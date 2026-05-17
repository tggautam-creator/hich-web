/**
 * Slice 1.3c — admin write surfaces (Admin Actions tab on user detail).
 *
 * Every endpoint here:
 *   1. inherits JWT + adminAuth gate from `adminRouter`
 *   2. validates inputs strictly (admin actions are high-blast-radius —
 *      we'd rather 400 a malformed request than write half a transaction)
 *   3. performs the write
 *   4. writes ONE audit_log row before returning
 *
 * Three actions in this slice:
 *   POST /users/:id/actions/push                — send a custom push
 *   POST /users/:id/actions/credit              — grant wallet credit
 *   POST /users/:id/actions/override-onboarding — toggle onboarding_completed
 *
 * Deferred to 1.3d (each needs its own design pass):
 *   POST /users/:id/actions/suspend             — needs sign-in gate
 *   POST /users/:id/actions/refund              — touches financial flows
 *   POST /users/:id/actions/reset-password      — Supabase already exposes
 *                                                 a forgot-password path
 *
 * Also here (read-only, paginated):
 *   GET /users/:id/audit                        — last N audit rows for
 *                                                 this user, drives the
 *                                                 Admin Actions tab's
 *                                                 "Recent actions" list
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'
import { writeAuditLog } from '../../lib/adminAudit.ts'
import { sendFcmPush } from '../../lib/fcm.ts'
import { getAvailableStripeBalanceCents } from './stripe.ts'
import { invalidateUserStatusCache } from '../../middleware/auth.ts'

export const adminActionsRouter = Router()

// ── shared helpers ──────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function targetUserId(req: Request, res: Response): string | null {
  const raw = req.params['id']
  const id = typeof raw === 'string' ? raw : ''
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({
      error: { code: 'INVALID_USER_ID', message: 'user id must be a UUID' },
    })
    return null
  }
  return id
}

function adminId(res: Response): string {
  // Set by validateJwt earlier in the middleware chain.
  return res.locals['userId'] as string
}

/**
 * Confirms the target user exists in public.users. Most actions can
 * skip this (Postgres will return 0-affected on a missing id) but
 * the push send call would otherwise return NO_TOKENS for both
 * "user doesn't exist" and "user exists but never registered a
 * push token" — different problems, different fixes.
 */
async function assertTargetExists(
  targetId: string,
  res: Response,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', targetId)
    .maybeSingle()
  if (error) {
    res.status(500).json({
      error: { code: 'TARGET_LOOKUP_FAILED', message: 'could not look up target user' },
    })
    return false
  }
  if (!data) {
    res.status(404).json({
      error: { code: 'TARGET_NOT_FOUND', message: 'target user does not exist' },
    })
    return false
  }
  return true
}

// ── POST /:id/actions/push ──────────────────────────────────────────────────

interface SendPushBody {
  title?: unknown
  body?: unknown
  reason?: unknown
}

