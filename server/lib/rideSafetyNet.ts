/**
 * Ride Safety Net — v1.2 Phase 3.1 (2026-05-23) rewrite.
 *
 * 3-stage divergence state machine. The cron (run every 60s) walks
 * every active ride through:
 *
 *   STAGE 0 (null)            normal — no divergence detected
 *      ├── [sep > 250m]                → 'watching'
 *      ▼
 *   STAGE 1 (watching)        divergence_state='watching',
 *                              divergence_first_seen_at=now
 *      ├── [sep < 250m]                → null (reset, false alarm)
 *      ├── [sep > 500m AND aged > 60s] → 'warning' + fire FCM push +
 *                                         realtime warning_fired
 *      ▼
 *   STAGE 2 (warning)         divergence_state='warning',
 *                              warning_fired_at=now,
 *                              warning_push_count++ (cap 2)
 *      ├── [user tapped "still here"]  → 'responded'
 *      ├── [user tapped "got out"]     → 'safety_ended' (immediate
 *                                         auto-end via /safety-end)
 *      ├── [user tapped "help"]        → 'responded' + SMS-help mint
 *      ├── [no response, 90s elapsed]  → 'safety_ended' (cron auto-end)
 *      ▼
 *   STAGE 3 (safety_ended)    auto-end with GPS-distance fare,
 *                              end_reason='auto_divergence' (or
 *                              user-button reason from endpoint)
 *
 *   STAGE R (responded)       user said it's fine. After
 *                              WARNING_REFIRE_COOLDOWN_MS (5 min) the
 *                              cron will re-fire if drift persists,
 *                              capped at MAX_WARNING_PUSHES total.
 *
 * "Never auto-end on radio loss alone" (locked decision 2026-05-23):
 * if either party's GPS ping is missing or older than
 * RECENT_PING_WINDOW_MS, we SKIP divergence detection entirely.
 */
import { supabaseAdmin } from './supabaseAdmin.ts'
import { sendFcmPush } from './fcm.ts'
import { realtimeBroadcast } from './realtimeBroadcast.ts'
import { haversineMetres } from './polyline.ts'
import { chargeRideViaWallet, creditDriverEarning } from './walletPayment.ts'

// ── Tunable constants ─────────────────────────────────────────────────

export const GPS_WATCH_THRESHOLD_M = 250
export const GPS_DIVERGE_THRESHOLD_M = 500
export const WATCH_TO_WARNING_AGE_MS = 60_000
export const WARNING_TO_AUTOEND_MS = 90_000
export const WARNING_REFIRE_COOLDOWN_MS = 5 * 60_000
export const MAX_WARNING_PUSHES = 2
export const PICKUP_GRACE_MS = 2 * 60_000
export const RECENT_PING_WINDOW_MS = 5 * 60_000
export const MAX_RIDE_DURATION_MS = 8 * 60 * 60_000

const KM_TO_MILES = 0.621371
const DEFAULT_MPG = 25
const PER_MIN_CENTS = 5
const MIN_FARE_CENTS = 500

// ── Public result type ────────────────────────────────────────────────

export interface SafetyNetResult {
  checked: number
  autoEnded: number
  warningsFired: number
  watchingFlagged: number
  reminders: number
}

// ── Internal types ────────────────────────────────────────────────────

export interface SafetyRideRow {
  id: string
  rider_id: string | null
  driver_id: string | null
  status: string
  started_at: string | null
  gps_distance_metres: number | null
  last_driver_gps_lat: number | null
  last_driver_gps_lng: number | null
  last_rider_gps_lat: number | null
  last_rider_gps_lng: number | null
  last_driver_ping_at: string | null
  last_rider_ping_at: string | null
  divergence_state: string | null
  divergence_first_seen_at: string | null
  warning_fired_at: string | null
  warning_push_count: number | null
  pickup_point: unknown
  dropoff_point: unknown
  auto_ended: boolean | null
}

// ── Main cron entry point ─────────────────────────────────────────────

const RIDE_COLUMNS =
  'id, rider_id, driver_id, status, started_at, gps_distance_metres, '
  + 'last_driver_gps_lat, last_driver_gps_lng, last_rider_gps_lat, last_rider_gps_lng, '
  + 'last_driver_ping_at, last_rider_ping_at, '
  + 'divergence_state, divergence_first_seen_at, warning_fired_at, '
  + 'warning_push_count, pickup_point, dropoff_point, auto_ended'

