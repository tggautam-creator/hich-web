/**
 * One-shot dev helper: fire the v1.2 Phase 3 safety overlay on the
 * most recent active ride immediately, bypassing the cron's 2-min
 * pickup grace + 60s watching wait. Used to demo the iOS overlay
 * without sitting through the natural divergence-detection timeline.
 *
 * Usage:
 *   tsx server/scripts/triggerSafetyWarning.ts                  → newest active ride
 *   tsx server/scripts/triggerSafetyWarning.ts <ride-id>        → specific ride
 *
 * Calls the same `fireDivergenceWarning` the cron uses, so the
 * realtime broadcast + per-party FCM push fan-out is identical to
 * the natural path. iOS overlay should pop on both apps within ~1s
 * of the script returning.
 */
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { fireDivergenceWarning, type SafetyRideRow } from '../lib/rideSafetyNet.ts'

async function main() {
  const explicitId = process.argv[2]?.trim()

  let ride: SafetyRideRow | null = null

  if (explicitId) {
    const { data, error } = await supabaseAdmin
      .from('rides')
      .select(
        'id, rider_id, driver_id, status, started_at, gps_distance_metres, '
        + 'last_driver_gps_lat, last_driver_gps_lng, last_rider_gps_lat, last_rider_gps_lng, '
        + 'last_driver_ping_at, last_rider_ping_at, '
        + 'divergence_state, divergence_first_seen_at, warning_fired_at, '
        + 'warning_push_count, pickup_point, dropoff_point, auto_ended',
      )
      .eq('id', explicitId)
      .single()
    if (error || !data) {
      console.error(`[trigger] Ride not found: ${explicitId}`)
      process.exit(1)
    }
    ride = data as unknown as SafetyRideRow
  } else {
    const { data, error } = await supabaseAdmin
      .from('rides')
      .select(
        'id, rider_id, driver_id, status, started_at, gps_distance_metres, '
        + 'last_driver_gps_lat, last_driver_gps_lng, last_rider_gps_lat, last_rider_gps_lng, '
        + 'last_driver_ping_at, last_rider_ping_at, '
        + 'divergence_state, divergence_first_seen_at, warning_fired_at, '
        + 'warning_push_count, pickup_point, dropoff_point, auto_ended',
      )
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
    if (error || !data || data.length === 0) {
      console.error('[trigger] No active rides found.')
      process.exit(1)
    }
    ride = data[0] as unknown as SafetyRideRow
  }

  console.log(`[trigger] Ride ${ride.id}:`)
  console.log(`  rider_id      = ${ride.rider_id}`)
  console.log(`  driver_id     = ${ride.driver_id}`)
  console.log(`  status        = ${ride.status}`)
  console.log(`  div_state     = ${ride.divergence_state ?? 'null'}`)
  console.log(`  push_count    = ${ride.warning_push_count ?? 0}`)
  console.log(`  driver_gps    = ${ride.last_driver_gps_lat}, ${ride.last_driver_gps_lng}`)
  console.log(`  rider_gps     = ${ride.last_rider_gps_lat}, ${ride.last_rider_gps_lng}`)

  if (ride.status !== 'active') {
    console.error(`[trigger] Ride is not active (status=${ride.status}). Aborting.`)
    process.exit(1)
  }

  const currentCount = ride.warning_push_count ?? 0
  const nextCount = currentCount + 1
  if (nextCount > 2) {
    console.error(`[trigger] Warning push cap (2) already hit for this ride. Aborting.`)
    process.exit(1)
  }

  console.log(`[trigger] Firing warning (push #${nextCount})...`)
  const fired = await fireDivergenceWarning(ride, Date.now(), nextCount)

  if (fired) {
    console.log(`[trigger] ✓ Warning fired. iOS overlay should pop within ~1s.`)
    console.log(`[trigger]   Channel: ride-safety:${ride.id.toLowerCase()}`)
    console.log(`[trigger]   Event:   warning_fired`)
  } else {
    console.error(`[trigger] ✗ Atomic write lost the race (another tick already advanced push_count). No push sent.`)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('[trigger] Fatal:', err)
  process.exit(1)
})
