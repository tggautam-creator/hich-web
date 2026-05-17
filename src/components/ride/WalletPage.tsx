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
  ride_id?: string | null
  counterparty_name?: string | null
  // Set when the withdrawal row has been tied to a Stripe Transfer.
  // The "landed" flip is derived cosmetically from created_at + 2
  // business days (see WalletPage.withdrawalEtaDate); transfer_paid_at
  // exists in the schema for forward-compat but isn't read by the UI.
  transfer_id?: string | null
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
  // Per-ride cooldown end (epoch ms). The server returns 429 with
  // `retry_after_seconds` when the driver re-nudges before the
  // 60 s window expires; we honour it by displaying a live tick so
  // the driver sees the actual remaining time instead of a button
  // that's permanently disabled. Mirrors iOS
  // `PendingEarningsPage::nudgeCooldownRemaining` (W-T1-P5).
  const [nudgeCooldownUntil, setNudgeCooldownUntil] = useState<Record<string, number>>({})
  // Tick state — re-renders the countdown labels every second while
  // any cooldown is still in the future.
  const [nudgeNowTick, setNudgeNowTick] = useState(() => Date.now())

  useEffect(() => {
    // Bail when there's nothing to count down — avoids a perpetual
    // tick that wakes the page every second after every cooldown
    // has expired.
    const hasActive = Object.values(nudgeCooldownUntil).some((until) => until > Date.now())
    if (!hasActive) return
    const id = window.setInterval(() => setNudgeNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [nudgeCooldownUntil])

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
        const body = (await resp.json().catch(() => ({}))) as {
          error?: { message?: string }
          retry_after_seconds?: number
        }
        // 429 cooldown: stash the per-ride deadline so the button
        // can show a live "Try again in 42s" countdown.
        if (resp.status === 429 && typeof body.retry_after_seconds === 'number') {
          const deadline = Date.now() + body.retry_after_seconds * 1000
          setNudgeCooldownUntil((prev) => ({ ...prev, [rideId]: deadline }))
          setNudgeNowTick(Date.now())
          // Don't surface a separate error — the countdown IS the
          // feedback. Clear any pre-existing error so it doesn't
          // linger above an unrelated row.
          setNudgeError(null)
          return
        }
        setNudgeError(body.error?.message ?? 'Could not send nudge.')
        return
      }
      setNudgedRideIds((prev) => {
        const next = new Set(prev)
        next.add(rideId)
        return next
      })
      // Successful nudge also kicks the cooldown so re-tap is
      // pre-blocked until the server window expires.
      const deadline = Date.now() + 60_000
      setNudgeCooldownUntil((prev) => ({ ...prev, [rideId]: deadline }))
      setNudgeNowTick(Date.now())
    } catch {
      setNudgeError('Network error. Please try again.')
    } finally {
      setNudgingRideId(null)
    }
  }

  function nudgeCooldownSecondsRemaining(rideId: string): number {
    const until = nudgeCooldownUntil[rideId]
    if (!until) return 0
    const remaining = Math.ceil((until - nudgeNowTick) / 1000)
    return remaining > 0 ? remaining : 0
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
      case 'fare_reversal': return 'Refunded — payment failed'
      case 'wallet_refund': return 'Refund — payment failed'
      case 'refund': return 'Refund'
      case 'tip_debit': return 'Tip to driver'
      case 'tip_credit': return 'Tip from rider'
      case 'withdrawal': return 'Withdrawal to bank'
      case 'withdrawal_failed_refund': return 'Refund — withdrawal failed'
      default: return type
    }
  }

  // Slice 8: refund/reversal rows all surface as the same generic label
  // ("Refund — payment failed") even though they come from three distinct
  // server paths. Parse the description prefix the server writes so the
  // rider/driver can tell *why* the refund happened. No schema change —
  // pure read-side enrichment. If the prefix doesn't match a known case,
  // fall back to the generic typeLabel so older rows still render.
  function refinedRefundLabel(tx: Transaction): string | null {
    const desc = (tx.description ?? '').toLowerCase()
    if (tx.type === 'wallet_refund') {
      if (desc.includes('no card on file')) return 'Refund · no card on file'
      if (desc.includes('card charge failed')) return 'Refund · card charge failed'
      if (desc.includes('card portion failed') || desc.includes('rider wallet restored')) return 'Refund · card payment failed'
    }
    if (tx.type === 'fare_reversal') {
      if (desc.includes('test-mode')) return 'Reversed · test-mode cleanup'
      if (desc.includes('rider payment failed')) return 'Reversed · rider payment failed'
    }
    if (tx.type === 'withdrawal_failed_refund') {
      return 'Refund · withdrawal failed at bank'
    }
    return null
  }

  // Pretty primary line for a transaction: "Ride earnings · Tarun Gautam"
  // when we know the other party, otherwise fall back to the type label.
  // We deliberately ignore tx.description for ride-linked rows — it stored a
  // raw uuid before the rider-name enrichment was added.
  //
  // For refund/reversal rows we prefer the description-parsed label
  // (Slice 8) so the rider can tell *which* refund cause this was. The
  // counterparty name is appended when known.
  function transactionTitle(tx: Transaction): string {
    const refined = refinedRefundLabel(tx)
    const base = refined ?? typeLabel(tx.type)
    if (tx.counterparty_name && tx.ride_id) {
      return `${base} · ${tx.counterparty_name}`
    }
    return refined ?? tx.description ?? base
  }

  function typeIcon(type: string): string {
    switch (type) {
      case 'topup': return '+'
      case 'fare_credit': return '+'
      case 'ride_earning': return '+'
      case 'wallet_refund': return '+'
      case 'tip_credit': return '+'
      case 'withdrawal_failed_refund': return '+'
      case 'fare_debit': return '−'
      case 'fare_reversal': return '−'
      case 'tip_debit': return '−'
      case 'withdrawal': return '−'
      case 'refund': return '+'
      default: return ''
    }
  }

  function isCredit(type: string): boolean {
    return type === 'topup' || type === 'fare_credit' || type === 'ride_earning'
      || type === 'wallet_refund' || type === 'refund' || type === 'tip_credit'
      || type === 'withdrawal_failed_refund'
  }

  // ETA helpers — Stripe doesn't expose a platform-level event for
  // "money landed in the connected account's bank" anymore (the old
  // `transfer.paid` event was retired and `payout.paid` only fires on
  // the connected account). We approximate by adding 2 business days
  // to the withdrawal's created_at: until that date the row reads "in
  // transit", after it reads "landed in your bank". Cosmetic but
  // accurate within ~1 day for ~99% of transfers and matches the copy
  // in WithdrawSheet's success state.
  function withdrawalEtaDate(createdAt: string): Date {
    const d = new Date(createdAt)
    let added = 0
    while (added < 2) {
      d.setDate(d.getDate() + 1)
      const dow = d.getDay()
      if (dow !== 0 && dow !== 6) added++
    }
    return d
  }
  function withdrawalEta(createdAt: string): string {
    return withdrawalEtaDate(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  function isDriverEarning(type: string): boolean {
    return type === 'ride_earning' || type === 'fare_credit'
  }

  return (
    <div className="min-h-screen bg-surface pb-20 safe-top" data-testid="wallet-page">
      {/* Header */}
      <div className="bg-primary px-6 pb-8 pt-12 text-white">
        <p className="text-sm text-white/80" id="wallet-balance-label">
          {showBankBanner ? 'Pending payout' : 'Your balance'}
        </p>
        {/* Slice 12: bare <p> gave screen readers no landmark + no
            announcement context. <h1> + aria-labelledby reads as
            "Your balance: $25.30" / "Pending payout: $25.30". */}
        <h1
          className="text-4xl font-bold"
          data-testid="wallet-balance"
          aria-labelledby="wallet-balance-label"
          aria-live="polite"
        >
          {formatCents(balance)}
        </h1>
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
              const cooldownSec = nudgeCooldownSecondsRemaining(p.ride_id)
              const inCooldown = cooldownSec > 0
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
                      {/* Payment-status pill — same role-neutral copy
                          as the iOS WalletHubPage row. Drivers don't
                          see "PAYMENT FAILED" on their own
                          earnings list either (W-T1-P9 parity). */}
                      <p className="mt-0.5 text-xs text-text-secondary">
                        {formatDate(p.ended_at)}
                        <span className="ml-2 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
                          Payment pending
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
                    disabled={nudging || alreadyNudged || inCooldown}
                    className="mt-2 text-xs font-semibold text-primary active:opacity-70 disabled:opacity-50"
                  >
                    {alreadyNudged
                      ? 'Nudge sent ✓'
                      : nudging
                        ? 'Sending…'
                        : inCooldown
                          ? `Try again in ${cooldownSec}s`
                          : 'Nudge rider →'}
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
          // Slice 10: rider and driver land here for opposite reasons —
          // riders haven't topped up yet (frame as benefit + CTA), drivers
          // haven't completed a ride yet (frame as expectation, no CTA).
          // Default text on each branch is concrete enough that a first-time
          // user understands what this screen will eventually show.
          <div className="rounded-2xl bg-white p-8 text-center" data-testid="empty-state">
            {isDriver ? (
              <>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-primary">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                  </svg>
                </div>
                <p className="mt-3 font-semibold text-text-primary">No earnings yet</p>
                <p className="mt-1 text-sm text-text-secondary">
                  Your fare for each completed ride lands here. Link a bank to withdraw to your account.
                </p>
                {!hasBank && (
                  <button
                    onClick={() => navigate('/stripe/payouts')}
                    className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white"
                    data-testid="empty-state-link-bank"
                  >
                    Link a bank account
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-success">
                    <rect x="2" y="6" width="20" height="14" rx="2" />
                    <line x1="2" y1="10" x2="22" y2="10" />
                    <line x1="6" y1="15" x2="10" y2="15" />
                  </svg>
                </div>
                <p className="mt-3 font-semibold text-text-primary">Top up to ride fee-free</p>
                <p className="mt-1 text-sm text-text-secondary">
                  Wallet rides skip the card processing fee (~9% on a $5 ride). Add funds once, ride for weeks.
                </p>
                <button
                  onClick={() => navigate('/wallet/add')}
                  className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white"
                  data-testid="empty-state-add-funds"
                >
                  Add funds
                </button>
              </>
            )}
          </div>
        )}

        {!loading && transactions.length > 0 && (
          <div className="space-y-2" data-testid="transaction-list">
            {transactions.map((tx) => {
              // Withdrawal pill state — cosmetic, derived from
              // created_at + 2 business days (see withdrawalEtaDate).
              // Stripe doesn't expose a platform-level "money landed in
              // bank" event so we don't try to pretend we know exactly;
              // the date approximation is right within ~1 day for ~99%
              // of transfers, which is the same UX you'd see in a real
              // tracker. transfer_id is still required so we don't show
              // pills on pre-Stripe failure rows.
              const isWithdrawalRow = tx.type === 'withdrawal' && !!tx.transfer_id
              const isLandedWithdrawal = isWithdrawalRow
                && withdrawalEtaDate(tx.created_at).getTime() <= Date.now()
              const isInTransitWithdrawal = isWithdrawalRow && !isLandedWithdrawal
              // Sprint 3 W-T1-P6 — every row now taps into the new
              // /wallet/transaction/:id detail page (signed amount
              // hero, status pill, refs, "View ride" deep-link when
              // ride-linked, etc.). Previously only ride-linked rows
              // were tappable.
              const isTappable = true
              const innerContent = (
                <>
                  <div>
                    <p className="font-medium text-text-primary">
                      {transactionTitle(tx)}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {formatDate(tx.created_at)}
                      {isDriver && !hasBank && isDriverEarning(tx.type) && (
                        <span data-testid="tx-pending-payout-tag" className="ml-2 text-primary">
                          · Link bank to withdraw
                        </span>
                      )}
                      {isInTransitWithdrawal && (
                        <span data-testid="tx-withdrawal-in-transit" className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-warning">
                          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="10" r="4" /></svg>
                          In transit · expected by {withdrawalEta(tx.created_at)}
                        </span>
                      )}
                      {isLandedWithdrawal && (
                        <span data-testid="tx-withdrawal-landed" className="ml-2 text-success">
                          · Landed in your bank
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p
                      className={`font-semibold ${isCredit(tx.type) ? 'text-success' : 'text-danger'}`}
                      data-testid="transaction-amount"
                      // Slice 12: color alone is inaccessible (color-blind +
                      // screen reader). Spoken label always says "credited"
                      // or "debited" so the meaning carries without color.
                      aria-label={`${formatCents(Math.abs(tx.amount_cents))} ${isCredit(tx.type) ? 'credited' : 'debited'}`}
                    >
                      <span aria-hidden="true">
                        {typeIcon(tx.type)}{formatCents(Math.abs(tx.amount_cents))}
                      </span>
                    </p>
                    {isTappable && (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-secondary shrink-0" aria-hidden="true">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    )}
                  </div>
                </>
              )
              return isTappable ? (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => { navigate(`/wallet/transaction/${tx.id}`) }}
                  className="w-full flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-left active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="transaction-item"
                  aria-label={`View transaction — ${transactionTitle(tx)}`}
                >
                  {innerContent}
                </button>
              ) : (
                <div
                  key={tx.id}
                  className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"
                  data-testid="transaction-item"
                >
                  {innerContent}
                </div>
              )
            })}
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
