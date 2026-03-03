import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'

const RESEND_COOLDOWN = 60

interface CheckInboxProps {
  'data-testid'?: string
}

export default function CheckInbox({ 'data-testid': testId }: CheckInboxProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const email    = (location.state as { email?: string } | null)?.email ?? ''

  const [countdown, setCountdown]       = useState(RESEND_COOLDOWN)
  const [isResending, setResending]     = useState(false)
  const [resendError, setResendError]   = useState<string | null>(null)
  const [resendSuccess, setResendSuccess] = useState(false)

  // phase increments each time we need to restart the countdown (on resend success)
  const [phase, setPhase] = useState(0)
  const intervalRef        = useRef<ReturnType<typeof setInterval> | null>(null)

  // 60-second countdown — restarts whenever `phase` changes
  useEffect(() => {
    setCountdown(RESEND_COOLDOWN)
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [phase])

  // Listen for Supabase auth state change → redirect on sign-in
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        navigate('/onboarding/profile')
      }
    })
    return () => { subscription.unsubscribe() }
  }, [navigate])

  async function handleResend() {
    if (countdown > 0 || isResending || !email) return
    setResending(true)
    setResendError(null)
    setResendSuccess(false)

    try {
      const { error } = await supabase.auth.signInWithOtp({ email })
      if (error) {
        setResendError(error.message)
      } else {
        setResendSuccess(true)
        setPhase((p) => p + 1) // restart countdown
      }
    } catch {
      setResendError('Something went wrong. Please try again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div
      data-testid={testId ?? 'check-inbox-page'}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
    >
      <header
        className="px-6 pb-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 2rem)' }}
      >
        <button
          onClick={() => { navigate(-1) }}
          className="text-primary text-sm font-medium"
        >
          ← Back
        </button>
      </header>

      <main className="flex-1 flex flex-col justify-center px-6 gap-6 text-center">
        <div className="text-6xl" aria-hidden="true">📬</div>

        <div className="space-y-3">
          <h1 className="text-2xl font-bold text-text-primary">Check your inbox</h1>
          <p className="text-text-secondary">We sent a magic link to</p>
          {email && (
            <p
              data-testid="submitted-email"
              className="font-semibold text-text-primary text-lg break-all"
            >
              {email}
            </p>
          )}
          <p className="text-sm text-text-secondary">
            Tap the link in that email to continue.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <PrimaryButton
            data-testid="resend-button"
            disabled={countdown > 0 || isResending}
            isLoading={isResending}
            onClick={() => { void handleResend() }}
          >
            {countdown > 0 ? `Resend in ${countdown}s` : 'Resend email'}
          </PrimaryButton>

          {resendError && (
            <p
              data-testid="resend-error"
              className="text-sm text-danger"
              role="alert"
            >
              {resendError}
            </p>
          )}

          {resendSuccess && (
            <p
              data-testid="resend-success"
              className="text-sm text-success font-medium"
            >
              ✓ Email sent!
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
