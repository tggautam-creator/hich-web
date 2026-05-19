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
import {
  sendPersonalizedEmailToMany,
  isAllowedFromAddress,
  FROM_ADDRESS_ALLOWLIST,
} from '../../lib/resend.ts'
import { computeFunnelData, STEP_ORDER, type FunnelStep } from './funnel.ts'

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
  // Slice 1.7c — funnel-step nudges. "stuck_after_<step>" =
  // users whose furthest funnel step is exactly <step> and they
  // never progressed to the next. Reuses computeFunnelData so the
  // exact same membership rules drive both /admin/funnel and these
  // audiences (no drift between what the funnel chart shows and
  // who a campaign actually reaches).
  | 'stuck_after_signup'             // signed up, never verified email
  | 'stuck_after_verified_email'     // verified email, never completed profile
  | 'stuck_after_completed_profile'  // completed profile, no payment method / vehicle
  | 'stuck_after_payment_or_vehicle' // has payment / vehicle, no first ride yet

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
/**
 * Maps a stuck-after-* audience type to the funnel step the user must
 * be CURRENTLY parked at (their maxStep === this index, never made it
 * to the next). Null = not a stuck-step audience.
 */
const STUCK_STEP_BY_TYPE: Partial<Record<AudienceType, FunnelStep>> = {
  stuck_after_signup: 'signed_up',
  stuck_after_verified_email: 'verified_email',
  stuck_after_completed_profile: 'completed_profile',
  stuck_after_payment_or_vehicle: 'payment_or_vehicle',
}

