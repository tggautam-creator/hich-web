import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { isValidEduEmail } from '@/lib/validation'
import InputField from '@/components/ui/InputField'
import PrimaryButton from '@/components/ui/PrimaryButton'
import Logo from '@/components/ui/Logo'

interface LoginProps {
  'data-testid'?: string
}

export default function Login({ 'data-testid': testId }: LoginProps) {
  const navigate = useNavigate()
  const location = useLocation()

  // If the user already has a session, redirect into the app
  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/home/rider', { replace: true })
    })
  }, [navigate])
  const redirectedEmail = (location.state as { email?: string } | null)?.email ?? ''

  const [email,        setEmail]       = useState(redirectedEmail)
  const [password,     setPassword]    = useState('')
  const [touched,      setTouched]     = useState(redirectedEmail.length > 0)
  const [isSubmitting, setSubmitting]  = useState(false)
  const [serverError,  setServerError] = useState<string | null>(null)

  const isEmailValid   = isValidEduEmail(email)
  const showEmailError = touched && email.length > 0 && !isEmailValid
  const showCheck      = touched && isEmailValid
  // Both a valid .edu email AND a non-empty password are required to submit
  const canSubmit      = isEmailValid && password.trim().length > 0

  async function handleMagicLink() {
    if (!isEmailValid || isSubmitting) return
    setSubmitting(true)
    setServerError(null)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
      })
      if (error) {
        setServerError(error.message)
      } else {
        navigate('/check-inbox', { state: { email: email.trim().toLowerCase() } })
      }
    } catch {
      setServerError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || isSubmitting) return

    setSubmitting(true)
    setServerError(null)

    try {
      const { data: signInData, error } = await supabase.auth.signInWithPassword({
        email:    email.trim().toLowerCase(),
        password,
      })

      if (error) {
        const msg = error.message.toLowerCase()
        if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
          setServerError('Incorrect email or password. Please try again.')
        } else {
          setServerError(error.message)
        }
      } else {
        const signedInUser = signInData.user
        const signedInSession = signInData.session

        // Ensure the auth store has the session before navigating to a guarded route
        if (signedInSession) {
          useAuthStore.setState({ session: signedInSession, user: signedInSession.user, isLoading: true })
        }

        const { data: profile, error: profileErr } = await supabase
          .from('users')
          .select('full_name, is_driver')
          .eq('id', signedInUser?.id ?? '')
          .single()

        if (profileErr || !profile?.full_name) {
          // Query failed or genuinely new user — let AuthGuard decide.
          // Navigate to /home/rider; AuthGuard will redirect to onboarding
          // if the profile truly doesn't exist, or render home if it does.
          navigate(profile?.is_driver ? '/home/driver' : '/home/rider', { replace: true })
        } else {
          navigate(profile.is_driver ? '/home/driver' : '/home/rider', { replace: true })
        }
      }
    } catch {
      setServerError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid={testId ?? 'login-page'}
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
          <h1 className="text-3xl font-bold text-text-primary">Welcome back</h1>
          <p className="text-text-secondary">
            Sign in with your university email and password.
          </p>
          {redirectedEmail && (
            <p data-testid="redirect-notice" className="text-sm text-primary font-medium">
              An account with this email already exists. Please log in.
            </p>
          )}
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
              showEmailError
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

          <InputField
            data-testid="password-input"
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setServerError(null)
            }}
          />

          <div className="flex items-center justify-between">
            <button
              data-testid="forgot-password-link"
              type="button"
              onClick={() => { navigate('/forgot-password') }}
              className="text-sm text-primary font-medium"
            >
              Forgot password?
            </button>
            <button
              data-testid="magic-link-button"
              type="button"
              onClick={() => { void handleMagicLink() }}
              disabled={!isEmailValid || isSubmitting}
              className="text-sm text-primary font-medium disabled:opacity-40"
            >
              Send login code
            </button>
          </div>

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
            disabled={!canSubmit}
            isLoading={isSubmitting}
            className="mt-1"
          >
            Log in
          </PrimaryButton>
        </form>

        <p className="text-sm text-text-secondary text-center">
          New to TAGO?{' '}
          <button
            onClick={() => { navigate('/signup') }}
            className="text-primary font-medium underline"
          >
            Sign up
          </button>
        </p>
      </main>
    </div>
  )
}
