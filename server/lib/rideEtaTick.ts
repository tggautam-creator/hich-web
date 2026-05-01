/**
 * Server-driven ETA tick for live ride activities (LIVE.5,
 * 2026-04-30). Closes the freshness gap LIVE.2 left open: status
 * transitions push instantly, but the etaMinutes number on the
 * lock-screen card still went stale during long iOS suspends
 * because we weren't computing fresh ETAs server-side.
 *
 * Cadence: every 30s, scan rides with status in
 * ('accepted', 'coordinating', 'active') AND a registered live-
 * activity push token. For each: read the driver's latest GPS
 * from `driver_locations`, compute a haversine × 1.3 / 35 mph
 * estimate to the relevant target (pickup for en-route, dropoff
 * for active), and push via APNs.
 *
 * Cheap haversine math (not a Google Routes call) — matches the
 * iOS-side `RideBoardHelpers.estimateScheduleFare` formula and
 * keeps the cron free of API-quota concerns. Accuracy within
 * ~10–20% is plenty for the lock-screen number.
 *
 * Idempotency: pushes every tick whether the value changed or not.
 * ActivityKit dedups by `timestamp`, and a stable lock-screen
 * number is fine — even a "still 4 minutes" update keeps the
 * card visibly fresh on the OS side.
 */
import { supabaseAdmin } from './supabaseAdmin.ts'
import { sendLiveActivityUpdate } from './apns.ts'
import { haversineMetres } from './polyline.ts'

const TICK_INTERVAL_MS = 30_000
const ACTIVE_STATUSES = ['accepted', 'coordinating', 'active'] as const

interface DriverLocationRow {
  user_id: string
  location: { coordinates: [number, number] } | null
}

interface RideRow {
  id: string
  status: string
  driver_id: string | null
  pickup_point: { coordinates: [number, number] } | null
  destination: { coordinates: [number, number] } | null
}

interface TokenRow {
  ride_id: string
  push_token: string
}

let tickHandle: ReturnType<typeof setInterval> | null = null

/**
 * Boot the periodic ETA tick. Idempotent — calling more than once
 * just no-ops. Safe to skip in tests by simply not invoking from
 * `index.ts`.
 */
export function startRideEtaTick(): void {
  if (tickHandle) return
  console.log(`[live-eta] Starting tick every ${TICK_INTERVAL_MS / 1000}s`)
  // Fire one immediately on boot so a ride that's been waiting
  // for the next tick gets refreshed within seconds of restart,
  // not 30s later. Wrapped to swallow errors.
  void runTickSafely()
  tickHandle = setInterval(() => {
    void runTickSafely()
  }, TICK_INTERVAL_MS)
}

export function stopRideEtaTick(): void {
  if (tickHandle) {
    clearInterval(tickHandle)
    tickHandle = null
  }
}

async function runTickSafely(): Promise<void> {
  try {
    await runTick()
  } catch (err) {
    console.error('[live-eta] tick errored:', err)
  }
}

async function runTick(): Promise<void> {
  // 1. Fetch every registered Live Activity token. If empty, no
  //    one's app is in a state to need updates — skip the work.
  const { data: tokenRows, error: tokenErr } = await supabaseAdmin
    .from('live_activity_tokens' as never)
    .select('ride_id, push_token')

  if (tokenErr) {
    console.warn('[live-eta] token fetch failed:', tokenErr.message)
    return
  }
  const tokens = (tokenRows ?? []) as TokenRow[]
  if (tokens.length === 0) return

  const rideIds = Array.from(new Set(tokens.map((t) => t.ride_id)))

  // 2. Fetch the matching ride rows (status, driver, endpoint coords).
  const { data: rideRows, error: rideErr } = await supabaseAdmin
    .from('rides')
    .select('id, status, driver_id, pickup_point, destination')
    .in('id', rideIds)

  if (rideErr) {
    console.warn('[live-eta] ride fetch failed:', rideErr.message)
    return
  }
  const rides = ((rideRows ?? []) as unknown as RideRow[])
    .filter((r) => ACTIVE_STATUSES.includes(r.status as (typeof ACTIVE_STATUSES)[number]))

  if (rides.length === 0) return

  // 3. Fetch driver locations for the rides we care about. One
  //    query covers the whole batch.
  const driverIds = Array.from(
    new Set(rides.map((r) => r.driver_id).filter((id): id is string => id !== null)),
  )
  if (driverIds.length === 0) return

  const { data: locRows, error: locErr } = await supabaseAdmin
    .from('driver_locations')
    .select('user_id, location')
    .in('user_id', driverIds)

  if (locErr) {
    console.warn('[live-eta] driver-location fetch failed:', locErr.message)
    return
  }
  const locByDriver = new Map<string, { lat: number; lng: number }>()
  for (const row of (locRows ?? []) as DriverLocationRow[]) {
    if (!row.location) continue
    const [lng, lat] = row.location.coordinates
    locByDriver.set(row.user_id, { lat, lng })
  }

  // 4. For each ride, compute ETA + push.
  const tokensByRide = new Map<string, string[]>()
  for (const t of tokens) {
    const list = tokensByRide.get(t.ride_id) ?? []
    list.push(t.push_token)
    tokensByRide.set(t.ride_id, list)
  }

  let pushed = 0
  for (const ride of rides) {
    if (!ride.driver_id) continue
    const driverLoc = locByDriver.get(ride.driver_id)
    if (!driverLoc) continue

    const targetCoord = ride.status === 'active'
      ? ride.destination?.coordinates
      : ride.pickup_point?.coordinates
    if (!targetCoord) continue

    const [targetLng, targetLat] = targetCoord
    const metres = haversineMetres(
      driverLoc.lat,
      driverLoc.lng,
      targetLat,
      targetLng,
    )
    if (!Number.isFinite(metres) || metres < 0) continue

    // 1.3x road fudge + 35mph (56kph) average ⇒ ETA in minutes.
    // Matches iOS RideBoardHelpers.estimateScheduleFare.
    const distanceKM = (metres / 1000) * 1.3
    const durationMin = (distanceKM / 56) * 60
    const etaMinutes = Math.max(0, Math.round(durationMin))

    const phase = ride.status === 'active' ? 'active' : 'enRoute'

    const rideTokens = tokensByRide.get(ride.id) ?? []
    for (const token of rideTokens) {
      const ok = await sendLiveActivityUpdate(
        token,
        { phase, etaMinutes, statusLine: '' },
        { relevanceScore: 100 },
      )
      if (ok) pushed++
    }
  }

  if (pushed > 0) {
    console.log(`[live-eta] tick pushed ${pushed} update(s) across ${rides.length} ride(s)`)
  } else {
    // Quiet diagnostic — fires once per minute (every other tick) so
    // the user can confirm the cron is alive without flooding the
    // log on idle servers.
    if (Math.floor(Date.now() / 60_000) % 1 === 0 && Math.floor(Date.now() / 30_000) % 2 === 0) {
      console.log(`[live-eta] tick alive — tokens=${tokens.length} activeRides=${rides.length}`)
    }
  }
}
