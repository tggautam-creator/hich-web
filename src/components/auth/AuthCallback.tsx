import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

interface AuthCallbackProps {
  'data-testid'?: string
}

/**
 * Handles the redirect after a user clicks a magic link.
 *
 * Supabase (PKCE flow) appends `?code=…` to the redirect URL.
 * With `detectSessionInUrl: true` the client exchanges the code
 * for a session automatically on load.  This component waits for
 * the `SIGNED_IN` event and then navigates to onboarding.
 */
export default function AuthCallback({ 'data-testid': testId }: AuthCallbackProps) {
  const navigate = useNavigate()

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        navigate('/onboarding/profile', { replace: true })
      }
    })

    // Fallback: if the session was already established before the listener
    // was mounted (e.g. implicit flow where hash is consumed instantly),
    // check once and navigate.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/onboarding/profile', { replace: true })
      }
    })

    return () => { subscription.unsubscribe() }
  }, [navigate])

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
