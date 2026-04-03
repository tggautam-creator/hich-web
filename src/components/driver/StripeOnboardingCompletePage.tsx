import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import PrimaryButton from '@/components/ui/PrimaryButton'

interface StripeOnboardingCompletePageProps {
  'data-testid'?: string
}

export default function StripeOnboardingCompletePage({
  'data-testid': testId = 'stripe-onboarding-complete-page',
}: StripeOnboardingCompletePageProps) {
  const navigate = useNavigate()
  const refreshProfile = useAuthStore((s) => s.refreshProfile)
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
          // Refresh profile so DriverHomePage picks up the updated stripe_onboarding_complete flag
          await refreshProfile()
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    void checkStatus()
    return () => { cancelled = true }
  }, [navigate, refreshProfile])

  return (
    <div
      data-testid={testId}
      className="flex min-h-dvh flex-col bg-surface font-sans"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
    >
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        {status === 'checking' && (
          <>
            <div className="mb-6 h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-text-secondary">Checking your account status...</p>
          </>
        )}

        {status === 'complete' && (
          <div className="w-full max-w-sm">
            {/* Success icon */}
            <div className="flex justify-center mb-6">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-success/10">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-12 w-12 text-success" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>

            <h1 className="mb-2 text-center text-2xl font-bold text-text-primary">
              You&apos;re all set!
            </h1>
            <p className="mb-6 text-center text-text-secondary">
              Your payout method is connected. Earnings will be deposited automatically after each ride.
            </p>

            {/* Tips section */}
            <div className="rounded-2xl bg-white border border-border p-5 mb-6 space-y-4">
              <p className="text-sm font-bold text-text-primary">Quick tips to get started</p>

              {/* Tip 1 — Online toggle */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/10">
                  <span className="h-2.5 w-2.5 rounded-full bg-success" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">Go online to receive rides</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Riders nearby will see you when you&apos;re online. Toggle off when you&apos;re done for the day.
                  </p>
                </div>
              </div>

              {/* Tip 2 — Ride board */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">Post rides on the board</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Going somewhere? Post your trip on the ride board so riders heading the same way can tag along.
                  </p>
                </div>
              </div>

              {/* Tip 3 — Notifications */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/10">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-warning" aria-hidden="true">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">You&apos;ll get notified</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    When a rider requests a ride near you, you&apos;ll get a push notification. Accept or decline right from the notification.
                  </p>
                </div>
              </div>
            </div>

            <PrimaryButton
              data-testid="go-home-button"
              onClick={() => { navigate('/home/driver', { replace: true }) }}
              className="w-full"
            >
              Start driving
            </PrimaryButton>
          </div>
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
              onClick={() => { navigate('/home/driver', { replace: true }) }}
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
