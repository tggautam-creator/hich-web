import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'
import SecondaryButton from '@/components/ui/SecondaryButton'
import BottomNav from '@/components/ui/BottomNav'

interface DriverPayoutsPageProps {
  'data-testid'?: string
}

interface ConnectStatus {
  has_account: boolean
  onboarding_complete: boolean
  charges_enabled: boolean
  payouts_enabled: boolean
  payout_method_type: 'bank_account' | 'card' | null
  payout_method_last4: string | null
  payout_method_label: string | null
}

export default function DriverPayoutsPage({
  'data-testid': testId = 'driver-payouts-page',
}: DriverPayoutsPageProps) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<ConnectStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [dashboardLoading, setDashboardLoading] = useState(false)

  useEffect(() => {
    async function fetchStatus() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const res = await fetch('/api/connect/status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok) {
          setStatus((await res.json()) as ConnectStatus)
        }
      } catch {
        // non-fatal
      } finally {
        setLoading(false)
      }
    }
    void fetchStatus()
  }, [])

  async function openDashboard() {
    setDashboardLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch('/api/connect/dashboard', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const body = (await res.json()) as { url: string }
        window.open(body.url, '_blank', 'noopener')
      }
    } catch {
      // non-fatal
    } finally {
      setDashboardLoading(false)
    }
  }

  const isBank = status?.payout_method_type === 'bank_account'
  const isCard = status?.payout_method_type === 'card'

  return (
    <div
      data-testid={testId}
      className="flex min-h-dvh flex-col bg-surface font-sans pb-20"
    >
      {/* Header */}
      <div
        className="bg-white border-b border-border px-4 flex items-center gap-3"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
      >
        <button onClick={() => { navigate(-1) }} className="p-1" aria-label="Go back">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-text-primary">Payouts</h1>
      </div>

      <div className="flex-1 px-4 py-6">
        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {/* No account */}
        {!loading && (!status || !status.has_account) && (
          <div className="flex flex-col items-center text-center py-8">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-primary" aria-hidden="true">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </div>
            <p className="mb-1 font-semibold text-text-primary">No payout method set up</p>
            <p className="mb-6 text-sm text-text-secondary max-w-xs">
              Connect a bank account or debit card to receive earnings from your rides.
            </p>
            <PrimaryButton
              data-testid="setup-payouts-button"
              onClick={() => { navigate('/stripe/onboarding') }}
              className="w-full max-w-sm"
            >
              Set up payouts
            </PrimaryButton>
          </div>
        )}

        {/* Pending verification */}
        {!loading && status?.has_account && !status.onboarding_complete && (
          <div className="flex flex-col items-center text-center py-8">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-warning" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="mb-1 font-semibold text-text-primary">Verification pending</p>
            <p className="mb-6 text-sm text-text-secondary max-w-xs">
              Your Stripe account needs more information to complete setup.
            </p>
            <PrimaryButton
              data-testid="continue-onboarding-button"
              onClick={() => { navigate('/stripe/onboarding') }}
              className="w-full max-w-sm"
            >
              Continue setup
            </PrimaryButton>
          </div>
        )}

        {/* Active — show payout method details */}
        {!loading && status?.onboarding_complete && (
          <div className="space-y-4 max-w-sm mx-auto">
            {/* Status pill */}
            <div className="flex items-center gap-2 mb-2">
              <div className="h-2.5 w-2.5 rounded-full bg-success" />
              <p className="text-sm font-semibold text-success">Payouts active</p>
            </div>

            {/* Payout method card */}
            <div
              data-testid="payout-method-card"
              className="rounded-2xl bg-white p-5 shadow-sm border border-border"
            >
              <div className="flex items-center gap-3 mb-4">
                {/* Icon */}
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${isBank ? 'bg-success/10' : 'bg-primary/10'}`}>
                  {isBank ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-success" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="10" rx="1" />
                      <path d="M12 2L3 7h18L12 2z" />
                      <line x1="7" y1="11" x2="7" y2="21" />
                      <line x1="12" y1="11" x2="12" y2="21" />
                      <line x1="17" y1="11" x2="17" y2="21" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-primary" aria-hidden="true">
                      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                      <line x1="1" y1="10" x2="23" y2="10" />
                    </svg>
                  )}
                </div>
                {/* Label + last4 */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text-primary">
                    {status.payout_method_label ?? (isBank ? 'Bank Account' : isCard ? 'Debit Card' : 'Payout account')}
                  </p>
                  {status.payout_method_last4 && (
                    <p className="text-sm text-text-secondary">••••&nbsp;{status.payout_method_last4}</p>
                  )}
                </div>
                {/* Type badge */}
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${isBank ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'}`}>
                  {isBank ? 'Bank' : isCard ? 'Debit card' : 'Connected'}
                </span>
              </div>

              {/* Schedule / fee row */}
              <div className={`rounded-xl p-3 flex items-start gap-3 ${isCard ? 'bg-warning/5 border border-warning/20' : 'bg-success/5 border border-success/20'}`}>
                {isBank ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success shrink-0 mt-0.5" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-text-primary">1–2 business days · Free</p>
                      <p className="text-xs text-text-secondary mt-0.5">Earnings deposit automatically after each ride</p>
                    </div>
                  </>
                ) : isCard ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-warning shrink-0 mt-0.5" aria-hidden="true">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-text-primary">Instant · 1.5% fee per payout</p>
                      <p className="text-xs text-text-secondary mt-0.5">Example: $10 ride → you receive $9.85</p>
                    </div>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success shrink-0 mt-0.5" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-text-primary">Payouts active</p>
                      <p className="text-xs text-text-secondary mt-0.5">Earnings deposit after each ride</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Upsell / info block */}
            {isBank && (
              <div
                data-testid="instant-payout-upsell"
                className="rounded-2xl bg-white p-4 border border-border shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary" aria-hidden="true">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-text-primary mb-0.5">Want instant payouts?</p>
                    <p className="text-xs text-text-secondary mb-3">
                      Switch to a Visa or Mastercard debit card to get paid in minutes. A 1.5% fee applies per payout.
                    </p>
                    <button
                      onClick={openDashboard}
                      className="text-xs font-medium text-primary"
                    >
                      Switch in Stripe dashboard →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isCard && (
              <div
                data-testid="debit-fee-info"
                className="rounded-2xl bg-white p-4 border border-border shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/10">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="10" rx="1" />
                      <path d="M12 2L3 7h18L12 2z" />
                      <line x1="7" y1="11" x2="7" y2="21" />
                      <line x1="12" y1="11" x2="12" y2="21" />
                      <line x1="17" y1="11" x2="17" y2="21" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-text-primary mb-0.5">Prefer no fees?</p>
                    <p className="text-xs text-text-secondary mb-3">
                      Switch to a bank account for free payouts. Earnings arrive in 1–2 business days with no deductions.
                    </p>
                    <button
                      onClick={openDashboard}
                      className="text-xs font-medium text-primary"
                    >
                      Switch in Stripe dashboard →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Stripe dashboard */}
            <PrimaryButton
              data-testid="open-dashboard-button"
              onClick={openDashboard}
              disabled={dashboardLoading}
              className="w-full"
            >
              {dashboardLoading ? 'Opening...' : 'Manage payouts on Stripe'}
            </PrimaryButton>
            <p className="text-xs text-text-secondary text-center">
              Update your payout method, view earnings history, and download tax documents.
            </p>

            <SecondaryButton
              onClick={() => { navigate('/profile') }}
              className="w-full"
            >
              Back to profile
            </SecondaryButton>
          </div>
        )}
      </div>

      <BottomNav activeTab="profile" />
    </div>
  )
}
