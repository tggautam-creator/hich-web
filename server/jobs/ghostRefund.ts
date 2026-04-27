/**
 * F7 — Ghost-driver auto-refund.
 *
 * Under the platform-custody model (F1) a rider's payment sits on TAGO's
 * Stripe balance as a driver wallet credit. If the driver never connects a
 * bank, that credit is frozen. After 90 days we refund the rider to clear
 * the liability and claw back the driver's wallet via `wallet_apply_delta`.
 *
 * Two entry points — both safe to run daily and idempotent on replay
 * (guaranteed by `ghost_refunds.ride_id UNIQUE`):
 *
 *   - sendGhostDriverReminders()  — day 60: flag + (later) send reminder email
 *   - processGhostDriverRefunds() — day 90: Stripe refund + wallet debit
 */
import Stripe from 'stripe'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { getServerEnv } from '../env.ts'

const REMINDER_DAYS = 60
const REFUND_DAYS = 90

function getStripe(): Stripe {
  const { STRIPE_SECRET_KEY } = getServerEnv()
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' })
}

interface EarningRow {
  ride_id: string
  user_id: string
  amount_cents: number
  payment_intent_id: string
  created_at: string
  rides: { rider_id: string } | null
  users: { stripe_onboarding_complete: boolean } | null
}

interface JobResult {
  scanned: number
  processed: number
  skipped: number
  errors: Array<{ ride_id: string; reason: string }>
}

/**
 * Pull ride_earning transactions older than `minDays` days where:
 *   - driver has not completed Connect onboarding
 *   - payment_intent_id is set (required for Stripe refund)
 *
 * Caller filters against `ghost_refunds` for the appropriate stage.
 */
