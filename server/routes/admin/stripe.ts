/**
 * Slice 1.3c-fix — admin-side read-only Stripe surfaces.
 *
 * Currently one endpoint:
 *   GET /api/admin/stripe/balance
 *     → { available_cents, pending_cents, currency }
 *
 * Used by the Grant Credit form on the user-detail Admin Actions
 * tab. The credit action is hard-blocked when the requested grant
 * exceeds Stripe's *available* platform balance (see
 * `getAvailableStripeBalanceCents` below) — UI surfaces the number
 * + warning before the admin even hits Confirm.
 *
 * Sits behind the same JWT + adminAuth gate as the rest of the admin
 * router (mounted in `./index.ts`).
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import Stripe from 'stripe'
import { getServerEnv } from '../../env.ts'

export const adminStripeRouter = Router()

function getStripe(): Stripe {
  const { STRIPE_SECRET_KEY } = getServerEnv()
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' })
}

/**
 * Sums Stripe's `available` balance buckets in USD-equivalent cents.
 *
 * Notes on the shape:
 *   - `available` is an ARRAY because Stripe holds balances per
 *     currency. We sum only USD; if Tago ever multi-currencies we'll
 *     extend this to be currency-aware.
 *   - `available` ≠ `pending`. Stripe holds card charges as
 *     `pending` for ~2 business days before flipping them to
 *     `available`. The credit hard-block uses `available` only —
 *     pending funds aren't transferable.
 *
 * Exported so the credit endpoint can reuse the same call (single
 * source of truth for "what counts as available").
 */
export async function getAvailableStripeBalanceCents(): Promise<{
  available_cents: number
  pending_cents: number
  currency: string
}> {
  const stripe = getStripe()
  const balance = await stripe.balance.retrieve()
  const usdAvailable = balance.available
    .filter((b) => b.currency === 'usd')
    .reduce((sum, b) => sum + b.amount, 0)
  const usdPending = balance.pending
    .filter((b) => b.currency === 'usd')
    .reduce((sum, b) => sum + b.amount, 0)
  return {
    available_cents: usdAvailable,
    pending_cents: usdPending,
    currency: 'usd',
  }
}

adminStripeRouter.get(
  '/balance',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const b = await getAvailableStripeBalanceCents()
      res.status(200).json({ ok: true, ...b })
    } catch (err) {
      next(err)
    }
  },
)
