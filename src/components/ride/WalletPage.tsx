import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/fare'
import PrimaryButton from '@/components/ui/PrimaryButton'
import BottomNav from '@/components/ui/BottomNav'
import WithdrawSheet from '@/components/ride/WithdrawSheet'

interface Transaction {
  id: string
  type: string
  amount_cents: number
  balance_after_cents: number
  description: string | null
  created_at: string
}

interface PendingEarning {
  ride_id: string
  rider_id: string
  rider_name: string | null
  fare_cents: number
  ended_at: string
  destination_name: string | null
  payment_status: 'pending' | 'failed'
}

async function fetchTransactions(): Promise<Transaction[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const res = await fetch('/api/wallet/transactions', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch transactions')
  const json = await res.json() as { transactions: Transaction[] }
  return json.transactions
}

async function fetchPendingEarnings(): Promise<{ pending: PendingEarning[]; total_cents: number }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const res = await fetch('/api/wallet/pending-earnings', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch pending earnings')
  return (await res.json()) as { pending: PendingEarning[]; total_cents: number }
}

export default function WalletPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { profile, refreshProfile } = useAuthStore()
  const [withdrawOpen, setWithdrawOpen] = useState(false)

  // Refresh profile once on mount to get latest wallet_balance from DB
  useEffect(() => { void refreshProfile() }, [refreshProfile])

  const balance = profile?.wallet_balance ?? 0
  const hasBank = profile?.stripe_onboarding_complete === true
  const isDriver = profile?.is_driver === true
  const showBankBanner = isDriver && !hasBank && balance > 0
  const canWithdraw = isDriver && balance > 0

  const { data: transactions = [], isLoading: loading } = useQuery({
    queryKey: ['wallet-transactions'],
    queryFn: fetchTransactions,
  })

  // Driver-only: rides the driver drove whose rider payment is still pending/failed.
  // These earnings haven't hit wallet_balance yet, so we list them separately
  // and let the driver nudge the rider to retry their card.
  const { data: pendingEarnings } = useQuery({
    queryKey: ['wallet-pending-earnings'],
    queryFn: fetchPendingEarnings,
    enabled: isDriver,
  })
  const pendingList = pendingEarnings?.pending ?? []
  const pendingTotal = pendingEarnings?.total_cents ?? 0

  const [nudgingRideId, setNudgingRideId] = useState<string | null>(null)
  const [nudgeError, setNudgeError] = useState<string | null>(null)
  const [nudgedRideIds, setNudgedRideIds] = useState<Set<string>>(new Set())

  async function handleNudge(rideId: string) {
    setNudgingRideId(rideId)
    setNudgeError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setNudgeError('Please sign in.'); return }
      const resp = await fetch(`/api/rides/${rideId}/nudge-rider`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: { message?: string } }
        setNudgeError(body.error?.message ?? 'Could not send nudge.')
        return
      }
      setNudgedRideIds((prev) => {
        const next = new Set(prev)
        next.add(rideId)
        return next
      })
    } catch {
      setNudgeError('Network error. Please try again.')
    } finally {
      setNudgingRideId(null)
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function typeLabel(type: string): string {
    switch (type) {
      case 'topup': return 'Added funds'
      case 'fare_debit': return 'Ride fare'
      case 'fare_credit': return 'Ride earnings'
      case 'ride_earning': return 'Ride earnings'
      case 'refund': return 'Refund'
      default: return type
    }
  }

  function typeIcon(type: string): string {
    switch (type) {
      case 'topup': return '+'
      case 'fare_credit': return '+'
      case 'ride_earning': return '+'
      case 'fare_debit': return '−'
      case 'refund': return '+'
      default: return ''
    }
  }

  function isCredit(type: string): boolean {
    return type === 'topup' || type === 'fare_credit' || type === 'ride_earning' || type === 'refund'
  }

  function isDriverEarning(type: string): boolean {
    return type === 'ride_earning' || type === 'fare_credit'
  }

  return (
    <div className="min-h-screen bg-surface pb-20 safe-top" data-testid="wallet-page">
      {/* Header */}
      <div className="bg-primary px-6 pb-8 pt-12 text-white">
        <p className="text-sm text-white/80">
          {showBankBanner ? 'Pending payout' : 'Your balance'}
        </p>
        <p className="text-4xl font-bold" data-testid="wallet-balance">
          {formatCents(balance)}
        </p>
      </div>

      {/* Bank-not-connected banner for drivers with earnings */}
      {showBankBanner && (
        <div className="px-6 pt-4">
          <div
            data-testid="wallet-bank-banner"
            className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-3"
          >
            <div className="h-8 w-8 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary" aria-hidden="true">
                <rect x="2" y="6" width="20" height="14" rx="2" />
                <path d="M2 10h20" />
                <path d="M6 14h.01" />
                <path d="M10 14h4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary">Add a bank to withdraw</p>
              <p className="text-xs text-text-secondary mt-0.5">
                You've earned {formatCents(balance)}. Link a bank to cash out.
              </p>
              <button
                data-testid="wallet-bank-banner-cta"
                onClick={() => navigate('/stripe/payouts')}
                className="mt-2 text-xs font-semibold text-primary active:opacity-70"
              >
                Link Bank Account →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Funds / Withdraw */}
      <div className="px-6 py-4 space-y-2">
        <PrimaryButton
          onClick={() => navigate('/wallet/add')}
          data-testid="add-funds-button"
        >
          Add Funds
        </PrimaryButton>
        {canWithdraw && (
          <button
            data-testid="withdraw-button"
            onClick={() => setWithdrawOpen(true)}
            className="w-full rounded-xl border border-primary py-3 text-sm font-semibold text-primary active:opacity-70"
          >
            Withdraw to Bank
          </button>
        )}
        <button
          data-testid="payment-methods-link"
          onClick={() => navigate('/payment/methods')}
          className="w-full py-2 text-sm font-medium text-text-secondary active:opacity-70"
        >
          Manage payment methods →
        </button>
      </div>

      {/* Payments in limbo — driver-only */}
      {isDriver && pendingList.length > 0 && (
        <div className="px-6 pb-2" data-testid="pending-earnings-section">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold text-text-primary">Payments in limbo</h2>
            <span className="text-sm font-semibold text-warning" data-testid="pending-earnings-total">
              {formatCents(pendingTotal)}
            </span>
          </div>
          <p className="mb-2 text-xs text-text-secondary">
            The rider hasn't completed payment yet. You'll be credited once they do.
          </p>
          {nudgeError && (
            <p data-testid="nudge-error" className="mb-2 text-xs text-danger">{nudgeError}</p>
          )}
          <div className="space-y-2">
            {pendingList.map((p) => {
              const alreadyNudged = nudgedRideIds.has(p.ride_id)
              const nudging = nudgingRideId === p.ride_id
              return (
                <div
                  key={p.ride_id}
                  className="rounded-2xl bg-white px-4 py-3"
                  data-testid="pending-earning-item"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-text-primary truncate">
                        {p.rider_name ?? 'Rider'}
                        {p.destination_name && (
                          <span className="text-text-secondary font-normal"> · {p.destination_name}</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-text-secondary">
                        {formatDate(p.ended_at)}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          p.payment_status === 'failed'
                            ? 'bg-danger/10 text-danger'
                            : 'bg-warning/10 text-warning'
                        }`}>
                          {p.payment_status === 'failed' ? 'Payment failed' : 'Payment pending'}
                        </span>
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold text-text-primary">
                      {formatCents(p.fare_cents)}
                    </p>
                  </div>
                  <button
                    data-testid="nudge-rider-button"
                    onClick={() => { void handleNudge(p.ride_id) }}
                    disabled={nudging || alreadyNudged}
                    className="mt-2 text-xs font-semibold text-primary active:opacity-70 disabled:opacity-50"
                  >
                    {alreadyNudged ? 'Nudge sent ✓' : nudging ? 'Sending…' : 'Nudge rider →'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Transactions */}
      <div className="px-6">
        <h2 className="mb-3 text-lg font-semibold text-text-primary">
          Transaction History
        </h2>

        {loading && (
          <div className="space-y-2" data-testid="loading-spinner">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl bg-white p-4">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-border" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-border" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-border" />
                </div>
                <div className="h-4 w-14 animate-pulse rounded bg-border" />
              </div>
            ))}
          </div>
        )}

        {!loading && transactions.length === 0 && (
          <div className="rounded-2xl bg-white p-8 text-center" data-testid="empty-state">
            <p className="text-3xl">💳</p>
            <p className="mt-2 font-semibold text-text-primary">No transactions yet</p>
            <p className="mt-1 text-sm text-text-secondary">
              Add funds to your wallet to get started
            </p>
          </div>
        )}

        {!loading && transactions.length > 0 && (
          <div className="space-y-2" data-testid="transaction-list">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"
                data-testid="transaction-item"
              >
                <div>
                  <p className="font-medium text-text-primary">
                    {tx.description ?? typeLabel(tx.type)}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {formatDate(tx.created_at)}
                    {isDriver && !hasBank && isDriverEarning(tx.type) && (
                      <span data-testid="tx-pending-payout-tag" className="ml-2 text-primary">
                        · Link bank to withdraw
                      </span>
                    )}
                  </p>
                </div>
                <p
                  className={`font-semibold ${isCredit(tx.type) ? 'text-success' : 'text-danger'}`}
                  data-testid="transaction-amount"
                >
                  {typeIcon(tx.type)}{formatCents(Math.abs(tx.amount_cents))}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav activeTab="payment" />

      <WithdrawSheet
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        balanceCents={balance}
        hasBank={hasBank}
        onSuccess={() => {
          void refreshProfile()
          void queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] })
        }}
      />
    </div>
  )
}