export async function resolveAudience(audience: Audience): Promise<UserMini[]> {
  // Stuck-step audiences run the funnel computation rather than a flat
  // users query. The opt-out filter applied downstream still works the
  // same — these are users that have signed up, so the
  // notification_preferences gate behaves identically.
  const stuckStep = STUCK_STEP_BY_TYPE[audience.type]
  if (stuckStep) {
    const stepIdx = STEP_ORDER.indexOf(stuckStep)
    // Run across all-time, both roles. Cohort restriction by date or
    // role would deny marketing the ability to nudge older inactive
    // users, which is the most common use case for these audiences.
    const { cohort, maxStepByUserId } = await computeFunnelData('all', 'both')
    // Filter out suspended users defensively. computeFunnelData uses
    // the public.users base table which we can't currently filter by
    // suspended_at without duplicating the query — easier to drop them
    // here.
    const { data: suspended, error: susErr } = await supabaseAdmin
      .from('users')
      .select('id')
      .not('suspended_at', 'is', null)
    if (susErr) throw susErr
    const suspendedIds = new Set(
      ((suspended ?? []) as Array<{ id: string }>).map((u) => u.id),
    )
    const stuck = cohort.filter((u) => {
      if (suspendedIds.has(u.id)) return false
      const max = maxStepByUserId.get(u.id) ?? 0
      return max === stepIdx
    })
    return stuck.map((u) => ({ id: u.id, email: u.email, full_name: u.full_name }))
  }

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
    'stuck_after_signup',
    'stuck_after_verified_email',
    'stuck_after_completed_profile',
    'stuck_after_payment_or_vehicle',
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
    'stuck_after_signup',
    'stuck_after_verified_email',
    'stuck_after_completed_profile',
    'stuck_after_payment_or_vehicle',
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
      // Slice 1.5 — apply the right opt-out filter based on channel.
      // ?channel=email uses notification_preferences.email_marketing;
      // anything else (default push) uses push_promos.
      const channel = req.query['channel'] === 'email' ? 'email' : 'push'
      const optOutColumn = channel === 'email' ? 'email_marketing' : 'push_promos'

      const usersRaw = await resolveAudience(audience)

      // Apply the channel-appropriate opt-out filter so the count the
      // admin sees matches the actual reach. Users without a
      // preferences row default to opt-in (both columns default true).
      let users = usersRaw
      if (usersRaw.length > 0) {
        const ids = usersRaw.map((u) => u.id)
        const { data: optOuts, error: optErr } = await supabaseAdmin
          .from('notification_preferences')
          .select(`user_id, ${optOutColumn}`)
          .in('user_id', ids)
          .eq(optOutColumn, false)
        if (optErr) throw optErr
        const optOutIds = new Set(
          ((optOuts ?? []) as Array<{ user_id: string }>).map((p) => p.user_id),
        )
        users = usersRaw.filter((u) => !optOutIds.has(u.id))
      }

      const sample = users.slice(0, 10)
      res.status(200).json({
        ok: true,
        audience,
        channel,
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
  /** Slice 1.6 — optional destination URL the poster should open
   * when clicked from the CampaignDetailPage / View. Persisted on
   * the row + returned by the public /api/campaigns/:slug endpoint. */
  poster_link_url?: unknown
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
      const pushPosterLinkUrl = typeof b.poster_link_url === 'string' && b.poster_link_url.trim().length > 0
        ? b.poster_link_url.trim()
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
            poster_link_url: pushPosterLinkUrl,
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
          poster_link_url: pushPosterLinkUrl,
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
          'id, slug, audience, title, body, poster_url, poster_link_url, recipient_count, push_sent_count, sent_by, sent_at, recalled_at, recalled_reason, recalled_by, channel, email_from, failed_emails',
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

// ── GET /from-addresses (Slice 1.5 — email composer dropdown) ──────────────

adminCampaignsRouter.get(
  '/from-addresses',
  (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, addresses: FROM_ADDRESS_ALLOWLIST })
  },
)

// ── POST /email (Slice 1.5 — broadcast email via Resend) ───────────────────

interface SendEmailBody {
  audience?: unknown
  subject?: unknown
  body_html?: unknown
  from?: unknown
  reason?: unknown
  confirm_count?: unknown
  test_to_self?: unknown
  /** Slice 1.6 — optional marketing hero image (Supabase Storage URL,
   * uploaded to the same `campaign-posters` bucket as push posters).
   * When present, the server prepends an `<img>` tag at the top of
   * the email body so it renders as the hero. */
  poster_url?: unknown
  /** Slice 1.6 — optional destination URL the poster should open
   * when clicked. When set alongside poster_url, the prepended
   * `<img>` is wrapped in an `<a href="...">`. Also persisted so
   * the campaign detail page (web + iOS) can mirror the click target. */
  poster_link_url?: unknown
}

/**
 * Slice 1.6 — Tago-branded footer auto-appended to every marketing
 * email. Standard practice (Mailchimp / WotC / etc.) — gives the
 * recipient legal / unsubscribe context without the admin having to
 * type it every campaign. Inline styles only (Gmail/Outlook strip
 * `<style>` blocks).
 *
 * Unsubscribe links to `/settings` — once the recipient logs in
 * there's a notification-preferences row with an `email_marketing`
 * toggle. (Full per-recipient one-click unsubscribe tokens are a
 * Phase 2 item; the settings-page path satisfies CAN-SPAM and the
 * server-side opt-out filter at send time honors the flag.)
 */
const EMAIL_FOOTER_HTML = `
<div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;text-align:center;">
  <p style="margin:0 0 8px 0;">
    ©2026 <strong style="color:#374151;">Tago</strong>. Carpooling for university students.
  </p>
  <p style="margin:0 0 12px 0;">
    <a href="https://www.tagorides.com/terms" style="color:#6b7280;text-decoration:underline;">Terms of Use</a>
    &nbsp;·&nbsp;
    <a href="https://www.tagorides.com/privacy" style="color:#6b7280;text-decoration:underline;">Privacy</a>
    &nbsp;·&nbsp;
    <a href="https://www.tagorides.com/settings" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
  </p>
  <p style="margin:0;font-size:11px;color:#9ca3af;">
    You received this email because you have a Tago account. To stop receiving marketing emails, visit your <a href="https://www.tagorides.com/settings" style="color:#9ca3af;text-decoration:underline;">notification settings</a>.
  </p>
</div>`

function htmlToPlainText(html: string): string {
  // Tiny strip — Resend expects either html OR text; we only send html
  // but log a plain-text variant in the audit row so support can grep
  // recall reasons later. Not security-critical (we control the input).
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

adminCampaignsRouter.post(
  '/email',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as SendEmailBody
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
      const subject = typeof b.subject === 'string' ? b.subject.trim() : ''
      const html = typeof b.body_html === 'string' ? b.body_html.trim() : ''
      const fromRaw = typeof b.from === 'string' ? b.from.trim().toLowerCase() : ''
      const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
      const confirmCount = typeof b.confirm_count === 'number' ? Math.floor(b.confirm_count) : null
      const testToSelf = b.test_to_self === true
      const posterUrl = typeof b.poster_url === 'string' && b.poster_url.trim().length > 0
        ? b.poster_url.trim()
        : null
      const posterLinkUrl = typeof b.poster_link_url === 'string' && b.poster_link_url.trim().length > 0
        ? b.poster_link_url.trim()
        : null

      if (!subject || !html) {
        res.status(400).json({
          error: { code: 'INVALID_BODY', message: 'subject and body_html are required' },
        })
        return
      }
      if (subject.length > 200) {
        res.status(400).json({
          error: { code: 'TOO_LONG', message: 'subject must be ≤ 200 chars' },
        })
        return
      }
      if (html.length > 50_000) {
        res.status(400).json({
          error: { code: 'TOO_LONG', message: 'body_html must be ≤ 50,000 chars' },
        })
        return
      }
      if (!fromRaw || !isAllowedFromAddress(fromRaw)) {
        res.status(400).json({
          error: {
            code: 'INVALID_FROM',
            message: '`from` must be one of the allowlisted addresses (see /api/admin/campaigns/from-addresses).',
          },
        })
        return
      }

      const adminId = res.locals['userId'] as string

      // 1. Resolve audience. test_to_self short-circuits to the
      //    caller's own user (email lookup happens below).
      let cohortUserIds: string[]
      if (testToSelf) {
        cohortUserIds = [adminId]
      } else {
        const users = await resolveAudience(audience)
        cohortUserIds = users.map((u) => u.id)
      }

      // 1.5 Honor email_marketing opt-outs (vs push_promos for push).
      if (!testToSelf && cohortUserIds.length > 0) {
        const { data: optOuts, error: optErr } = await supabaseAdmin
          .from('notification_preferences')
          .select('user_id, email_marketing')
          .in('user_id', cohortUserIds)
          .eq('email_marketing', false)
        if (optErr) throw optErr
        const optOutIds = new Set(
          ((optOuts ?? []) as Array<{ user_id: string; email_marketing: boolean }>).map((p) => p.user_id),
        )
        cohortUserIds = cohortUserIds.filter((id) => !optOutIds.has(id))
      }

      // 2. Drift check (skipped for test_to_self).
      if (!testToSelf && confirmCount !== null && confirmCount !== cohortUserIds.length) {
        res.status(409).json({
          error: {
            code: 'AUDIENCE_DRIFT',
            message: `Audience size changed since preview (was ${confirmCount}, now ${cohortUserIds.length}). Re-preview and confirm.`,
          },
          previous_count: confirmCount,
          current_count: cohortUserIds.length,
        })
        return
      }

      // 3. Create the campaign row. Persist the ORIGINAL author HTML
      //    in `body` so a future Duplicate-from-history pre-fills the
      //    composer with just the author's content, not our prepended
      //    hero `<img>`. The hero is reconstructed at send time from
      //    `poster_url` — single source of truth.
      let slug = generateCampaignSlug()
      let campaignId: string | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: created, error: createErr } = await supabaseAdmin
          .from('campaigns')
          .insert({
            slug,
            audience: audience as unknown as Record<string, unknown>,
            title: subject,
            body: html,
            poster_url: posterUrl,
            poster_link_url: posterLinkUrl,
            recipient_count: cohortUserIds.length,
            push_sent_count: 0,
            sent_by: adminId,
            channel: 'email',
            email_from: fromRaw,
          })
          .select('id, slug')
          .single()
        if (createErr) {
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
        res.status(500).json({
          error: {
            code: 'CAMPAIGN_INSERT_FAILED',
            message: 'Could not create campaign row after slug retries.',
          },
        })
        return
      }

      if (cohortUserIds.length === 0) {
        res.status(200).json({
          ok: true,
          campaign_id: campaignId,
          slug,
          recipient_count: 0,
          sent: 0,
          failed: 0,
        })
        return
      }

      // 4. Look up email + name for the recipients. `full_name` is
      //    needed for per-recipient `{{name}}` / `{{first_name}}`
      //    substitution at send time (mail merge).
      const { data: emailRows, error: emailErr } = await supabaseAdmin
        .from('users')
        .select('id, email, full_name')
        .in('id', cohortUserIds)
      if (emailErr) throw emailErr
      const recipients = (emailRows ?? [])
        .filter((u): u is { id: string; email: string; full_name: string | null } =>
          typeof u.email === 'string' && u.email.length > 0,
        )
        .map((u) => ({ email: u.email, full_name: u.full_name }))

      // 5. Fire the batch send via Resend. Hero image (if any) is
      //    prepended as a centered <img> with sane mobile-friendly
      //    styling — full-width on phones, capped at 600px on desktop.
      //    Inline styles only (Gmail / Outlook strip <style> blocks).
      //    When poster_link_url is set, the <img> is wrapped in an
      //    <a href="..."> so the hero is clickable in the inbox.
      //    Branded footer auto-appended.
      const imgTag = posterUrl
        ? `<img src="${posterUrl}" alt="" ` +
          `style="display:block;width:100%;max-width:600px;height:auto;` +
            `border-radius:8px;margin:0 auto;border:0;" />`
        : ''
      const heroBlock = posterUrl
        ? `<div style="text-align:center;margin-bottom:16px;">` +
            (posterLinkUrl
              ? `<a href="${posterLinkUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${imgTag}</a>`
              : imgTag) +
          `</div>`
        : ''
      const finalHtml = heroBlock + html + EMAIL_FOOTER_HTML

      // 2026-05-18 — personalize per recipient. `subject` + `finalHtml`
      // are templates with optional `{{name}}` / `{{first_name}}`
      // tokens; the sender resolves them per recipient using their
      // `full_name`. Recipients with no full_name see their email
      // username as the fallback (see lib/personalize.ts).
      const sendResult = await sendPersonalizedEmailToMany({
        from: fromRaw,
        subjectTemplate: subject,
        htmlTemplate: finalHtml,
        recipients,
      })

      // 6. Update the campaign row with delivered count (reusing
      //    push_sent_count as a generic "delivered count" across
      //    channels — fine for now; if we grow channel-specific
      //    counters, rename in a follow-up migration). Also persist
      //    the failed recipient list so the Retry button on past
      //    campaigns can target only those addresses.
      const failedEmailsToStore = sendResult.failedRecipients.map((f) => f.email)
      await supabaseAdmin
        .from('campaigns')
        .update({
          push_sent_count: sendResult.sent,
          failed_emails: failedEmailsToStore,
        })
        .eq('id', campaignId)

      // 7. Audit.
      await writeAuditLog({
        adminId,
        targetUserId: null,
        action: 'send_campaign_email',
        payload: {
          campaign_id: campaignId,
          slug,
          audience,
          subject,
          body_plain_preview: htmlToPlainText(html).slice(0, 200),
          poster_url: posterUrl,
          poster_link_url: posterLinkUrl,
          from: fromRaw,
          reason: reason || null,
          recipient_count: cohortUserIds.length,
          sent: sendResult.sent,
          failed: sendResult.failed,
          failed_emails_count: failedEmailsToStore.length,
        },
      })

      res.status(200).json({
        ok: true,
        campaign_id: campaignId,
        slug,
        recipient_count: cohortUserIds.length,
        sent: sendResult.sent,
        failed: sendResult.failed,
        failed_emails: failedEmailsToStore,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /campaigns/:id/retry-failed ────────────────────────────────────────
//
// Re-send an email campaign to only the recipients whose original send
// failed (Resend rate-limit, transient bounce, etc). The original
// campaign row holds the subject in `title`, the body template in
// `body`, and the failed addresses in `failed_emails`. We re-resolve
// `full_name` for those emails so `{{name}}` substitution still works,
// run the throttled per-recipient send, then REWRITE `failed_emails`
// with the still-failed set so a clean retry is a no-op next time.
//
// Constraints:
//   - Only `channel='email'` campaigns are retryable through this path.
//   - The campaign must not have been recalled.
//   - Empty `failed_emails` returns 200 with sent=0 (clean no-op).

adminCampaignsRouter.post(
  '/:id/retry-failed',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']
      if (typeof id !== 'string' || id.length === 0) {
        res.status(400).json({
          error: { code: 'INVALID_ID', message: 'campaign id is required' },
        })
        return
      }
      const adminId = res.locals['userId'] as string

      // Load the campaign so we have subject/body + the failed list.
      const { data: campaign, error: lookupErr } = await supabaseAdmin
        .from('campaigns')
        .select(
          'id, slug, channel, email_from, title, body, poster_url, poster_link_url, failed_emails, push_sent_count, recalled_at',
        )
        .eq('id', id)
        .maybeSingle()
      if (lookupErr) throw lookupErr
      if (!campaign) {
        res.status(404).json({
          error: { code: 'CAMPAIGN_NOT_FOUND', message: 'campaign does not exist' },
        })
        return
      }
      if (campaign.channel !== 'email') {
        res.status(400).json({
          error: {
            code: 'WRONG_CHANNEL',
            message: 'retry-failed only supports email campaigns',
          },
        })
        return
      }
      if (campaign.recalled_at) {
        res.status(409).json({
          error: {
            code: 'CAMPAIGN_RECALLED',
            message: 'cannot retry a recalled campaign',
          },
        })
        return
      }
      const failedEmails = (campaign.failed_emails ?? []) as string[]
      if (failedEmails.length === 0) {
        res.status(200).json({
          ok: true,
          campaign_id: id,
          sent: 0,
          failed: 0,
          failed_emails: [],
          note: 'no failed recipients to retry',
        })
        return
      }
      if (!campaign.email_from || !isAllowedFromAddress(campaign.email_from)) {
        res.status(400).json({
          error: {
            code: 'INVALID_FROM',
            message: 'the campaign was sent from a non-allowlisted address',
          },
        })
        return
      }

      // Hydrate full_name for substitution. Missing users (e.g. they
      // deleted their account) still get the retry — the substitution
      // falls back to email username automatically.
      const { data: userRows, error: userErr } = await supabaseAdmin
        .from('users')
        .select('email, full_name')
        .in('email', failedEmails)
      if (userErr) throw userErr
      const nameByEmail = new Map<string, string | null>()
      for (const u of userRows ?? []) {
        if (u.email) nameByEmail.set(u.email, u.full_name)
      }
      const recipients = failedEmails.map((email) => ({
        email,
        full_name: nameByEmail.get(email) ?? null,
      }))

      // Reconstruct hero + footer the same way the original send did.
      const imgTag = campaign.poster_url
        ? `<img src="${campaign.poster_url}" alt="" ` +
          `style="display:block;width:100%;max-width:600px;height:auto;` +
            `border-radius:8px;margin:0 auto;border:0;" />`
        : ''
      const heroBlock = campaign.poster_url
        ? `<div style="text-align:center;margin-bottom:16px;">` +
            (campaign.poster_link_url
              ? `<a href="${campaign.poster_link_url}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${imgTag}</a>`
              : imgTag) +
          `</div>`
        : ''
      const finalHtml = heroBlock + campaign.body + EMAIL_FOOTER_HTML

      const sendResult = await sendPersonalizedEmailToMany({
        from: campaign.email_from,
        subjectTemplate: campaign.title,
        htmlTemplate: finalHtml,
        recipients,
      })

      // Update campaign: bump delivered count, rewrite failed_emails
      // with the still-failed set so subsequent retries shrink it down
      // to zero or stop being offered.
      const newFailedEmails = sendResult.failedRecipients.map((f) => f.email)
      const newDeliveredCount = (campaign.push_sent_count ?? 0) + sendResult.sent
      const { error: updateErr } = await supabaseAdmin
        .from('campaigns')
        .update({
          push_sent_count: newDeliveredCount,
          failed_emails: newFailedEmails,
        })
        .eq('id', id)
      if (updateErr) throw updateErr

      await writeAuditLog({
        adminId,
        targetUserId: null,
        action: 'retry_campaign_email',
        payload: {
          campaign_id: id,
          slug: campaign.slug,
          attempted: failedEmails.length,
          sent: sendResult.sent,
          still_failed: newFailedEmails.length,
        },
      })

      res.status(200).json({
        ok: true,
        campaign_id: id,
        attempted: failedEmails.length,
        sent: sendResult.sent,
        failed: sendResult.failed,
        failed_emails: newFailedEmails,
      })
    } catch (err) {
      next(err)
    }
  },
)
