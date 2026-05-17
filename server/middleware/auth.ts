import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

/**
 * Validates the Supabase JWT in the Authorization header.
 * Uses local jsonwebtoken.verify() for speed (<1ms vs ~200ms network call).
 * Falls back to supabaseAdmin.auth.getUser() if local verification fails.
 * On success sets res.locals.userId; on failure returns 401.
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

  // Try local JWT verification first (fast path)
  if (jwtSecret) {
    try {
      const decoded = jwt.verify(token, jwtSecret) as { sub?: string }
      if (decoded.sub) {
        res.locals['userId'] = decoded.sub
        bumpLastActive(decoded.sub)
        next()
        return
      }
    } catch {
      // Token invalid or expired locally — fall through to Supabase
    }
  }

  // Fallback: verify via Supabase Auth API
  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error ?? !data.user) {
    res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    })
    return
  }

  res.locals['userId'] = data.user.id
  bumpLastActive(data.user.id)
  next()
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
