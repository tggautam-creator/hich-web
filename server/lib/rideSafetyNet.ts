/**
 * Ride Safety Net — catches rides where driver/rider forgot to scan QR to end.
 *
 * Layer 1: Approaching-dropoff push reminder (handled in gps-ping endpoint)
 * Layer 2: GPS divergence detection — auto-ends ride when parties separate
 * Layer 3: Max 8-hour duration timeout — auto-ends any ride active too long
 *
 * Called by cron every 60 seconds.
 */
import { supabaseAdmin } from './supabaseAdmin.ts'
import { sendFcmPush } from './fcm.ts'
import { realtimeBroadcast } from './realtimeBroadcast.ts'
import { haversineMetres } from './polyline.ts'

const GPS_DIVERGE_THRESHOLD_M = 500      // 500m apart = likely separated
const GPS_DIVERGE_MIN_AGE_MS = 2 * 60_000 // both pings must be 2+ min old
const MAX_RIDE_DURATION_MS = 8 * 60 * 60_000 // 8 hours

interface AutoEndResult {
  checked: number
  autoEnded: number
  reminders: number
}

export async function checkActiveRides(): Promise<AutoEndResult> {
  const result: AutoEndResult = { checked: 0, autoEnded: 0, reminders: 0 }

  // Fetch all active rides
  const { data: rides, error } = await supabaseAdmin
    .from('rides')
    .select('id, rider_id, driver_id, status, started_at, last_driver_gps_lat, last_driver_gps_lng, last_rider_gps_lat, last_rider_gps_lng, last_driver_ping_at, last_rider_ping_at, gps_distance_metres, pickup_point, dropoff_point, auto_ended')
    .eq('status', 'active')
    .limit(100)

  if (error || !rides) {
    console.error('[rideSafetyNet] Failed to fetch active rides:', error)
    return result
  }

  result.checked = rides.length
  const now = Date.now()

  for (const ride of rides) {
    const startedAt = ride.started_at ? new Date(ride.started_at as string).getTime() : now
    const elapsedMs = now - startedAt

    // ── Layer 3: Max duration timeout (8 hours) ────────────────────────────
    if (elapsedMs > MAX_RIDE_DURATION_MS) {
      console.log(`[rideSafetyNet] Ride ${ride.id} exceeded max duration (${Math.round(elapsedMs / 3600000)}h) — auto-ending`)
      await autoEndRide(ride, 'max_duration')
      result.autoEnded++
      continue
    }

    // ── Layer 2: GPS divergence detection ──────────────────────────────────
    if (
      ride.last_driver_gps_lat != null && ride.last_driver_gps_lng != null &&
      ride.last_rider_gps_lat != null && ride.last_rider_gps_lng != null &&
      ride.last_driver_ping_at && ride.last_rider_ping_at
    ) {
      const driverPingAge = now - new Date(ride.last_driver_ping_at as string).getTime()
      const riderPingAge = now - new Date(ride.last_rider_ping_at as string).getTime()

      // Both pings must be recent-ish (within 5 min) to be reliable
      if (driverPingAge < 5 * 60_000 && riderPingAge < 5 * 60_000) {
        const separation = haversineMetres(
          ride.last_driver_gps_lat, ride.last_driver_gps_lng,
          ride.last_rider_gps_lat, ride.last_rider_gps_lng,
        )

        if (separation > GPS_DIVERGE_THRESHOLD_M) {
          // Check that the divergence has persisted — both pings are 2+ min old
          // (meaning they didn't JUST separate, they've been apart for a while)
          const olderPingAge = Math.min(driverPingAge, riderPingAge)
          if (olderPingAge > GPS_DIVERGE_MIN_AGE_MS) {
            console.log(`[rideSafetyNet] Ride ${ride.id} GPS diverged ${Math.round(separation)}m apart for ${Math.round(olderPingAge / 1000)}s — auto-ending`)
            await autoEndRide(ride, 'gps_divergence')
            result.autoEnded++
            continue
          }
        }
      }
    }

    // ── Periodic QR scan reminders (every 15 min after 30 min active) ─────
    if (elapsedMs > 30 * 60_000) {
      // Check if it's time for a reminder (every 15 min window)
      const minutesActive = Math.floor(elapsedMs / 60_000)
      // Send at 30, 45, 60, 75... min marks
      if (minutesActive % 15 === 0) {
        const userIds = [ride.driver_id, ride.rider_id].filter(Boolean) as string[]
        const { data: tokens } = await supabaseAdmin
          .from('push_tokens')
          .select('token')
          .in('user_id', userIds)

        if (tokens && tokens.length > 0) {
          void sendFcmPush(
            tokens.map((t: { token: string }) => t.token),
            {
              title: 'Ride still active',
              body: `Your ride has been active for ${minutesActive} minutes. Don't forget to scan the QR code to end it!`,
              data: { type: 'end_ride_reminder', ride_id: ride.id },
            },
          )
          result.reminders++
        }
      }
    }
  }

  return result
}

