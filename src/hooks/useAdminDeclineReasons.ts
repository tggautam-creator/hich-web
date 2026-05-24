/**
 * 2026-05-23 — supply-side decline analytics. Mirrors
 * server/routes/admin/declineReasons.ts; keep both in sync.
 */
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

const SIXTY_SEC_MS = 60 * 1000

export type DeclineWindow = '24h' | '7d' | '30d' | 'all'

export interface AdminDeclineReasonRow {
  reason: string
  count: number
  snooze_count: number
  snooze_long_count: number
}

export interface AdminDeclineEvent {
  id: string
  reason: string
  snooze_minutes: number | null
  created_at: string
  driver_id: string
  driver_name: string | null
  driver_email: string | null
  ride_id: string | null
  rider_id: string | null
  rider_name: string | null
  rider_email: string | null
  ride_origin_name: string | null
  ride_destination_name: string | null
  ride_fare_cents: number | null
  ride_status: string | null
}

export interface AdminDeclineReasonsResponse {
  ok: true
  window: DeclineWindow
  total_declines: number
  total_snoozes: number
  rows: AdminDeclineReasonRow[]
  events: AdminDeclineEvent[]
  events_truncated: boolean
}

export function useAdminDeclineReasons(args: { window?: DeclineWindow }) {
  const { window = '7d' } = args
  return useQuery<AdminDeclineReasonsResponse>({
    queryKey: ['admin', 'decline-reasons', window],
    queryFn: () =>
      adminGet<AdminDeclineReasonsResponse>(`/decline-reasons?window=${window}`),
    placeholderData: keepPreviousData,
    staleTime: SIXTY_SEC_MS,
    refetchInterval: SIXTY_SEC_MS,
  })
}
