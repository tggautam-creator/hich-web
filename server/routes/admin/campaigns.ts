/**
 * Slice 1.4 — broadcast push notification composer.
 *
 *   GET  /api/admin/campaigns/audience/preview
 *        body? — none; uses query string `?type=...&...`. Returns
 *        { count, sample_users[] } so the composer can show
 *        "this will reach X users" before the admin hits Send.
 *
 *   POST /api/admin/campaigns/push
 *        body { audience: {...}, title, body, reason? }
 *        Resolves the audience → recipient user_ids → push tokens,
 *        fans the push out via sendFcmPush, writes ONE notifications
 *        row per recipient (so they see the message in their inbox
 *        even if the push didn't deliver), and writes ONE audit_log
 *        row keyed on target_user_id=null (broadcast, not per-user).
 *
 * Audience descriptors (kept narrow on purpose — Phase 2's Slice
 * 2.1 will introduce a drag-drop custom audience builder; this
 * slice ships the half-dozen most-common pre-baked filters):
 *
 *   { type: 'all_users' }
 *   { type: 'all_drivers' }                  is_driver = true
 *   { type: 'all_riders' }                   is_driver = false
 *   { type: 'by_university', domain: '...' } email ILIKE %@<domain>
 *   { type: 'active_last_7d' }               last_active_at >= 7d ago
 *   { type: 'active_last_30d' }              last_active_at >= 30d ago
 *   { type: 'dormant_30d' }                  last_active_at IS NOT NULL
 *                                            AND last_active_at < 30d ago
 *
 * In all cases, suspended users are EXCLUDED from the recipient set
 * (no point pushing to someone who can't open the app).
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'
import { writeAuditLog } from '../../lib/adminAudit.ts'
import { sendFcmPush } from '../../lib/fcm.ts'

export const adminCampaignsRouter = Router()

// ── types ────────────────────────────────────────────────────────────────────

export type AudienceType =
  | 'all_users'
  | 'all_drivers'
  | 'all_riders'
  | 'by_university'
  | 'active_last_7d'
  | 'active_last_30d'
  | 'dormant_30d'

export interface Audience {
  type: AudienceType
  /** Required when type='by_university'. Lowercase domain (e.g. 'davis.edu'). */
  domain?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

interface UserMini {
  id: string
  email: string
  full_name: string | null
}

/**
 * Resolves an audience descriptor to the list of matching users.
 * Always excludes suspended users.
 *
 * Returns the FULL list (no pagination) because Tago's user count is
 * small enough today. When user counts cross ~50k we'll page through
 * via a SQL function or RPC instead of in-memory.
 */
export async function resolveAudience(audience: Audience): Promise<UserMini[]> {
  let query = supabaseAdmin
    .from('users')
    .select('id, email, full_name, is_driver, last_active_at, suspended_at')
    .is('suspended_at', null)

  if (audience.type === 'all_drivers') {
    query = query.eq('is_driver', true)
  } else if (audience.type === 'all_riders') {
    query = query.eq('is_driver', false)
  } else if (audience.type === 'by_university') {
    if (!audience.domain) return []
    // ILIKE '%@<domain>' — match emails whose domain part equals the
    // supplied string (case-insensitive). Strip a leading '@' if the
    // admin typed it.
    const dom = audience.domain.replace(/^@/, '').toLowerCase()
    query = query.ilike('email', `%@${dom}`)
  } else if (audience.type === 'active_last_7d') {
    const cutoff = new Date(Date.now() - 7 * DAY_MS).toISOString()
    query = query.gte('last_active_at', cutoff)
  } else if (audience.type === 'active_last_30d') {
    const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString()
    query = query.gte('last_active_at', cutoff)
  } else if (audience.type === 'dormant_30d') {
    const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString()
    query = query.lt('last_active_at', cutoff).not('last_active_at', 'is', null)
  }
  // type='all_users' applies no extra filter beyond suspended.

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((u) => ({ id: u.id, email: u.email, full_name: u.full_name }))
}

