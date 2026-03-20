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
        {loading && (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {!loading && (!status || !status.has_account) && (
          <div className="flex flex-col items-center text-center py-12">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-primary" aria-hidden="true">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </div>
            <p className="mb-4 text-text-secondary">
              Connect your bank account to receive ride earnings
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

        {!loading && status?.has_account && !status.onboarding_complete && (
          <div className="flex flex-col items-center text-center py-12">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-warning" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="mb-1 font-semibold text-text-primary">Verification pending</p>
            <p className="mb-4 text-sm text-text-secondary">
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

        {!loading && status?.onboarding_complete && (
          <div className="space-y-6">
            {/* Status card */}
            <div className="rounded-2xl bg-white p-4 shadow-sm border border-border">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-3 w-3 rounded-full bg-success" />
                <p className="font-semibold text-text-primary">Payouts active</p>
              </div>
              <p className="text-sm text-text-secondary">
                Ride earnings are automatically deposited to your connected bank account via Stripe.
              </p>
            </div>

            {/* Dashboard link */}
            <PrimaryButton
              data-testid="open-dashboard-button"
              onClick={openDashboard}
              disabled={dashboardLoading}
              className="w-full"
            >
              {dashboardLoading ? 'Opening...' : 'View Stripe dashboard'}
            </PrimaryButton>
            <p className="text-xs text-text-secondary text-center">
              Manage your bank account, view payout history, and download tax documents on Stripe.
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