async function loadStaleEarnings(minDays: number): Promise<EarningRow[]> {
  const cutoffIso = new Date(Date.now() - minDays * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('ride_id, user_id, amount_cents, payment_intent_id, created_at, rides!inner(rider_id), users!inner(stripe_onboarding_complete)')
    .eq('type', 'ride_earning')
    .not('payment_intent_id', 'is', null)
    .not('ride_id', 'is', null)
    .lte('created_at', cutoffIso)

  if (error) throw new Error(`loadStaleEarnings: ${error.message}`)
  const rows = (data ?? []) as unknown as EarningRow[]
  return rows.filter((r) => r.users?.stripe_onboarding_complete === false)
}

/**
 * Day-60 pass: record a `ghost_refunds` row with `reminder_sent_at`. Email
 * delivery itself is left to the mailer (not wired in this job yet — we log
 * the driver_id so ops can batch-send until SMTP is hooked up).
 */
export async function sendGhostDriverReminders(): Promise<JobResult> {
  const result: JobResult = { scanned: 0, processed: 0, skipped: 0, errors: [] }
  const rows = await loadStaleEarnings(REMINDER_DAYS)
  result.scanned = rows.length

  for (const row of rows) {
    if (!row.ride_id || !row.rides?.rider_id) {
      result.skipped += 1
      continue
    }

    const { error: insertErr } = await supabaseAdmin
      .from('ghost_refunds')
      .upsert(
        {
          ride_id: row.ride_id,
          driver_id: row.user_id,
          rider_id: row.rides.rider_id,
          amount_cents: row.amount_cents,
          payment_intent_id: row.payment_intent_id,
          reminder_sent_at: new Date().toISOString(),
        },
        { onConflict: 'ride_id', ignoreDuplicates: false },
      )

    if (insertErr) {
      result.errors.push({ ride_id: row.ride_id, reason: insertErr.message })
      continue
    }
    console.log(`[ghostRefund] reminder queued for driver ${row.user_id} ride ${row.ride_id}`)
    result.processed += 1
  }

  return result
}

/**
 * Day-90 pass: refund rider + debit driver wallet. Order matters.
 *  1. Stripe refund  — if this fails we bail, nothing in our DB changes.
 *  2. Wallet debit   — `wallet_apply_delta` is atomic.
 *  3. Rides row      — mark `payment_status='refunded_ghost_driver'`.
 *  4. ghost_refunds  — record stripe_refund_id + refunded_at (idempotency key).
 *
 * Replaying after (1) but before (4) is safe: Stripe refunds are idempotent
 * via the `Idempotency-Key`. The row insert at (4) uses upsert on ride_id,
 * which the `UNIQUE(ride_id)` constraint enforces.
 */
export async function processGhostDriverRefunds(): Promise<JobResult> {
  const result: JobResult = { scanned: 0, processed: 0, skipped: 0, errors: [] }
  const rows = await loadStaleEarnings(REFUND_DAYS)
  result.scanned = rows.length

  // Skip rides already refunded.
  const rideIds = rows.map((r) => r.ride_id).filter(Boolean)
  if (rideIds.length === 0) return result

  const { data: alreadyRefunded } = await supabaseAdmin
    .from('ghost_refunds')
    .select('ride_id')
    .not('refunded_at', 'is', null)
    .in('ride_id', rideIds)

  const refundedSet = new Set((alreadyRefunded ?? []).map((r) => r.ride_id as string))

  const stripe = getStripe()

  for (const row of rows) {
    if (!row.ride_id || !row.rides?.rider_id) {
      result.skipped += 1
      continue
    }
    if (refundedSet.has(row.ride_id)) {
      result.skipped += 1
      continue
    }

    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: row.payment_intent_id,
          amount: row.amount_cents,
          metadata: { ride_id: row.ride_id, kind: 'ghost_driver_refund' },
        },
        { idempotencyKey: `ghost-refund-${row.ride_id}` },
      )

      const { error: debitErr } = await supabaseAdmin.rpc('wallet_apply_delta', {
        p_user_id: row.user_id,
        p_delta_cents: -row.amount_cents,
        p_type: 'ghost_refund',
        p_description: `Auto-refund — bank not linked within 90 days (ride ${row.ride_id})`,
        p_ride_id: row.ride_id,
        // payment_intent_id stays NULL — the original ride_earning row already
        // owns this PI under the partial-unique index from migration 024.
        // Reusing it would throw 23505 the moment this job actually runs in
        // prod. The audit link is preserved by p_ride_id and the
        // ghost_refunds.stripe_refund_id row written below.
        p_payment_intent_id: null,
        p_stripe_event_id: null,
      })

      if (debitErr) {
        // Stripe refunded but we couldn't debit — surface loudly. The stripe
        // refund itself is safe (rider got money back); the wallet balance is
        // now over-reporting by amount_cents until ops reconciles.
        console.error(`[ghostRefund] CRITICAL: refund ${refund.id} succeeded but wallet debit failed for driver ${row.user_id}: ${debitErr.message}`)
        result.errors.push({ ride_id: row.ride_id, reason: `wallet debit failed: ${debitErr.message}` })
        continue
      }

      await supabaseAdmin
        .from('rides')
        .update({ payment_status: 'refunded_ghost_driver' })
        .eq('id', row.ride_id)

      await supabaseAdmin
        .from('ghost_refunds')
        .upsert(
          {
            ride_id: row.ride_id,
            driver_id: row.user_id,
            rider_id: row.rides.rider_id,
            amount_cents: row.amount_cents,
            payment_intent_id: row.payment_intent_id,
            stripe_refund_id: refund.id,
            refunded_at: new Date().toISOString(),
          },
          { onConflict: 'ride_id', ignoreDuplicates: false },
        )

      console.log(`[ghostRefund] refunded ride ${row.ride_id} (driver ${row.user_id}) — stripe ${refund.id}`)
      result.processed += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error(`[ghostRefund] refund failed for ride ${row.ride_id}: ${msg}`)
      result.errors.push({ ride_id: row.ride_id, reason: msg })
    }
  }

  return result
}