export async function checkActiveRides(): Promise<SafetyNetResult> {
  const result: SafetyNetResult = {
    checked: 0,
    autoEnded: 0,
    warningsFired: 0,
    watchingFlagged: 0,
    reminders: 0,
  }

  const { data: rides, error } = await supabaseAdmin
    .from('rides')
    .select(RIDE_COLUMNS)
    .eq('status', 'active')
    .limit(100)

  if (error || !rides) {
    console.error('[rideSafetyNet] Failed to fetch active rides:', error)
    return result
  }

  result.checked = rides.length
  const now = Date.now()

  for (const raw of rides as unknown[]) {
    const ride = raw as SafetyRideRow

    const startedAtMs = ride.started_at
      ? new Date(ride.started_at).getTime()
      : now
    const elapsedMs = now - startedAtMs

    // ── Layer 3: Max duration timeout (8 hours) ────────────────────────
    if (elapsedMs > MAX_RIDE_DURATION_MS) {
      console.log(`[rideSafetyNet] Ride ${ride.id} exceeded max duration (${Math.round(elapsedMs / 3600000)}h) — auto-ending`)
      const r = await endRideForSafety({ rideId: ride.id, endReason: 'auto_idle' })
      if (r.ok) result.autoEnded++
      continue
    }

    // ── Pickup grace ──────────────────────────────────────────────────
    if (elapsedMs < PICKUP_GRACE_MS) continue

    if (ride.divergence_state === 'safety_ended') continue

    // ── Compute separation, if BOTH parties have recent pings ─────────
    // "Never auto-end on radio loss alone"
    const separationM = computeRecentSeparation(ride, now)
    if (separationM == null) {
      maybeFirePeriodicReminder(ride, elapsedMs, result)
      continue
    }

    // ── State machine ────────────────────────────────────────────────
    const advance = advanceDivergenceState({ ride, separationM, now })
    if (advance.action === 'reset') {
      await supabaseAdmin
        .from('rides')
        .update({
          divergence_state: null,
          divergence_first_seen_at: null,
        } as never)
        .eq('id', ride.id)
    } else if (advance.action === 'flag_watching') {
      await supabaseAdmin
        .from('rides')
        .update({
          divergence_state: 'watching',
          divergence_first_seen_at: new Date(now).toISOString(),
        } as never)
        .eq('id', ride.id)
      result.watchingFlagged++
    } else if (advance.action === 'fire_warning') {
      const fired = await fireDivergenceWarning(ride, now, advance.nextPushCount)
      if (fired) {
        result.warningsFired++
        // Mutate the local row so the periodic-reminder call below
        // sees the new state and skips.
        ride.divergence_state = 'warning'
      }
    } else if (advance.action === 'auto_end') {
      const r = await endRideForSafety({ rideId: ride.id, endReason: 'auto_divergence' })
      if (r.ok) result.autoEnded++
      continue
    }

    maybeFirePeriodicReminder(ride, elapsedMs, result)
  }

  return result
}

// ── Recent separation helper ──────────────────────────────────────────

function computeRecentSeparation(ride: SafetyRideRow, now: number): number | null {
  if (
    ride.last_driver_gps_lat == null
    || ride.last_driver_gps_lng == null
    || ride.last_rider_gps_lat == null
    || ride.last_rider_gps_lng == null
    || !ride.last_driver_ping_at
    || !ride.last_rider_ping_at
  ) return null

  const driverAge = now - new Date(ride.last_driver_ping_at).getTime()
  const riderAge = now - new Date(ride.last_rider_ping_at).getTime()
  if (driverAge > RECENT_PING_WINDOW_MS || riderAge > RECENT_PING_WINDOW_MS) return null

  return haversineMetres(
    ride.last_driver_gps_lat, ride.last_driver_gps_lng,
    ride.last_rider_gps_lat, ride.last_rider_gps_lng,
  )
}

// ── Pure-ish state advancer (exported for testing) ────────────────────

export type StateAdvance =
  | { action: 'noop' }
  | { action: 'reset' }
  | { action: 'flag_watching' }
  | { action: 'fire_warning'; nextPushCount: number }
  | { action: 'auto_end' }