adminActionsRouter.post(
  '/:id/actions/push',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = targetUserId(req, res)
      if (!id) return

      const b = req.body as SendPushBody
      const title = typeof b.title === 'string' ? b.title.trim() : ''
      const body = typeof b.body === 'string' ? b.body.trim() : ''
      const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
      if (!title || !body) {
        res.status(400).json({
          error: { code: 'INVALID_BODY', message: 'title and body are required' },
        })
        return
      }
      if (title.length > 120 || body.length > 500) {
        res.status(400).json({
          error: { code: 'TOO_LONG', message: 'title ≤ 120 chars, body ≤ 500 chars' },
        })
        return
      }

      if (!(await assertTargetExists(id, res))) return

      // Fetch the user's push tokens directly — admin push bypasses
      // the same-ride gate that the normal /api/notifications/send
      // applies, so we don't reuse that route.
      const { data: tokenRows, error: tokenErr } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', id)
      if (tokenErr) throw tokenErr
      const tokens = (tokenRows ?? []).map((r) => r.token)
      if (tokens.length === 0) {
        res.status(404).json({
          error: { code: 'NO_TOKENS', message: 'user has no registered push tokens' },
        })
        return
      }

      const sent = await sendFcmPush(tokens, {
        title,
        body,
        data: { source: 'admin_panel' },
      })

      await writeAuditLog({
        adminId: adminId(res),
        targetUserId: id,
        action: 'send_push',
        payload: {
          title,
          body,
          reason: reason || null,
          tokens_attempted: tokens.length,
          tokens_succeeded: sent,
        },
      })

      res.status(200).json({
        ok: true,
        sent,
        total_tokens: tokens.length,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /:id/actions/credit ────────────────────────────────────────────────

interface CreditBody {
  amount_cents?: unknown
  reason?: unknown
}

const MAX_CREDIT_CENTS = 50 * 100 // $50 safety cap per action — tightened 2026-05-17 after Tarun's "what if I mis-click" review.

adminActionsRouter.post(
  '/:id/actions/credit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = targetUserId(req, res)
      if (!id) return

      const b = req.body as CreditBody
      const amount = typeof b.amount_cents === 'number' ? Math.round(b.amount_cents) : NaN
      const reason = typeof b.reason === 'string' ? b.reason.trim() : ''

      if (!Number.isFinite(amount) || amount === 0) {
        res.status(400).json({
          error: { code: 'INVALID_AMOUNT', message: 'amount_cents must be a nonzero integer' },
        })
        return
      }
      // Sign rule: positive credits the user; negative debits. Cap both.
      if (Math.abs(amount) > MAX_CREDIT_CENTS) {
        const capDollars = (MAX_CREDIT_CENTS / 100).toFixed(2)
        res.status(400).json({
          error: {
            code: 'AMOUNT_TOO_LARGE',
            message: `|amount| must be ≤ $${capDollars}. Larger ops grants require a code change after a deliberate review.`,
          },
        })
        return
      }
      if (!reason) {
        res.status(400).json({
          error: { code: 'REASON_REQUIRED', message: 'reason is required for wallet credits' },
        })
        return
      }

      if (!(await assertTargetExists(id, res))) return

      // Hard-block: a positive credit (money owed to the user) must
      // fit within Tago's current Stripe platform available balance.
      // If a rider spends granted credit on a ride, the driver's
      // wallet gets credited; when that driver withdraws, Tago has
      // to push money from Stripe to their bank — granting more
      // credits than the platform balance can cover leaves us with
      // phantom liabilities that fail at withdrawal time. Debits
      // (negative amounts) don't pull from Stripe, so they bypass
      // this check.
      if (amount > 0) {
        try {
          const balance = await getAvailableStripeBalanceCents()
          if (amount > balance.available_cents) {
            res.status(409).json({
              error: {
                code: 'INSUFFICIENT_STRIPE_BALANCE',
                message: `Grant exceeds Stripe platform balance. Requested: ${amount}¢, available: ${balance.available_cents}¢.`,
              },
              available_cents: balance.available_cents,
              requested_cents: amount,
            })
            return
          }
        } catch (stripeErr) {
          // If Stripe is unreachable we err on the side of safety
          // and refuse the credit — better to surface the outage
          // than silently over-grant.
          console.error('[adminAction:credit] Stripe balance check failed:', stripeErr)
          res.status(503).json({
            error: {
              code: 'STRIPE_BALANCE_UNAVAILABLE',
              message: 'Could not verify Stripe balance — grant blocked. Retry later.',
            },
          })
          return
        }
      }

      const { data, error } = await supabaseAdmin.rpc('wallet_apply_delta', {
        p_user_id: id,
        p_delta_cents: amount,
        p_type: amount > 0 ? 'admin_credit' : 'admin_debit',
        p_description: reason,
        p_ride_id: null,
        p_payment_intent_id: null,
        p_stripe_event_id: null,
      })
      if (error) throw error

      const result = data as { applied?: boolean; balance?: number; error?: string }
      if (!result?.applied) {
        res.status(409).json({
          error: {
            code: 'WALLET_REJECTED',
            message: result?.error ?? 'wallet_apply_delta did not apply',
          },
        })
        return
      }

      await writeAuditLog({
        adminId: adminId(res),
        targetUserId: id,
        action: 'grant_wallet_credit',
        payload: {
          amount_cents: amount,
          reason,
          balance_after_cents: result.balance ?? null,
        },
      })

      res.status(200).json({
        ok: true,
        amount_cents: amount,
        balance_after_cents: result.balance ?? null,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /:id/actions/override-onboarding ───────────────────────────────────

interface OverrideOnbBody {
  onboarding_completed?: unknown
  reason?: unknown
}

adminActionsRouter.post(
  '/:id/actions/override-onboarding',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = targetUserId(req, res)
      if (!id) return

      const b = req.body as OverrideOnbBody
      if (typeof b.onboarding_completed !== 'boolean') {
        res.status(400).json({
          error: { code: 'INVALID_BODY', message: 'onboarding_completed must be a boolean' },
        })
        return
      }
      const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
      if (!reason) {
        res.status(400).json({
          error: { code: 'REASON_REQUIRED', message: 'reason is required when overriding onboarding state' },
        })
        return
      }

      // Fetch current value so the audit row captures the before/after.
      const { data: before, error: beforeErr } = await supabaseAdmin
        .from('users')
        .select('onboarding_completed')
        .eq('id', id)
        .maybeSingle()
      if (beforeErr) throw beforeErr
      if (!before) {
        res.status(404).json({
          error: { code: 'TARGET_NOT_FOUND', message: 'target user does not exist' },
        })
        return
      }

      const desired = b.onboarding_completed
      if (before.onboarding_completed === desired) {
        res.status(200).json({
          ok: true,
          changed: false,
          onboarding_completed: desired,
        })
        return
      }

      const { error: updateErr } = await supabaseAdmin
        .from('users')
        .update({ onboarding_completed: desired })
        .eq('id', id)
      if (updateErr) throw updateErr

      await writeAuditLog({
        adminId: adminId(res),
        targetUserId: id,
        action: 'override_onboarding',
        payload: {
          from: before.onboarding_completed,
          to: desired,
          reason,
        },
      })

      res.status(200).json({
        ok: true,
        changed: true,
        onboarding_completed: desired,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /:id/actions/suspend ───────────────────────────────────────────────

interface SuspendBody {
  suspended?: unknown
  reason?: unknown
}

adminActionsRouter.post(
  '/:id/actions/suspend',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = targetUserId(req, res)
      if (!id) return

      const callerId = adminId(res)
      if (id === callerId) {
        res.status(400).json({
          error: { code: 'CANNOT_SUSPEND_SELF', message: 'You cannot suspend your own account.' },
        })
        return
      }

      const b = req.body as SuspendBody
      if (typeof b.suspended !== 'boolean') {
        res.status(400).json({
          error: { code: 'INVALID_BODY', message: '`suspended` must be a boolean' },
        })
        return
      }
      const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
      // Reason required when suspending; optional (but recorded) when un-suspending.
      if (b.suspended && !reason) {
        res.status(400).json({
          error: { code: 'REASON_REQUIRED', message: 'A reason is required when suspending an account.' },
        })
        return
      }

      // Refuse to suspend admins — defense-in-depth on top of
      // validateJwt's admin-bypass.
      const { data: target, error: lookupErr } = await supabaseAdmin
        .from('users')
        .select('is_admin, suspended_at')
        .eq('id', id)
        .maybeSingle()
      if (lookupErr) throw lookupErr
      if (!target) {
        res.status(404).json({
          error: { code: 'TARGET_NOT_FOUND', message: 'target user does not exist' },
        })
        return
      }
      if (b.suspended && target.is_admin) {
        res.status(400).json({
          error: { code: 'CANNOT_SUSPEND_ADMIN', message: 'Admin accounts cannot be suspended.' },
        })
        return
      }

      const desired = b.suspended
      const wasSuspended = target.suspended_at !== null
      if (wasSuspended === desired) {
        res.status(200).json({
          ok: true,
          changed: false,
          suspended: desired,
        })
        return
      }

      const update = desired
        ? { suspended_at: new Date().toISOString(), suspended_reason: reason }
        : { suspended_at: null, suspended_reason: null }
      const { error: updateErr } = await supabaseAdmin
        .from('users')
        .update(update)
        .eq('id', id)
      if (updateErr) throw updateErr

      // Drop the validateJwt status cache so the change takes effect
      // on the user's NEXT request instead of waiting up to STATUS_TTL_MS.
      invalidateUserStatusCache(id)

      await writeAuditLog({
        adminId: callerId,
        targetUserId: id,
        action: desired ? 'suspend_user' : 'unsuspend_user',
        payload: { reason: reason || null },
      })

      res.status(200).json({
        ok: true,
        changed: true,
        suspended: desired,
        reason: reason || null,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /:id/actions/reset-password ────────────────────────────────────────

interface ResetPasswordBody {
  reason?: unknown
}

adminActionsRouter.post(
  '/:id/actions/reset-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = targetUserId(req, res)
      if (!id) return

      const b = req.body as ResetPasswordBody
      const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
      // No reason required — force-resets are commonly run on a "user
      // reports they can't reset themselves" call and the reason is
      // captured in the audit row's free-text optional field.

      // Look up the user's email so Supabase can send the recovery
      // mail to the right address. Fail with 404 if no row.
      const { data: target, error: lookupErr } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('id', id)
        .maybeSingle()
      if (lookupErr) throw lookupErr
      if (!target) {
        res.status(404).json({
          error: { code: 'TARGET_NOT_FOUND', message: 'target user does not exist' },
        })
        return
      }

      // generateLink is the admin-side primitive that produces a
      // password recovery URL. Sending the email is delegated to
      // Supabase's built-in template (admins have already verified
      // the template renders correctly per Slice 0.2 dev verification).
      // We use { type: 'recovery' } which mirrors the "Forgot password?"
      // flow on /auth/login.
      const { error: linkErr } =
        await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email: target.email,
        })
      if (linkErr) {
        res.status(502).json({
          error: {
            code: 'AUTH_LINK_FAILED',
            message: linkErr.message ?? 'Supabase Auth refused the recovery-link request.',
          },
        })
        return
      }

      await writeAuditLog({
        adminId: adminId(res),
        targetUserId: id,
        action: 'force_reset_password',
        payload: { email: target.email, reason: reason || null },
      })

      res.status(200).json({
        ok: true,
        email: target.email,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id/audit ─────────────────────────────────────────────────────────

interface AuditRowResponse {
  id: string
  admin_id: string
  admin_email: string | null
  action: string
  payload: Record<string, unknown>
  created_at: string
}

adminActionsRouter.get(
  '/:id/audit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = targetUserId(req, res)
      if (!id) return
      const limit = Math.min(
        Math.max(parseInt(String(req.query['limit'] ?? '25'), 10) || 25, 1),
        100,
      )
      const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0)

      const { data, count, error } = await supabaseAdmin
        .from('admin_audit_log')
        .select('id, admin_id, action, payload, created_at', { count: 'exact' })
        .eq('target_user_id', id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (error) throw error

      const rows = (data ?? []) as Array<{
        id: string
        admin_id: string
        action: string
        payload: Record<string, unknown>
        created_at: string
      }>

      // Hydrate admin_email for display so the UI doesn't have to
      // round-trip per row. Only the distinct admin ids are looked up.
      const adminIds = Array.from(new Set(rows.map((r) => r.admin_id)))
      const adminEmailById = new Map<string, string>()
      if (adminIds.length > 0) {
        const { data: adminRows, error: adminErr } = await supabaseAdmin
          .from('users')
          .select('id, email')
          .in('id', adminIds)
        if (adminErr) throw adminErr
        for (const a of adminRows ?? []) adminEmailById.set(a.id, a.email)
      }

      const out: AuditRowResponse[] = rows.map((r) => ({
        id: r.id,
        admin_id: r.admin_id,
        admin_email: adminEmailById.get(r.admin_id) ?? null,
        action: r.action,
        payload: r.payload,
        created_at: r.created_at,
      }))

      res.status(200).json({
        ok: true,
        audit: out,
        total: count ?? out.length,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)
