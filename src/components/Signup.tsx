import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { isValidEduEmail } from '@/lib/validation'
import InputField from '@/components/ui/InputField'
import PrimaryButton from '@/components/ui/PrimaryButton'

interface SignupProps {
  'data-testid'?: string
}

export default function Signup({ 'data-testid': testId }: SignupProps) {
  const navigate = useNavigate()
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

  return (
    <div
      data-testid={testId ?? 'signup-page'}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
    >
      <header
        className="px-6 pb-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 2rem)' }}
      >
        <button
          onClick={() => { navigate('/') }}
          className="text-primary text-sm font-medium"
        >
          ← Back
        </button>
      </header>

      <main className="flex-1 flex flex-col justify-center px-6 gap-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-text-primary">Join HICH</h1>
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
          HICH is for university students only.
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
