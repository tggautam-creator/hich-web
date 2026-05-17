import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

/**
 * Admin authorization middleware. Sits BEHIND `validateJwt`, so by the
 * time we run, `res.locals.userId` is the verified Supabase auth user
 * id. We then check `public.users.is_admin = true` for that id — the
 * authoritative grant flag set by migration 069. Non-admins get 403,
 * not 401, because their token IS valid; they just lack permission.
 *
 * Server-side only. Client-side bypasses (web AuthGuard / iOS RootView
 * email-domain shortcut) are UX conveniences and DO NOT grant API
 * access. Every `/api/admin/*` route MUST go through this middleware.
 *
 * Failure modes:
 *   - 401 MISSING_USER_ID  → `validateJwt` didn't run or didn't set
 *                            res.locals.userId. Should be impossible
 *                            in production but defensive against route
 *                            registration order mistakes.
 *   - 403 NOT_AN_ADMIN     → user exists but `is_admin = false` (or
 *                            the public.users row doesn't exist yet —
 *                            same outcome: no admin permission).
 *   - 500 ADMIN_LOOKUP_FAILED → DB error. Don't leak the message to
 *                               the client; log server-side instead.
 *
 * Audit logging happens in the route handler (each admin write writes
 * its own audit row), not here — this middleware is permission only.
 */
export async function adminAuth(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = res.locals['userId'] as string | undefined
  if (!userId) {
    res.status(401).json({
      error: {
        code: 'MISSING_USER_ID',
        message: 'adminAuth requires validateJwt to have run first',
      },
    })
    return
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error(
      `[adminAuth] lookup failed for userId=${userId.slice(0, 8)}…:`,
      error.message,
    )
    res.status(500).json({
      error: {
        code: 'ADMIN_LOOKUP_FAILED',
        message: 'Could not verify admin status',
      },
    })
    return
  }

  // `maybeSingle()` returns data=null when no row matches (e.g. a
  // freshly-signed-up admin whose `public.users` row hasn't been
  // bootstrapped yet). Treat as not-an-admin — we don't trust
  // anyone without an explicit `is_admin = true` row in public.users.
  const isAdmin = data?.is_admin === true
  if (!isAdmin) {
    res.status(403).json({
      error: {
        code: 'NOT_AN_ADMIN',
        message: 'This endpoint requires admin permission',
      },
    })
    return
  }

  // Stash for downstream handlers that want to log "admin <id> did X".
  res.locals['isAdmin'] = true
  next()
}