export function advanceDivergenceState(opts: {
  ride: SafetyRideRow
  separationM: number
  now: number
}): StateAdvance {
  const { ride, separationM, now } = opts
  const state = ride.divergence_state

  if (state === 'safety_ended') return { action: 'noop' }

  if (separationM < GPS_WATCH_THRESHOLD_M) {
    if (state === null) return { action: 'noop' }
    return { action: 'reset' }
  }

  if (state === null) {
    return separationM >= GPS_WATCH_THRESHOLD_M
      ? { action: 'flag_watching' }
      : { action: 'noop' }
  }

  if (state === 'watching') {
    if (separationM < GPS_DIVERGE_THRESHOLD_M) return { action: 'noop' }
    const firstSeenMs = ride.divergence_first_seen_at
      ? new Date(ride.divergence_first_seen_at).getTime()
      : now
    const aged = now - firstSeenMs
    if (aged < WATCH_TO_WARNING_AGE_MS) return { action: 'noop' }
    return maybeFireWarning(ride, now)
  }

  if (state === 'warning') {
    const warningMs = ride.warning_fired_at
      ? new Date(ride.warning_fired_at).getTime()
      : now
    const warningAge = now - warningMs
    if (warningAge >= WARNING_TO_AUTOEND_MS) {
      return { action: 'auto_end' }
    }
    return { action: 'noop' }
  }

  if (state === 'responded') {
    if (separationM < GPS_DIVERGE_THRESHOLD_M) return { action: 'noop' }
    const lastFireMs = ride.warning_fired_at
      ? new Date(ride.warning_fired_at).getTime()
      : 0
    const sinceLastFire = now - lastFireMs
    if (sinceLastFire < WARNING_REFIRE_COOLDOWN_MS) return { action: 'noop' }
    return maybeFireWarning(ride, now)
  }

  return { action: 'noop' }
}

function maybeFireWarning(ride: SafetyRideRow, now: number): StateAdvance {
  const pushCount = ride.warning_push_count ?? 0
  if (pushCount >= MAX_WARNING_PUSHES) {
    const warningMs = ride.warning_fired_at
      ? new Date(ride.warning_fired_at).getTime()
      : 0
    const aged = now - warningMs
    if (aged >= WARNING_TO_AUTOEND_MS) {
      return { action: 'auto_end' }
    }
    return { action: 'noop' }
  }
  return { action: 'fire_warning', nextPushCount: pushCount + 1 }
}

// ── Warning side-effect (atomic write + push + realtime) ──────────────

/**
 * Atomically flip the row into 'warning' state with an incremented
 * push count BEFORE firing the FCM push. The conditional .eq(...) on
 * `warning_push_count` prevents two cron ticks from each double-firing
 * — the second update matches zero rows and skips.
 */
export async function fireDivergenceWarning(
  ride: SafetyRideRow,
  now: number,
  nextPushCount: number,
): Promise<boolean> {
  const expectedPushCount = nextPushCount - 1
  const { data: updated } = await supabaseAdmin
    .from('rides')
    .update({
      divergence_state: 'warning',
      warning_fired_at: new Date(now).toISOString(),
      warning_push_count: nextPushCount,
      warning_responded_by: null,
      warning_responded_at: null,
      warning_responded_role: null,
    } as never)
    .eq('id', ride.id)
    .eq('warning_push_count', expectedPushCount)
    .select('id')

  if (!updated || (updated as unknown[]).length === 0) {
    return false
  }

  void realtimeBroadcast(
    `ride-safety:${ride.id.toLowerCase()}`,
    'warning_fired',
    {
      ride_id: ride.id,
      fired_at: new Date(now).toISOString(),
      push_count: nextPushCount,
    },
  )

  if (ride.rider_id) {
    const { data: tokens } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', ride.rider_id)
    const list = (tokens ?? []).map((t: { token: string }) => t.token)
    if (list.length > 0) {
      // category: 'SAFETY_WARNING' triggers iOS time-sensitive
      // interruption (Focus / DND bypass) — see fcm.ts. The 90s
      // response window is too short to wait for the user to next
      // wake their phone if they're in Sleep mode.
      void sendFcmPush(list, {
        title: 'Safety check',
        body: 'You and your driver appear to have moved apart. Open Tago to confirm.',
        data: { type: 'ride_safety_warning', ride_id: ride.id, role: 'rider' },
        category: 'SAFETY_WARNING',
      })
    }
  }
  if (ride.driver_id) {
    const { data: tokens } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', ride.driver_id)
    const list = (tokens ?? []).map((t: { token: string }) => t.token)
    if (list.length > 0) {
      void sendFcmPush(list, {
        title: 'Safety check',
        body: 'Your rider is no longer with you. Open Tago to confirm.',
        data: { type: 'ride_safety_warning', ride_id: ride.id, role: 'driver' },
        category: 'SAFETY_WARNING',
      })
    }
  }

  return true
}

