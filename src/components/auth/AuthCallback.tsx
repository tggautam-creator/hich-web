import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

interface AuthCallbackProps {
  'data-testid'?: string
}

/**
 * Handles the redirect after a user clicks a magic/reset link.
 *
 * Supabase (PKCE flow) appends `?code=…` to the redirect URL.
 * With `detectSessionInUrl: true` the client exchanges the code
 * for a session automatically on load.
 *
 * Routing logic:
 *  - PASSWORD_RECOVERY → /reset-password (user needs to set new password)
 *  - SIGNED_IN with existing profile → /home/rider (returning user)
 *  - SIGNED_IN without profile → /onboarding/profile (new user)
 */
export default function AuthCallback({ 'data-testid': testId }: AuthCallbackProps) {
  const navigate = useNavigate()

  useEffect(() => {
    /** Look up the users-table row and navigate accordingly. */
    async function routeSignedInUser() {
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
        navigate('/reset-password', { replace: true })
      } else if (event === 'SIGNED_IN') {
        void routeSignedInUser()
      }
    })

    // Fallback: if the session was already established before the listener
    // was mounted (e.g. implicit flow where hash is consumed instantly),
    // check once and navigate.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        void routeSignedInUser()
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
