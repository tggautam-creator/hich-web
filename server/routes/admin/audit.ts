/**
 * `/api/admin/audit-log` — global audit log read endpoint (Slice 1.8).
 *
 * The per-user audit list (`GET /api/admin/users/:id/audit` in
 * actions.ts) is keyed on target_user_id and powers the Admin Actions
 * tab on user detail pages. This endpoint is the global feed —
 * EVERY admin write across EVERY user, filterable and paginated.
 *
 * Filters (all optional, AND'd together):
 *   - action          — exact match on the action token
 *                       ('send_push', 'grant_wallet_credit', etc.)
 *   - admin_id        — UUID of the admin who performed the action
 *   - target_user_id  — UUID of the user the action was performed on
 *                       (use 'null' string to filter for broadcast
 *                       campaigns which have no target)
 *
 * Pagination: limit (default 25, max 100) + offset.
 * Sort: newest-first (uses `idx_admin_audit_created` from migration 074).
 *
 * Hydrates admin_email AND target_email so the UI can render the row
 * end-to-end without per-row round trips. Suspended / deleted users
 * still resolve (we look up by id, not by active status).
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'

export const adminAuditRouter = Router()

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

interface AuditRow {
  id: string
  admin_id: string
  target_user_id: string | null
  action: string
  payload: Record<string, unknown>
  created_at: string
}

interface AuditRowResponse extends AuditRow {
  admin_email: string | null
  target_email: string | null
}

interface AuditListResponse {
  ok: true
  audit: AuditRowResponse[]
  total: number
  limit: number
  offset: number
  distinct_actions: string[]
}

adminAuditRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(
        Math.max(parseInt(String(req.query['limit'] ?? '25'), 10) || 25, 1),
        100,
      )
      const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0)

      const actionFilter = typeof req.query['action'] === 'string'
        ? String(req.query['action']).trim()
        : ''
      const adminIdFilter = typeof req.query['admin_id'] === 'string'
        ? String(req.query['admin_id']).trim()
        : ''
      const targetFilter = typeof req.query['target_user_id'] === 'string'
        ? String(req.query['target_user_id']).trim()
        : ''
      // Slice 1.8b — free-text search across `action` + the stringified
      // jsonb payload. Strips chars that would break a PostgREST .or()
      // filter (the `%` is fine, but `,` `(` `)` are delimiters).
      const qRaw = typeof req.query['q'] === 'string'
        ? String(req.query['q']).trim()
        : ''
      const qSafe = qRaw.replace(/[,()*]/g, '')

      // Validate UUID filters before they hit Postgres — a malformed
      // UUID bubbles up as a 500 from supabase-js otherwise.
      if (adminIdFilter && !UUID_RE.test(adminIdFilter)) {
        res.status(400).json({
          error: { code: 'INVALID_ADMIN_ID', message: 'admin_id must be a UUID' },
        })
        return
      }
      if (targetFilter && targetFilter !== 'null' && !UUID_RE.test(targetFilter)) {
        res.status(400).json({
          error: { code: 'INVALID_TARGET_USER_ID', message: 'target_user_id must be a UUID or "null"' },
        })
        return
      }

      let query = supabaseAdmin
        .from('admin_audit_log')
        .select(
          'id, admin_id, target_user_id, action, payload, created_at',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (actionFilter) query = query.eq('action', actionFilter)
      if (adminIdFilter) query = query.eq('admin_id', adminIdFilter)
      if (targetFilter === 'null') {
        query = query.is('target_user_id', null)
      } else if (targetFilter) {
        query = query.eq('target_user_id', targetFilter)
      }
      // Free-text: match either the action token or anything inside
      // the jsonb payload (cast to text so we don't need a separate
      // tsvector index — fine while admin_audit_log is small).
      if (qSafe.length > 0) {
        const pat = `%${qSafe}%`
        query = query.or(`action.ilike.${pat},payload::text.ilike.${pat}`)
      }

      const { data, count, error } = await query
      if (error) throw error
      const rows = (data ?? []) as AuditRow[]

      // Collect every admin + target id so we can hydrate emails in
      // one round trip. We dedupe across the two so a user that
      // appears as both admin and target only counts once.
      const userIds = new Set<string>()
      for (const r of rows) {
        userIds.add(r.admin_id)
        if (r.target_user_id) userIds.add(r.target_user_id)
      }

      const emailById = new Map<string, string>()
      if (userIds.size > 0) {
        const { data: userRows, error: usrErr } = await supabaseAdmin
          .from('users')
          .select('id, email')
          .in('id', Array.from(userIds))
        if (usrErr) throw usrErr
        for (const u of userRows ?? []) emailById.set(u.id, u.email)
      }

      const out: AuditRowResponse[] = rows.map((r) => ({
        ...r,
        admin_email: emailById.get(r.admin_id) ?? null,
        target_email: r.target_user_id ? (emailById.get(r.target_user_id) ?? null) : null,
      }))

      // Distinct action list powers the filter dropdown on the web
      // client without a second round trip. Pulled from the SAME
      // window we're paginating over to keep the response self-
      // contained; the client merges across pages if it wants the
      // exhaustive list.
      const distinctActions = Array.from(new Set(rows.map((r) => r.action))).sort()

      const body: AuditListResponse = {
        ok: true,
        audit: out,
        total: count ?? out.length,
        limit,
        offset,
        distinct_actions: distinctActions,
      }
      res.status(200).json(body)
    } catch (err) {
      next(err)
    }
  },
)
