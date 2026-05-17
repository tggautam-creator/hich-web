import { useQuery } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

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

export type ActiveRideStatus = 'accepted' | 'coordinating' | 'active'

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

export interface LiveSnapshotResponse {
  ok: true
  active_rides: LiveActiveRide[]
  events: LiveEvent[]
  events_since: string
  generated_at: string
  active_truncated: boolean
  events_truncated: boolean
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
