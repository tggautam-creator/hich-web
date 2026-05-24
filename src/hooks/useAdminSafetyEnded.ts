/**
 * 2026-05-24 — v1.2 Phase 3 admin review queue for safety-ended
 * rides. Mirrors the server response shape in
 * server/routes/admin/safetyEnded.ts; keep both in sync.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

const THIRTY_SEC_MS = 30 * 1000

/**
 * UI filter buckets. `user_button` collapses both role-specific
 * safety-button reasons into one row count; the page shows them as
 * one tile.
 */
export type SafetyEndedReasonFilter =
  | 'auto_divergence'
  | 'auto_idle'
  | 'user_button'
  | 'manual'
  | 'all'

export interface AdminSafetyEndedRow {
  id: string
  rider_id: string | null
  driver_id: string | null
  started_at: string | null
  ended_at: string | null
  fare_cents: number | null
  payment_status: string | null
  end_reason: string | null
  divergence_state: string | null
  divergence_first_seen_at: string | null
  warning_fired_at: string | null
  warning_push_count: number | null
  warning_responded_by: string | null
  warning_responded_at: string | null
  warning_responded_role: string | null
  help_sms_sent_at: string | null
  gps_distance_metres: number | null
  last_driver_gps_lat: number | null
  last_driver_gps_lng: number | null
  last_rider_gps_lat: number | null
  last_rider_gps_lng: number | null
  rider_name: string | null
  rider_email: string | null
  driver_name: string | null
  driver_email: string | null
  origin_name: string | null
  destination_name: string | null
}

export interface AdminSafetyEndedResponse {
  ok: true
  rows: AdminSafetyEndedRow[]
  total: number
  counts: {
    auto_divergence: number
    auto_idle: number
    user_button: number
    manual: number
  }
  limit: number
  offset: number
}

export function useAdminSafetyEnded(args: {
  reason?: SafetyEndedReasonFilter
  limit?: number
  offset?: number
}) {
  const { reason = 'all', limit = 25, offset = 0 } = args
  const params = new URLSearchParams()
  params.set('reason', reason)
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  return useQuery<AdminSafetyEndedResponse>({
    queryKey: ['admin', 'safety-ended', reason, limit, offset],
    queryFn: () =>
      adminGet<AdminSafetyEndedResponse>(`/safety-ended?${params.toString()}`),
    placeholderData: keepPreviousData,
    staleTime: THIRTY_SEC_MS,
    refetchInterval: THIRTY_SEC_MS,
  })
}