// ── Periodic 15-min QR-scan reminder ──────────────────────────────────

function maybeFirePeriodicReminder(
  ride: SafetyRideRow,
  elapsedMs: number,
  result: SafetyNetResult,
): void {
  // Suppress if a divergence state is set — the user already has
  // enough alerts in their face.
  if (ride.divergence_state != null) return
  if (elapsedMs <= 30 * 60_000) return

  const minutesActive = Math.floor(elapsedMs / 60_000)
  if (minutesActive % 15 !== 0) return

  const userIds = [ride.driver_id, ride.rider_id].filter(Boolean) as string[]
  if (userIds.length === 0) return

  void supabaseAdmin
    .from('push_tokens')
    .select('token')
    .in('user_id', userIds)
    .then(({ data }: { data: { token: string }[] | null }) => {
      const list = (data ?? []).map((t: { token: string }) => t.token)
      if (list.length === 0) return
      void sendFcmPush(list, {
        title: 'Ride still active',
        body: `Your ride has been active for ${minutesActive} minutes. Don't forget to scan the QR code to end it!`,
        data: { type: 'end_ride_reminder', ride_id: ride.id },
      })
    })
  result.reminders++
}

// ── Exported safety-end helper ────────────────────────────────────────

export type SafetyEndReason =
  | 'auto_divergence'
  | 'auto_idle'
  | 'rider_safety_button'
  | 'driver_safety_button'
  | 'manual_end'

export interface SafetyEndResult {
  ok: boolean
  fareCents?: number
  reason?: string
}

