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
 * Charge a rider's saved card and route funds to the driver's Stripe Express account.
 *
 * Uses destination charges with application_fee_amount = 0 (zero platform commission).
 * Stripe fee is added on top of the fare so the driver receives the full fare_cents.
 * Idempotency key prevents double-charging on retries.
 */
export async function chargeRideFare(params: {
  rideId: string
  fareCents: number
  riderCustomerId: string
  riderPaymentMethodId: string
  driverAccountId: string
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
        transfer_data: {
          destination: params.driverAccountId,
        },
        application_fee_amount: 0,
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

    console.error(`[chargeRideFare] Failed for ride ${params.rideId}: ${message}`)
    return { success: false, error: message }
  }
}
