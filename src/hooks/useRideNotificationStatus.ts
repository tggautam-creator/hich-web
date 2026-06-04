/**
 * v1.3 Sprint 12 Slice 2a — driver-fanout telemetry for the rider's
 * WaitingRoom.
 *
 * Mirrors iOS `RideNotificationStatusEndpoint.swift` 1:1. Polls
 * `GET /api/rides/:rideId/notification-status` every 5s while the
 * ride is in `requested` so the WaitingRoom can render meaningful
 * copy ("Reached 3 drivers, 1 declined") instead of a bare spinner.
 *
 * Server-side aggregates the `notifications` table (driver-side
 * push attempts) + `ride_offers` (accept/decline state machine).
 * Auth is rider-only — server returns 403 if `userId !== ride.rider_id`.
 *
 * Web's 90-second "no drivers available" fallback CTA already lives
 * in `WaitingRoom.tsx:657` and isn't part of this hook's scope. This
 * hook adds the informational status card that surfaces progress
 * within ~5s instead of the user staring at a blank spinner for 90s.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface RideNotificationStatus {
  rideId: string
  rideStatus: string
  driversNotified: number
  driversPending: number
  driversAccepted: number
  driversDeclined: number
  driverId: string | null
}

const POLL_INTERVAL_MS = 5_000

function statusKey(rideId: string | null | undefined) {
  return ['rides', 'notification-status', rideId ?? 'none'] as const
}

interface UseRideNotificationStatusOptions {
  /** When false (e.g. ride status moved past `requested`), polling
   *  stops + the hook returns the last known value. */
  enabled?: boolean
}

export function useRideNotificationStatus(
  rideId: string | null | undefined,
  { enabled = true }: UseRideNotificationStatusOptions = {},
) {
  return useQuery<RideNotificationStatus>({
    queryKey: statusKey(rideId),
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in')
      const resp = await fetch(`/api/rides/${encodeURIComponent(rideId as string)}/notification-status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!resp.ok) throw new Error(`notification-status ${resp.status}`)
      const body = (await resp.json()) as {
        ride_id: string
        ride_status: string
        drivers_notified: number
        drivers_pending: number
        drivers_accepted: number
        drivers_declined: number
        driver_id: string | null
      }
      return {
        rideId: body.ride_id,
        rideStatus: body.ride_status,
        driversNotified: body.drivers_notified,
        driversPending: body.drivers_pending,
        driversAccepted: body.drivers_accepted,
        driversDeclined: body.drivers_declined,
        driverId: body.driver_id ?? null,
      }
    },
    enabled: enabled && typeof rideId === 'string' && rideId.length > 0,
    refetchInterval: POLL_INTERVAL_MS,
    // Once-only retry: server returns 403/404 deterministically if
    // the ride is wrong; no point hammering. Real network errors
    // recover on the next 5s tick anyway.
    retry: false,
  })
}
