/**
 * Server-side session recovery for iOS PWA persistence.
 *
 * iOS clears JavaScript-accessible storage (localStorage, document.cookie)
 * when a PWA is force-killed. The server stores the refresh token in an
 * HTTP-only cookie that survives force-kills. These helpers sync/recover
 * the session via the server.
 */

import type { Session } from '@supabase/supabase-js'

/**
 * Save the current session's refresh token to the server's HTTP-only cookie.
 * Called after every auth state change (login, token refresh).
 */
export async function syncSessionToServer(session: Session): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
      credentials: 'same-origin',
      cache: 'no-store', // required for iOS PWA cookie reliability
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Attempt to recover a session from the server's HTTP-only cookie.
 * Called on app startup when client-side storage returns no session.
 * Returns the recovered session or null.
 */
export async function recoverSessionFromServer(): Promise<Session | null> {
  try {
    const res = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store', // required for iOS PWA cookie reliability
    })
    if (!res.ok) return null

    const body = (await res.json()) as { session: Session | null }
    return body.session ?? null
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
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch {
    // Non-fatal
  }
}
