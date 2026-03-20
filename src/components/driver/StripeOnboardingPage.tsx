import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'
import SecondaryButton from '@/components/ui/SecondaryButton'

interface StripeOnboardingPageProps {
  'data-testid'?: string
}

export default function StripeOnboardingPage({
  'data-testid': testId = 'stripe-onboarding-page',
}: StripeOnboardingPageProps) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleOnboard() {
    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const origin = window.location.origin
      const res = await fetch('/api/connect/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          return_url: `${origin}/stripe/onboarding/complete`,
          refresh_url: `${origin}/stripe/onboarding`,
        }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Failed to start onboarding')
        return
      }

      const body = (await res.json()) as { url?: string; already_complete?: boolean }

      if (body.already_complete) {
        navigate('/stripe/payouts')
        return
      }

      if (body.url) {
        window.location.href = body.url
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      data-testid={testId}
      className="flex min-h-dvh flex-col bg-surface font-sans"
    >
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        {/* Icon */}
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-success/10">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-12 w-12 text-success" aria-hidden="true">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
        </div>

        <h1 className="mb-2 text-center text-2xl font-bold text-text-primary">
          Connect your bank account
        </h1>
        <p className="mb-8 text-center text-text-secondary max-w-sm">
          We use Stripe to securely handle payments. You&apos;ll be redirected to Stripe to verify your identity and connect your bank account.
        </p>

        {/* Benefits */}
        <div className="mb-10 w-full max-w-sm space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-5 w-5 rounded-full bg-success/20 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 text-success" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-text-primary">Instant payouts</span> — ride earnings go directly to your bank
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-5 w-5 rounded-full bg-success/20 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 text-success" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-text-primary">Secure</span> — we never see your bank details
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-5 w-5 rounded-full bg-success/20 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 text-success" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-text-primary">Zero commission</span> — you keep 100% of every fare
            </p>
          </div>
        </div>

        {error && (
          <p data-testid="onboard-error" className="mb-4 text-sm text-danger text-center">
            {error}
          </p>
        )}

        <PrimaryButton
          data-testid="start-onboarding-button"
          onClick={handleOnboard}
          disabled={loading}
          className="w-full max-w-sm"
        >
          {loading ? 'Connecting...' : 'Connect with Stripe'}
        </PrimaryButton>

        <SecondaryButton
          data-testid="skip-onboarding-button"
          onClick={() => { navigate(-1) }}
          className="w-full max-w-sm mt-3"
        >
          I&apos;ll do this later
        </SecondaryButton>
      </div>
    </div>
  )
}
