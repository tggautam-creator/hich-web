/**
 * 2026-05-23 — admin-side ride visibility hooks. Mirrors the
 * `useAdminReports` shape; same patterns for filter args, list +
 * detail queries, 30s stale-time. Read-only — no mutations here
 * (force-cancel / refund still live on the user detail page).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPost } from '@/lib/admin/api'

const THIRTY_SEC_MS = 30 * 1000

export type AdminRideStatus =
  | 'requested'
  | 'accepted'
  | 'coordinating'
  | 'active'
  | 'completed'
  | 'cancelled'

export type InboxStatusFilter = '' | AdminRideStatus
export type InboxHasReport = '' | 'yes'

export interface AdminRideInboxRow {
  id: string
  status: AdminRideStatus
  rider_id: string
  rider_name: string | null
  rider_email: string | null
  driver_id: string | null
  driver_name: string | null
  driver_email: string | null
  origin_name: string | null
  destination_name: string | null
  fare_cents: number | null
  payment_status: string | null
  created_at: string
  started_at: string | null
  ended_at: string | null
  has_report: boolean
}

export interface AdminRideInboxResponse {
  ok: true
  rides: AdminRideInboxRow[]
  total: number
  limit: number
  offset: number
}

export interface AdminRideInboxArgs {
  status?: InboxStatusFilter
  dateFrom?: string
  dateTo?: string
  q?: string
  hasReport?: InboxHasReport
  limit?: number
  offset?: number
}

export function useAdminRideInbox(args: AdminRideInboxArgs = {}) {
  const {
    status = '',
    dateFrom = '',
    dateTo = '',
    q = '',
    hasReport = '',
    limit = 25,
    offset = 0,
  } = args

  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  if (q) params.set('q', q)
  if (hasReport) params.set('has_report', hasReport)
  params.set('limit', String(limit))
  params.set('offset', String(offset))

  return useQuery<AdminRideInboxResponse>({
    queryKey: ['admin', 'rides', 'inbox', status, dateFrom, dateTo, q, hasReport, limit, offset],
    queryFn: () => adminGet<AdminRideInboxResponse>(`/rides?${params.toString()}`),
    placeholderData: keepPreviousData,
    staleTime: THIRTY_SEC_MS,
    refetchInterval: THIRTY_SEC_MS,
  })
}

// ── Detail ──────────────────────────────────────────────────────────

export interface AdminRideDetail {
  id: string
  rider_id: string
  driver_id: string | null
  schedule_id: string | null
  vehicle_id: string | null
  status: AdminRideStatus
  origin_name: string | null
  destination_name: string | null
  fare_cents: number | null
  payment_status: string | null
  pickup_confirmed: boolean | null
  dropoff_confirmed: boolean | null
  pickup_note: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string
  // Allow extra columns without breaking the type — there are many
  // ride-row fields and we render only the ones the UI cares about.
  [key: string]: unknown
}

export interface AdminRideUser {
  id: string
  email: string | null
  full_name: string | null
  avatar_url: string | null
  is_driver: boolean
  suspended_at: string | null
}

export interface AdminRideVehicle {
  id: string
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  plate: string | null
}

export interface AdminRideSchedule {
  id: string
  user_id: string
  mode: string | null
  trip_date: string | null
  trip_time: string | null
  time_type: string | null
  origin_address: string | null
  dest_address: string | null
  available_seats: number | null
}

export interface AdminRideMessage {
  id: string
  ride_id: string
  sender_id: string
  content: string
  type: string
  meta: Record<string, unknown> | null
  created_at: string
}

export interface AdminRidePayment {
  id: string
  user_id: string
  kind: string
  amount_cents: number
  payment_source: string | null
  created_at: string
  meta: Record<string, unknown> | null
}

export interface AdminRideReportLink {
  id: string
  reporter_id: string
  severity: string
  status: string
  title: string
  created_at: string
}

/**
 * 2026-05-23 — migration 094 ride_audit_log row. One row per
 * changed-field-of-interest on a `rides` UPDATE: status, driver_id,
 * pickup_confirmed, dropoff_confirmed, payment_status, fare_cents.
 * `changed_by` is the auth.uid() of the actor when JWT'd; NULL for
 * service-role / system updates.
 */
export interface AdminRideAuditRow {
  id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  created_at: string
}

/**
 * 2026-05-23 — blind two-sided rating row (migration 014).
 * Each completed ride can have at most two of these: rider→driver
 * and driver→rider. Admin sees both regardless of submission
 * (no blind-mode on the admin surface — admin needs full visibility).
 */
export interface AdminRideRating {
  id: string
  rater_id: string
  rated_id: string
  stars: number
  tags: string[]
  comment: string | null
  created_at: string
}

export interface AdminRideDetailResponse {
  ok: true
  ride: AdminRideDetail
  rider: AdminRideUser | null
  driver: AdminRideUser | null
  vehicle: AdminRideVehicle | null
  schedule: AdminRideSchedule | null
  messages: AdminRideMessage[]
  payment: AdminRidePayment[]
  reports: AdminRideReportLink[]
  audit_log: AdminRideAuditRow[]
  ratings: AdminRideRating[]
}

export function useAdminRideDetail(id: string | undefined) {
  return useQuery<AdminRideDetailResponse>({
    queryKey: ['admin', 'rides', 'detail', id],
    queryFn: () => adminGet<AdminRideDetailResponse>(`/rides/${id}`),
    enabled: typeof id === 'string' && id.length > 0,
    staleTime: THIRTY_SEC_MS,
  })
}

// ── Actions: refund + force-cancel ────────────────────────────────────
//
// Both endpoints already exist (server/routes/admin/refunds.ts) — these
// hooks wrap them with the right cache invalidation so the ride detail
// page reflects the new state immediately AND any open inbox view
// updates without a manual refresh.
//
// Why thin wrappers instead of reusing useAdminRefundRide from
// useAdminUsers.ts: that hook invalidates per-user queries
// (`admin/users/wallet/:userId` etc.) which only matter on the user
// detail page. On the ride detail page we instead need to invalidate
// `admin/rides/detail/:id` + the inbox, plus we don't always know
// "the viewed user id" (could be rider OR driver). Cleaner to have a
// ride-centric hook.

export interface AdminRefundRideArgs {
  reason: string
  allow_driver_overdraft?: boolean
}

export interface AdminRefundRideResult {
  ok: true
  ride_id: string
  fare_cents: number
  rider_balance_after_cents: number | null
  driver_balance_after_cents: number | null
}

export function useAdminRefundRideById(rideId: string) {
  const qc = useQueryClient()
  return useMutation<AdminRefundRideResult, Error, AdminRefundRideArgs>({
    mutationFn: (body) =>
      adminPost<AdminRefundRideResult>(`/rides/${rideId}/refund`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'rides', 'detail', rideId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'rides', 'inbox'] })
    },
  })
}

export interface AdminCancelRideArgs {
  reason: string
}

export interface AdminCancelRideResult {
  ok: true
  ride_id: string
  status: 'cancelled'
}

export function useAdminCancelRide(rideId: string) {
  const qc = useQueryClient()
  return useMutation<AdminCancelRideResult, Error, AdminCancelRideArgs>({
    mutationFn: (body) =>
      adminPost<AdminCancelRideResult>(`/rides/${rideId}/cancel`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'rides', 'detail', rideId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'rides', 'inbox'] })
    },
  })
}
