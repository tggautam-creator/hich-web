import { Router } from 'express'
import Stripe from 'stripe'
import { validateJwt } from '../middleware/auth.ts'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { getServerEnv } from '../env.ts'

export const walletRouter = Router()

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

    // Credit the wallet
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('wallet_balance')
      .eq('id', userId)
      .single()

    if (userErr || !user) {
      res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      })
      return
    }

    const newBalance = (user.wallet_balance as number) + amountCents

    await supabaseAdmin
      .from('users')
      .update({ wallet_balance: newBalance })
      .eq('id', userId)

    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'topup',
        amount_cents: amountCents,
        balance_after_cents: newBalance,
        description: `Added $${(amountCents / 100).toFixed(2)} to wallet`,
        payment_intent_id: payment_intent_id,
      })

    res.json({ credited: true, balance: newBalance })
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

    res.json({ transactions: data })
  } catch (err) {
    next(err)
  }
})
