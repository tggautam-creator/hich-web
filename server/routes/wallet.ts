import { Router } from 'express'
import Stripe from 'stripe'
import { validateJwt } from '../middleware/auth.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { getServerEnv } from '../env.ts'

export const walletRouter = Router()

const MIN_WITHDRAW_CENTS = 100    // $1.00 floor — avoids dust + Stripe minimums

function getStripe(): Stripe {
  const { STRIPE_SECRET_KEY } = getServerEnv()
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' })
}

// ── POST /api/wallet/topup — create a PaymentIntent ────────────────────────
walletRouter.post('/topup', validateJwt, async (req, res, next) => {
  try {
    const userId = res.locals['userId'] as string
    const { amount_cents } = req.body as { amount_cents: unknown }

    // Validate amount
    if (typeof amount_cents !== 'number' || !Number.isInteger(amount_cents)) {
      res.status(400).json({
        error: { code: 'INVALID_AMOUNT', message: 'amount_cents must be an integer' },
      })
      return
    }
    if (amount_cents < 500 || amount_cents > 20000) {
      res.status(400).json({
        error: { code: 'AMOUNT_OUT_OF_RANGE', message: 'Amount must be between $5.00 and $200.00' },
      })
      return
    }

    // Get or create Stripe customer
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id, email')
      .eq('id', userId)
      .single()

    if (userErr || !user) {
      res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      })
      return
    }

    const stripe = getStripe()
    let customerId = user.stripe_customer_id as string | null

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email as string,
        metadata: { user_id: userId },
      })
      customerId = customer.id

      await supabaseAdmin
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId)
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount_cents,
      currency: 'usd',
      customer: customerId,
      metadata: { user_id: userId },
    })

    res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/wallet/confirm-topup — verify payment and credit wallet ──────
// Called by the client after Stripe confirmCardPayment succeeds.
// Verifies the PaymentIntent status with Stripe before crediting.
walletRouter.post('/confirm-topup', validateJwt, async (req, res, next) => {
  try {
    const userId = res.locals['userId'] as string
    const { payment_intent_id } = req.body as { payment_intent_id: unknown }

    if (typeof payment_intent_id !== 'string' || !payment_intent_id) {
      res.status(400).json({
        error: { code: 'INVALID_PAYLOAD', message: 'payment_intent_id is required' },
      })
      return
    }

    const stripe = getStripe()
    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id)

    // Verify payment succeeded and belongs to this user
    if (paymentIntent.status !== 'succeeded') {
      res.status(400).json({
        error: { code: 'PAYMENT_NOT_SUCCEEDED', message: 'Payment has not succeeded' },
      })
      return
    }

    if (paymentIntent.metadata['user_id'] !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Payment does not belong to this user' },
      })
      return
    }

    const amountCents = paymentIntent.amount

    // Idempotency: check if this PaymentIntent was already credited (by webhook or previous call)
    const { data: existing } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('payment_intent_id', payment_intent_id)
      .limit(1)

    if (existing && existing.length > 0) {
      // Already credited — return current balance
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('wallet_balance')
        .eq('id', userId)
        .single()

      res.json({ credited: false, balance: user?.wallet_balance ?? 0 })
      return
    }

    // Atomic credit via RPC: balance update + transaction insert in one tx.
    // A unique-index conflict on payment_intent_id rolls back the balance.
    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('wallet_apply_delta', {
      p_user_id: userId,
      p_delta_cents: amountCents,
      p_type: 'topup',
      p_description: `Added $${(amountCents / 100).toFixed(2)} to wallet`,
      p_ride_id: null,
      p_payment_intent_id: payment_intent_id,
      p_stripe_event_id: null,
    })

    if (rpcErr) {
      // 23505 = duplicate payment_intent_id → another caller (webhook) already credited.
      if ((rpcErr as { code?: string }).code === '23505') {
        const { data: userRow } = await supabaseAdmin
          .from('users')
          .select('wallet_balance')
          .eq('id', userId)
          .single()
        res.json({ credited: false, balance: userRow?.wallet_balance ?? 0 })
        return
      }
      next(rpcErr)
      return
    }

    if (!rpcResult?.applied) {
      res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: rpcResult?.error ?? 'User not found' },
      })
      return
    }

    res.json({ credited: true, balance: rpcResult.balance })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/wallet/withdraw — pay out wallet balance to driver's bank ─────
