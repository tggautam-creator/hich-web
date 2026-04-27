import Stripe from 'stripe'
import { getServerEnv } from '../env.ts'

function getStripe(): Stripe {
  const { STRIPE_SECRET_KEY } = getServerEnv()
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' })
}

/**
 * Estimate Stripe processing fee for a given amount.
 * Standard US rate: 2.9% + 30¢
 */
export function estimateStripeFee(amountCents: number): number {
  return Math.round(amountCents * 0.029 + 30)
}

/**
 * Charge a rider's saved card to TAGO's platform Stripe balance.
 *
 * Funds land in TAGO's balance, not the driver's Connect account. Caller is
 * responsible for crediting the driver's in-app wallet atomically on success
 * (via wallet_apply_delta). The driver withdraws from their wallet later,
 * which is when we create the Stripe Transfer + Payout. This removes the
 * Connect-onboarded precondition so a driver can take their first ride
 * without connecting a bank.
 *
 * Stripe processing fee is added on top of the fare so the rider covers it
 * and TAGO's wallet credit to the driver matches fare_cents exactly.
 * Idempotency key prevents double-charging on retries.
 */
export async function chargeRideFare(params: {
  rideId: string
  fareCents: number
  riderCustomerId: string
  riderPaymentMethodId: string
}): Promise<{ success: boolean; paymentIntentId?: string; stripFeeCents?: number; error?: string }> {
  const stripe = getStripe()

  const stripFeeCents = estimateStripeFee(params.fareCents)
  const totalCharge = params.fareCents + stripFeeCents

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: totalCharge,
        currency: 'usd',
        customer: params.riderCustomerId,
        payment_method: params.riderPaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: { ride_id: params.rideId },
      },
      {
        idempotencyKey: `ride-payment-${params.rideId}`,
      },
    )

    return {
      success: true,
      paymentIntentId: pi.id,
      stripFeeCents,
    }
  } catch (err) {
    const message = err instanceof Stripe.errors.StripeError
      ? err.message
      : err instanceof Error
        ? err.message
        : 'Unknown payment error'

    // Tag cross-mode contamination so log searches catch it. "No such
    // customer" is what Stripe returns when a live key is asked to
    // charge a test customer (or vice-versa) — root cause of the
    // wallet-balance contamination tracked in /Users/.../scenario-2-stripe-purring-hollerith.md.
    const crossMode = message.includes('No such customer') ? ' [CROSS_MODE_STRIPE]' : ''
    console.error(`[chargeRideFare]${crossMode} Failed for ride ${params.rideId}: ${message}`)
    return { success: false, error: message }
  }
}
