/**
 * Wallet-first ride payment helper.
 *
 * Phase 3a from /Users/.../scenario-2-stripe-purring-hollerith.md (the wider
 * payment-architecture plan): a rider's `users.wallet_balance` (built up via
 * topups) pays for the ride first, and the card only gets charged for the
 * remainder. Three branches:
 *
 *   wallet ≥ fare     → debit wallet for `fare`. No Stripe call. Fastest +
 *                        cheapest path (skips the 2.9% + 30¢ Stripe fee).
 *   0 < wallet < fare → debit wallet for what's there, charge card for the
 *                        shortfall via the existing chargeRideFare helper.
 *   wallet = 0        → charge card for the full fare. Today's behavior.
 *
 * The driver's wallet credit (the +fare ride_earning) is the caller's
 * responsibility and is independent of the split — driver always gets full
 * fare regardless of how the rider paid.
 *
 * Idempotency: each individual ride should debit the rider's wallet at most
 * once. We check for an existing `fare_debit` row on (user_id, ride_id)
 * before debiting; on a replay we re-derive the split from the existing
 * row and skip the wallet write. The card-charge idempotency key includes
 * the card-portion amount so retries with a different split don't collide
 * with Stripe's idempotent-replay return.
 */
import { supabaseAdmin } from './supabaseAdmin.ts'
import { chargeRideFare } from './stripeConnect.ts'

export type ChargeViaWalletResult =
  | {
      success: true
      walletDebitCents: number
      cardChargeCents: number
      paymentIntentId?: string
      stripeFeeCents?: number
    }
  | { success: false; error: string }

interface ChargeViaWalletParams {
  rideId: string
  riderId: string
  fareCents: number
  /** Stripe customer id (live or test, matches the secret in env). */
  riderCustomerId: string | null
  /** Stripe payment-method id attached to the customer. */
  riderPaymentMethodId: string | null
}

export async function chargeRideViaWallet(
  params: ChargeViaWalletParams,
): Promise<ChargeViaWalletResult> {
  const { rideId, riderId, fareCents, riderCustomerId, riderPaymentMethodId } = params

  if (fareCents <= 0) {
    return { success: true, walletDebitCents: 0, cardChargeCents: 0 }
  }

  // ── Idempotency check: did we already debit the wallet for this ride? ──
  // C1 fix: sum *all* fare_debit and wallet_refund rows for this ride. A
  // fare_debit on its own is NOT proof the rider's wallet is still down —
  // the Stripe payment_failed webhook may have already refunded it via a
  // wallet_refund row. We only treat the request as a replay when the net
  // (debits − refunds) is still positive. If a prior attempt's debit got
  // refunded, the retry takes the fresh path (re-read balance, re-debit)
  // and inserts a NEW fare_debit row; without that, the driver would get
  // credited from a wallet that no longer holds the funds.
  const { data: priorTxRows } = await supabaseAdmin
    .from('transactions')
    .select('amount_cents, type')
    .eq('user_id', riderId)
    .eq('ride_id', rideId)
    .in('type', ['fare_debit', 'wallet_refund'])

  let priorDebitCents = 0
  let priorRefundCents = 0
  for (const row of priorTxRows ?? []) {
    const amt = (row.amount_cents as number | null) ?? 0
    if (row.type === 'fare_debit') priorDebitCents += -amt   // stored negative
    else if (row.type === 'wallet_refund') priorRefundCents += amt
  }
  const netActiveDebitCents = Math.max(0, priorDebitCents - priorRefundCents)

  let walletDebitCents = 0
  const replayingDebit = netActiveDebitCents > 0

  if (replayingDebit) {
    walletDebitCents = netActiveDebitCents
  } else {
    // Fresh path — read current wallet, decide split.
    const { data: rider, error: riderErr } = await supabaseAdmin
      .from('users')
      .select('wallet_balance')
      .eq('id', riderId)
      .single()

    if (riderErr || !rider) {
      return { success: false, error: `Could not load rider: ${riderErr?.message ?? 'not found'}` }
    }

    const balance = (rider.wallet_balance as number | null) ?? 0
    walletDebitCents = Math.min(balance, fareCents)

    if (walletDebitCents > 0) {
      const { error: debitErr } = await supabaseAdmin.rpc('wallet_apply_delta', {
        p_user_id: riderId,
        p_delta_cents: -walletDebitCents,
        p_type: 'fare_debit',
        p_description: 'Ride fare',
        p_ride_id: rideId,
        p_payment_intent_id: null,
        p_stripe_event_id: null,
      })
      if (debitErr) {
        return { success: false, error: `Wallet debit failed: ${debitErr.message}` }
      }
    }
  }

  const cardChargeCents = fareCents - walletDebitCents

  // ── Branch A: wallet covered the whole fare ──────────────────────────
  if (cardChargeCents === 0) {
    return { success: true, walletDebitCents, cardChargeCents: 0 }
  }

  // ── Branch B: card needed for shortfall ──────────────────────────────
  if (!riderCustomerId || !riderPaymentMethodId) {
    // Wallet covered some but not all, and there's no card to cover the
    // rest. Refund the wallet portion (only on fresh debit — replays let
    // the caller handle the rollback themselves) so the rider isn't
    // partially charged for nothing.
    if (!replayingDebit && walletDebitCents > 0) {
      await refundWalletPortion({
        rideId,
        riderId,
        amountCents: walletDebitCents,
        reason: 'Refunded — no card on file for shortfall',
      })
    }
    return {
      success: false,
      error: 'No card on file for the card-side shortfall',
    }
  }

  // Charge the card for the remainder. Custom idempotency key includes
  // the amount so a later retry with a different split (e.g. after a
  // topup) doesn't get short-circuited to the prior attempt's response.
  const chargeResult = await chargeRideFare({
    rideId,
    fareCents: cardChargeCents,
    riderCustomerId,
    riderPaymentMethodId,
    idempotencyKey: `ride-payment-${rideId}-card-${cardChargeCents}`,
  })

  if (!chargeResult.success) {
    if (!replayingDebit && walletDebitCents > 0) {
      await refundWalletPortion({
        rideId,
        riderId,
        amountCents: walletDebitCents,
        reason: 'Refunded — card charge failed (wallet portion restored)',
      })
    }
    return { success: false, error: chargeResult.error ?? 'Card charge failed' }
  }

  return {
    success: true,
    walletDebitCents,
    cardChargeCents,
    paymentIntentId: chargeResult.paymentIntentId,
    stripeFeeCents: chargeResult.stripFeeCents,
  }
}