//
// F5. Debits the driver's wallet and creates a Stripe Transfer to their
// connected account. The default Stripe payout schedule moves funds to the
// linked bank (typically T+2). Requires `Idempotency-Key` — replays return
// the first response.
walletRouter.post('/withdraw', validateJwt, idempotency('wallet-withdraw'), async (req, res, next) => {
  try {
    const userId = res.locals['userId'] as string
    const body = (req.body ?? {}) as { amount_cents?: unknown }
    const amountCents = typeof body.amount_cents === 'number' ? body.amount_cents : NaN

    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: { code: 'INVALID_AMOUNT', message: 'amount_cents must be a positive integer' } })
      return
    }
    if (amountCents < MIN_WITHDRAW_CENTS) {
      res.status(400).json({ error: { code: 'MIN_AMOUNT', message: `Minimum withdrawal is $${(MIN_WITHDRAW_CENTS / 100).toFixed(2)}` } })
      return
    }

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('wallet_balance, stripe_account_id, stripe_onboarding_complete')
      .eq('id', userId)
      .single()

    if (userErr || !user) {
      res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
      return
    }

    if (!user.stripe_account_id || user.stripe_onboarding_complete !== true) {
      res.status(400).json({
        error: { code: 'BANK_NOT_LINKED', message: 'Link a bank account before withdrawing' },
      })
      return
    }

    const balance = (user.wallet_balance as number | null) ?? 0
    if (amountCents > balance) {
      res.status(400).json({
        error: { code: 'INSUFFICIENT_BALANCE', message: 'Withdrawal exceeds wallet balance' },
      })
      return
    }

    // Debit first. If the Stripe transfer fails, we credit back.
    const { error: debitErr } = await supabaseAdmin.rpc('wallet_apply_delta', {
      p_user_id: userId,
      p_delta_cents: -amountCents,
      p_type: 'withdrawal',
      p_description: `Withdrawal to bank · $${(amountCents / 100).toFixed(2)}`,
      p_ride_id: null,
      p_payment_intent_id: null,
      p_stripe_event_id: null,
    })

    if (debitErr) {
      console.error(`[wallet/withdraw] debit failed for user ${userId}: ${debitErr.message}`)
      next(debitErr)
      return
    }

    const stripe = getStripe()
    try {
      // Stripe-side idempotency: a network blip between our debit and the
      // Transfer (or a server crash + client retry) could otherwise create
      // a duplicate transfer and pay the driver twice. The route also has
      // HTTP-level idempotency middleware, but that protects only against
      // matching `Idempotency-Key` headers — a fresh retry without the
      // header would slip past. Tying the key to (user, amount, today) is
      // a coarse but safe dedupe: a same-day repeat withdrawal of the
      // exact same cents reuses Stripe's cached response. Driver wanting
      // to withdraw twice in a day for the same exact amount must wait
      // for date rollover or pick a different amount — acceptable trade.
      const dayKey = new Date().toISOString().split('T')[0]
      const transfer = await stripe.transfers.create(
        {
          amount: amountCents,
          currency: 'usd',
          destination: user.stripe_account_id as string,
          metadata: { user_id: userId, kind: 'wallet_withdrawal' },
        },
        { idempotencyKey: `withdraw-${userId}-${amountCents}-${dayKey}` },
      )

      res.json({
        status: 'transferring',
        transfer_id: transfer.id,
        amount_cents: amountCents,
        eta_days: 2,
      })
    } catch (stripeErr) {
      // Credit back the debit so the user isn't out their money.
      const { error: creditBackErr } = await supabaseAdmin.rpc('wallet_apply_delta', {
        p_user_id: userId,
        p_delta_cents: amountCents,
        p_type: 'withdrawal_failed_refund',
        p_description: 'Refund — withdrawal failed at Stripe',
        p_ride_id: null,
        p_payment_intent_id: null,
        p_stripe_event_id: null,
      })
      if (creditBackErr) {
        console.error(`[wallet/withdraw] CRITICAL: credit-back failed for user ${userId}: ${creditBackErr.message}`)
      }

      const message = stripeErr instanceof Stripe.errors.StripeError
        ? stripeErr.message
        : stripeErr instanceof Error ? stripeErr.message : 'Unknown Stripe error'
      console.error(`[wallet/withdraw] Stripe transfer failed for user ${userId}: ${message}`)
      res.status(502).json({ error: { code: 'TRANSFER_FAILED', message } })
    }
  } catch (err) {
    next(err)
  }
})

