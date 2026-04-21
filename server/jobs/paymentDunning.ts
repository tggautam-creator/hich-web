/**
 * 24 h / 48 h / 72 h payment-dunning cron.
 *
 * Complements the B2 end-of-ride nudge and the H1 driver-initiated nudge:
 * if a rider still hasn't settled a payment N hours after the ride ended,
 * push them again. Three buckets — 24 h, 48 h, 72 h — then we stop (the
 * F7 ghost-refund job takes it from there at day 90).
 *
 * Safe to run daily; at-most-once per ride per bucket is guaranteed by the
 * `payment_nudges (ride_id, bucket)` UNIQUE constraint. If two cron nodes
 * double-fire, one INSERT wins and the other gets 23505 and skips — so the
 * push never goes out twice.
 */
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { sendFcmPush } from '../lib/fcm.ts'

type Bucket = '24h' | '48h' | '72h'

const BUCKETS: ReadonlyArray<{ key: Bucket; minHours: number; maxHours: number }> = [
  { key: '24h', minHours: 24, maxHours: 48 },
  { key: '48h', minHours: 48, maxHours: 72 },
  { key: '72h', minHours: 72, maxHours: 96 },
]

interface StaleRide {
  id: string
  rider_id: string
  ended_at: string
  payment_status: 'pending' | 'failed'
}

export interface DunningResult {
  scanned: number
  nudged: number
  skipped: number
  errors: Array<{ ride_id: string; bucket: Bucket; reason: string }>
}

function pickBucket(endedAtIso: string, now: number): Bucket | null {
  const ageHours = (now - new Date(endedAtIso).getTime()) / 3_600_000
  for (const b of BUCKETS) {
    if (ageHours >= b.minHours && ageHours < b.maxHours) return b.key
  }
  return null
}

async function pushPaymentNeeded(riderId: string, rideId: string, bucket: Bucket): Promise<void> {
  const { data: tokenRows } = await supabaseAdmin
    .from('push_tokens')
    .select('token')
    .eq('user_id', riderId)
  const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token as string)
  if (tokens.length === 0) return
  await sendFcmPush(tokens, {
    title: 'Payment still needed',
    body: 'Open TAGO to finish paying for your recent ride.',
    data: { type: 'payment_needed', ride_id: rideId, bucket },
  })
}

/**
 * Scan pending/failed rides ended in the last 96 h, pick the bucket each one
 * falls into (if any), insert a `payment_nudges` row, and fire the FCM push.
 * The INSERT is the idempotency guard — push happens only if insert succeeded.
 */
export async function sendPendingPaymentNudges(): Promise<DunningResult> {
  const result: DunningResult = { scanned: 0, nudged: 0, skipped: 0, errors: [] }
  const now = Date.now()

  // Window: ended between 96 h ago and 24 h ago (nothing younger than 24 h
  // falls into any bucket). The server clock is authoritative.
  const earliest = new Date(now - 96 * 3_600_000).toISOString()
  const latest = new Date(now - 24 * 3_600_000).toISOString()

  const { data: rides, error: ridesErr } = await supabaseAdmin
    .from('rides')
    .select('id, rider_id, ended_at, payment_status')
    .in('payment_status', ['pending', 'failed'])
    .gte('ended_at', earliest)
    .lte('ended_at', latest)

  if (ridesErr) throw new Error(`sendPendingPaymentNudges: ${ridesErr.message}`)

  const ridesList = (rides ?? []) as StaleRide[]
  result.scanned = ridesList.length

  for (const ride of ridesList) {
    if (!ride.rider_id || !ride.ended_at) {
      result.skipped += 1
      continue
    }
    const bucket = pickBucket(ride.ended_at, now)
    if (!bucket) {
      result.skipped += 1
      continue
    }

    // Insert is the idempotency guard. 23505 (unique violation) → already sent
    // this bucket for this ride; skip silently. Any other error is surfaced.
    const { error: insertErr } = await supabaseAdmin
      .from('payment_nudges')
      .insert({ ride_id: ride.id, bucket })

    if (insertErr) {
      const code = (insertErr as { code?: string }).code
      if (code === '23505') {
        result.skipped += 1
        continue
      }
      result.errors.push({ ride_id: ride.id, bucket, reason: insertErr.message })
      continue
    }

    try {
      await pushPaymentNeeded(ride.rider_id, ride.id, bucket)
      console.log(`[paymentDunning] nudged rider ${ride.rider_id} for ride ${ride.id} (${bucket})`)
      result.nudged += 1
    } catch (pushErr) {
      // FCM failure after insert — row already claimed the bucket, so we
      // won't retry. Better than double-pushing on the next cron tick.
      const msg = pushErr instanceof Error ? pushErr.message : 'unknown'
      result.errors.push({ ride_id: ride.id, bucket, reason: `push failed: ${msg}` })
    }
  }

  return result
}