/**
 * Auto-end a ride that was forgotten.
 * Uses GPS-tracked distance for fare, sends push to both parties.
 */
async function autoEndRide(
  ride: Record<string, unknown>,
  reason: 'gps_divergence' | 'max_duration',
): Promise<void> {
  const rideId = ride.id as string
  const endedAt = new Date().toISOString()

  // For GPS divergence: use the last position where they were still together
  // (approximated by the last shared gps coords on the ride)
  let dropoffGeo: { type: 'Point'; coordinates: [number, number] } | null = null

  if (reason === 'gps_divergence' && ride.last_driver_gps_lat != null && ride.last_driver_gps_lng != null) {
    // Use driver's last known position as approximate dropoff
    dropoffGeo = {
      type: 'Point',
      coordinates: [ride.last_driver_gps_lng as number, ride.last_driver_gps_lat as number],
    }
  } else if (ride.last_gps_lat != null && ride.last_gps_lng != null) {
    dropoffGeo = {
      type: 'Point',
      coordinates: [ride.last_gps_lng as number, ride.last_gps_lat as number],
    }
  }

  // Calculate fare using GPS distance (already accumulated during the ride)
  const gpsDistanceM = (ride.gps_distance_metres as number) ?? 0
  const startedAt = ride.started_at as string | null
  const startMs = startedAt ? new Date(startedAt).getTime() : Date.now()
  const durationMin = Math.max(0, Math.round((Date.now() - startMs) / 60_000))

  // Simple fare calc (mirrors server formula)
  const KM_TO_MILES = 0.621371
  const distanceMiles = (gpsDistanceM / 1000) * KM_TO_MILES
  const gallonsUsed = distanceMiles / 25 // DEFAULT_MPG
  const gasCostCents = Math.round(gallonsUsed * 3.50 * 100)
  const timeCostCents = Math.round(durationMin * 5)
  const raw = 100 + gasCostCents + timeCostCents
  // Upper cap removed 2026-04-24 — safety-net fare mirrors the main formula.
  const fareCents = Math.max(200, raw)

  // Update ride
  await supabaseAdmin
    .from('rides')
    .update({
      status: 'completed',
      ended_at: endedAt,
      fare_cents: fareCents,
      auto_ended: true,
      ...(dropoffGeo ? { dropoff_point: dropoffGeo } : {}),
    })
    .eq('id', rideId)

  // Notify both parties
  const userIds = [ride.driver_id as string, ride.rider_id as string].filter(Boolean)
  const { data: tokens } = await supabaseAdmin
    .from('push_tokens')
    .select('token')
    .in('user_id', userIds)

  const reasonText = reason === 'gps_divergence'
    ? 'You and the other party appear to have separated without scanning the QR code.'
    : 'Your ride has been active for over 8 hours.'

  if (tokens && tokens.length > 0) {
    void sendFcmPush(
      tokens.map((t: { token: string }) => t.token),
      {
        title: 'Ride auto-ended',
        body: `${reasonText} The ride has been ended and fare calculated automatically.`,
        data: { type: 'ride_auto_ended', ride_id: rideId },
      },
    )
  }

  // Broadcast to both parties so their UI updates
  for (const uid of userIds) {
    void realtimeBroadcast(`rider:${uid}`, 'ride_ended', {
      ride_id: rideId,
      auto_ended: true,
      reason,
    })
  }

  console.log(`[rideSafetyNet] Auto-ended ride ${rideId} — reason=${reason}, fare=${fareCents}c, gps_distance=${Math.round(gpsDistanceM)}m, duration=${durationMin}min`)
}