/**
 * Credit a driver's wallet for a completed ride.
 *
 * Single source of truth for the four sites that previously inlined the
 * `wallet_apply_delta('ride_earning')` call (rides /end, /scan-driver,
 * /retry-payment, plus the rideSafetyNet auto-end path). Centralising
 * lets us:
 *
 *   1. Treat 23505 (duplicate `payment_intent_id` under the partial-unique
 *      index from migration 024) as success — that error means a parallel
 *      caller already credited the driver, so the rider isn't double-billed
 *      and we shouldn't double-credit either. Pre-fix, this surfaced as a
 *      noisy console.error and (worse) made the call site assume the credit
 *      had failed.
 *
 *   2. Tag every other failure with a `[CRITICAL][driver-credit-leak]`
 *      prefix that log monitoring can alert on. The rider's card was
 *      already charged in TAGO's platform balance — if the credit fails,
 *      the driver is out money silently. We can't roll back the charge
 *      from here, so the next-best thing is making the alert load-bearing.
 */
export async function creditDriverEarning(params: {
  driverId: string
  fareCents: number
  rideId: string
  paymentIntentId: string | null
  /** Free-form context for logs ('rides/end', 'rideSafetyNet', etc.). */
  ctx: string
  description?: string
}): Promise<{ success: boolean; alreadyCredited?: boolean; error?: string }> {
  const description = params.description ?? `Ride earning · ${params.rideId}`

  const { error } = await supabaseAdmin.rpc('wallet_apply_delta', {
    p_user_id: params.driverId,
    p_delta_cents: params.fareCents,
    p_type: 'ride_earning',
    p_description: description,
    p_ride_id: params.rideId,
    p_payment_intent_id: params.paymentIntentId,
    p_stripe_event_id: null,
  })

  if (!error) return { success: true }

  // 23505 = duplicate payment_intent_id under partial-unique index. Means
  // another caller (e.g. a duplicate webhook, a retry middleware replay)
  // already wrote the same credit. Safe to treat as success.
  if ((error as { code?: string }).code === '23505') {
    console.log(`[${params.ctx}] driver credit already applied for ride ${params.rideId} (idempotent)`)
    return { success: true, alreadyCredited: true }
  }

  // Anything else is a money-leak risk: the rider has been charged but the
  // driver was not credited. Use a grep-able prefix so alerting catches it.
  console.error(
    `[CRITICAL][driver-credit-leak][${params.ctx}] driver=${params.driverId} ride=${params.rideId} fare_cents=${params.fareCents} pi=${params.paymentIntentId ?? 'null'} err=${error.message}`,
  )
  return { success: false, error: error.message }
}

/**
 * Restore the rider's wallet portion of a ride payment when the card-side
 * portion failed. Also called from the Stripe `payment_intent.payment_failed`
 * webhook for async card failures (see stripeWebhook.ts).
 *
 * Uses a distinct `wallet_refund` transaction type so the entry shows up as
 * a credit in the rider's history without being confused with `ride_earning`
 * or `fare_credit` (which carry driver-side semantics).
 */
export async function refundWalletPortion(params: {
  rideId: string
  riderId: string
  amountCents: number
  reason: string
}): Promise<{ success: boolean; error?: string }> {
  if (params.amountCents <= 0) return { success: true }

  // Idempotency by net balance: a ride may go through debit → refund →
  // re-debit cycles. We refund only what's currently still debited (sum of
  // fare_debits minus sum of wallet_refunds for this rider/ride). If that
  // net is already zero or negative, a refund would over-credit the rider.
  const { data: priorTxRows } = await supabaseAdmin
    .from('transactions')
    .select('amount_cents, type')
    .eq('user_id', params.riderId)
    .eq('ride_id', params.rideId)
    .in('type', ['fare_debit', 'wallet_refund'])

  let debits = 0
  let refunds = 0
  for (const row of priorTxRows ?? []) {
    const amt = (row.amount_cents as number | null) ?? 0
    if (row.type === 'fare_debit') debits += -amt
    else if (row.type === 'wallet_refund') refunds += amt
  }
  const netStillDebited = Math.max(0, debits - refunds)
  if (netStillDebited <= 0) return { success: true }

  // Cap the refund at what's still owed so a too-large request can't
  // over-credit (defence-in-depth — caller should already pass the right
  // amount).
  const refundCents = Math.min(params.amountCents, netStillDebited)

  const { error } = await supabaseAdmin.rpc('wallet_apply_delta', {
    p_user_id: params.riderId,
    p_delta_cents: refundCents,
    p_type: 'wallet_refund',
    p_description: params.reason,
    p_ride_id: params.rideId,
    p_payment_intent_id: null,
    p_stripe_event_id: null,
  })
  if (error) {
    console.error(`[refundWalletPortion] failed for rider ${params.riderId} ride ${params.rideId}: ${error.message}`)
    return { success: false, error: error.message }
  }
  return { success: true }
}
