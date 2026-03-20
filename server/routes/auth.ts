/**
 * Server-side session cookie routes.
 *
 * iOS PWAs clear JavaScript-accessible storage (localStorage, document.cookie)
 * when force-killed from the app switcher. Server-set HTTP-only cookies survive
 * because they're managed by the browser's HTTP cookie store, not JavaScript.
 *
 * Flow:
 *  1. Client logs in via Supabase → calls POST /api/auth/session with refresh token
 *  2. Server stores refresh token in an HTTP-only cookie
 *  3. PWA force-killed → client-side storage wiped
 *  4. PWA relaunches → client calls GET /api/auth/session
 *  5. Server reads HTTP-only cookie → refreshes session with Supabase → returns new tokens
 *  6. Client restores session — user stays logged in
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import { validateJwt } from '../middleware/auth.ts'
import { getServerEnv } from '../env.ts'

export const authRouter = Router()

const COOKIE_NAME = 'hich_rt'
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days — outlasts Supabase refresh token for reliability

function cookieOpts() {
  return {
    httpOnly: true,
    secure: true, // always true — app is served over HTTPS via Vercel
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS,
  }
}

/**
 * POST /api/auth/session — save refresh token in HTTP-only cookie.
 * Requires a valid JWT so attackers can't inject arbitrary tokens.
 */
authRouter.post('/session', validateJwt, (req: Request, res: Response) => {
  const refreshToken = req.body?.refresh_token
  if (!refreshToken || typeof refreshToken !== 'string') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'refresh_token required' } })
    return
  }

  res.cookie(COOKIE_NAME, refreshToken, cookieOpts())
  res.json({ ok: true })
})

/**
 * GET /api/auth/session — recover session from HTTP-only cookie.
 * No JWT required — this IS the recovery mechanism for when the client
 * has lost its tokens (iOS force-kill).
 */
authRouter.get('/session', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[COOKIE_NAME]
  if (!refreshToken) {
    res.json({ session: null })
    return
  }

  try {
    const env = getServerEnv()

    // Call Supabase GoTrue token refresh endpoint directly
    const gotrueRes = await fetch(
      `${env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(10_000),
      },
    )

    if (!gotrueRes.ok) {
      // Refresh token expired or invalid — clear the stale cookie
      res.clearCookie(COOKIE_NAME, { path: '/' })
      res.json({ session: null })
      return
    }

    const session = (await gotrueRes.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
      expires_at: number
      token_type: string
      user: Record<string, unknown>
    }

    // Update cookie with the new refresh token (Supabase rotates on each refresh)
    res.cookie(COOKIE_NAME, session.refresh_token, cookieOpts())

    res.json({ session })
  } catch {
    // Network error or timeout — don't clear cookie (might be transient)
    res.json({ session: null })
  }
})

/**
 * DELETE /api/auth/session — clear the cookie on sign-out.
 */
authRouter.delete('/session', (_req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, { path: '/' })
  res.json({ ok: true })
})

/**
 * GET /api/auth/debug — diagnostic endpoint.
 * Returns whether the HTTP-only session cookie is present in the request.
 * Used to verify that Vercel's rewrite proxy forwards cookies correctly.
 * No JWT required — this is a diagnostic tool, not a data endpoint.
 */
authRouter.get('/debug', (req: Request, res: Response) => {
  const hasCookie = Boolean(req.cookies?.[COOKIE_NAME])
  res.json({
    hasCookie,
    cookieLength: hasCookie ? (req.cookies[COOKIE_NAME] as string).length : 0,
    timestamp: new Date().toISOString(),
  })
})
