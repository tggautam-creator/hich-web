import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'

interface StripeOnboardingCompletePageProps {
  'data-testid'?: string
}

export default function StripeOnboardingCompletePage({
  'data-testid': testId = 'stripe-onboarding-complete-page',
}: StripeOnboardingCompletePageProps) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'checking' | 'complete' | 'pending' | 'error'>('checking')

  useEffect(() => {
    let cancelled = false

    async function checkStatus() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { navigate('/login'); return }

        const res = await fetch('/api/connect/onboard/complete', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })

        if (!res.ok) {
          if (!cancelled) setStatus('error')
          return
        }

        const body = (await res.json()) as { onboarding_complete: boolean }
        if (!cancelled) {
          setStatus(body.onboarding_complete ? 'complete' : 'pending')
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    void checkStatus()
    return () => { cancelled = true }
  }, [navigate])

  return (
    <div
      data-testid={testId}
      className="flex min-h-dvh flex-col bg-surface font-sans"
    >
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        {status === 'checking' && (
          <>
            <div className="mb-6 h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-text-secondary">Checking your account status...</p>
          </>
        )}

        {status === 'complete' && (
          <>
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-success/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-12 w-12 text-success" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 className="mb-2 text-center text-2xl font-bold text-text-primary">
              You&apos;re all set!
            </h1>
            <p className="mb-8 text-center text-text-secondary max-w-sm">
              Your bank account is connected. Ride earnings will be deposited directly to your bank.
            </p>
            <PrimaryButton
              data-testid="go-home-button"
              onClick={() => { navigate('/home/driver') }}
              className="w-full max-w-sm"
            >
              Start driving
            </PrimaryButton>
          </>
        )}

        {status === 'pending' && (
          <>
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-warning/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-12 w-12 text-warning" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h1 className="mb-2 text-center text-2xl font-bold text-text-primary">
              Almost there
            </h1>
            <p className="mb-8 text-center text-text-secondary max-w-sm">
              Stripe is still verifying your account. This usually takes a few minutes. You can start driving once verification is complete.
            </p>
            <PrimaryButton
              data-testid="go-home-button"
              onClick={() => { navigate('/home/driver') }}
              className="w-full max-w-sm"
            >
              Go to home
            </PrimaryButton>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-danger/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-12 w-12 text-danger" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h1 className="mb-2 text-center text-2xl font-bold text-text-primary">
              Something went wrong
            </h1>
            <p className="mb-8 text-center text-text-secondary max-w-sm">
              We couldn&apos;t verify your Stripe account status. Please try again.
            </p>
            <PrimaryButton
              data-testid="retry-button"
              onClick={() => { navigate('/stripe/onboarding') }}
              className="w-full max-w-sm"
            >
              Try again
            </PrimaryButton>
          </>
        )}
      </div>
    </div>
  )
}
