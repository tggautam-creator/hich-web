/**
 * Server-side session recovery for iOS PWA persistence.
 *
 * iOS clears JavaScript-accessible storage (localStorage, document.cookie)
 * when a PWA is force-killed. The server stores the refresh token in an
 * HTTP-only cookie that survives force-kills. These helpers sync/recover
 * the session via the server.
 */

import type { Session } from '@supabase/supabase-js'
import { authLog } from '@/lib/authLogger'

/**
 * Save the current session's refresh token to the server's HTTP-only cookie.
 * Called after every auth state change (login, token refresh).
 */
export async function syncSessionToServer(session: Session): Promise<boolean> {
  // Retry up to 2 times — if the first attempt fails (network blip, server cold start),
  // a second attempt 2s later usually succeeds. Without this, the cookie never gets saved
  // and force-killing the PWA means zero recovery path.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
        credentials: 'include',
        cache: 'no-store',
      })
      authLog('serverCookie', 'syncSessionToServer', res.ok, `status=${res.status} attempt=${attempt + 1}`)
      if (res.ok) return true
    } catch (err) {
      authLog('serverCookie', 'syncSessionToServer', false, `attempt=${attempt + 1} ${String(err)}`)
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

/**
 * Attempt to recover a session from the server's HTTP-only cookie.
 * Called on app startup when client-side storage returns no session.
 * Returns the recovered session or null.
 */
export async function recoverSessionFromServer(): Promise<Session | null> {
  try {
    const res = await fetch('/api/auth/session', {
      credentials: 'include',
      cache: 'no-store',
    })
    authLog('serverCookie', 'recoverSessionFromServer:fetch', res.ok, `status=${res.status}`)
    if (!res.ok) return null

    const body = (await res.json()) as { session: Session | null }
    const hasSession = body.session !== null && body.session !== undefined
    authLog('serverCookie', 'recoverSessionFromServer:result', hasSession, hasSession ? 'session recovered' : 'no session in cookie')
    return body.session ?? null
  } catch (err) {
    authLog('serverCookie', 'recoverSessionFromServer', false, String(err))
    return null
  }
}

/**
 * Check if the server-side cookie is present (diagnostic endpoint).
 * Returns the debug info or null on failure.
 */
export async function checkServerCookie(): Promise<{ hasCookie: boolean; cookieLength: number; timestamp: string } | null> {
  try {
    const res = await fetch('/api/auth/debug', {
      credentials: 'include',
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as { hasCookie: boolean; cookieLength: number; timestamp: string }
  } catch {
    return null
  }
}

/**
 * Clear the server-side session cookie on sign-out.
 */
export async function clearServerSession(): Promise<void> {
  try {
    await fetch('/api/auth/session', {
      method: 'DELETE',
      credentials: 'include',
      cache: 'no-store',
    })
    authLog('serverCookie', 'clearServerSession', true)
  } catch (err) {
    authLog('serverCookie', 'clearServerSession', false, String(err))
  }
}
