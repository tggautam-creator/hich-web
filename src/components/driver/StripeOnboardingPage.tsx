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
  const [showTipDialog, setShowTipDialog] = useState(false)

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
      <div className="flex flex-1 flex-col px-6 pb-8" style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}>
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-primary" aria-hidden="true">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-text-primary text-center">
            How do you want to get paid?
          </h1>
          <p className="mt-2 text-center text-text-secondary max-w-sm text-sm">
            Choose the option that works best for you. You&apos;ll set up the details in the next step on Stripe&apos;s secure platform.
          </p>
        </div>

        {/* Option cards */}
        <div className="space-y-4 max-w-sm w-full mx-auto mb-6">
          {/* Bank Account */}
          <div
            data-testid="bank-option-card"
            className="rounded-2xl bg-white border-2 border-success/30 p-4 shadow-sm"
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/10">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-success" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="10" rx="1" />
                  <path d="M12 2L3 7h18L12 2z" />
                  <line x1="7" y1="11" x2="7" y2="21" />
                  <line x1="12" y1="11" x2="12" y2="21" />
                  <line x1="17" y1="11" x2="17" y2="21" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-text-primary">Bank Account</p>
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                    Recommended
                  </span>
                </div>
                <p className="text-xs text-text-secondary">Works with any US bank</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <p className="text-sm text-text-secondary"><span className="font-medium text-text-primary">Free forever</span> — no payout fees</p>
              </div>
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <p className="text-sm text-text-secondary">Arrives in <span className="font-medium text-text-primary">1–2 business days</span></p>
              </div>
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <p className="text-sm text-text-secondary">Best for most drivers</p>
              </div>
            </div>
          </div>

          {/* Debit Card */}
          <div
            data-testid="debit-option-card"
            className="rounded-2xl bg-white border-2 border-primary/20 p-4 shadow-sm"
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-text-primary">Debit Card</p>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Instant
                  </span>
                </div>
                <p className="text-xs text-text-secondary">Visa or Mastercard debit</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <p className="text-sm text-text-secondary">Arrives in <span className="font-medium text-text-primary">minutes</span> after each ride</p>
              </div>
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <p className="text-sm text-text-secondary">Best for quick access to earnings</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 shrink-0 flex items-center justify-center">
                  <div className="h-1.5 w-1.5 rounded-full bg-warning" />
                </div>
                <p className="text-sm text-text-secondary"><span className="font-medium text-warning">1.5% fee</span> deducted per payout (e.g. $0.15 on a $10 ride)</p>
              </div>
            </div>
          </div>
        </div>

        {/* Info note */}
        <div className="max-w-sm w-full mx-auto mb-4 flex items-start gap-2 rounded-xl bg-primary/5 border border-primary/15 px-4 py-3">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p className="text-xs text-text-secondary">
            You&apos;ll pick your specific bank or card in the next step. You can switch at any time from your Stripe dashboard.
          </p>
        </div>

        {error && (
          <p data-testid="onboard-error" className="mb-4 text-sm text-danger text-center max-w-sm mx-auto">
            {error}
          </p>
        )}

        <div className="max-w-sm w-full mx-auto space-y-3">
          <PrimaryButton
            data-testid="start-onboarding-button"
            onClick={() => setShowTipDialog(true)}
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Connecting...' : 'Continue with Stripe'}
          </PrimaryButton>

          <SecondaryButton
            data-testid="skip-onboarding-button"
            onClick={() => { navigate('/home/driver', { replace: true }) }}
            className="w-full"
          >
            I&apos;ll do this later
          </SecondaryButton>
        </div>
      </div>

      {/* Tip dialog — shown before redirecting to Stripe */}
      {showTipDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            aria-hidden="true"
            onClick={() => setShowTipDialog(false)}
          />

          {/* Dialog */}
          <div
            data-testid="stripe-tip-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Before you continue"
            className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
          >
            {/* Warning icon */}
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 text-warning" aria-hidden="true">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>

            <h3 className="text-center text-lg font-bold text-text-primary mb-3">
              Before you continue
            </h3>

            <p className="text-center text-sm text-text-secondary mb-4">
              Stripe will ask you for a <span className="font-semibold text-text-primary">website</span>. Since you&apos;re a student driver, you probably don&apos;t have one.
            </p>

            <div className="rounded-xl bg-surface border border-border px-4 py-3 mb-6">
              <p className="text-sm text-text-primary font-medium mb-2">Here&apos;s what to do:</p>
              <ol className="space-y-2 text-sm text-text-secondary list-decimal list-inside">
                <li>Look for <span className="font-medium text-text-primary">&quot;I don&apos;t have a website&quot;</span> and tap it</li>
                <li>Type <span className="font-semibold text-primary">TAGO rideshare driver</span> as your product description</li>
              </ol>
            </div>

            <PrimaryButton
              data-testid="stripe-tip-continue"
              onClick={() => { setShowTipDialog(false); void handleOnboard() }}
              disabled={loading}
              className="w-full mb-3"
            >
              {loading ? 'Connecting...' : 'Got it, continue'}
            </PrimaryButton>

            <button
              type="button"
              onClick={() => setShowTipDialog(false)}
              className="w-full py-2 text-sm font-medium text-text-secondary"
            >
              Go back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
