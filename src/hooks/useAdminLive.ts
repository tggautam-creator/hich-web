import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPost } from '@/lib/admin/api'

/**
 * Slice 1.7 — live ops snapshot hook.
 *
 * Polls `/api/admin/live/snapshot` every 10 s while the tab is in the
 * foreground. React Query pauses polling automatically when the
 * window loses focus (refetchIntervalInBackground default = false) so
 * the page doesn't keep hitting the server when no one's watching.
 *
 * Response shape mirrors server/routes/admin/live.ts.
 */

export interface LatLng { lat: number; lng: number }

export type ActiveRideStatus = 'requested' | 'accepted' | 'coordinating' | 'active'

export type StuckReason =
  | 'awaiting_driver'
  | 'coordinating_long'
  | 'driver_gps_stale'
  | 'ride_long'

export interface LiveActiveRide {
  id: string
  status: ActiveRideStatus
  rider_id: string
  driver_id: string | null
  origin: LatLng | null
  destination: LatLng | null
  pickup_point: LatLng | null
  origin_name: string | null
  destination_name: string | null
  last_driver_gps: LatLng | null
  last_rider_gps: LatLng | null
  last_driver_ping_at: string | null
  last_rider_ping_at: string | null
  fare_cents: number | null
  created_at: string
  started_at: string | null
  rider_name: string | null
  driver_name: string | null
  stuck_reason: StuckReason | null
  stuck_for_ms: number | null
}

export type LiveEventKind = 'created' | 'accepted' | 'started' | 'completed' | 'cancelled'

export interface LiveEvent {
  ride_id: string
  kind: LiveEventKind
  at: string
  rider_name: string | null
  driver_name: string | null
  fare_cents: number | null
}

export interface OnlineDriver {
  user_id: string
  name: string | null
  email: string | null
  last_ping_at: string
  lat: number
  lng: number
  on_active_ride: boolean
  /** True when the GPS ping is older than the matcher's freshness
   * threshold (5 min). The matcher still notifies them; UI surfaces
   * this as a "stale ping" warning so admin knows the on-map dot
   * may not reflect their current position. */
  ping_stale: boolean
  ping_age_ms: number
}

export interface LiveSnapshotResponse {
  ok: true
  active_rides: LiveActiveRide[]
  events: LiveEvent[]
  online_drivers: OnlineDriver[]
  available_driver_count: number
  snoozed_driver_count: number
  events_since: string
  generated_at: string
  active_truncated: boolean
  events_truncated: boolean
  online_drivers_truncated: boolean
}

const POLL_MS = 10_000

export function useAdminLive() {
  return useQuery<LiveSnapshotResponse>({
    queryKey: ['admin', 'live', 'snapshot'],
    queryFn: () => adminGet<LiveSnapshotResponse>('/live/snapshot'),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: POLL_MS - 1, // align with poll
  })
}

// ── Slice 1.7b — force-cancel from the Live drawer ──────────────────────────

interface ForceCancelArgs { reason: string }
interface ForceCancelResult {
  ok: true
  ride_id: string
  previous_status: string
  notifications_written: number
  push_sent: number
}

export function useAdminForceCancelRide(rideId: string) {
  const qc = useQueryClient()
  return useMutation<ForceCancelResult, Error, ForceCancelArgs>({
    mutationFn: (args) =>
      adminPost<ForceCancelResult>(`/rides/${rideId}/cancel`, args),
    onSuccess: () => {
      // Refresh the snapshot immediately so the cancelled ride drops
      // off the active list / moves to the event feed.
      void qc.invalidateQueries({ queryKey: ['admin', 'live', 'snapshot'] })
      // Audit lists for rider + driver may also be open in another tab.
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'audit'] })
    },
  })
}

// ── Slice 1.7f — admin force-reassign ride to a specific driver ────────────

interface ReassignArgs { new_driver_id: string; reason: string }
interface ReassignResult {
  ok: true
  ride_id: string
  previous_status: string
  next_status: string
  previous_driver_id: string | null
  new_driver_id: string
  notifications_written: number
  push_sent: number
}

export function useAdminReassignRide(rideId: string) {
  const qc = useQueryClient()
  return useMutation<ReassignResult, Error, ReassignArgs>({
    mutationFn: (args) =>
      adminPost<ReassignResult>(`/rides/${rideId}/reassign`, args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'live', 'snapshot'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'audit'] })
    },
  })
}
