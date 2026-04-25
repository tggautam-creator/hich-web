import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import Stripe from 'stripe'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'
import { getServerEnv } from '../env.ts'

export const paymentRouter = Router()

export function getStripe(): Stripe {
  const { STRIPE_SECRET_KEY } = getServerEnv()
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' })
}

function isMissingCustomerError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const stripeErr = err as { code?: string; message?: string }
  return stripeErr.code === 'resource_missing'
    || (typeof stripeErr.message === 'string' && stripeErr.message.includes('No such customer'))
}

/**
 * Ensure the user has a Stripe customer. Creates one if missing.
 * Returns the customer ID.
 */
async function ensureCustomer(userId: string): Promise<string> {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('stripe_customer_id, email')
    .eq('id', userId)
    .single()

  if (error || !user) throw new Error('User not found')

  const stripe = getStripe()
  const createAndPersistCustomer = async (): Promise<string> => {
    const customer = await stripe.customers.create({
      email: user.email as string,
      metadata: { user_id: userId },
    })

    await supabaseAdmin
      .from('users')
      .update({ stripe_customer_id: customer.id })
      .eq('id', userId)

    return customer.id
  }

  const customerId = user.stripe_customer_id as string | null
  if (!customerId) {
    return createAndPersistCustomer()
  }

  try {
    const existing = await stripe.customers.retrieve(customerId)
    if ('deleted' in existing && existing.deleted) {
      return createAndPersistCustomer()
    }
    return customerId
  } catch (err) {
    if (isMissingCustomerError(err)) {
      return createAndPersistCustomer()
    }
    throw err
  }
}

// ── POST /api/payment/setup-intent — create SetupIntent for saving a card
paymentRouter.post('/setup-intent', validateJwt, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = res.locals['userId'] as string
    const customerId = await ensureCustomer(userId)

    const stripe = getStripe()
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
    })

    res.json({ clientSecret: setupIntent.client_secret })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/payment/methods — list rider's saved payment methods
paymentRouter.get('/methods', validateJwt, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = res.locals['userId'] as string

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id, default_payment_method_id')
      .eq('id', userId)
      .single()

    if (userErr || !user || !user.stripe_customer_id) {
      res.json({ methods: [], default_method_id: null })
      return
    }

    const stripe = getStripe()
    const methods = await stripe.paymentMethods.list({
      customer: user.stripe_customer_id as string,
      type: 'card',
    })

    // Self-heal a stale default_payment_method_id. Cards can be detached
    // out-of-band (Stripe Dashboard, test-mode reset, expired card) leaving
    // the cached column pointing at a payment method that no longer exists.
    // Downstream guards (rider-post card check + migration 051 trigger) trust
    // this column, so a stale value lets users slip past. Reconcile here.
    let effectiveDefault: string | null = user.default_payment_method_id
    const cachedDefaultStillValid =
      effectiveDefault != null && methods.data.some((m) => m.id === effectiveDefault)

    if (effectiveDefault != null && !cachedDefaultStillValid) {
      effectiveDefault = methods.data[0]?.id ?? null
      await supabaseAdmin
        .from('users')
        .update({ default_payment_method_id: effectiveDefault })
        .eq('id', userId)
    }

    const cards = methods.data.map((m) => ({
      id: m.id,
      brand: m.card?.brand ?? 'unknown',
      last4: m.card?.last4 ?? '****',
      exp_month: m.card?.exp_month ?? 0,
      exp_year: m.card?.exp_year ?? 0,
      is_default: m.id === effectiveDefault,
    }))

    res.json({ methods: cards, default_method_id: effectiveDefault })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/payment/default-method — set default payment method
paymentRouter.post('/default-method', validateJwt, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = res.locals['userId'] as string
    const { payment_method_id } = req.body as { payment_method_id?: string }

    if (!payment_method_id || typeof payment_method_id !== 'string') {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'payment_method_id is required' },
      })
      return
    }

    // Verify this payment method belongs to the user's customer
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single()

    if (userErr || !user || !user.stripe_customer_id) {
      res.status(400).json({
        error: { code: 'NO_CUSTOMER', message: 'No Stripe customer found. Save a card first.' },
      })
      return
    }

    const stripe = getStripe()
    const pm = await stripe.paymentMethods.retrieve(payment_method_id)

    if (pm.customer !== user.stripe_customer_id) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Payment method does not belong to this user' },
      })
      return
    }

    await supabaseAdmin
      .from('users')
      .update({ default_payment_method_id: payment_method_id })
      .eq('id', userId)

    res.json({ default_method_id: payment_method_id })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/payment/methods/:id — detach a payment method
paymentRouter.delete('/methods/:id', validateJwt, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = res.locals['userId'] as string
    const methodId = req.params['id'] as string

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id, default_payment_method_id')
      .eq('id', userId)
      .single()

    if (userErr || !user || !user.stripe_customer_id) {
      res.status(400).json({
        error: { code: 'NO_CUSTOMER', message: 'No Stripe customer found' },
      })
      return
    }

    const stripe = getStripe()
    const pm = await stripe.paymentMethods.retrieve(methodId)

    if (pm.customer !== user.stripe_customer_id) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Payment method does not belong to this user' },
      })
      return
    }

    await stripe.paymentMethods.detach(methodId)

    // If this was the default, clear it
    if (user.default_payment_method_id === methodId) {
      await supabaseAdmin
        .from('users')
        .update({ default_payment_method_id: null })
        .eq('id', userId)
    }

    res.json({ detached: true })
  } catch (err) {
    next(err)
  }
})
