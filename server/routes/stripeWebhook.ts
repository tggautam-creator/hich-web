import { Router } from 'express'
import type { Request, Response } from 'express'
import Stripe from 'stripe'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
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

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent
    const userId = paymentIntent.metadata['user_id']
    const amountCents = paymentIntent.amount

    if (!userId) {
      console.error('PaymentIntent missing user_id metadata:', paymentIntent.id)
      res.status(400).json({ error: { code: 'MISSING_METADATA', message: 'No user_id in metadata' } })
      return
    }

    // Idempotency guard: reject duplicate Stripe events
    const { data: existingTx } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('stripe_event_id', event.id)
      .maybeSingle()

    if (existingTx) {
      console.log(`[Webhook] Duplicate event ${event.id}, skipping`)
      res.json({ received: true })
      return
    }

    // Get current balance
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('wallet_balance')
      .eq('id', userId)
      .single()

    if (userErr || !user) {
      console.error('User not found for topup:', userId)
      res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
      return
    }

    const currentBalance = user.wallet_balance as number
    const newBalance = currentBalance + amountCents

    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({ wallet_balance: newBalance })
      .eq('id', userId)

    if (updateErr) {
      console.error('Failed to update wallet balance:', updateErr)
      res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to update balance' } })
      return
    }

    const { error: txErr } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'topup',
        amount_cents: amountCents,
        balance_after_cents: newBalance,
        description: `Added $${(amountCents / 100).toFixed(2)} to wallet`,
        stripe_event_id: event.id,
        payment_intent_id: paymentIntent.id,
      })

    if (txErr) {
      console.error('Failed to insert transaction record:', txErr)
    }
  }

  res.json({ received: true })
})
