import { Router } from 'express'
import type { Request, Response } from 'express'
import Stripe from 'stripe'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { sendFcmPush } from '../lib/fcm.ts'
import { getServerEnv } from '../env.ts'

export const stripeWebhookRouter = Router()

function getStripe(): Stripe {
  const { STRIPE_SECRET_KEY } = getServerEnv()
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' })
}

// ── POST /api/stripe/webhook — Stripe webhook handler ──────────────────────
// NOTE: This route must use express.raw() middleware, NOT express.json().
// It is mounted BEFORE the global JSON parser in app.ts.
stripeWebhookRouter.post('/', async (req: Request, res: Response) => {
  const { STRIPE_WEBHOOK_SECRET } = getServerEnv()
  const stripe = getStripe()

  const sig = req.headers['stripe-signature']
  if (!sig) {
    res.status(400).json({ error: { code: 'NO_SIGNATURE', message: 'Missing stripe-signature header' } })
    return
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signature verification failed'
    console.error('Webhook signature verification failed:', message)
    res.status(400).json({ error: { code: 'INVALID_SIGNATURE', message } })
    return
  }

  // ── payment_intent.succeeded ────────────────────────────────────────────
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent
    const rideId = paymentIntent.metadata['ride_id']

    // Ride payment (Stripe Connect) — has ride_id in metadata
    if (rideId) {
      await handleRidePaymentSucceeded(rideId, paymentIntent.id)
      res.json({ received: true })
      return
    }

    // Legacy wallet topup — has user_id in metadata
    const userId = paymentIntent.metadata['user_id']
    if (userId) {
      await handleWalletTopup(event.id, paymentIntent, userId)
    }
  }

  // ── payment_intent.payment_failed — ride payment failed ─────────────────
  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent
    const rideId = paymentIntent.metadata['ride_id']

    if (rideId) {
      await handleRidePaymentFailed(rideId, paymentIntent.id)
    }
  }

  // ── account.updated — Stripe Connect account verification changes ───────
  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account
    await handleAccountUpdated(account)
  }

  res.json({ received: true })
})

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleRidePaymentSucceeded(rideId: string, paymentIntentId: string): Promise<void> {
  console.log(`[Webhook] Ride payment succeeded: ride=${rideId} pi=${paymentIntentId}`)

  const { error } = await supabaseAdmin
    .from('rides')
    .update({ payment_status: 'paid' })
    .eq('id', rideId)

  if (error) {
    console.error(`[Webhook] Failed to update ride payment status: ${error.message}`)
    return
  }

  // Notify driver that payment was received
  const { data: ride } = await supabaseAdmin
    .from('rides')
    .select('driver_id, fare_cents')
    .eq('id', rideId)
    .single()

  if (ride?.driver_id) {
    const { data: tokens } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', ride.driver_id)

    const tokenList = (tokens ?? []).map((t: { token: string }) => t.token)
    if (tokenList.length > 0) {
      const amount = ((ride.fare_cents as number) / 100).toFixed(2)
      await sendFcmPush(tokenList, {
        title: 'Payment received',
        body: `$${amount} has been deposited to your Stripe account`,
        data: { type: 'payment_received', ride_id: rideId },
      })
    }
  }
}

