import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

interface AuthCallbackProps {
  'data-testid'?: string
}

/** Decode Supabase's URL-encoded error description (`+` → space, etc). */
function decodeUrlError(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

/** How long to wait for a SIGNED_IN event before declaring the link dead. */
const SIGN_IN_TIMEOUT_MS = 15_000

/**
 * Handles the redirect after a user clicks a magic / confirmation / reset
 * link.
 *
 * Supabase (PKCE flow) appends `?code=…` to the redirect URL.
 * With `detectSessionInUrl: true` the client exchanges the code
 * for a session automatically on load.
 *
 * Routing logic:
 *  - PASSWORD_RECOVERY → /reset-password (user needs to set new password)
 *  - SIGNED_IN with existing profile → /home/rider (returning user)
 *  - SIGNED_IN without profile → /onboarding/profile (new user)
 *
 * Failure surface (added 2026-05-12 per WEB_PARITY_REPORT W-T0-9):
 * Previously this page would sit on a "Signing you in…" spinner forever
 * if the magic link was expired or invalid. Supabase signals failure
 * two ways:
 *   1. Redirects here with `error_description` / `error_code` / `error`
 *      in the query string OR hash fragment (PKCE uses query; older
 *      implicit/recovery flows use hash). We detect those immediately.
 *   2. No URL error but no SIGNED_IN event arrives either (silent code
 *      exchange failure). After `SIGN_IN_TIMEOUT_MS` we surface a
 *      generic "link expired" message rather than spin forever.
 * iOS handles this via `DeepLinkErrorCover` in `AuthCallbackPage.swift`.
 */
export default function AuthCallback({ 'data-testid': testId }: AuthCallbackProps) {
  const navigate = useNavigate()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    // 1) Detect URL-encoded errors immediately. Supabase appends
    //    `error_description=Email+link+is+invalid+or+has+expired`
    //    (or similar) to the callback URL when the link is dead.
    const searchParams = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '',
    )
    const urlError =
      searchParams.get('error_description')
      ?? hashParams.get('error_description')
      ?? searchParams.get('error_code')
      ?? hashParams.get('error_code')
      ?? searchParams.get('error')
      ?? hashParams.get('error')
    if (urlError) {
      setErrorMessage(decodeUrlError(urlError))
      return
    }

    // `routed` guards against the listener + getSession() fallback both
    // racing to navigate. Without it the timeout below could surface a
    // false-positive error after a successful navigation.
    let routed = false

    async function routeSignedInUser() {
      if (routed) return
      routed = true
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        navigate('/onboarding/profile', { replace: true })
        return
      }

      const { data } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', user.id)
        .single()

      if (data?.full_name) {
        navigate('/home/rider', { replace: true })
      } else {
        navigate('/onboarding/profile', { replace: true })
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        routed = true
        navigate('/reset-password', { replace: true })
      } else if (event === 'SIGNED_IN') {
        void routeSignedInUser()
      }
    })

    // Fallback: if the session was already established before the listener
    // was mounted (e.g. implicit flow where hash is consumed instantly),
    // check once and navigate.
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        void routeSignedInUser()
      }
    })

    // 2) Safety timeout. If neither a URL error nor a SIGNED_IN event
    //    arrived in `SIGN_IN_TIMEOUT_MS`, the code exchange almost
    //    certainly failed silently — surface a generic message so the
    //    user isn't stranded on the spinner.
    const timeoutId = window.setTimeout(() => {
      if (!routed) {
        setErrorMessage('This sign-in link has expired or is invalid. Try requesting a new one.')
      }
    }, SIGN_IN_TIMEOUT_MS)

    return () => {
      subscription.unsubscribe()
      window.clearTimeout(timeoutId)
    }
  }, [navigate])

  if (errorMessage) {
    return (
      <div
        data-testid={testId ?? 'auth-callback-page'}
        className="min-h-dvh w-full bg-surface flex flex-col items-center justify-center font-sans gap-4 px-6"
      >
        <div className="h-12 w-12 rounded-full bg-danger/10 flex items-center justify-center text-danger">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-text-primary text-center">
          Sign-in link expired
        </h1>
        <p
          data-testid="auth-callback-error-message"
          className="text-sm text-text-secondary text-center max-w-xs"
        >
          {errorMessage}
        </p>
        <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
          <button
            type="button"
            data-testid="auth-callback-retry"
            onClick={() => navigate('/login', { replace: true })}
            className="rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-white active:opacity-80"
          >
            Back to sign in
          </button>
          <button
            type="button"
            data-testid="auth-callback-signup"
            onClick={() => navigate('/signup', { replace: true })}
            className="rounded-2xl border border-border px-6 py-3 text-sm font-semibold text-text-primary active:bg-surface"
          >
            Create a new account
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid={testId ?? 'auth-callback-page'}
      className="min-h-dvh w-full bg-surface flex flex-col items-center justify-center font-sans gap-4"
    >
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      <p className="text-text-secondary text-sm">Signing you in…</p>
    </div>
  )
}
