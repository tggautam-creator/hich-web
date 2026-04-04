import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import PrimaryButton from '@/components/ui/PrimaryButton'
import Logo from '@/components/ui/Logo'

const RESEND_COOLDOWN = 60
const OTP_LENGTH = 8

interface CheckInboxProps {
  'data-testid'?: string
}

export default function CheckInbox({ 'data-testid': testId }: CheckInboxProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const email = (location.state as { email?: string } | null)?.email ?? ''

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [isVerifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const [countdown, setCountdown] = useState(RESEND_COOLDOWN)
  const [isResending, setResending] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)
  const [resendError, setResendError] = useState<string | null>(null)

  const [phase, setPhase] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Auto-focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

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

  const verify = useCallback(async (code: string) => {
    if (!email || code.length !== OTP_LENGTH) return
    setVerifying(true)
    setVerifyError(null)

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'email',
      })

      if (error) {
        setVerifyError('Invalid code. Please try again.')
        setDigits(Array(OTP_LENGTH).fill(''))
        inputRefs.current[0]?.focus()
        return
      }

      if (data.session) {
        // Ensure the auth store picks up the session before we navigate
        // to a guarded route. Without this, AuthGuard's initialize() may
        // fire INITIAL_SESSION with null (storage not yet persisted) and
        // redirect to /signup.
        useAuthStore.setState({
          session: data.session,
          user: data.session.user,
        })

        // Check if user has completed onboarding
        const { data: profile } = await supabase
          .from('users')
          .select('full_name, is_driver')
          .eq('id', data.user?.id ?? '')
          .single()

        if (profile?.full_name) {
          navigate(profile.is_driver ? '/home/driver' : '/home/rider', { replace: true })
        } else {
          navigate('/onboarding/profile', { replace: true })
        }
      }
    } catch {
      setVerifyError('Something went wrong. Please try again.')
    } finally {
      setVerifying(false)
    }
  }, [email, navigate])

  function handleDigitChange(index: number, value: string) {
    // Handle paste of full code
    if (value.length > 1) {
      const pasted = value.replace(/\D/g, '').slice(0, OTP_LENGTH)
      if (pasted.length > 0) {
        const newDigits = Array(OTP_LENGTH).fill('')
        for (let i = 0; i < pasted.length; i++) {
          newDigits[i] = pasted[i]!
        }
        setDigits(newDigits)
        setVerifyError(null)
        const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1)
        inputRefs.current[focusIndex]?.focus()
        if (pasted.length === OTP_LENGTH) {
          void verify(pasted)
        }
        return
      }
    }

    const digit = value.replace(/\D/g, '').slice(-1)
    const newDigits = [...digits]
    newDigits[index] = digit
    setDigits(newDigits)
    setVerifyError(null)

    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-submit when all digits filled
    if (digit && newDigits.every((d) => d !== '')) {
      void verify(newDigits.join(''))
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      const newDigits = [...digits]
      newDigits[index - 1] = ''
      setDigits(newDigits)
      inputRefs.current[index - 1]?.focus()
    }
  }

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
        setDigits(Array(OTP_LENGTH).fill(''))
        setVerifyError(null)
        setPhase((p) => p + 1)
        inputRefs.current[0]?.focus()
      }
    } catch {
      setResendError('Something went wrong. Please try again.')
    } finally {
      setResending(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const code = digits.join('')
    if (code.length === OTP_LENGTH) {
      void verify(code)
    }
  }

  return (
    <div
      data-testid={testId ?? 'check-inbox-page'}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
    >
      <header
        className="px-6 pb-4 flex items-center justify-between"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 2rem)' }}
      >
        <button
          data-testid="back-button"
          onClick={() => { navigate(-1) }}
          className="text-primary text-sm font-medium"
        >
          ← Back
        </button>
        <Logo size="sm" />
      </header>

      <main className="flex-1 flex flex-col justify-center px-6 gap-6 text-center">
        <div className="space-y-3">
          <h1 className="text-2xl font-bold text-text-primary">Enter your code</h1>
          <p className="text-text-secondary">We sent an 8-digit code to</p>
          {email && (
            <p
              data-testid="submitted-email"
              className="font-semibold text-text-primary text-lg break-all"
            >
              {email}
            </p>
          )}
        </div>

        {/* OTP Input */}
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4">
          <div className="flex gap-2 justify-center" data-testid="otp-inputs">
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el }}
                data-testid={`otp-input-${i}`}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={i === 0 ? 8 : 1}
                value={digit}
                onChange={(e) => { handleDigitChange(i, e.target.value) }}
                onKeyDown={(e) => { handleKeyDown(i, e) }}
                className="w-10 h-12 text-center text-xl font-bold rounded-lg border-2 border-border bg-white text-text-primary focus:border-primary focus:outline-none transition-colors"
                aria-label={`Digit ${i + 1}`}
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
              />
            ))}
          </div>

          {verifyError && (
            <p
              data-testid="verify-error"
              className="text-sm text-danger"
              role="alert"
            >
              {verifyError}
            </p>
          )}

          <PrimaryButton
            data-testid="verify-button"
            type="submit"
            disabled={digits.some((d) => !d) || isVerifying}
            isLoading={isVerifying}
            className="w-full max-w-xs"
          >
            Verify
          </PrimaryButton>
        </form>

        {/* Resend */}
        <div className="flex flex-col items-center gap-3">
          <button
            data-testid="resend-button"
            disabled={countdown > 0 || isResending}
            onClick={() => { void handleResend() }}
            className="text-sm font-medium text-primary disabled:text-text-secondary disabled:opacity-60"
          >
            {countdown > 0 ? `Resend code in ${countdown}s` : 'Resend code'}
          </button>

          {resendError && (
            <p data-testid="resend-error" className="text-sm text-danger" role="alert">
              {resendError}
            </p>
          )}

          {resendSuccess && (
            <p data-testid="resend-success" className="text-sm text-success font-medium">
              New code sent!
            </p>
          )}
        </div>

        <p className="text-xs text-text-secondary">
          Didn&apos;t get an email? Check your spam folder.
        </p>
      </main>
    </div>
  )
}
