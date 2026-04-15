import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { trackEvent } from '@/lib/analytics'
import PrimaryButton from '@/components/ui/PrimaryButton'

const RESEND_COOLDOWN = 60
const OTP_LENGTH = 6

interface PhoneVerificationPageProps {
  'data-testid'?: string
}

export default function PhoneVerificationPage({ 'data-testid': testId }: PhoneVerificationPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const refreshProfile = useAuthStore((s) => s.refreshProfile)
  const profile = useAuthStore((s) => s.profile)

  // Phone can come from navigation state (onboarding) or from profile (re-verify)
  const navPhone = (location.state as { phone?: string; returnTo?: string } | null)?.phone
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo
  const isExistingUser = Boolean(returnTo || (profile?.full_name && !navPhone))

  const [phone, setPhone] = useState(navPhone ?? profile?.phone ?? '')
  const [editingPhone, setEditingPhone] = useState(false)
  const [editPhone, setEditPhone] = useState('')

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [isVerifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [isSending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [smsSent, setSmsSent] = useState(false)

  const [countdown, setCountdown] = useState(RESEND_COOLDOWN)
  const [isResending, setResending] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)

  const [phase, setPhase] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const sentRef = useRef(false)

  // ── Change phone number (existing users) ──────────────────────────────────
  const handleChangePhone = useCallback(async () => {
    const cleaned = editPhone.replace(/\D/g, '')
    if (cleaned.length < 10) return

    const formatted = cleaned.startsWith('1') ? `+${cleaned}` : `+1${cleaned}`
    setEditingPhone(false)
    setPhone(formatted)
    setSmsSent(false)
    setSendError(null)
    setDigits(Array(OTP_LENGTH).fill(''))
    setVerifyError(null)
    sentRef.current = false
    setPhase((p) => p + 1)
  }, [editPhone])

  // ── Send OTP on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!phone || sentRef.current) return
    sentRef.current = true

    void (async () => {
      setSending(true)
      setSendError(null)
      try {
        const { error } = await supabase.auth.updateUser({ phone })
        if (error) throw error
        setSmsSent(true)
        trackEvent('phone_otp_sent', { phone })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to send verification code'
        setSendError(msg)
      } finally {
        setSending(false)
      }
    })()
  }, [phone])

  // Auto-focus first input once SMS is sent
  useEffect(() => {
    if (smsSent) inputRefs.current[0]?.focus()
  }, [smsSent])

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

  // ── Verify OTP ──────────────────────────────────────────────────────────────
  const verify = useCallback(async (code: string) => {
    if (!phone || code.length !== OTP_LENGTH) return
    setVerifying(true)
    setVerifyError(null)

    try {
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token: code,
        type: 'phone_change',
      })
      if (error) throw error

      // Mark phone_verified in DB
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from('users')
          .update({ phone_verified: true })
          .eq('id', user.id)
      }

      await refreshProfile()
      trackEvent('phone_verified')

      // Navigate to return destination or continue onboarding
      if (returnTo) {
        navigate(returnTo, { replace: true })
      } else {
        navigate('/onboarding/location', { replace: true })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid code — please try again'
      setVerifyError(msg)
      setDigits(Array(OTP_LENGTH).fill(''))
      inputRefs.current[0]?.focus()
    } finally {
      setVerifying(false)
    }
  }, [phone, navigate, refreshProfile, returnTo])

  // ── Resend OTP ──────────────────────────────────────────────────────────────
  const handleResend = useCallback(async () => {
    if (countdown > 0 || isResending || !phone) return
    setResending(true)
    setResendSuccess(false)
    setVerifyError(null)

    try {
      const { error } = await supabase.auth.updateUser({ phone })
      if (error) throw error
      setResendSuccess(true)
      setPhase((p) => p + 1) // restart countdown
      trackEvent('phone_otp_resent')
    } catch {
      setVerifyError('Failed to resend code — try again')
    } finally {
      setResending(false)
    }
  }, [countdown, isResending, phone])

  // ── Input handlers (same pattern as CheckInbox) ─────────────────────────────
  const handleChange = useCallback(
    (index: number, value: string) => {
      // Only accept digits
      const digit = value.replace(/\D/g, '').slice(-1)
      const next = [...digits]
      next[index] = digit
      setDigits(next)
      setVerifyError(null)

      if (digit && index < OTP_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus()
      }

      // Auto-submit when all digits filled
      if (digit && index === OTP_LENGTH - 1 && next.every((d) => d)) {
        void verify(next.join(''))
      }
    },
    [digits, verify],
  )

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus()
      }
    },
    [digits],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault()
      const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
      if (!text) return
      const next = Array(OTP_LENGTH).fill('')
      for (let i = 0; i < text.length; i++) next[i] = text[i]
      setDigits(next)
      const focusIdx = Math.min(text.length, OTP_LENGTH - 1)
      inputRefs.current[focusIdx]?.focus()
      if (text.length === OTP_LENGTH) void verify(text)
    },
    [verify],
  )

  // ── No phone number — redirect back ─────────────────────────────────────────
  if (!phone) {
    return (
      <div data-testid={testId ?? 'phone-verification-page'} className="min-h-dvh w-full bg-surface flex flex-col items-center justify-center px-6">
        <p className="text-sm text-danger text-center mb-4">No phone number found. Please go back and enter your phone number.</p>
        <PrimaryButton onClick={() => navigate('/onboarding/profile', { replace: true })}>
          Go Back
        </PrimaryButton>
      </div>
    )
  }

  // ── Sending initial SMS ─────────────────────────────────────────────────────
  if (isSending) {
    return (
      <div data-testid={testId ?? 'phone-verification-page'} className="min-h-dvh w-full bg-surface flex flex-col items-center justify-center px-6">
        <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin mb-4" />
        <p className="text-sm text-text-secondary">Sending verification code to {phone}…</p>
      </div>
    )
  }

  // ── Failed to send SMS ──────────────────────────────────────────────────────
  if (sendError && !smsSent && !editingPhone) {
    return (
      <div data-testid={testId ?? 'phone-verification-page'} className="min-h-dvh w-full bg-surface flex flex-col items-center justify-center px-6 gap-4">
        <div className="h-14 w-14 rounded-full bg-danger/10 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 text-danger"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        </div>
        <p className="text-sm text-danger text-center">{sendError}</p>
        <PrimaryButton onClick={() => { sentRef.current = false; setSendError(null); setSending(false); window.location.reload() }}>
          Try Again
        </PrimaryButton>
        <button
          type="button"
          onClick={() => {
            if (isExistingUser) {
              setEditingPhone(true)
              setEditPhone('')
              setSendError(null)
            } else {
              navigate('/onboarding/profile', { replace: true })
            }
          }}
          className="text-sm text-text-secondary underline active:opacity-60"
        >
          Use a different number
        </button>
        <button
          type="button"
          onClick={() => { void supabase.auth.signOut().then(() => navigate('/login', { replace: true })) }}
          className="text-sm text-danger underline active:opacity-60"
        >
          Sign Out
        </button>
      </div>
    )
  }

  // ── OTP entry screen ────────────────────────────────────────────────────────
  const maskedPhone = phone.length > 4
    ? phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4)
    : phone

  return (
    <div
      data-testid={testId ?? 'phone-verification-page'}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 2rem)', paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)' }}
    >
      <div className="flex-1 flex flex-col justify-center px-6">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-primary" aria-hidden="true">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-text-primary text-center">Verify your phone</h1>
        <p className="mb-8 text-sm text-text-secondary text-center">
          We sent a 6-digit code to <span className="font-semibold text-text-primary">{maskedPhone}</span>
        </p>

        {/* OTP input boxes */}
        <div className="flex justify-center gap-2.5 mb-6" data-testid="otp-inputs">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el }}
              data-testid={`otp-digit-${i}`}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={i === 0 ? handlePaste : undefined}
              disabled={isVerifying}
              className={[
                'h-14 w-11 rounded-xl border-2 bg-white text-center text-xl font-bold text-text-primary',
                'transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
                'disabled:opacity-50',
                verifyError ? 'border-danger' : 'border-border',
              ].join(' ')}
              aria-label={`Digit ${i + 1}`}
            />
          ))}
        </div>

        {/* Error message */}
        {verifyError && (
          <p data-testid="verify-error" className="text-sm text-danger text-center mb-4" role="alert">
            {verifyError}
          </p>
        )}

        {/* Resend success */}
        {resendSuccess && !verifyError && (
          <p data-testid="resend-success" className="text-sm text-success text-center mb-4">
            New code sent!
          </p>
        )}

        {/* Verify button */}
        <PrimaryButton
          data-testid="verify-button"
          onClick={() => { void verify(digits.join('')) }}
          isLoading={isVerifying}
          disabled={digits.some((d) => !d) || isVerifying}
        >
          Verify
        </PrimaryButton>

        {/* Resend */}
        <div className="mt-6 text-center">
          {countdown > 0 ? (
            <p className="text-sm text-text-secondary">
              Resend code in <span className="font-semibold text-text-primary">{countdown}s</span>
            </p>
          ) : (
            <button
              data-testid="resend-button"
              type="button"
              onClick={() => { void handleResend() }}
              disabled={isResending}
              className="text-sm font-semibold text-primary active:opacity-60 disabled:opacity-50"
            >
              {isResending ? 'Sending…' : 'Resend Code'}
            </button>
          )}
        </div>

        {/* Wrong number */}
        <div className="mt-4 text-center">
          {editingPhone ? (
            <div className="flex items-center gap-2 justify-center" data-testid="edit-phone-inline">
              <input
                data-testid="edit-phone-input"
                type="tel"
                inputMode="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="(555) 123-4567"
                className="h-10 w-44 rounded-lg border border-border bg-white px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') void handleChangePhone() }}
              />
              <button
                data-testid="edit-phone-submit"
                type="button"
                onClick={() => { void handleChangePhone() }}
                disabled={editPhone.replace(/\D/g, '').length < 10}
                className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
              >
                Send
              </button>
              <button
                type="button"
                onClick={() => setEditingPhone(false)}
                className="text-xs text-text-secondary underline"
              >
                Cancel
              </button>
            </div>
          ) : isExistingUser ? (
            <button
              data-testid="wrong-number-button"
              type="button"
              onClick={() => { setEditingPhone(true); setEditPhone('') }}
              className="text-xs text-text-secondary underline active:opacity-60"
            >
              Wrong number? Change it
            </button>
          ) : (
            <button
              data-testid="wrong-number-button"
              type="button"
              onClick={() => navigate('/onboarding/profile', { replace: true })}
              className="text-xs text-text-secondary underline active:opacity-60"
            >
              Wrong number? Go back
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
