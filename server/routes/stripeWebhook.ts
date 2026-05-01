import { Router } from 'express'
import type { Request, Response } from 'express'
import Stripe from 'stripe'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { sendFcmPush } from '../lib/fcm.ts'
import { getServerEnv } from '../env.ts'
import { populateTransactionPaymentSource } from './wallet.ts'

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

  // ── Livemode-mode mismatch defense (H5, PAY.0 audit 2026-04-28) ───
  // A correctly-configured pair of (server secret key, webhook secret)
  // for the same Stripe project will only verify webhook events from
  // that project's mode. But a misconfigured deployment that mixes
  // test-mode + live-mode keys (which has happened in this repo's
  // history — see `[CROSS_MODE_STRIPE]` tags in `stripeConnect.ts`)
  // would accept events from the wrong mode and credit wallets from
  // a sandbox PaymentIntent. Belt-and-braces: assert the event's
  // `livemode` flag matches the secret key's prefix.
  const { STRIPE_SECRET_KEY } = getServerEnv()
  const expectedLivemode = STRIPE_SECRET_KEY.startsWith('sk_live_')
  if (event.livemode !== expectedLivemode) {
    console.error(
      `[Webhook] livemode mismatch: event.livemode=${event.livemode} expected=${expectedLivemode} event_id=${event.id}`,
    )
    res.status(400).json({
      error: {
        code: 'LIVEMODE_MISMATCH',
        message: 'Webhook event livemode does not match server mode',
      },
    })
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

  // NB: there is no platform-level "money landed in driver's bank" event
  // in current Stripe API — `transfer.paid` was retired and `payout.paid`
  // only fires on the connected account. The wallet UI computes the
  // landed/in-transit state cosmetically from created_at + 2 business
  // days. See WalletPage.withdrawalEta + Slice 5 followup notes.

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

  // Atomically transition only from processing/pending → failed. The
  // tighter .in() (was .neq('payment_status','failed')) closes a race:
  // when /retry-payment succeeds and flips status back to 'paid', a late
  // payment_failed webhook for the *original* PI would otherwise still
  // win the .neq check, mark the ride failed, and reverse a credit that
  // was already settled. Now 'paid' is filtered out — only in-flight
  // states can transition. Returning data tells us we owned the change.
  const { data: transitioned, error: updateErr } = await supabaseAdmin
    .from('rides')
    .update({ payment_status: 'failed' })
    .eq('id', rideId)
    .in('payment_status', ['processing', 'pending'])
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
          p_transfer_id: null,
        })
        if (reverseErr) {
          console.error(`[Webhook] CRITICAL: payment failed but wallet reversal errored for driver ${ride.driver_id} ride ${rideId}: ${reverseErr.message}`)
        }
      }
    }

    // ── Restore rider's wallet portion if this was a wallet+card payment ──
    // Phase 3a (wallet-first) splits a fare into wallet_debit + card charge
    // when wallet < fare. If the card charge later fails async, we owe the
    // rider their wallet portion back. refundWalletPortion is idempotent
    // (skips if a wallet_refund row already exists for this ride).
    if (ride?.rider_id) {
      // Sum every fare_debit on this ride (a retry-after-refund may insert
      // more than one) and let refundWalletPortion's net-balance check
      // decide what's actually still owed.
      const { data: debitRows } = await supabaseAdmin
        .from('transactions')
        .select('amount_cents')
        .eq('user_id', ride.rider_id)
        .eq('ride_id', rideId)
        .eq('type', 'fare_debit')

      let debitedCents = 0
      for (const r of debitRows ?? []) {
        debitedCents += -((r.amount_cents as number | null) ?? 0)
      }

      if (debitedCents > 0) {
        const { refundWalletPortion } = await import('../lib/walletPayment.ts')
        await refundWalletPortion({
          rideId,
          riderId: ride.rider_id,
          amountCents: debitedCents,
          reason: 'Refunded — card portion failed (rider wallet restored)',
        })
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
    p_transfer_id: null,
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
    return
  }

  // PAY.12 (2026-04-29): backfill funding-source columns. The webhook
  // path may also be the FIRST inserter (when the rider closes the
  // app before /confirm-topup fires) — we still want to label the
  // row's source. The /confirm-topup path runs the same call;
  // idempotent UPDATE writes the same data either way.
  await populateTransactionPaymentSource(paymentIntent.id, paymentIntent)

  // PAY.14 (2026-04-29): foreground in-app banner push. The iOS
  // PaymentEventStore listens for `topup_succeeded` and shows a
  // top-of-screen banner regardless of which tab the user is on.
  // System banner also fires when app is backgrounded. Best-effort —
  // a missing push token list just means the credit happened
  // silently, which is the same behavior as before this slice.
  const { data: tokens } = await supabaseAdmin
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId)
  const tokenList = (tokens ?? []).map((t: { token: string }) => t.token)
  if (tokenList.length > 0) {
    const dollars = (amountCents / 100).toFixed(2)
    await sendFcmPush(tokenList, {
      title: 'Wallet topped up',
      body: `$${dollars} added to your Tago credit.`,
      data: { type: 'topup_succeeded', amount: `$${dollars}` },
    })
  }
}