export async function endRideForSafety(args: {
  rideId: string
  endReason: SafetyEndReason
}): Promise<SafetyEndResult> {
  const { rideId, endReason } = args
  const endedAt = new Date().toISOString()

  const { data: row, error } = await supabaseAdmin
    .from('rides')
    .select(
      'id, rider_id, driver_id, status, started_at, gps_distance_metres, '
      + 'last_driver_gps_lat, last_driver_gps_lng' as never,
    )
    .eq('id', rideId)
    .single()
  if (error || !row) return { ok: false, reason: 'not_found' }
  const ride = row as unknown as {
    id: string
    rider_id: string | null
    driver_id: string | null
    status: string
    started_at: string | null
    gps_distance_metres: number | null
    last_driver_gps_lat: number | null
    last_driver_gps_lng: number | null
  }

  if (ride.status !== 'active') {
    return { ok: false, reason: `not_active:${ride.status}` }
  }

  const riderId = ride.rider_id
  const driverId = ride.driver_id
  const gpsDistanceM = ride.gps_distance_metres ?? 0
  const startMs = ride.started_at ? new Date(ride.started_at).getTime() : Date.now()
  const durationMin = Math.max(0, Math.round((Date.now() - startMs) / 60_000))

  const distanceMiles = (gpsDistanceM / 1000) * KM_TO_MILES
  const gallonsUsed = distanceMiles / DEFAULT_MPG
  const gasCostCents = Math.round(gallonsUsed * 3.50 * 100)
  const timeCostCents = Math.round(durationMin * PER_MIN_CENTS)
  const raw = gasCostCents + timeCostCents
  const fareCents = Math.max(MIN_FARE_CENTS, raw)

  const dropoffGeo = (
    ride.last_driver_gps_lat != null && ride.last_driver_gps_lng != null
  )
    ? {
        type: 'Point' as const,
        coordinates: [ride.last_driver_gps_lng, ride.last_driver_gps_lat] as [number, number],
      }
    : null

  let paymentStatus: 'paid' | 'processing' | 'pending' | 'failed' = 'pending'
  let paymentIntentId: string | undefined
  let stripeFeeCents = 0

  if (driverId && riderId) {
    const { data: rider } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id, default_payment_method_id, wallet_balance')
      .eq('id', riderId)
      .single()
    const walletBalance = (rider?.wallet_balance as number | null) ?? 0
    const hasCard = !!rider?.stripe_customer_id && !!rider?.default_payment_method_id
    const walletCoversFare = walletBalance >= fareCents

    if (walletCoversFare || hasCard) {
      const chargeResult = await chargeRideViaWallet({
        rideId,
        riderId,
        fareCents,
        riderCustomerId: (rider?.stripe_customer_id as string | null) ?? null,
        riderPaymentMethodId: (rider?.default_payment_method_id as string | null) ?? null,
      })
      if (chargeResult.success) {
        paymentStatus = chargeResult.cardChargeCents === 0 ? 'paid' : 'processing'
        paymentIntentId = chargeResult.paymentIntentId
        stripeFeeCents = chargeResult.stripeFeeCents ?? 0
        await creditDriverEarning({
          driverId,
          fareCents,
          rideId,
          paymentIntentId: chargeResult.paymentIntentId ?? null,
          ctx: 'rideSafetyNet',
          description: `Ride earning · ${rideId} (safety-end: ${endReason})`,
        })
      } else {
        paymentStatus = 'failed'
        console.warn(`[rideSafetyNet] Charge failed for ride ${rideId}: ${chargeResult.error}`)
      }
    } else {
      console.warn(`[rideSafetyNet] No card & wallet=${walletBalance}<${fareCents} for rider ${riderId} (pending retry)`)
    }
  }

  // auto_ended is true ONLY for cron-driven ends.
  const autoEnded = endReason === 'auto_divergence' || endReason === 'auto_idle'
  const updatePayload: Record<string, unknown> = {
    status: 'completed',
    ended_at: endedAt,
    fare_cents: fareCents,
    auto_ended: autoEnded,
    payment_status: paymentStatus,
    stripe_fee_cents: stripeFeeCents,
    end_reason: endReason,
    divergence_state: 'safety_ended',
  }
  if (paymentIntentId) updatePayload.payment_intent_id = paymentIntentId
  if (dropoffGeo) updatePayload.dropoff_point = dropoffGeo

  await supabaseAdmin.from('rides').update(updatePayload).eq('id', rideId)

  const userIds = [driverId, riderId].filter(Boolean) as string[]
  if (userIds.length > 0) {
    const { data: tokens } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .in('user_id', userIds)
    const list = (tokens ?? []).map((t: { token: string }) => t.token)
    if (list.length > 0) {
      void sendFcmPush(list, {
        title: 'Ride ended',
        body: copyForEndReason(endReason),
        data: { type: 'ride_auto_ended', ride_id: rideId, reason: endReason },
      })
    }
  }
  if (paymentStatus === 'pending' && riderId) {
    const { data: riderTokens } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', riderId)
    const list = (riderTokens ?? []).map((t: { token: string }) => t.token)
    if (list.length > 0) {
      void sendFcmPush(list, {
        title: 'Payment needed',
        body: 'Your auto-ended ride needs payment. Add a card or top up your wallet.',
        data: { type: 'payment_needed', ride_id: rideId },
      })
    }
  }

  for (const uid of userIds) {
    void realtimeBroadcast(`rider:${uid}`, 'ride_ended', {
      ride_id: rideId,
      auto_ended: true,
      reason: endReason,
      fare_cents: fareCents,
    })
  }
  void realtimeBroadcast(`ride-safety:${rideId.toLowerCase()}`, 'safety_ended', {
    ride_id: rideId,
    reason: endReason,
  })

  console.log(`[rideSafetyNet] Safety-ended ride ${rideId} — reason=${endReason}, fare=${fareCents}c, gps_distance=${Math.round(gpsDistanceM)}m, duration=${durationMin}min, payment_status=${paymentStatus}`)
  return { ok: true, fareCents, reason: endReason }
}

function copyForEndReason(reason: SafetyEndReason): string {
  switch (reason) {
    case 'auto_divergence':
      return 'You and the other party appear to have separated. The ride has been ended and fare calculated automatically.'
    case 'auto_idle':
      return 'Your ride has been active for over 8 hours and has been ended automatically.'
    case 'rider_safety_button':
    case 'driver_safety_button':
      return 'The ride has been ended via the safety button.'
    case 'manual_end':
      return 'The ride has been ended manually. Fare calculated from GPS distance.'
  }
}
