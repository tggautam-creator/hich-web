import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { isValidEduEmail } from '@/lib/validation'
import InputField from '@/components/ui/InputField'
import PrimaryButton from '@/components/ui/PrimaryButton'

interface ForgotPasswordProps {
  'data-testid'?: string
}

export default function ForgotPassword({ 'data-testid': testId }: ForgotPasswordProps) {
  const navigate = useNavigate()

  const [email,        setEmail]       = useState('')
  const [touched,      setTouched]     = useState(false)
  const [isSubmitting, setSubmitting]  = useState(false)
  const [serverError,  setServerError] = useState<string | null>(null)
  const [sent,         setSent]        = useState(false)

  const isEmailValid   = isValidEduEmail(email)
  const showEmailError = touched && email.length > 0 && !isEmailValid
  const canSubmit      = isEmailValid

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || isSubmitting) return

    setSubmitting(true)
    setServerError(null)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: `${window.location.origin}/auth/callback` },
      )

      if (error) {
        setServerError(error.message)
      } else {
        setSent(true)
      }
    } catch {
      setServerError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid={testId ?? 'forgot-password-page'}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
    >
      <header
        className="px-6 pb-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 2rem)' }}
      >
        <button
          data-testid="back-button"
          onClick={() => { navigate('/login') }}
          className="text-primary text-sm font-medium"
        >
          ← Back to login
        </button>
      </header>

      <main className="flex-1 flex flex-col justify-center px-6 gap-8">

        {sent ? (
          /* ── Success state ─────────────────────────────────────────── */
          <div data-testid="success-message" className="space-y-3 text-center">
            <h1 className="text-3xl font-bold text-text-primary">Check your email</h1>
            <p className="text-text-secondary">
              We sent a password reset link to{' '}
              <strong className="text-text-primary">{email.trim().toLowerCase()}</strong>.
              Check your inbox and follow the instructions.
            </p>
            <button
              data-testid="back-to-login-button"
              onClick={() => { navigate('/login') }}
              className="mt-4 text-primary font-medium underline"
            >
              Back to login
            </button>
          </div>
        ) : (
          /* ── Form state ────────────────────────────────────────────── */
          <>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-text-primary">Reset password</h1>
              <p className="text-text-secondary">
                Enter your .edu email and we&apos;ll send you a reset link.
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
                  showEmailError
                    ? 'Please use your .edu university email address.'
                    : undefined
                }
              />

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
                Send reset link
              </PrimaryButton>
            </form>
          </>
        )}
      </main>
    </div>
  )
}
