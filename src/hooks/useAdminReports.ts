/**
 * 2026-05-22 — Phase 3a + 3b of docs/REPORTS_PLAN.md. Admin-side
 * hooks for the in-app reporting system. Mirrors server contract in
 * `server/routes/admin/reports.ts`.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPost } from '@/lib/admin/api'

const THIRTY_SEC_MS = 30 * 1000

export type AdminReportSeverity = 'emergency' | 'urgent' | 'normal' | 'low'
export type AdminReportStatus =
  | 'open'
  | 'in_progress'
  | 'awaiting_user'
  | 'resolved'
  | 'closed'

export interface AdminReport {
  id: string
  reporter_id: string
  subject_user_id: string | null
  ride_id: string | null
  schedule_id: string | null
  category: string
  severity: AdminReportSeverity
  status: AdminReportStatus
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

export interface AdminReportMessage {
  id: string
  author_id: string
  author_role: 'admin' | 'user'
  body: string
  channel: 'admin_panel' | 'email_inbound' | 'email_outbound' | 'in_app'
  is_internal_note: boolean
  email_message_id: string | null
  created_at: string
}

export interface AdminReportAttachment {
  id: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
  uploaded_by: string
  created_at: string
}

export interface AdminReportUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  is_driver: boolean
  suspended_at: string | null
}

export interface AdminReportRideSnapshot {
  id: string
  status: string
  payment_status: string | null
  rider_id: string
  driver_id: string | null
  vehicle_id: string | null
  origin_name: string | null
  destination_name: string | null
  fare_cents: number | null
  created_at: string
  ended_at: string | null
}

export interface AdminReportDetailResponse {
  ok: true
  report: AdminReport
  messages: AdminReportMessage[]
  attachments: AdminReportAttachment[]
  reporter: AdminReportUser | null
  subject_user: AdminReportUser | null
  ride: AdminReportRideSnapshot | null
}

export function useAdminReportDetail(id: string | undefined) {
  return useQuery<AdminReportDetailResponse>({
    queryKey: ['admin', 'reports', 'detail', id],
    queryFn: () =>
      adminGet<AdminReportDetailResponse>(`/reports/${id}`),
    enabled: typeof id === 'string' && id.length > 0,
    // 30s stale keeps the thread freshness up without hammering;
    // admin reply mutation invalidates on success anyway.
    staleTime: THIRTY_SEC_MS,
  })
}

export interface AdminPostReportMessageArgs {
  body: string
  is_internal_note?: boolean
}

export interface AdminPostReportMessageResult {
  ok: true
  id: string
  created_at: string
}

export function useAdminPostReportMessage(reportId: string) {
  const qc = useQueryClient()
  return useMutation<AdminPostReportMessageResult, Error, AdminPostReportMessageArgs>({
    mutationFn: (input) =>
      adminPost<AdminPostReportMessageResult>(`/reports/${reportId}/messages`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'reports', 'detail', reportId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'reports', 'inbox'] })
    },
  })
}

// ── Phase 3c — Actions ──────────────────────────────────────────────

export interface AdminChangeStatusArgs {
  status: AdminReportStatus
  resolution_note?: string
}

export function useAdminChangeReportStatus(reportId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true; status: AdminReportStatus }, Error, AdminChangeStatusArgs>({
    mutationFn: (input) =>
      adminPost(`/reports/${reportId}/actions/status`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'reports', 'detail', reportId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'reports', 'inbox'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'reports', 'audit', reportId] })
      // Phase 4 — acknowledging an emergency from the sticky banner
      // is just a status flip to `in_progress`. Invalidate the
      // banner query so the row falls off immediately instead of
      // waiting up to 10s for the next poll tick.
      void qc.invalidateQueries({ queryKey: ['admin', 'reports', 'emergency-banner'] })
    },
  })
}

export interface AdminChangeSeverityArgs {
  severity: AdminReportSeverity
}

export function useAdminChangeReportSeverity(reportId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true; severity: AdminReportSeverity }, Error, AdminChangeSeverityArgs>({
    mutationFn: (input) =>
      adminPost(`/reports/${reportId}/actions/severity`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'reports', 'detail', reportId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'reports', 'inbox'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'reports', 'audit', reportId] })
    },
  })
}

export interface AdminReportAuditRow {
  id: string
  admin_id: string
  admin_email: string | null
  action: string
  payload: Record<string, unknown>
  created_at: string
}

export interface AdminReportAuditResponse {
  ok: true
  audit: AdminReportAuditRow[]
}

export function useAdminReportAudit(reportId: string | undefined) {
  return useQuery<AdminReportAuditResponse>({
    queryKey: ['admin', 'reports', 'audit', reportId],
    queryFn: () => adminGet<AdminReportAuditResponse>(`/reports/${reportId}/audit-log`),
    enabled: typeof reportId === 'string' && reportId.length > 0,
    staleTime: THIRTY_SEC_MS,
  })
}

// ── Phase 3a — Inbox list ───────────────────────────────────────────

export type InboxStatusFilter = '' | 'open' | 'in_progress' | 'awaiting_user' | 'resolved' | 'closed'
export type InboxSeverityFilter = '' | 'emergency' | 'urgent' | 'normal' | 'low'
export type InboxHasRefund = '' | 'yes' | 'no'
export type InboxSort = 'severity_first' | 'newest' | 'oldest' | 'awaiting'

export interface AdminReportInboxRow {
  id: string
  reporter_id: string
  reporter_name: string | null
  reporter_email: string | null
  category: string
  severity: AdminReportSeverity
  status: AdminReportStatus
  title: string
  body_preview: string
  ride_id: string | null
  requested_refund_cents: number | null
  assigned_admin_id: string | null
  created_at: string
  updated_at: string
}

export interface AdminReportInboxResponse {
  ok: true
  reports: AdminReportInboxRow[]
  total: number
  counts: {
    open: number
    urgent: number
    emergency: number
  }
  limit: number
  offset: number
}

export interface AdminReportInboxArgs {
  status?: InboxStatusFilter
  severity?: InboxSeverityFilter
  category?: string
  hasRefund?: InboxHasRefund
  myQueue?: boolean
  sort?: InboxSort
  limit?: number
  offset?: number
}

// ── Phase 4 — Realtime emergency banner ─────────────────────────────
//
// Tight-poll hook that drives the sticky red banner mounted in
// `AdminLayout`. 10s cadence (vs the inbox's 30s) so an emergency
// surfaces to whichever admin is online within a span of seconds,
// not half a minute — matches the docs/REPORTS_PLAN.md "Realtime
// emergency banner" requirement without needing to enable
// postgres-changes on the `reports` table or thread a new
// broadcast through the server.
//
// Returns *just* the rows (no count blob, no pagination) — the
// banner stacks one card per open emergency and dismisses each
// on acknowledge. Capped at limit=10 — if you have 10 unack'd
// emergencies on one page you have bigger problems than the
// banner copy.

const TEN_SEC_MS = 10 * 1000

export function useOpenEmergencyReports() {
  const params = new URLSearchParams()
  params.set('status', 'open')
  params.set('severity', 'emergency')
  params.set('sort', 'newest')
  params.set('limit', '10')

  return useQuery<AdminReportInboxResponse>({
    queryKey: ['admin', 'reports', 'emergency-banner'],
    queryFn: () =>
      adminGet<AdminReportInboxResponse>(`/reports?${params.toString()}`),
    staleTime: TEN_SEC_MS,
    refetchInterval: TEN_SEC_MS,
    refetchIntervalInBackground: false,
  })
}

export function useAdminReportInbox(args: AdminReportInboxArgs = {}) {
  const {
    status = '',
    severity = '',
    category = '',
    hasRefund = '',
    myQueue = false,
    sort = 'severity_first',
    limit = 25,
    offset = 0,
  } = args

  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (severity) params.set('severity', severity)
  if (category) params.set('category', category)
  if (hasRefund) params.set('has_refund', hasRefund)
  if (myQueue) params.set('my_queue', 'yes')
  if (sort !== 'severity_first') params.set('sort', sort)
  params.set('limit', String(limit))
  params.set('offset', String(offset))

  return useQuery<AdminReportInboxResponse>({
    queryKey: [
      'admin', 'reports', 'inbox',
      status, severity, category, hasRefund, myQueue, sort, limit, offset,
    ],
    queryFn: () =>
      adminGet<AdminReportInboxResponse>(`/reports?${params.toString()}`),
    placeholderData: keepPreviousData,
    // 30s — fresh enough for ops, cheap on the server.
    staleTime: THIRTY_SEC_MS,
    refetchInterval: THIRTY_SEC_MS,
  })
}
