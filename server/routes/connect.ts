import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import Stripe from 'stripe'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'
import { getServerEnv } from '../env.ts'

export const connectRouter = Router()

function getStripe(): Stripe {
  const { STRIPE_SECRET_KEY } = getServerEnv()
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' })
}

// ── POST /api/connect/onboard — create Express account + return onboarding URL
connectRouter.post('/onboard', validateJwt, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = res.locals['userId'] as string
    const { return_url, refresh_url } = req.body as { return_url?: string; refresh_url?: string }

    if (!return_url || !refresh_url) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'return_url and refresh_url are required' },
      })
      return
    }

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('email, stripe_account_id, stripe_onboarding_complete')
      .eq('id', userId)
      .single()

    if (userErr || !user) {
      res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
      return
    }

    const stripe = getStripe()
    let accountId = user.stripe_account_id as string | null

    // If already onboarded, return status instead
    if (accountId && user.stripe_onboarding_complete) {
      res.json({ already_complete: true, stripe_account_id: accountId })
      return
    }

    // Create Express account if none exists
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email as string,
        capabilities: {
          transfers: { requested: true },
        },
        metadata: { user_id: userId },
      })
      accountId = account.id

      await supabaseAdmin
        .from('users')
        .update({ stripe_account_id: accountId })
        .eq('id', userId)
    }

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url,
      return_url,
      type: 'account_onboarding',
    })

    res.json({ url: accountLink.url, stripe_account_id: accountId })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connect/onboard/refresh — fresh onboarding link if previous expired
connectRouter.get('/onboard/refresh', validateJwt, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = res.locals['userId'] as string
    const return_url = req.query['return_url'] as string | undefined
    const refresh_url = req.query['refresh_url'] as string | undefined

    if (!return_url || !refresh_url) {
      res.status(400).json({
        error: { code: 'INVALID_PARAMS', message: 'return_url and refresh_url query params required' },
      })
      return
    }

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('stripe_account_id')
      .eq('id', userId)
      .single()

    if (userErr || !user || !user.stripe_account_id) {
      res.status(404).json({
        error: { code: 'NO_ACCOUNT', message: 'No Stripe account found. Start onboarding first.' },
      })
      return
    }

    const stripe = getStripe()
    const accountLink = await stripe.accountLinks.create({
      account: user.stripe_account_id as string,
      refresh_url,
      return_url,
      type: 'account_onboarding',
    })

    res.json({ url: accountLink.url })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connect/onboard/complete — check account status after Stripe redirect
connectRouter.get('/onboard/complete', validateJwt, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = res.locals['userId'] as string

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('stripe_account_id')
      .eq('id', userId)
      .single()

    if (userErr || !user || !user.stripe_account_id) {
      res.status(404).json({
        error: { code: 'NO_ACCOUNT', message: 'No Stripe account found' },
      })
      return
    }

    const stripe = getStripe()
    const account = await stripe.accounts.retrieve(user.stripe_account_id as string)

    const isComplete = account.charges_enabled && account.payouts_enabled

    if (isComplete) {
      await supabaseAdmin
        .from('users')
        .update({ stripe_onboarding_complete: true })
        .eq('id', userId)
    }

    res.json({
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      onboarding_complete: isComplete,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connect/status — driver's Stripe verification status
connectRouter.get('/status', validateJwt, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = res.locals['userId'] as string

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('stripe_account_id, stripe_onboarding_complete')
      .eq('id', userId)
      .single()

    if (userErr || !user) {
      res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
      return
    }

    if (!user.stripe_account_id) {
      res.json({ has_account: false, onboarding_complete: false, charges_enabled: false, payouts_enabled: false })
      return
    }

    const stripe = getStripe()
    const account = await stripe.accounts.retrieve(user.stripe_account_id as string)

    res.json({
      has_account: true,
      onboarding_complete: user.stripe_onboarding_complete ?? false,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/connect/dashboard — Stripe Express dashboard login link
connectRouter.get('/dashboard', validateJwt, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = res.locals['userId'] as string

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('stripe_account_id, stripe_onboarding_complete')
      .eq('id', userId)
      .single()

    if (userErr || !user || !user.stripe_account_id) {
      res.status(404).json({
        error: { code: 'NO_ACCOUNT', message: 'No Stripe account found' },
      })
      return
    }

    if (!user.stripe_onboarding_complete) {
      res.status(400).json({
        error: { code: 'NOT_VERIFIED', message: 'Complete onboarding before accessing dashboard' },
      })
      return
    }

    const stripe = getStripe()
    const loginLink = await stripe.accounts.createLoginLink(user.stripe_account_id as string)

    res.json({ url: loginLink.url })
  } catch (err) {
    next(err)
  }
})