function parseAudienceFromQuery(req: Request): Audience | null {
  const type = req.query['type']
  if (typeof type !== 'string') return null
  const validTypes: AudienceType[] = [
    'all_users', 'all_drivers', 'all_riders', 'by_university',
    'active_last_7d', 'active_last_30d', 'dormant_30d',
  ]
  if (!validTypes.includes(type as AudienceType)) return null
  const domain = typeof req.query['domain'] === 'string' ? req.query['domain'] : undefined
  return { type: type as AudienceType, domain }
}

function parseAudienceFromBody(body: unknown): Audience | null {
  if (!body || typeof body !== 'object') return null
  const a = body as { type?: unknown; domain?: unknown }
  if (typeof a.type !== 'string') return null
  const validTypes: AudienceType[] = [
    'all_users', 'all_drivers', 'all_riders', 'by_university',
    'active_last_7d', 'active_last_30d', 'dormant_30d',
  ]
  if (!validTypes.includes(a.type as AudienceType)) return null
  const domain = typeof a.domain === 'string' ? a.domain : undefined
  return { type: a.type as AudienceType, domain }
}

// ── GET /audience/preview ───────────────────────────────────────────────────

adminCampaignsRouter.get(
  '/audience/preview',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audience = parseAudienceFromQuery(req)
      if (!audience) {
        res.status(400).json({
          error: { code: 'INVALID_AUDIENCE', message: '`type` must be a valid audience type' },
        })
        return
      }
      if (audience.type === 'by_university' && !audience.domain) {
        res.status(400).json({
          error: { code: 'DOMAIN_REQUIRED', message: '`domain` is required when type=by_university' },
        })
        return
      }
      const usersRaw = await resolveAudience(audience)

      // Apply the same notification_preferences.push_promos opt-out
      // filter the send endpoint applies, so the count the admin sees
      // matches the actual reach. Users without a preferences row
      // default to opt-in (push_promos defaults true).
      let users = usersRaw
      if (usersRaw.length > 0) {
        const ids = usersRaw.map((u) => u.id)
        const { data: optOuts, error: optErr } = await supabaseAdmin
          .from('notification_preferences')
          .select('user_id, push_promos')
          .in('user_id', ids)
          .eq('push_promos', false)
        if (optErr) throw optErr
        const optOutIds = new Set(
          ((optOuts ?? []) as Array<{ user_id: string; push_promos: boolean }>).map((p) => p.user_id),
        )
        users = usersRaw.filter((u) => !optOutIds.has(u.id))
      }

      const sample = users.slice(0, 10)
      res.status(200).json({
        ok: true,
        audience,
        count: users.length,
        opted_out_count: usersRaw.length - users.length,
        sample_users: sample,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /push ──────────────────────────────────────────────────────────────

interface SendPushBody {
  audience?: unknown
  title?: unknown
  body?: unknown
  reason?: unknown
  /** Safety: require the admin to re-enter the audience count from the preview. Prevents stale-count sends. */
  confirm_count?: unknown
  /** Public URL of an uploaded poster image (campaign-posters bucket). Optional. */
  poster_url?: unknown
  /**
   * Slice 1.4d test-mode. When true, the recipient set is forced to
   * just the calling admin's user_id (audience is still recorded on
   * the campaign row for traceability, but no fan-out happens). Lets
   * the admin preview the actual push + inbox + /c/<slug> page
   * before broadcasting to real users.
   */
  test_to_self?: unknown
}

/**
 * Generates a short URL-friendly slug for the campaign. 10 chars of
 * base36 ≈ 3.7 quadrillion combinations — collision-free in practice
 * for Tago's volume; if a collision ever happens, the INSERT below
 * will 23505 and we retry.
 */
function generateCampaignSlug(): string {
  let s = ''
  for (let i = 0; i < 10; i++) {
    s += Math.floor(Math.random() * 36).toString(36)
  }
  return s
}

adminCampaignsRouter.post(
  '/push',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as SendPushBody
      const audience = parseAudienceFromBody(b.audience)
      if (!audience) {
        res.status(400).json({
          error: { code: 'INVALID_AUDIENCE', message: '`audience.type` must be a valid audience type' },
        })
        return
      }
      if (audience.type === 'by_university' && !audience.domain) {
        res.status(400).json({
          error: { code: 'DOMAIN_REQUIRED', message: '`audience.domain` is required when type=by_university' },
        })
        return
      }
      const title = typeof b.title === 'string' ? b.title.trim() : ''
      const body = typeof b.body === 'string' ? b.body.trim() : ''
      const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
      const confirmCount = typeof b.confirm_count === 'number' ? Math.floor(b.confirm_count) : null
      // Posters arrive as already-uploaded public URLs from the
      // campaign-posters bucket. We store the URL on the campaign row
      // and include it in the push payload data field so the SW can
      // render it in the banner + the detail page renders it inline.
      const posterUrl = typeof b.poster_url === 'string' && b.poster_url.trim().length > 0
        ? b.poster_url.trim()
        : null
      const testToSelf = b.test_to_self === true
      if (!title || !body) {
        res.status(400).json({
          error: { code: 'INVALID_BODY', message: 'title and body are required' },
        })
        return
      }
      if (title.length > 120 || body.length > 500) {
        res.status(400).json({
          error: { code: 'TOO_LONG', message: 'title ≤ 120 chars, body ≤ 500 chars' },
        })
        return
      }

      // 1. Resolve audience.
      //    test_to_self short-circuits the audience and routes the
      //    push exclusively to the calling admin so they can preview
      //    end-to-end (banner + inbox + /c/<slug>) before going broad.
      //    Audience is still recorded on the campaign row for
      //    traceability — recipient_count just reads 1.
      const callerId = res.locals['userId'] as string
      const users = testToSelf
        ? [{ id: callerId, email: '', full_name: null }]
        : await resolveAudience(audience)
      let recipientIds = users.map((u) => u.id)

      // 1.5 Honor user opt-outs (notification_preferences.push_promos).
      //     Skipped for test_to_self — the admin is opting into their own
      //     preview deliberately. Users without a notification_preferences
      //     row default to opt-IN (push_promos defaults true) so they
      //     stay in the recipient set.
      if (!testToSelf && recipientIds.length > 0) {
        const { data: optOuts, error: optErr } = await supabaseAdmin
          .from('notification_preferences')
          .select('user_id, push_promos')
          .in('user_id', recipientIds)
          .eq('push_promos', false)
        if (optErr) throw optErr
        const optOutIds = new Set(
          ((optOuts ?? []) as Array<{ user_id: string; push_promos: boolean }>).map((p) => p.user_id),
        )
        recipientIds = recipientIds.filter((id) => !optOutIds.has(id))
      }

      // 2. Optional safety: if the admin passed `confirm_count` (the
      // value the preview returned), require it to match the current
      // resolution. Catches the case where 60+ seconds pass between
      // preview + send and new users have signed up.
      // Skipped for test_to_self (single-user send by definition).
      if (!testToSelf && confirmCount !== null && confirmCount !== recipientIds.length) {
        res.status(409).json({
          error: {
            code: 'AUDIENCE_DRIFT',
            message: `Audience size changed since preview (was ${confirmCount}, now ${recipientIds.length}). Re-preview and confirm.`,
          },
          previous_count: confirmCount,
          current_count: recipientIds.length,
        })
        return
      }

      // 2.5 Create the campaigns row up-front so we have a slug for
      // the deep link in the push payload. Done before sending so a
      // zero-recipient broadcast still leaves a campaign row in
      // history (admins can see "tried to broadcast to dormant_30d,
      // hit 0 users"). Slug retry once on collision.
      const adminId = res.locals['userId'] as string
      let slug = generateCampaignSlug()
      let campaignId: string | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: created, error: createErr } = await supabaseAdmin
          .from('campaigns')
          .insert({
            slug,
            // Cast — Audience is a typed union but the DB column is
            // jsonb (Record<string, unknown>). The two are structurally
            // compatible; the cast is just to satisfy the index-signature
            // requirement on Insert.
            audience: audience as unknown as Record<string, unknown>,
            title,
            body,
            poster_url: posterUrl,
            recipient_count: recipientIds.length,
            push_sent_count: 0, // updated after send
            sent_by: adminId,
          })
          .select('id, slug')
          .single()
        if (createErr) {
          // 23505 = unique_violation on the slug. Regenerate + retry.
          if ((createErr as { code?: string }).code === '23505') {
            slug = generateCampaignSlug()
            continue
          }
          throw createErr
        }
        campaignId = created.id
        slug = created.slug
        break
      }
      if (!campaignId) {
        // Three slug collisions in a row is statistically impossible —
        // something else is wrong. Fail loud.
        res.status(500).json({
          error: {
            code: 'CAMPAIGN_INSERT_FAILED',
            message: 'Could not create campaign row after slug retries.',
          },
        })
        return
      }

      if (recipientIds.length === 0) {
        res.status(200).json({
          ok: true,
          campaign_id: campaignId,
          slug,
          recipient_count: 0,
          push_sent: 0,
          notifications_written: 0,
          audience,
        })
        return
      }

      // 3. Fetch tokens for the recipients.
      const { data: tokenRows, error: tokenErr } = await supabaseAdmin
        .from('push_tokens')
        .select('user_id, token')
        .in('user_id', recipientIds)
      if (tokenErr) throw tokenErr
      const tokens = (tokenRows ?? []).map((t) => t.token)

      // 4. Fire the push (best-effort; failures per token are
      // swallowed by sendFcmPush which returns a count of successes).
      // Data payload carries:
      //   - type='admin_broadcast' so the SW + iOS router know to
      //     deep-link to /c/<slug>
      //   - slug + campaign_id so the router can resolve the URL
      //   - image (when posterUrl set) so the SW can render it in
      //     the notification banner (Android + web; iOS needs an
      //     NSE which lands in Slice 1.4c)
      const pushData: Record<string, string> = {
        source: 'admin_panel',
        type: 'admin_broadcast',
        campaign_id: campaignId,
        slug,
      }
      if (posterUrl) pushData['image'] = posterUrl
      const pushSent = tokens.length > 0
        ? await sendFcmPush(tokens, {
            title,
            body,
            data: pushData,
          })
        : 0

      // 5. Write ONE notifications row per recipient so they have an
      // in-app inbox entry regardless of push delivery success.
      const notifInserts = recipientIds.map((uid) => ({
        user_id: uid,
        type: 'admin_broadcast',
        title,
        body,
        data: { ...pushData, poster_url: posterUrl },
      }))
      const { error: notifErr } = await supabaseAdmin
        .from('notifications')
        .insert(notifInserts)
      if (notifErr) {
        console.warn('[adminCampaign] notifications batch insert failed:', notifErr.message)
        // Don't 500 — the push already went out, the notif insert is a
        // record-keeping nicety not a delivery requirement.
      }

      // 6. Update the campaign row with the final push count + audit.
      await supabaseAdmin
        .from('campaigns')
        .update({ push_sent_count: pushSent })
        .eq('id', campaignId)

      // 7. Audit log — single row, target_user_id null (broadcast).
      await writeAuditLog({
        adminId,
        targetUserId: null,
        action: 'send_campaign_push',
        payload: {
          campaign_id: campaignId,
          slug,
          audience,
          title,
          body,
          reason: reason || null,
          poster_url: posterUrl,
          recipient_count: recipientIds.length,
          push_sent: pushSent,
          tokens_attempted: tokens.length,
        },
      })

      res.status(200).json({
        ok: true,
        campaign_id: campaignId,
        slug,
        recipient_count: recipientIds.length,
        push_sent: pushSent,
        tokens_attempted: tokens.length,
        notifications_written: notifErr ? 0 : recipientIds.length,
        audience,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET / (campaign history list) ───────────────────────────────────────────

adminCampaignsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(
        Math.max(parseInt(String(req.query['limit'] ?? '25'), 10) || 25, 1),
        100,
      )
      const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0)

      const { data, count, error } = await supabaseAdmin
        .from('campaigns')
        .select(
          'id, slug, audience, title, body, poster_url, recipient_count, push_sent_count, sent_by, sent_at, recalled_at, recalled_reason, recalled_by',
          { count: 'exact' },
        )
        .order('sent_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (error) throw error

      // Hydrate sender + recaller emails so the UI doesn't have to round-trip.
      const adminIds = new Set<string>()
      for (const c of data ?? []) {
        adminIds.add(c.sent_by)
        if (c.recalled_by) adminIds.add(c.recalled_by)
      }
      const emailById = new Map<string, string>()
      if (adminIds.size > 0) {
        const { data: senders, error: sErr } = await supabaseAdmin
          .from('users')
          .select('id, email')
          .in('id', Array.from(adminIds))
        if (sErr) throw sErr
        for (const s of senders ?? []) emailById.set(s.id, s.email)
      }

      res.status(200).json({
        ok: true,
        campaigns: (data ?? []).map((c) => ({
          ...c,
          sent_by_email: emailById.get(c.sent_by) ?? null,
          recalled_by_email: c.recalled_by ? emailById.get(c.recalled_by) ?? null : null,
        })),
        total: count ?? data?.length ?? 0,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /:id/recall ────────────────────────────────────────────────────────

interface RecallBody {
  reason?: unknown
}

adminCampaignsRouter.post(
  '/:id/recall',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawId = req.params['id']
      const campaignId = typeof rawId === 'string' ? rawId : ''
      if (!campaignId) {
        res.status(400).json({
          error: { code: 'INVALID_CAMPAIGN_ID', message: 'campaign id required' },
        })
        return
      }

      const reason = typeof (req.body as RecallBody).reason === 'string'
        ? ((req.body as RecallBody).reason as string).trim()
        : ''
      if (!reason) {
        res.status(400).json({
          error: { code: 'REASON_REQUIRED', message: 'A reason is required to recall a campaign.' },
        })
        return
      }

      const { data: campaign, error: lookupErr } = await supabaseAdmin
        .from('campaigns')
        .select('id, slug, recalled_at')
        .eq('id', campaignId)
        .maybeSingle()
      if (lookupErr) throw lookupErr
      if (!campaign) {
        res.status(404).json({
          error: { code: 'CAMPAIGN_NOT_FOUND', message: 'No campaign with that id.' },
        })
        return
      }
      if (campaign.recalled_at !== null) {
        res.status(409).json({
          error: { code: 'ALREADY_RECALLED', message: 'This campaign was already recalled.' },
        })
        return
      }

      const adminId = res.locals['userId'] as string

      // 1. Wipe the in-app inbox copies. notifications.data is jsonb;
      // we filter on the campaign_id field we wrote at send-time.
      // PostgREST exposes jsonb-key access via `data->>campaign_id`.
      const { data: deleted, error: delErr } = await supabaseAdmin
        .from('notifications')
        .delete()
        .eq('type', 'admin_broadcast')
        .filter('data->>campaign_id', 'eq', campaignId)
        .select('id')
      if (delErr) throw delErr
      const deletedCount = deleted?.length ?? 0

      // 2. Soft-delete the campaign so /c/<slug> 404s + the row shows
      // as RECALLED in the history list.
      const { error: updateErr } = await supabaseAdmin
        .from('campaigns')
        .update({
          recalled_at: new Date().toISOString(),
          recalled_reason: reason,
          recalled_by: adminId,
        })
        .eq('id', campaignId)
      if (updateErr) throw updateErr

      // 3. Audit log.
      await writeAuditLog({
        adminId,
        targetUserId: null,
        action: 'recall_campaign',
        payload: {
          campaign_id: campaignId,
          slug: campaign.slug,
          reason,
          notifications_deleted: deletedCount,
        },
      })

      res.status(200).json({
        ok: true,
        campaign_id: campaignId,
        notifications_deleted: deletedCount,
      })
    } catch (err) {
      next(err)
    }
  },
)
