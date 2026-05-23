/**
 * 2026-05-22 — Phase 3b of docs/REPORTS_PLAN.md.
 *
 * `/api/admin/reports/*` — admin-side surface for the in-app
 * reporting system. Mounted under `/api/admin/reports`, inherits
 * JWT + `adminAuth` from the parent router.
 *
 * What lives here:
 *   GET  /:id              → full report row + thread (including
 *                            internal admin notes) + attachments +
 *                            reporter / subject user / ride snapshot
 *   POST /:id/messages     → admin posts a reply (or an internal
 *                            note when `is_internal_note=true`).
 *                            Bumps the report's updated_at and
 *                            flips status to `awaiting_user` when
 *                            the admin replies to a user message.
 *
 * What does NOT live here (yet):
 *   GET  /                 → inbox list (Phase 3a)
 *   POST /:id/actions/*    → status/severity/assign/refund/suspend
 *                            (Phase 3c)
 *
 * Authorization: every route trusts the parent router's
 * `validateJwt` + `adminAuth`. Service-role reads bypass RLS so
 * admins can see internal notes that end-users never get.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'
import { sendFcmPush } from '../../lib/fcm.ts'
import { sendSupportReplyEmail } from '../../lib/adminAlerts.ts'

export const adminReportsRouter = Router()

/**
 * 2026-05-22 — Phase 3c+ notification fan-out for admin-driven
 * report events. Inserts a `notifications` row (in-app list) AND
 * fires an FCM push to every device the reporter has registered.
 * Both sides are fire-and-forget — failures here NEVER block the
 * admin action that triggered them.
 *
 * `data.report_id` lets the iOS notification handler deep-link
 * straight to `/reports/:id` on tap.
 */
async function notifyReporter(args: {
  reporterId: string
  type: 'report_reply' | 'report_resolved' | 'report_closed' | 'report_awaiting_user'
  title: string
  body: string
  reportId: string
}): Promise<void> {
  const { reporterId, type, title, body, reportId } = args
  try {
    // In-app notifications row first — even if the push fails
    // (token expired, etc.) the user still sees the badge in the
    // app's Notifications page.
    await supabaseAdmin.from('notifications').insert({
      user_id: reporterId,
      type,
      title,
      body,
      data: { report_id: reportId },
      is_read: false,
    })
  } catch (err) {
    console.error(
      '[adminReports] notifications insert failed:',
      err instanceof Error ? err.message : String(err),
    )
  }

  try {
    const { data: tokens, error: tokensErr } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', reporterId)
    if (tokensErr) throw tokensErr
    const tokenList = (tokens ?? []).map((t) => t.token).filter(Boolean)
    if (tokenList.length === 0) return

    await sendFcmPush(
      tokenList,
      {
        title,
        body,
        data: {
          type,
          report_id: reportId,
        },
      },
      'rides',
    )
  } catch (err) {
    console.error(
      '[adminReports] FCM push failed:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function parseReportIdParam(req: Request, res: Response): string | null {
  const raw = req.params['id']
  const id = typeof raw === 'string' ? raw : ''
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'report id must be a UUID' } })
    return null
  }
  return id
}

// ── GET / — inbox list with filter + counts ────────────────────────────────
//
// Powers `/admin/reports` (Phase 3a). All filters are optional and
// AND-composed:
//   status     'open' | 'in_progress' | 'awaiting_user' | 'resolved' | 'closed'
//   severity   'emergency' | 'urgent' | 'normal' | 'low'
//   category   one of the 14 canonical raw values
//   has_refund 'yes' | 'no' — `requested_refund_cents IS NOT NULL`
//   my_queue   'yes' — only reports assigned to the calling admin
//   sort       'severity_first' (default — emergency → urgent → newest)
//              | 'newest' | 'oldest' | 'awaiting' (awaiting_user first)
//
// Returns the paginated list + a tiny KPI block (open / urgent /
// emergency counts) so the header banner stays consistent across
// filter changes.

interface InboxRow {
  id: string
  reporter_id: string
  reporter_name: string | null
  reporter_email: string | null
  category: string
  severity: string
  status: string
  title: string
  body_preview: string
  ride_id: string | null
  requested_refund_cents: number | null
  assigned_admin_id: string | null
  created_at: string
  updated_at: string
}

adminReportsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminId = res.locals['userId'] as string
      const limit = Math.min(
        Math.max(parseInt(String(req.query['limit'] ?? '25'), 10) || 25, 1),
        100,
      )
      const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0)
      const sort = typeof req.query['sort'] === 'string' ? req.query['sort'] : 'severity_first'
      const statusFilter = typeof req.query['status'] === 'string' ? req.query['status'] : ''
      const severityFilter = typeof req.query['severity'] === 'string' ? req.query['severity'] : ''
      const categoryFilter = typeof req.query['category'] === 'string' ? req.query['category'] : ''
      const hasRefund = typeof req.query['has_refund'] === 'string' ? req.query['has_refund'] : ''
      const myQueue = req.query['my_queue'] === 'yes'

      let listQuery = supabaseAdmin
        .from('reports')
        .select(
          'id, reporter_id, category, severity, status, title, body, ride_id, requested_refund_cents, assigned_admin_id, created_at, updated_at',
          { count: 'exact' },
        )
      // Cast through the typed enum unions — the typed Supabase
      // client narrows `.eq` arg types from query strings.
      const ALLOWED_STATUS = new Set([
        'open', 'in_progress', 'awaiting_user', 'resolved', 'closed',
      ])
      const ALLOWED_SEVERITY = new Set([
        'emergency', 'urgent', 'normal', 'low',
      ])
      if (statusFilter && ALLOWED_STATUS.has(statusFilter)) {
        listQuery = listQuery.eq(
          'status',
          statusFilter as 'open' | 'in_progress' | 'awaiting_user' | 'resolved' | 'closed',
        )
      }
      if (severityFilter && ALLOWED_SEVERITY.has(severityFilter)) {
        listQuery = listQuery.eq(
          'severity',
          severityFilter as 'emergency' | 'urgent' | 'normal' | 'low',
        )
      }
      if (categoryFilter) listQuery = listQuery.eq('category', categoryFilter)
      if (hasRefund === 'yes') listQuery = listQuery.not('requested_refund_cents', 'is', null)
      if (hasRefund === 'no') listQuery = listQuery.is('requested_refund_cents', null)
      if (myQueue) listQuery = listQuery.eq('assigned_admin_id', adminId)

      // Postgres ordering by enum-like severity is awkward without
      // a custom CASE expression Supabase doesn't expose. Two cheap
      // options were left: (a) created_at DESC on the query then
      // re-sort in JS for severity_first / awaiting (current
      // approach — fine at page sizes of 100), or (b) request all
      // rows and sort in JS (too expensive at scale). Picked (a).
      if (sort === 'oldest') {
        listQuery = listQuery.order('created_at', { ascending: true })
      } else {
        listQuery = listQuery.order('created_at', { ascending: false })
      }

      const [listRes, openRes, urgentRes, emergencyRes] = await Promise.all([
        listQuery.range(offset, offset + limit - 1),
        supabaseAdmin
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .in('status', ['open', 'in_progress', 'awaiting_user']),
        supabaseAdmin
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .eq('severity', 'urgent')
          .in('status', ['open', 'in_progress', 'awaiting_user']),
        supabaseAdmin
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .eq('severity', 'emergency')
          .in('status', ['open', 'in_progress', 'awaiting_user']),
      ])
      if (listRes.error) throw listRes.error
      if (openRes.error) throw openRes.error
      if (urgentRes.error) throw urgentRes.error
      if (emergencyRes.error) throw emergencyRes.error

      const sortedRows = (() => {
        const base = listRes.data ?? []
        if (sort === 'severity_first') {
          const rank: Record<string, number> = {
            emergency: 0,
            urgent: 1,
            normal: 2,
            low: 3,
          }
          return [...base].sort((a, b) => {
            const ra = rank[a.severity] ?? 99
            const rb = rank[b.severity] ?? 99
            if (ra !== rb) return ra - rb
            return a.created_at > b.created_at ? -1 : 1
          })
        }
        if (sort === 'awaiting') {
          return [...base].sort((a, b) => {
            const aWaiting = a.status === 'awaiting_user' ? 0 : 1
            const bWaiting = b.status === 'awaiting_user' ? 0 : 1
            if (aWaiting !== bWaiting) return aWaiting - bWaiting
            return a.created_at > b.created_at ? -1 : 1
          })
        }
        return base
      })()

      // Resolve reporter display names + emails in a single batch
      // lookup so the table renders "Maya R." instead of a bare
      // UUID. Skipped if the page is empty.
      const reporterIds = Array.from(new Set(sortedRows.map((r) => r.reporter_id)))
      const reporterMap = new Map<string, { full_name: string | null; email: string | null }>()
      if (reporterIds.length > 0) {
        const { data: reporters, error: reportersErr } = await supabaseAdmin
          .from('users')
          .select('id, full_name, email')
          .in('id', reporterIds)
        if (reportersErr) throw reportersErr
        for (const u of reporters ?? []) {
          reporterMap.set(u.id, { full_name: u.full_name, email: u.email })
        }
      }

      const rows: InboxRow[] = sortedRows.map((r) => {
        const reporter = reporterMap.get(r.reporter_id)
        return {
          id: r.id,
          reporter_id: r.reporter_id,
          reporter_name: reporter?.full_name ?? null,
          reporter_email: reporter?.email ?? null,
          category: r.category,
          severity: r.severity,
          status: r.status,
          title: r.title,
          body_preview: r.body.length > 140 ? r.body.slice(0, 137) + '…' : r.body,
          ride_id: r.ride_id,
          requested_refund_cents: r.requested_refund_cents,
          assigned_admin_id: r.assigned_admin_id,
          created_at: r.created_at,
          updated_at: r.updated_at,
        }
      })

      res.status(200).json({
        ok: true,
        reports: rows,
        total: listRes.count ?? rows.length,
        counts: {
          open: openRes.count ?? 0,
          urgent: urgentRes.count ?? 0,
          emergency: emergencyRes.count ?? 0,
        },
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id — full admin detail ────────────────────────────────────────────

interface AdminReportDetail {
  id: string
  reporter_id: string
  subject_user_id: string | null
  ride_id: string | null
  schedule_id: string | null
  category: string
  severity: string
  status: string
  title: string
  body: string
  requested_refund_cents: number | null
  ride_state_at_report: string | null
  metadata: Record<string, unknown>
  assigned_admin_id: string | null
  resolution_note: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  updated_at: string
}

interface AdminReportMessageRow {
  id: string
  author_id: string
  author_role: 'admin' | 'user'
  body: string
  channel: string
  is_internal_note: boolean
  email_message_id: string | null
  created_at: string
}

adminReportsRouter.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseReportIdParam(req, res)
      if (!id) return

      const { data: report, error: reportErr } = await supabaseAdmin
        .from('reports')
        .select(
          'id, reporter_id, subject_user_id, ride_id, schedule_id, category, severity, status, title, body, requested_refund_cents, ride_state_at_report, metadata, assigned_admin_id, resolution_note, resolved_at, resolved_by, created_at, updated_at',
        )
        .eq('id', id)
        .maybeSingle()
      if (reportErr) throw reportErr
      if (!report) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not found' } })
        return
      }

      // Parallel fan-out: thread + attachments + reporter + subject + ride
      // snapshot. Each is a small read; service-role bypasses RLS so we
      // pull the full picture even on internal notes.
      const [messagesRes, attachmentsRes, reporterRes, subjectRes, rideRes] = await Promise.all([
        supabaseAdmin
          .from('report_messages')
          .select(
            'id, author_id, author_role, body, channel, is_internal_note, email_message_id, created_at',
          )
          .eq('report_id', id)
          .order('created_at', { ascending: true }),
        supabaseAdmin
          .from('report_attachments')
          .select('id, storage_path, mime_type, file_size, uploaded_by, created_at')
          .eq('report_id', id)
          .order('created_at', { ascending: true }),
        supabaseAdmin
          .from('users')
          .select('id, email, full_name, avatar_url, is_driver, suspended_at')
          .eq('id', report.reporter_id)
          .maybeSingle(),
        report.subject_user_id
          ? supabaseAdmin
              .from('users')
              .select('id, email, full_name, avatar_url, is_driver, suspended_at')
              .eq('id', report.subject_user_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        report.ride_id
          ? supabaseAdmin
              .from('rides')
              .select(
                'id, status, payment_status, rider_id, driver_id, vehicle_id, origin_name, destination_name, fare_cents, created_at, ended_at',
              )
              .eq('id', report.ride_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])
      if (messagesRes.error) throw messagesRes.error
      if (attachmentsRes.error) throw attachmentsRes.error
      if (reporterRes.error) throw reporterRes.error
      if (subjectRes.error) throw subjectRes.error
      if (rideRes.error) throw rideRes.error

      // 2026-05-22 — Phase 3b polish. Pre-sign each attachment's
      // private storage path so the admin page can render thumbnails
      // inline without a per-image round-trip. 1h TTL covers the
      // longest realistic admin session before they refresh. If
      // signing fails for a row (rare — usually means the file was
      // deleted out-of-band), we keep `signed_url=null` and the UI
      // renders a download placeholder so the admin can still see
      // metadata and follow up manually.
      const SIGNED_URL_TTL_SECONDS = 60 * 60
      const rawAttachments = attachmentsRes.data ?? []
      const signedAttachments = await Promise.all(
        rawAttachments.map(async (row) => {
          try {
            const { data: signed, error: signErr } = await supabaseAdmin.storage
              .from('report-attachments')
              .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS)
            if (signErr) throw signErr
            return { ...row, signed_url: signed?.signedUrl ?? null }
          } catch (err) {
            console.error(
              '[adminReports] sign attachment failed:',
              row.storage_path,
              err instanceof Error ? err.message : String(err),
            )
            return { ...row, signed_url: null }
          }
        }),
      )

      res.status(200).json({
        ok: true,
        report: report as AdminReportDetail,
        messages: (messagesRes.data ?? []) as AdminReportMessageRow[],
        attachments: signedAttachments,
        reporter: reporterRes.data ?? null,
        subject_user: subjectRes.data ?? null,
        ride: rideRes.data ?? null,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /:id/messages — admin reply or internal note ──────────────────────

adminReportsRouter.post(
  '/:id/messages',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminId = res.locals['userId'] as string
      const id = parseReportIdParam(req, res)
      if (!id) return

      const { body: replyBody, is_internal_note, channel } = req.body as {
        body?: unknown
        is_internal_note?: unknown
        channel?: unknown
      }
      if (typeof replyBody !== 'string' || replyBody.trim().length < 1) {
        res
          .status(400)
          .json({ error: { code: 'MISSING_FIELD', message: 'body is required' } })
        return
      }
      if (replyBody.length > 5000) {
        res.status(400).json({
          error: { code: 'INVALID_FIELD', message: 'body must be at most 5000 characters' },
        })
        return
      }

      const isInternalNote = is_internal_note === true
      // 2026-05-22 — Phase 6a. The compose box now exposes a
      // Reply via toggle: `in_app` (default — same behavior as
      // before, stored as `admin_panel`), `email` (Resend email
      // out, stored as `email_outbound`), or `both` (in-app row
      // AND email).
      //
      // The `email_outbound` literal stays as the persisted channel
      // for the message row in both `email` and `both` modes — the
      // reporter sees the message in their My Reports thread either
      // way; the difference is only whether we also fire an email.
      //
      // Internal notes always use `admin_panel` — there's no point
      // emailing a note that's hidden from the user.
      const replyVia: 'in_app' | 'email' | 'both' =
        !isInternalNote && (channel === 'email' || channel === 'both')
          ? channel
          : 'in_app'
      const channelValue: 'admin_panel' | 'email_outbound' =
        replyVia === 'in_app' ? 'admin_panel' : 'email_outbound'

      const { data: report, error: reportErr } = await supabaseAdmin
        .from('reports')
        .select('id, status, reporter_id, title')
        .eq('id', id)
        .maybeSingle()
      if (reportErr) throw reportErr
      if (!report) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not found' } })
        return
      }

      const { data, error } = await supabaseAdmin
        .from('report_messages')
        .insert({
          report_id: id,
          author_id: adminId,
          author_role: 'admin',
          channel: channelValue,
          is_internal_note: isInternalNote,
          body: replyBody.trim(),
        })
        .select('id, created_at')
        .single()
      if (error || !data) throw error ?? new Error('insert failed')

      // Side effects only when the reply is visible to the user:
      //   - flip status from `open` / `in_progress` to `awaiting_user`
      //     so the inbox can sort "we replied, ball is in user's court"
      //     rows separately
      //   - bump updated_at (handled by the trigger on any UPDATE)
      //   - notify the reporter via in-app row + FCM push
      // Internal notes do NOT flip status NOR notify — they're
      // triage-side only and the reporter never sees them.
      if (!isInternalNote) {
        const nextStatus = report.status === 'open' || report.status === 'in_progress'
          ? 'awaiting_user'
          : report.status
        await supabaseAdmin
          .from('reports')
          .update({ status: nextStatus, updated_at: new Date().toISOString() })
          .eq('id', id)

        // In-app push fires for `in_app` AND `both`. For `email`-only,
        // the user already gets the email in their inbox — a duplicate
        // push would be noise.
        if (replyVia === 'in_app' || replyVia === 'both') {
          // Fire-and-forget notification. setImmediate so the response
          // returns before the push fans out. notifyReporter swallows
          // its own errors so this can never bubble up.
          const preview = replyBody.trim().length > 80
            ? replyBody.trim().slice(0, 77) + '…'
            : replyBody.trim()
          setImmediate(() => {
            void notifyReporter({
              reporterId: report.reporter_id,
              type: 'report_reply',
              title: 'Tago support replied',
              body: preview,
              reportId: id,
            })
          })
        }

        // 2026-05-22 — Phase 6a outbound email. Fire-and-forget so the
        // 201 response never blocks on Resend; the helper swallows its
        // own failures + logs. On success we patch the message row
        // with the returned Resend email id so the Phase 6b inbound
        // webhook can dedup against it (and the audit log has the
        // trail of which messages went out via email).
        if (replyVia === 'email' || replyVia === 'both') {
          const messageId = data.id
          setImmediate(() => {
            void (async () => {
              try {
                const { data: reporter, error: repErr } = await supabaseAdmin
                  .from('users')
                  .select('email, full_name')
                  .eq('id', report.reporter_id)
                  .maybeSingle()
                if (repErr) throw repErr
                if (!reporter?.email) {
                  console.warn('[adminReports] email reply skipped — reporter has no email on file', report.reporter_id)
                  return
                }
                const { data: admin } = await supabaseAdmin
                  .from('users')
                  .select('full_name')
                  .eq('id', adminId)
                  .maybeSingle()
                const sendResult = await sendSupportReplyEmail({
                  reportID: id,
                  reportTitle: report.title,
                  reporterEmail: reporter.email,
                  reporterName: reporter.full_name,
                  body: replyBody.trim(),
                  adminName: admin?.full_name ?? null,
                })
                if (sendResult.ok && sendResult.emailId) {
                  await supabaseAdmin
                    .from('report_messages')
                    .update({ email_message_id: sendResult.emailId })
                    .eq('id', messageId)
                } else if (!sendResult.ok) {
                  console.error(
                    '[adminReports] email reply send failed:',
                    sendResult.error,
                  )
                }
              } catch (err) {
                console.error(
                  '[adminReports] email reply pipeline crashed:',
                  err instanceof Error ? err.message : String(err),
                )
              }
            })()
          })
        }
      }

      res.status(201).json({ ok: true, id: data.id, created_at: data.created_at })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /:id/actions/status — change status + write audit row ─────────────
//
// 2026-05-22 — Phase 3c. Admin flips a report's lifecycle state.
// Resolution states (`resolved` / `closed`) also accept an optional
// `resolution_note` that's stored on the report row + audit log.
// Every change writes a `report_audit_log` row so we have a
// forensic trail of who flipped what when.

type ReportStatus = 'open' | 'in_progress' | 'awaiting_user' | 'resolved' | 'closed'
type ReportSeverity = 'emergency' | 'urgent' | 'normal' | 'low'

const ALLOWED_STATUS_VALUES = new Set<ReportStatus>([
  'open', 'in_progress', 'awaiting_user', 'resolved', 'closed',
])
const ALLOWED_SEVERITY_VALUES = new Set<ReportSeverity>([
  'emergency', 'urgent', 'normal', 'low',
])

adminReportsRouter.post(
  '/:id/actions/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminId = res.locals['userId'] as string
      const id = parseReportIdParam(req, res)
      if (!id) return

      const { status, resolution_note } = req.body as {
        status?: unknown
        resolution_note?: unknown
      }

      if (typeof status !== 'string' || !ALLOWED_STATUS_VALUES.has(status as ReportStatus)) {
        res.status(400).json({
          error: { code: 'INVALID_STATUS', message: `status must be one of: ${Array.from(ALLOWED_STATUS_VALUES).join(', ')}` },
        })
        return
      }
      const newStatus = status as ReportStatus

      const resolutionNote = typeof resolution_note === 'string' && resolution_note.trim().length > 0
        ? resolution_note.trim().slice(0, 500)
        : null

      const { data: existing, error: existingErr } = await supabaseAdmin
        .from('reports')
        .select('id, status, resolution_note, reporter_id, title')
        .eq('id', id)
        .maybeSingle()
      if (existingErr) throw existingErr
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not found' } })
        return
      }

      // Update report row. Resolution states freeze resolved_at +
      // resolved_by so the row has its own forensic stamps in
      // addition to the audit log. Re-opening from resolved/closed
      // clears them.
      const isResolutionState = newStatus === 'resolved' || newStatus === 'closed'
      const nowIso = new Date().toISOString()
      const updatePayload: Record<string, unknown> = {
        status: newStatus,
        updated_at: nowIso,
      }
      if (resolutionNote !== null) {
        updatePayload['resolution_note'] = resolutionNote
      }
      if (isResolutionState) {
        updatePayload['resolved_at'] = nowIso
        updatePayload['resolved_by'] = adminId
      } else if (existing.status === 'resolved' || existing.status === 'closed') {
        // Re-opening — clear stamps.
        updatePayload['resolved_at'] = null
        updatePayload['resolved_by'] = null
      }

      const { error: updateErr } = await supabaseAdmin
        .from('reports')
        .update(updatePayload)
        .eq('id', id)
      if (updateErr) throw updateErr

      // Audit row. Service-role insert; no RLS on report_audit_log
      // for end users.
      await supabaseAdmin.from('report_audit_log').insert({
        report_id: id,
        admin_id: adminId,
        action: 'status_change',
        payload: {
          from: existing.status,
          to: newStatus,
          ...(resolutionNote !== null ? { resolution_note: resolutionNote } : {}),
        },
      })

      // Notify the reporter on resolution-state transitions only.
      // Other flips (open ↔ in_progress / awaiting_user) are
      // internal triage signals and shouldn't push the user.
      if (isResolutionState && existing.status !== newStatus) {
        const notificationBody = resolutionNote
          ? resolutionNote.length > 120
            ? resolutionNote.slice(0, 117) + '…'
            : resolutionNote
          : newStatus === 'resolved'
            ? 'Tago has marked your report as resolved. Tap to view details.'
            : 'Tago has closed your report.'
        setImmediate(() => {
          void notifyReporter({
            reporterId: existing.reporter_id,
            type: newStatus === 'resolved' ? 'report_resolved' : 'report_closed',
            title: newStatus === 'resolved' ? 'Your report was resolved' : 'Your report was closed',
            body: notificationBody,
            reportId: id,
          })
        })
      }

      res.status(200).json({ ok: true, status: newStatus })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /:id/actions/severity — admin severity override + audit ────────────

adminReportsRouter.post(
  '/:id/actions/severity',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminId = res.locals['userId'] as string
      const id = parseReportIdParam(req, res)
      if (!id) return

      const { severity } = req.body as { severity?: unknown }
      if (typeof severity !== 'string' || !ALLOWED_SEVERITY_VALUES.has(severity as ReportSeverity)) {
        res.status(400).json({
          error: { code: 'INVALID_SEVERITY', message: `severity must be one of: ${Array.from(ALLOWED_SEVERITY_VALUES).join(', ')}` },
        })
        return
      }
      const newSeverity = severity as ReportSeverity

      const { data: existing, error: existingErr } = await supabaseAdmin
        .from('reports')
        .select('id, severity')
        .eq('id', id)
        .maybeSingle()
      if (existingErr) throw existingErr
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not found' } })
        return
      }

      const { error: updateErr } = await supabaseAdmin
        .from('reports')
        .update({ severity: newSeverity, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (updateErr) throw updateErr

      await supabaseAdmin.from('report_audit_log').insert({
        report_id: id,
        admin_id: adminId,
        action: 'severity_change',
        payload: { from: existing.severity, to: newSeverity },
      })

      res.status(200).json({ ok: true, severity: newSeverity })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id/audit-log — admin-only forensic log of report actions ──────────
//
// Reads `report_audit_log` for a single report so the detail page's
// right column can show "Tarun changed status to in_progress · 2m
// ago" inline. Resolves admin_id → email for display.

adminReportsRouter.get(
  '/:id/audit-log',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseReportIdParam(req, res)
      if (!id) return

      const { data, error } = await supabaseAdmin
        .from('report_audit_log')
        .select('id, admin_id, action, payload, created_at')
        .eq('report_id', id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error

      const adminIds = Array.from(new Set((data ?? []).map((r) => r.admin_id)))
      const adminMap = new Map<string, string>()
      if (adminIds.length > 0) {
        const { data: admins, error: adminsErr } = await supabaseAdmin
          .from('users')
          .select('id, email')
          .in('id', adminIds)
        if (adminsErr) throw adminsErr
        for (const u of admins ?? []) {
          if (u.email) adminMap.set(u.id, u.email)
        }
      }

      const rows = (data ?? []).map((r) => ({
        id: r.id,
        admin_id: r.admin_id,
        admin_email: adminMap.get(r.admin_id) ?? null,
        action: r.action,
        payload: r.payload,
        created_at: r.created_at,
      }))

      res.status(200).json({ ok: true, audit: rows })
    } catch (err) {
      next(err)
    }
  },
)
