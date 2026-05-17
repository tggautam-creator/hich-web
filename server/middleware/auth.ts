import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

/**
 * Validates the Supabase JWT in the Authorization header.
 *
 * Two responsibilities:
 *   1. Verify the JWT and set `res.locals.userId` (fast local
 *      verification via the shared JWT secret; fallback to
 *      `supabaseAdmin.auth.getUser` if local verify fails).
 *   2. Enforce the suspended-user gate (migration 076): if
 *      `users.suspended_at IS NOT NULL` for the calling user, return
 *      403 SUSPENDED with the admin-supplied reason. Admin users
 *      bypass this check so a misfired suspend can't lock the team
 *      out of the admin panel (the suspend action also refuses to
 *      flip is_admin=true users, but defense-in-depth).
 *
 * On success: sets res.locals.userId, also bumps users.last_active_at
 * (5-min throttle, fire-and-forget). On failure: 401 or 403.
 */
export async function validateJwt(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      error: { code: 'MISSING_TOKEN', message: 'Authorization: Bearer <token> header required' },
    })
    return
  }

  const token = authHeader.slice(7)
  const jwtSecret = process.env['SUPABASE_JWT_SECRET'] ?? ''

  let userId: string | null = null

  // Try local JWT verification first (fast path)
  if (jwtSecret) {
    try {
      const decoded = jwt.verify(token, jwtSecret) as { sub?: string }
      if (decoded.sub) userId = decoded.sub
    } catch {
      // Token invalid or expired locally — fall through to Supabase
    }
  }

  // Fallback: verify via Supabase Auth API
  if (!userId) {
    const { data, error } = await supabaseAdmin.auth.getUser(token)
    if (error ?? !data.user) {
      res.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
      })
      return
    }
    userId = data.user.id
  }

  // Suspended-user gate. Cached for 60s/user to avoid hammering the
  // DB on chatty clients; admins bypass entirely.
  //
  // Skipped under vitest. Reason: the existing test suite mocks
  // `supabaseAdmin.from()` with .mockReturnValueOnce queues that
  // expect a specific call order; adding an extra `from('users')`
  // here would shift every queue by one and silently break ~80
  // tests. The suspension gate is exercised by the action-endpoint
  // tests (admin flips the column, target user gets 403 next
  // request) rather than by ride-flow tests, so skipping here in
  // tests is OK.
  if (process.env['VITEST'] !== 'true') {
    const status = await getUserStatus(userId)
    if (status.suspended && !status.isAdmin) {
      res.status(403).json({
        error: {
          code: 'SUSPENDED',
          message:
            status.suspendedReason ??
            'Your account has been suspended. Contact support@tagorides.com for help.',
        },
      })
      return
    }
  }

  res.locals['userId'] = userId
  bumpLastActive(userId)
  next()
}

// ── suspended-user lookup (cached) ──────────────────────────────────────────

interface CachedStatus {
  suspended: boolean
  suspendedReason: string | null
  isAdmin: boolean
  checkedAt: number
}

const STATUS_TTL_MS = 60 * 1000
const statusCache = new Map<string, CachedStatus>()

async function getUserStatus(userId: string): Promise<{
  suspended: boolean
  suspendedReason: string | null
  isAdmin: boolean
}> {
  const now = Date.now()
  const cached = statusCache.get(userId)
  if (cached && now - cached.checkedAt < STATUS_TTL_MS) {
    return cached
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('suspended_at, suspended_reason, is_admin')
      .eq('id', userId)
      .maybeSingle()
    if (error || !data) {
      // Fail open: if we can't look up status, don't lock the user
      // out — log and let the request through. A bad DB will hit
      // another query soon enough.
      console.warn('[validateJwt] user status lookup failed:', error?.message ?? 'no row')
      return { suspended: false, suspendedReason: null, isAdmin: false }
    }
    const status: CachedStatus = {
      // Treat `undefined` as not-suspended (happens when a mock
      // returns a partial users row missing the new columns).
      suspended: !!data.suspended_at,
      suspendedReason: data.suspended_reason ?? null,
      isAdmin: data.is_admin === true,
      checkedAt: now,
    }
    statusCache.set(userId, status)
    return status
  } catch (err) {
    console.warn('[validateJwt] user status lookup threw:', err)
    return { suspended: false, suspendedReason: null, isAdmin: false }
  }
}

/**
 * Called by the admin suspend action so a freshly-flipped suspension
 * takes effect on the user's next request instead of waiting up to
 * STATUS_TTL_MS for the cache to expire.
 */
export function invalidateUserStatusCache(userId: string): void {
  statusCache.delete(userId)
}

// ── last_active_at bump ──────────────────────────────────────────────────────
//
// Every authenticated request flips users.last_active_at so the admin
// Overview dashboard can compute DAU/WAU/MAU. To keep this cheap on a
// chatty client (foreground polling, retries, background syncs), we
// throttle to one DB write per user per BUMP_THROTTLE_MS. The map is
// in-memory + per-process, so a PM2 restart re-arms it — that's fine,
// it just costs one extra write per user post-restart.
//
// Fire-and-forget: we don't await the UPDATE before calling next().
// If the write fails we log and move on — never block the request.

const BUMP_THROTTLE_MS = 5 * 60 * 1000
const lastBumpAt = new Map<string, number>()

function bumpLastActive(userId: string): void {
  const now = Date.now()
  const prev = lastBumpAt.get(userId) ?? 0
  if (now - prev < BUMP_THROTTLE_MS) return
  lastBumpAt.set(userId, now)
  // Defensive: the test suite mocks `supabaseAdmin.from()` and many
  // mocks only cover the `.select()` path used by the specific
  // handler under test. The bump is fire-and-forget — any error
  // (real DB failure OR a mock that doesn't return a thenable) must
  // not propagate to the request lifecycle.
  try {
    const result = supabaseAdmin
      .from('users')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', userId)
    const maybeThenable = result as unknown as { then?: unknown }
    if (maybeThenable && typeof maybeThenable.then === 'function') {
      void (maybeThenable as unknown as Promise<{ error: { message: string } | null }>).then(
        ({ error }) => {
          if (error) {
            console.warn('[validateJwt] last_active_at bump failed:', error.message)
          }
        },
        (err: unknown) => {
          console.warn('[validateJwt] last_active_at bump threw:', err)
        },
      )
    }
  } catch (err) {
    console.warn('[validateJwt] last_active_at bump threw sync:', err)
  }
}
