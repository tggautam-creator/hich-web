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

/**
 * Allowlist for `return_url` + `refresh_url` on Stripe Connect onboarding.
 * Stripe redirects the user to whichever URL we hand it, so an attacker
 * who tricks a driver into hitting `/api/connect/onboard` with a
 * malicious URL can phish them post-onboarding (Stripe → attacker page
 * styled as Tago). JWT auth limits this to a session the attacker
 * already controls, but the URL-bar-says-stripe-came-from-us moment is
 * a real phishing vector for adjacent attacks (cookie theft, fake
 * "complete profile" form). Closes M4 from the PAY.0 audit (2026-04-28).
 *
 * Rules:
 *   - Allow `https://tagorides.com` and any `*.tagorides.com` subdomain.
 *   - Allow the `tago://` iOS custom scheme for Universal Link returns.
 *   - Allow `http://localhost:5173` / `http://localhost:3001` for dev.
 *   - Reject everything else with INVALID_BODY.
 *
 * Same predicate is used by both `onboard` (POST body) and
 * `onboard/refresh` (query params).
 */
function isAllowedConnectURL(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  // iOS custom scheme — strict prefix match.
  if (parsed.protocol === 'tago:') return true
  // Production + dev origins.
  const allowedHosts = new Set([
    'tagorides.com',
    'www.tagorides.com',
    'localhost',
    '127.0.0.1',
  ])
  if (allowedHosts.has(parsed.hostname)) return true
  // *.tagorides.com subdomains (preview deploys, staging, etc.).
  if (parsed.hostname.endsWith('.tagorides.com')) return true
  return false
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

    // Allowlist check — see `isAllowedConnectURL` doc for rationale.
    if (!isAllowedConnectURL(return_url) || !isAllowedConnectURL(refresh_url)) {
      res.status(400).json({
        error: {
          code: 'INVALID_URL',
          message: 'return_url and refresh_url must point at tagorides.com or the tago:// scheme',
        },
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

    if (!isAllowedConnectURL(return_url) || !isAllowedConnectURL(refresh_url)) {
      res.status(400).json({
        error: {
          code: 'INVALID_URL',
          message: 'return_url and refresh_url must point at tagorides.com or the tago:// scheme',
        },
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
      res.json({ has_account: false, onboarding_complete: false, charges_enabled: false, payouts_enabled: false, payout_method_type: null, payout_method_last4: null, payout_method_label: null })
      return
    }

    const stripe = getStripe()
    const account = await stripe.accounts.retrieve(user.stripe_account_id as string, {
      expand: ['external_accounts'],
    })

    // Extract connected payout method details
    let payoutMethodType: 'bank_account' | 'card' | null = null
    let payoutMethodLast4: string | null = null
    let payoutMethodLabel: string | null = null

    const extList = account.external_accounts
    if (extList && extList.data.length > 0) {
      const ext = extList.data[0]
      if (ext.object === 'bank_account') {
        const ba = ext as Stripe.BankAccount
        payoutMethodType = 'bank_account'
        payoutMethodLast4 = ba.last4
        payoutMethodLabel = ba.bank_name ?? 'Bank Account'
      } else if (ext.object === 'card') {
        const card = ext as Stripe.Card
        payoutMethodType = 'card'
        payoutMethodLast4 = card.last4
        payoutMethodLabel = card.brand ?? 'Debit Card'
      }
    }

    // Reconcile our `users.stripe_onboarding_complete` flag with
    // Stripe's authoritative `account.details_submitted` on every
    // status read (PAY.5b, 2026-04-28). The legacy hosted-onboarding
    // flow flipped this flag via the `/onboard/complete` callback
    // after the redirect; the embedded flow has no equivalent
    // server-side trigger — its `accountOnboardingDidExit` callback
    // fires client-side only. So we sync from Stripe lazily here:
    // every status fetch checks if Stripe says details are submitted
    // and updates the DB if so. The `account.updated` webhook is the
    // production-grade backstop for cases where the user never
    // re-opens the Payouts page after finishing.
    let onboardingComplete = (user.stripe_onboarding_complete as boolean | null) ?? false
    if (!onboardingComplete && account.details_submitted) {
      onboardingComplete = true
      await supabaseAdmin
        .from('users')
        .update({ stripe_onboarding_complete: true })
        .eq('id', userId)
    }

    res.json({
      has_account: true,
      onboarding_complete: onboardingComplete,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      payout_method_type: payoutMethodType,
      payout_method_last4: payoutMethodLast4,
      payout_method_label: payoutMethodLabel,
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/connect/account-session — mint an AccountSession client
// secret for Stripe Connect Embedded Components on iOS (PAY.5b,
// 2026-04-28). The iOS app passes this client_secret to
// `EmbeddedComponentManager(fetchClientSecret:)`, then renders
// `AccountOnboardingView` (SwiftUI) inline — no Safari sheet, no
// Universal-Link return-URL dance.
//
// Idempotency: each call mints a fresh client_secret bound to the
// driver's Stripe account; safe to call repeatedly. Stripe expires
// the secret quickly so we don't cache.
//
// If the driver doesn't have a Stripe account yet, we lazily create
// an Express account here (same logic as `/onboard`) so the iOS flow
// can call this endpoint directly without first hitting `/onboard`.
connectRouter.post('/account-session', validateJwt, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = res.locals['userId'] as string

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('stripe_account_id, email, full_name')
      .eq('id', userId)
      .single()

    if (userErr || !user) {
      res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } })
      return
    }

    const stripe = getStripe()
    let accountId = user.stripe_account_id as string | null

    // Validate the existing account is reachable in the current mode
    // (test vs live). The cross-mode footgun: the row was created
    // when the server was in live mode (e.g. from the web app), but
    // the dev server runs against test keys — Stripe then 404s when
    // we try to use the live account id. Detect that and fall through
    // to fresh creation. Accepts the same dev/live drift the cards
    // endpoint flagged earlier today.
    if (accountId) {
      try {
        await stripe.accounts.retrieve(accountId)
      } catch (err) {
        const stripeErr = err as { code?: string; statusCode?: number }
        const isMissing = stripeErr?.code === 'account_invalid'
          || stripeErr?.code === 'resource_missing'
          || stripeErr?.statusCode === 404
        if (isMissing) {
          console.warn(
            `[connect] stripe_account_id=${accountId} unreachable (${stripeErr?.code ?? 'unknown'}) — clearing for re-creation`,
          )
          accountId = null
          await supabaseAdmin
            .from('users')
            .update({ stripe_account_id: null, stripe_onboarding_complete: false })
            .eq('id', userId)
        } else {
          throw err
        }
      }
    }

    if (!accountId) {
      // Lazy account creation — same shape as the hosted-onboarding
      // path. Express, US, transfers + card_payments capabilities.
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: user.email as string,
        capabilities: {
          card_payments: { requested: true },
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

    // `account_onboarding` is the embedded component we render on iOS.
    // `payouts` is enabled too so the iOS Payouts surface can later
    // embed the payouts view inline (skip Stripe Express dashboard
    // for in-app management). Unused components stay disabled.
    const accountSession = await stripe.accountSessions.create({
      account: accountId,
      components: {
        account_onboarding: { enabled: true },
        payouts: { enabled: true },
      },
    })

    res.json({
      client_secret: accountSession.client_secret,
      account_id: accountId,
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
