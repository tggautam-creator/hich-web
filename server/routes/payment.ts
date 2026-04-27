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
 * Self-heals `users.default_payment_method_id` against Stripe and returns
 * the effective default PM id (or null if the customer truly has no cards).
 *
 * Three guards (rides.ts /request, schedule.ts /request, payment.ts /methods)
 * used to do this inline with diverging behavior — schedule.ts even null-out'd
 * the column when its retrieve() throw was transient, which is what nuked
 * users' default and caused "add a payment method" prompts despite saved
 * cards. Centralizing here makes all three paths heal-forward instead of
 * heal-backward: we trust Stripe's PM list as the source of truth and
 * promote any surviving card before declaring "no payment method."
 */
export async function resolveAndPersistDefaultPm(
  userId: string,
  customerId: string,
  cachedDefault: string | null,
): Promise<string | null> {
  const stripe = getStripe()
  const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card' })
  const pms = list.data

  if (pms.length === 0) {
    if (cachedDefault) {
      await supabaseAdmin
        .from('users')
        .update({ default_payment_method_id: null })
        .eq('id', userId)
    }
    return null
  }

  const cachedStillValid = cachedDefault != null && pms.some((m) => m.id === cachedDefault)
  if (cachedStillValid) return cachedDefault

  // Cached default was detached out-of-band but the customer still has other
  // valid cards — promote the most-recently-created one and persist.
  const promoted = [...pms].sort((a, b) => b.created - a.created)[0]?.id ?? null
  if (promoted && promoted !== cachedDefault) {
    await supabaseAdmin
      .from('users')
      .update({ default_payment_method_id: promoted })
      .eq('id', userId)
  }
  return promoted
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

    const effectiveDefault = await resolveAndPersistDefaultPm(
      userId,
      user.stripe_customer_id as string,
      (user.default_payment_method_id as string | null) ?? null,
    )

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

    // Stripe doesn't dedupe by default — re-saving a card creates a new
    // pm_xxx with a fresh id but the same card.fingerprint. Without this
    // check the Payment Methods page accumulates duplicates of the same
    // physical card. When we detect a fingerprint collision, detach the
    // *new* pm and promote the *existing* one as default; pm_ids referenced
    // by existing rows (rides, transactions) keep working.
    const fingerprint = pm.card?.fingerprint
    let effectivePmId = payment_method_id
    if (fingerprint) {
      const list = await stripe.paymentMethods.list({
        customer: user.stripe_customer_id as string,
        type: 'card',
      })
      const duplicates = list.data.filter(
        (m) => m.id !== payment_method_id && m.card?.fingerprint === fingerprint,
      )
      if (duplicates.length > 0) {
        const oldest = [...duplicates].sort((a, b) => a.created - b.created)[0]
        effectivePmId = oldest.id
        try {
          await stripe.paymentMethods.detach(payment_method_id)
        } catch {
          // Non-fatal — the existing card is still usable as default.
        }
      }
    }

    await supabaseAdmin
      .from('users')
      .update({ default_payment_method_id: effectivePmId })
      .eq('id', userId)

    res.json({ default_method_id: effectivePmId, deduplicated: effectivePmId !== payment_method_id })
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

    // If this was the default, promote a remaining card (if any) so the
    // user isn't left in a "have cards but no default" state — that's the
    // exact pothole that produced the duplicate-card bug: a NULL column
    // tripped the on-demand ride blocker even though Stripe still had a
    // valid card on file.
    let newDefault: string | null = user.default_payment_method_id as string | null
    if (user.default_payment_method_id === methodId) {
      newDefault = await resolveAndPersistDefaultPm(
        userId,
        user.stripe_customer_id as string,
        null, // cached default just got detached
      )
    }

    res.json({ detached: true, default_method_id: newDefault })
  } catch (err) {
    next(err)
  }
})
