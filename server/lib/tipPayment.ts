/**
 * Tip charging — card-first, wallet-fallback (Uber-style).
 *
 * The fare flow is wallet-first because we want to amortise Stripe fees on
 * recurring carpool spend. Tips invert that: the rider's wallet is meant
 * for ride budget and shouldn't be silently drained by an optional gratuity.
 * So we try the rider's saved card first; if no card is on file or the
 * card declines, we fall back to the wallet so the driver still gets paid.
 *
 * Idempotency: once any tip transaction (debit OR credit) exists for a
 * ride, additional tip attempts are rejected. Stripe-side, the PI uses an
 * idempotency key tied to (ride, rider) so a network retry can't create a
 * duplicate charge.
 *
 * Webhook isolation: tip PaymentIntents store the ride association under
 * `tip_ride_id` (not `ride_id`) in metadata. The fare webhook handler keys
 * off `ride_id`, so a tip PI's success/failure events are silently ignored
 * by the ride flow — they don't accidentally mark a ride paid or trigger a
 * fare reversal. Async tip failures are out-of-scope for MVP (tips are
 * small + off_session resolves synchronously in 99% of cases).
 */
import Stripe from 'stripe'
import { supabaseAdmin } from './supabaseAdmin.ts'
import { getServerEnv } from '../env.ts'
import { estimateStripeFee } from './stripeConnect.ts'

function getStripe(): Stripe {
  const { STRIPE_SECRET_KEY } = getServerEnv()
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' })
}

export type TipResult =
  | {
      success: true
      method: 'card' | 'wallet'
      paymentIntentId?: string
      stripeFeeCents?: number
      riderBalance?: number
      driverBalance?: number
    }
  | {
      success: false
      errorCode: 'ALREADY_TIPPED' | 'NO_PAYMENT_OPTION' | 'CHARGE_FAILED'
      error: string
    }

interface ChargeTipParams {
  rideId: string
  riderId: string
  driverId: string
  tipCents: number
}

export async function chargeTip(params: ChargeTipParams): Promise<TipResult> {
  const { rideId, riderId, driverId, tipCents } = params

  // ── Idempotency: any prior tip on this ride? ───────────────────────────
  const { data: existing } = await supabaseAdmin
    .from('transactions')
    .select('id')
    .eq('ride_id', rideId)
    .in('type', ['tip_debit', 'tip_credit'])
    .limit(1)
  if (existing && existing.length > 0) {
    return {
      success: false,
      errorCode: 'ALREADY_TIPPED',
      error: 'You have already tipped this driver',
    }
  }

  // ── Look up rider payment options ──────────────────────────────────────
  const { data: rider } = await supabaseAdmin
    .from('users')
    .select('stripe_customer_id, default_payment_method_id, wallet_balance')
    .eq('id', riderId)
    .single()

  const riderCustomerId = (rider?.stripe_customer_id as string | null) ?? null
  const riderPmId = (rider?.default_payment_method_id as string | null) ?? null
  const walletBalance = (rider?.wallet_balance as number | null) ?? 0
  const hasCard = !!riderCustomerId && !!riderPmId
  const walletCovers = walletBalance >= tipCents

  if (!hasCard && !walletCovers) {
    return {
      success: false,
      errorCode: 'NO_PAYMENT_OPTION',
      error: 'No saved card and wallet balance is too low to cover this tip',
    }
  }

  // ── Path A: try card first ─────────────────────────────────────────────
  if (hasCard) {
    const stripeFeeCents = estimateStripeFee(tipCents)
    const totalCharge = tipCents + stripeFeeCents
    const stripe = getStripe()

    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: totalCharge,
          currency: 'usd',
          customer: riderCustomerId as string,
          payment_method: riderPmId as string,
          off_session: true,
          confirm: true,
          // NOTE: 'tip_ride_id' (not 'ride_id') so the fare webhook doesn't
          // mistake this PI for a ride payment.
          metadata: { kind: 'tip', tip_ride_id: rideId, rider_id: riderId, driver_id: driverId },
        },
        { idempotencyKey: `tip-${rideId}-${riderId}` },
      )

      // Credit driver. The transactions row's payment_intent_id is the
      // tip PI; partial-unique index on payment_intent_id makes this
      // idempotent under retry — a second call with the same PI returns
      // 23505 and we treat that as success.
      const credit = await creditTipToDriver({
        driverId,
        tipCents,
        rideId,
        paymentIntentId: pi.id,
      })

      if (!credit.success) {
        // Card succeeded but credit failed — the [CRITICAL] log inside
        // creditTipToDriver flags it for manual reconciliation. Surface
        // as a user-facing failure so the rider doesn't tip "twice"
        // believing the first one didn't go through.
        return {
          success: false,
          errorCode: 'CHARGE_FAILED',
          error: 'Tip charged but driver credit failed — support has been notified',
        }
      }

      return {
        success: true,
        method: 'card',
        paymentIntentId: pi.id,
        stripeFeeCents,
      }
    } catch (err) {
      const message = err instanceof Stripe.errors.StripeError
        ? err.message
        : err instanceof Error ? err.message : 'Unknown card error'
      console.warn(`[chargeTip] card charge failed for ride ${rideId}, falling back to wallet: ${message}`)
      // fall through to wallet path
    }
  }

  // ── Path B: wallet fallback ────────────────────────────────────────────
  if (!walletCovers) {
    return {
      success: false,
      errorCode: 'CHARGE_FAILED',
      error: 'Card declined and wallet balance is too low to cover this tip',
    }
  }

  const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('tip_ride', {
    p_ride_id: rideId,
    p_rider_id: riderId,
    p_driver_id: driverId,
    p_tip_cents: tipCents,
  })

  if (rpcErr) {
    console.error(`[chargeTip] wallet path RPC error for ride ${rideId}: ${rpcErr.message}`)
    return { success: false, errorCode: 'CHARGE_FAILED', error: rpcErr.message }
  }

  if (!rpcResult?.tipped) {
    const msg = rpcResult?.error ?? 'Tip failed'
    return { success: false, errorCode: 'CHARGE_FAILED', error: msg }
  }

  return {
    success: true,
    method: 'wallet',
    riderBalance: rpcResult.rider_balance,
    driverBalance: rpcResult.driver_balance,
  }
}

async function creditTipToDriver(params: {
  driverId: string
  tipCents: number
  rideId: string
  paymentIntentId: string
}): Promise<{ success: boolean; alreadyCredited?: boolean }> {
  const { error } = await supabaseAdmin.rpc('wallet_apply_delta', {
    p_user_id: params.driverId,
    p_delta_cents: params.tipCents,
    p_type: 'tip_credit',
    p_description: 'Tip from rider (card)',
    p_ride_id: params.rideId,
    p_payment_intent_id: params.paymentIntentId,
    p_stripe_event_id: null,
  })
  if (!error) return { success: true }

  // 23505 = duplicate PI — already credited via parallel call.
  if ((error as { code?: string }).code === '23505') {
    console.log(`[chargeTip] tip credit already applied for ride ${params.rideId} (idempotent)`)
    return { success: true, alreadyCredited: true }
  }

  // Card was charged but driver wasn't credited. Tag for monitoring.
  console.error(
    `[CRITICAL][tip-credit-leak] driver=${params.driverId} ride=${params.rideId} pi=${params.paymentIntentId} tip_cents=${params.tipCents} err=${error.message}`,
  )
  return { success: false }
}
