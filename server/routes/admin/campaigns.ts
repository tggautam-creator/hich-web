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
      const users = await resolveAudience(audience)
      // Surface a small sample (up to 10) so the admin can sanity-check
      // who they're about to message. Real send still hits all users.
      const sample = users.slice(0, 10)
      res.status(200).json({
        ok: true,
        audience,
        count: users.length,
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
      const users = await resolveAudience(audience)
      const recipientIds = users.map((u) => u.id)

      // 2. Optional safety: if the admin passed `confirm_count` (the
      // value the preview returned), require it to match the current
      // resolution. Catches the case where 60+ seconds pass between
      // preview + send and new users have signed up.
      if (confirmCount !== null && confirmCount !== recipientIds.length) {
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

      if (recipientIds.length === 0) {
        res.status(200).json({
          ok: true,
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
      const pushSent = tokens.length > 0
        ? await sendFcmPush(tokens, {
            title,
            body,
            data: { source: 'admin_panel', campaign_kind: 'broadcast' },
          })
        : 0

      // 5. Write ONE notifications row per recipient so they have an
      // in-app inbox entry regardless of push delivery success.
      const notifInserts = recipientIds.map((uid) => ({
        user_id: uid,
        type: 'admin_broadcast',
        title,
        body,
        data: { source: 'admin_panel', campaign_kind: 'broadcast' },
      }))
      const { error: notifErr } = await supabaseAdmin
        .from('notifications')
        .insert(notifInserts)
      if (notifErr) {
        console.warn('[adminCampaign] notifications batch insert failed:', notifErr.message)
        // Don't 500 — the push already went out, the notif insert is a
        // record-keeping nicety not a delivery requirement.
      }

      // 6. Audit log — single row, target_user_id null (broadcast).
      await writeAuditLog({
        adminId: res.locals['userId'] as string,
        targetUserId: null,
        action: 'send_campaign_push',
        payload: {
          audience,
          title,
          body,
          reason: reason || null,
          recipient_count: recipientIds.length,
          push_sent: pushSent,
          tokens_attempted: tokens.length,
        },
      })

      res.status(200).json({
        ok: true,
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
