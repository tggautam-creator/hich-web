import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { isValidEduEmail } from '@/lib/validation'
import { trackEvent } from '@/lib/analytics'
import InputField from '@/components/ui/InputField'
import PrimaryButton from '@/components/ui/PrimaryButton'
import Logo from '@/components/ui/Logo'

interface SignupProps {
  'data-testid'?: string
}

export default function Signup({ 'data-testid': testId }: SignupProps) {
  const navigate = useNavigate()

  // If the user already has a session (e.g. PWA reopened at /signup after
  // force-kill), redirect into the app so AuthGuard can handle it.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/home/rider', { replace: true })
    })
  }, [navigate])
  const [email, setEmail]             = useState('')
  const [touched, setTouched]         = useState(false)
  const [isSubmitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const isValid   = isValidEduEmail(email)
  const showError = touched && email.length > 0 && !isValid
  const showCheck = touched && isValid

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || isSubmitting) return

    setSubmitting(true)
    setServerError(null)

    try {
      const trimmedEmail = email.trim().toLowerCase()

      // Check if an account with this email already exists via server endpoint.
      // Uses supabaseAdmin to query public.users — bypasses RLS, no RPC needed.
      try {
        const checkRes = await fetch(
          `/api/auth/check-email?email=${encodeURIComponent(trimmedEmail)}`,
          { signal: AbortSignal.timeout(8_000) },
        )
        if (checkRes.ok) {
          const { exists } = (await checkRes.json()) as { exists: boolean | null }
          if (exists === true) {
            navigate('/login', { state: { email: trimmedEmail }, replace: true })
            return
          }
        }
      } catch {
        // Server unreachable — fall through to OTP signup
      }

      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
      })
      if (error) {
        setServerError(error.message)
      } else {
        trackEvent('signup_started', { edu_domain: trimmedEmail.split('@')[1] })
        navigate('/check-inbox', { state: { email: trimmedEmail } })
      }
    } catch {
      setServerError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid={testId ?? 'signup-page'}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
    >
      <header
        className="px-6 pb-4 flex items-center justify-between"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 2rem)' }}
      >
        <button
          onClick={() => { navigate('/') }}
          className="text-primary text-sm font-medium"
        >
          ← Back
        </button>
        <Logo size="sm" />
      </header>

      <main className="flex-1 flex flex-col justify-center px-6 gap-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-text-primary">Join TAGO</h1>
          <p className="text-text-secondary">
            Enter your university email to get started.
          </p>
        </div>

        <form
          onSubmit={(e) => { void handleSubmit(e) }}
          noValidate
          className="flex flex-col gap-3"
        >
          <InputField
            data-testid="email-input"
            label="University email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@ucdavis.edu"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setTouched(true)
              setServerError(null)
            }}
            error={
              showError
                ? 'Please use your .edu university email address.'
                : undefined
            }
          />

          {showCheck && (
            <p
              data-testid="email-valid-indicator"
              className="text-sm text-success font-medium flex items-center gap-1"
            >
              ✓ Valid .edu email
            </p>
          )}

          {serverError && (
            <p
              data-testid="server-error"
              className="text-sm text-danger"
              role="alert"
            >
              {serverError}
            </p>
          )}

          <PrimaryButton
            data-testid="submit-button"
            type="submit"
            disabled={!isValid}
            isLoading={isSubmitting}
            className="mt-1"
          >
            Continue
          </PrimaryButton>
        </form>

        <p className="text-sm text-text-secondary text-center">
          Only <span className="font-semibold">.edu</span> emails accepted.
          TAGO is for verified university students only.
        </p>

        <p className="text-xs text-text-secondary text-center">
          By signing up, you agree to our{' '}
          <Link to="/terms" className="text-primary underline">Terms of Service</Link>
          {' '}and{' '}
          <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>.
        </p>

        <p className="text-sm text-text-secondary text-center">
          Already have an account?{' '}
          <button
            onClick={() => { navigate('/login') }}
            className="text-primary font-medium underline"
          >
            Log in
          </button>
        </p>
      </main>
    </div>
  )
}
