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
//
// `idempotency()` middleware added 2026-04-28 (PAY.0 H3). Without it,
// a double-tap on "I've paid" or a network retry could race on the
// `payment_intent_id` partial-unique index — Postgres serializes the
// 23505 collision correctly but the response body to the racing
// client could echo a stale balance (the SELECT runs before the
// other path's RPC commits). Reservation-pattern idempotency
// guarantees a single handler run per key.
walletRouter.post('/confirm-topup', validateJwt, idempotency('wallet-confirm-topup'), async (req, res, next) => {
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
    // `p_transfer_id: null` is REQUIRED — there are two overloaded
    // `wallet_apply_delta` functions in DB (7-param topup-era + 8-param
    // withdrawal-era). Calling with exactly 7 named args triggers
    // PostgREST PGRST203 "could not choose the best candidate function".
    // Pinning the 8th arg explicitly disambiguates to the newer signature.
    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('wallet_apply_delta', {
      p_user_id: userId,
      p_delta_cents: amountCents,
      p_type: 'topup',
      p_description: `Added $${(amountCents / 100).toFixed(2)} to wallet`,
      p_ride_id: null,
      p_payment_intent_id: payment_intent_id,
      p_stripe_event_id: null,
      p_transfer_id: null,
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

    // PAY.12 (2026-04-29): write the funding-source columns onto the
    // freshly-inserted transactions row so the wallet UI can show
    // "Apple Pay" / "Visa •••• 4242" instead of a generic subtitle.
    // Best-effort — failure here doesn't unwind the credit; row just
    // stays with null pm_* fields and falls back to the legacy copy.
    await populateTransactionPaymentSource(payment_intent_id, paymentIntent)

    res.json({ credited: true, balance: rpcResult.balance })
  } catch (err) {
    next(err)
  }
})

/// Decorate the `transactions` row matching `paymentIntentId` with the
/// funding source we read off the PaymentIntent. Called from both
/// `/confirm-topup` (which already retrieved the PI) and the
/// `payment_intent.succeeded` webhook (which receives the event
/// object). Idempotent — running both paths writes the same data.
export async function populateTransactionPaymentSource(
  paymentIntentId: string,
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  try {
    const stripe = getStripe()
    let pm: Stripe.PaymentMethod | null = null
    if (typeof paymentIntent.payment_method === 'string') {
      pm = await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
    } else if (paymentIntent.payment_method) {
      pm = paymentIntent.payment_method as Stripe.PaymentMethod
    }
    if (!pm || pm.type !== 'card' || !pm.card) return

    const wallet = pm.card.wallet?.type ?? null
    await supabaseAdmin
      .from('transactions')
      .update({
        pm_brand: pm.card.brand,
        pm_last4: pm.card.last4,
        pm_wallet: wallet,
      })
      .eq('payment_intent_id', paymentIntentId)
  } catch (err) {
    // Best-effort — never propagate. The row already has the credit
    // applied; the source label is a UX nicety, not financial data.
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[wallet] populateTransactionPaymentSource failed for pi=${paymentIntentId}: ${message}`)
  }
}

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
    // `p_transfer_id: null` here too — see wallet_apply_delta dispatch
    // note above. Withdrawals get the real `transfer_id` written via a
    // direct `transactions` UPDATE after `stripe.transfers.create`
    // succeeds (further down in this handler), not at insert time.
    const { error: debitErr } = await supabaseAdmin.rpc('wallet_apply_delta', {
      p_user_id: userId,
      p_delta_cents: -amountCents,
      p_type: 'withdrawal',
      p_description: `Withdrawal to bank · $${(amountCents / 100).toFixed(2)}`,
      p_ride_id: null,
      p_payment_intent_id: null,
      p_stripe_event_id: null,
      p_transfer_id: null,
    })

    if (debitErr) {
      console.error(`[wallet/withdraw] debit failed for user ${userId}: ${debitErr.message}`)
      next(debitErr)
      return
    }

    const stripe = getStripe()
    try {
      // Stripe-side idempotency: prefer the HTTP `Idempotency-Key`
      // header (now reservation-protected by `idempotency()`
      // middleware as of PAY.0 H1) so a legitimate retry with the
      // same key reuses Stripe's cached transfer, while a genuinely
      // new withdrawal-of-same-amount with a fresh key creates a
      // fresh transfer. Closes the H4 finding from the 2026-04-28
      // payments security audit: the prior `(user, amount, dayKey)`
      // formulation incorrectly aliased two different same-day
      // withdrawals of the same cents to one Stripe transfer,
      // letting the second debit succeed but the second transfer
      // silently no-op. iOS clients always send the header; web
      // legacy clients fall back to the day-keyed scheme.
      const httpIdempotencyKey = req.header('Idempotency-Key') ?? req.header('idempotency-key')
      const dayKey = new Date().toISOString().split('T')[0]
      const stripeKey = httpIdempotencyKey
        ? `withdraw-${httpIdempotencyKey}`
        : `withdraw-${userId}-${amountCents}-${dayKey}`
      const transfer = await stripe.transfers.create(
        {
          amount: amountCents,
          currency: 'usd',
          destination: user.stripe_account_id as string,
          metadata: { user_id: userId, kind: 'wallet_withdrawal' },
        },
        { idempotencyKey: stripeKey },
      )

      // Stamp the just-written withdrawal row with the Stripe transfer id
      // so the wallet UI can render an "in transit" pill for it, and so
      // the transfer.paid webhook can find it later. Targets the most
      // recent un-tagged withdrawal for this user (the one we just wrote
      // a few lines above; the HTTP idempotency middleware + Stripe-side
      // idempotency key together prevent any other withdrawal from
      // racing in between). Failure here is non-fatal — the money has
      // already moved; worst case the UI doesn't show "in transit".
      const { error: tagErr } = await supabaseAdmin
        .from('transactions')
        .update({ transfer_id: transfer.id })
        .eq('user_id', userId)
        .eq('type', 'withdrawal')
        .is('transfer_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
      if (tagErr) {
        console.error(`[wallet/withdraw] failed to attach transfer_id ${transfer.id} to txn for user ${userId}: ${tagErr.message}`)
      }

      res.json({
        status: 'transferring',
        transfer_id: transfer.id,
        amount_cents: amountCents,
        eta_days: 2,
      })
    } catch (stripeErr) {
      // Capture Stripe's reason FIRST so we can both log it AND
      // include it in the credit-back row's description (PAY.15,
      // 2026-04-29). Earlier the row just said "Refund — withdrawal
      // failed at Stripe" which left the user wondering whether
      // their bank rejected, the platform balance was insufficient,
      // or the connected account got disabled. Surfacing the
      // verbatim Stripe message makes the detail page actionable.
      const failureReason = stripeErr instanceof Stripe.errors.StripeError
        ? stripeErr.message
        : stripeErr instanceof Error ? stripeErr.message : 'Unknown Stripe error'

      // Credit back the debit so the user isn't out their money.
      // Truncate to 500 chars so a verbose Stripe response can't
      // bloat the transactions row.
      const truncatedReason = failureReason.length > 500
        ? failureReason.slice(0, 497) + '…'
        : failureReason
      const { error: creditBackErr } = await supabaseAdmin.rpc('wallet_apply_delta', {
        p_user_id: userId,
        p_delta_cents: amountCents,
        p_type: 'withdrawal_failed_refund',
        p_description: `Refund — withdrawal declined: ${truncatedReason}`,
        p_ride_id: null,
        p_payment_intent_id: null,
        p_stripe_event_id: null,
        p_transfer_id: null,
      })
      if (creditBackErr) {
        console.error(`[wallet/withdraw] CRITICAL: credit-back failed for user ${userId}: ${creditBackErr.message}`)
      }

      console.error(`[wallet/withdraw] Stripe transfer failed for user ${userId}: ${failureReason}`)
      res.status(502).json({ error: { code: 'TRANSFER_FAILED', message: failureReason } })
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
//
// Cursor pagination (PAY.7, 2026-04-28). Query params:
//   - `cursor` — ISO 8601 timestamp from prior response's `next_cursor`.
//     When omitted, returns the newest page. Filter is `created_at <
//     cursor`, so the cursor row itself is not returned (avoids overlap).
//   - `limit` — clamped to [1, 50]. Default 25 (one screenful on iOS).
//
// Response shape: `{ transactions, next_cursor }`. `next_cursor` is the
// last row's `created_at` ISO string, or null when fewer than `limit`
// rows came back (caller can stop fetching).
walletRouter.get('/transactions', validateJwt, async (req, res, next) => {
  try {
    const userId = res.locals['userId'] as string
    const cursorRaw = req.query['cursor']
    const limitRaw = req.query['limit']

    let limit = 25
    if (typeof limitRaw === 'string') {
      const parsed = Number.parseInt(limitRaw, 10)
      if (Number.isFinite(parsed)) {
        limit = Math.min(Math.max(parsed, 1), 50)
      }
    }

    let query = supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (typeof cursorRaw === 'string' && cursorRaw.length > 0) {
      query = query.lt('created_at', cursorRaw)
    }

    const { data, error } = await query

    if (error) {
      res.status(500).json({
        error: { code: 'DB_ERROR', message: error.message },
      })
      return
    }

    const txList = data ?? []
    const nextCursor = txList.length === limit
      ? (txList[txList.length - 1]!.created_at as string)
      : null

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

    res.json({ transactions: enriched, next_cursor: nextCursor })
  } catch (err) {
    next(err)
  }
})