async function handleRidePaymentFailed(rideId: string, paymentIntentId: string): Promise<void> {
  console.log(`[Webhook] Ride payment failed: ride=${rideId} pi=${paymentIntentId}`)

  // Atomically transition processing → failed. Without the .neq guard, a
  // duplicate webhook delivery would re-fire the wallet reversal below and
  // double-debit the driver. Returning data tells us we owned the change.
  const { data: transitioned, error: updateErr } = await supabaseAdmin
    .from('rides')
    .update({ payment_status: 'failed' })
    .eq('id', rideId)
    .neq('payment_status', 'failed')
    .select('id, rider_id, driver_id')

  if (updateErr) {
    console.error(`[Webhook] Failed to update ride payment status: ${updateErr.message}`)
    return
  }

  const ride = transitioned?.[0]
  const ownedTransition = Boolean(ride)

  // Reverse the wallet credit. chargeRideFare counts a successfully-CREATED
  // PaymentIntent as success and credits the driver immediately, even though
  // off_session collection can still fail asynchronously. Before this fix
  // payment_failed only flipped a status flag, leaving the driver's wallet
  // showing money TAGO never collected — the screenshot bug.
  if (ownedTransition && ride?.driver_id) {
    const { data: earnings } = await supabaseAdmin
      .from('transactions')
      .select('amount_cents')
      .eq('ride_id', rideId)
      .eq('type', 'ride_earning')
      .limit(1)

    const earningCents = (earnings?.[0]?.amount_cents as number | null) ?? 0

    if (earningCents > 0) {
      // Idempotency: if a prior attempt already wrote the reversal, skip.
      const { data: prior } = await supabaseAdmin
        .from('transactions')
        .select('id')
        .eq('ride_id', rideId)
        .eq('type', 'fare_reversal')
        .limit(1)

      if (!prior || prior.length === 0) {
        const { error: reverseErr } = await supabaseAdmin.rpc('wallet_apply_delta', {
          p_user_id: ride.driver_id,
          p_delta_cents: -earningCents,
          p_type: 'fare_reversal',
          p_description: `Reversed — rider payment failed (ride ${rideId})`,
          p_ride_id: rideId,
          // payment_intent_id stays NULL: the original ride_earning row owns
          // this PI under the partial-unique index from migration 024 (which
          // exists to block double-credits). Reusing the PI here would throw
          // 23505. The reversal is still tied to the ride via p_ride_id.
          p_payment_intent_id: null,
          p_stripe_event_id: null,
        })
        if (reverseErr) {
          console.error(`[Webhook] CRITICAL: payment failed but wallet reversal errored for driver ${ride.driver_id} ride ${rideId}: ${reverseErr.message}`)
        }
      }
    }
  }

  // Look up rider_id for the push (re-uses the row we already fetched if we
  // owned the transition; otherwise re-read since transitioned[0] is empty).
  let riderId = ride?.rider_id as string | null | undefined
  if (!riderId) {
    const { data: re } = await supabaseAdmin
      .from('rides')
      .select('rider_id')
      .eq('id', rideId)
      .single()
    riderId = re?.rider_id as string | null | undefined
  }

  if (riderId) {
    const { data: tokens } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', riderId)

    const tokenList = (tokens ?? []).map((t: { token: string }) => t.token)
    if (tokenList.length > 0) {
      await sendFcmPush(tokenList, {
        title: 'Payment failed',
        body: 'Your ride payment could not be processed. Please update your payment method.',
        data: { type: 'payment_failed', ride_id: rideId },
      })
    }
  }
}

async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  const accountId = account.id
  const chargesEnabled = account.charges_enabled ?? false
  const payoutsEnabled = account.payouts_enabled ?? false
  const isComplete = chargesEnabled && payoutsEnabled

  console.log(`[Webhook] account.updated: ${accountId} charges=${chargesEnabled} payouts=${payoutsEnabled}`)

  // Find user by stripe_account_id and update onboarding status
  const { error } = await supabaseAdmin
    .from('users')
    .update({ stripe_onboarding_complete: isComplete })
    .eq('stripe_account_id', accountId)

  if (error) {
    console.error(`[Webhook] Failed to update onboarding status for account ${accountId}: ${error.message}`)
  }
}

/** Legacy wallet topup handler — kept for backward compatibility */
async function handleWalletTopup(eventId: string, paymentIntent: Stripe.PaymentIntent, userId: string): Promise<void> {
  const amountCents = paymentIntent.amount

  // Idempotency guard: reject duplicate Stripe events
  const { data: existingTx } = await supabaseAdmin
    .from('transactions')
    .select('id')
    .eq('stripe_event_id', eventId)
    .maybeSingle()

  if (existingTx) {
    console.log(`[Webhook] Duplicate event ${eventId}, skipping`)
    return
  }

  // Atomic credit via RPC: balance + transaction in one tx.
  // Unique indexes on stripe_event_id / payment_intent_id prevent double-credit;
  // if another path (confirm-topup) credited first, the 23505 rolls us back.
  const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('wallet_apply_delta', {
    p_user_id: userId,
    p_delta_cents: amountCents,
    p_type: 'topup',
    p_description: `Added $${(amountCents / 100).toFixed(2)} to wallet`,
    p_ride_id: null,
    p_payment_intent_id: paymentIntent.id,
    p_stripe_event_id: eventId,
  })

  if (rpcErr) {
    if ((rpcErr as { code?: string }).code === '23505') {
      console.log(`[Webhook] Duplicate topup (already credited via confirm-topup or earlier webhook): user=${userId} pi=${paymentIntent.id}`)
      return
    }
    console.error('Failed to apply wallet delta:', rpcErr)
    return
  }

  if (!rpcResult?.applied) {
    console.error('User not found for topup:', userId, rpcResult?.error)
  }
}