// ── GET /api/wallet/pending-earnings — driver-side "payments in limbo" ─────
//
// Lists rides the caller drove whose rider-side payment never settled
// (`payment_status IN ('pending','failed')`). These are earnings the driver
// has *not* received yet — the rider either had no card at end-of-ride (B2)
// or their off-session retry hit a Stripe decline. The driver's wallet was
// NOT credited for these rides, so they don't double-count against existing
// `wallet_balance`.
walletRouter.get('/pending-earnings', validateJwt, async (_req, res, next) => {
  try {
    const userId = res.locals['userId'] as string

    const { data: rides, error: ridesErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, fare_cents, ended_at, destination_name, payment_status')
      .eq('driver_id', userId)
      .in('payment_status', ['pending', 'failed'])
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(50)

    if (ridesErr) {
      res.status(500).json({ error: { code: 'DB_ERROR', message: ridesErr.message } })
      return
    }

    const ridesList = rides ?? []
    const riderIds = Array.from(new Set(
      ridesList.map((r) => r.rider_id as string | null).filter((id): id is string => Boolean(id)),
    ))

    const nameById = new Map<string, string>()
    if (riderIds.length > 0) {
      const { data: riders } = await supabaseAdmin
        .from('users')
        .select('id, full_name')
        .in('id', riderIds)
      for (const r of riders ?? []) {
        if (r.id) nameById.set(r.id as string, (r.full_name as string | null) ?? '')
      }
    }

    const pending = ridesList.map((r) => ({
      ride_id: r.id,
      rider_id: r.rider_id,
      rider_name: nameById.get(r.rider_id as string) ?? null,
      fare_cents: r.fare_cents,
      ended_at: r.ended_at,
      destination_name: r.destination_name,
      payment_status: r.payment_status,
    }))
    const totalCents = pending.reduce((sum, p) => sum + ((p.fare_cents as number | null) ?? 0), 0)

    res.json({ pending, total_cents: totalCents })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/wallet/transactions — fetch transaction history ───────────────
walletRouter.get('/transactions', validateJwt, async (_req, res, next) => {
  try {
    const userId = res.locals['userId'] as string

    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      res.status(500).json({
        error: { code: 'DB_ERROR', message: error.message },
      })
      return
    }

    const txList = data ?? []

    // Enrich ride-linked rows with the OTHER party's name so the wallet UI
    // can show "Ride earning · Tarun Gautam" instead of "Ride earning ·
    // 96b85b…" (the bare ride uuid was unreadable for the driver).
    const rideIds = Array.from(
      new Set(txList.map((t) => t.ride_id as string | null).filter((v): v is string => Boolean(v))),
    )
    const counterpartyByRide = new Map<string, string>()
    if (rideIds.length > 0) {
      const { data: rides } = await supabaseAdmin
        .from('rides')
        .select('id, rider_id, driver_id')
        .in('id', rideIds)

      const otherIds = new Set<string>()
      const rideOtherById = new Map<string, string>()
      for (const r of rides ?? []) {
        const otherId = r.rider_id === userId
          ? (r.driver_id as string | null)
          : (r.rider_id as string | null)
        if (otherId) {
          otherIds.add(otherId)
          rideOtherById.set(r.id as string, otherId)
        }
      }

      const nameById = new Map<string, string>()
      if (otherIds.size > 0) {
        const { data: users } = await supabaseAdmin
          .from('users')
          .select('id, full_name')
          .in('id', Array.from(otherIds))
        for (const u of users ?? []) {
          if (u.id) nameById.set(u.id as string, (u.full_name as string | null) ?? '')
        }
      }

      for (const [rideId, otherId] of rideOtherById) {
        const name = nameById.get(otherId)
        if (name) counterpartyByRide.set(rideId, name)
      }
    }

    const enriched = txList.map((t) => {
      const rideId = t.ride_id as string | null
      const counterpartyName = rideId ? counterpartyByRide.get(rideId) ?? null : null
      return { ...t, counterparty_name: counterpartyName }
    })

    res.json({ transactions: enriched })
  } catch (err) {
    next(err)
  }
})
