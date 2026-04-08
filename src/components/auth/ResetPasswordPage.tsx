import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { validatePassword } from '@/lib/validation'
import InputField from '@/components/ui/InputField'
import PrimaryButton from '@/components/ui/PrimaryButton'

interface ResetPasswordPageProps {
  'data-testid'?: string
}

export default function ResetPasswordPage({ 'data-testid': testId }: ResetPasswordPageProps) {
  const navigate = useNavigate()

  const [password,     setPassword]    = useState('')
  const [confirm,      setConfirm]     = useState('')
  const [isSubmitting, setSubmitting]  = useState(false)
  const [fieldError,   setFieldError]  = useState<string | null>(null)
  const [serverError,  setServerError] = useState<string | null>(null)
  const [success,      setSuccess]     = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isSubmitting) return

    const passwordError = validatePassword(password)
    if (passwordError) {
      setFieldError(passwordError)
      return
    }

    if (password !== confirm) {
      setFieldError('Passwords do not match')
      return
    }

    setFieldError(null)
    setServerError(null)
    setSubmitting(true)

    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setServerError(error.message)
      } else {
        setSuccess(true)
      }
    } catch {
      setServerError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid={testId ?? 'reset-password-page'}
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
        {success ? (
          <div data-testid="success-message" className="space-y-3 text-center">
            <h1 className="text-3xl font-bold text-text-primary">Password updated</h1>
            <p className="text-text-secondary">
              Your password has been reset. You can now log in with your new password.
            </p>
            <button
              data-testid="go-to-login-button"
              onClick={() => { navigate('/login') }}
              className="mt-4 text-primary font-medium underline"
            >
              Go to login
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-text-primary">Set new password</h1>
              <p className="text-text-secondary">
                Enter your new password below.
              </p>
            </div>

            <form
              onSubmit={(e) => { void handleSubmit(e) }}
              noValidate
              className="flex flex-col gap-3"
            >
              <InputField
                data-testid="password-input"
                label="New password"
                type="password"
                autoComplete="new-password"
                placeholder="Min. 8 characters, 1 number"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setFieldError(null)
                  setServerError(null)
                }}
              />
              <p className="-mt-3 text-xs text-text-secondary">
                Passwords must be at least 8 characters long and include at least 1 number.
              </p>

              <InputField
                data-testid="confirm-password-input"
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value)
                  setFieldError(null)
                  setServerError(null)
                }}
              />

              {fieldError && (
                <p
                  data-testid="field-error"
                  className="text-sm text-danger"
                  role="alert"
                >
                  {fieldError}
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
                isLoading={isSubmitting}
                className="mt-1"
              >
                Reset password
              </PrimaryButton>
            </form>
          </>
        )}
      </main>
    </div>
  )
}
