import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/fare'
import BottomNav from '@/components/ui/BottomNav'
import WithdrawSheet from '@/components/ride/WithdrawSheet'
import {
  formatTxDate,
  isCredit,
  isDriverEarning,
  transactionTitle,
  typeIcon,
  withdrawalEta,
  withdrawalEtaDate,
  type WalletTransaction,
} from '@/lib/transactionDisplay'

// Limit the wallet hub's inline preview to the most recent N rows;
// matches iOS WalletHubPage.swift:462 `WalletTransactionsEndpoint(limit: 5)`.
const RECENT_PREVIEW_LIMIT = 5

interface PendingEarning {
  ride_id: string
  rider_id: string
  rider_name: string | null
  fare_cents: number
  ended_at: string
  destination_name: string | null
  payment_status: 'pending' | 'failed'
}

async function fetchTransactions(): Promise<WalletTransaction[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const res = await fetch(`/api/wallet/transactions?limit=${RECENT_PREVIEW_LIMIT}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch transactions')
  const json = await res.json() as { transactions: WalletTransaction[] }
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

  // ── On-focus refetch (iOS-parity for scenePhase == .active) ──────
  // iOS WalletHubPage re-runs refreshProfile + loadRecentTransactions
  // + loadPendingEarnings whenever the app foregrounds. Web's
  // closest analogue is visibilitychange — fire the same fan-out so
  // a webhook-landed top-up / settled withdrawal converges without
  // requiring the user to navigate away and back. React Query's
  // default refetchOnWindowFocus handles the queries, but profile
  // lives in Zustand and needs an explicit refresh call.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      void refreshProfile()
      void queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] })
      void queryClient.invalidateQueries({ queryKey: ['wallet-pending-earnings'] })
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [refreshProfile, queryClient])

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
  const pendingCount = pendingEarnings?.pending?.length ?? 0
  const pendingTotal = pendingEarnings?.total_cents ?? 0


  return (
    <div className="min-h-screen bg-surface pb-24 safe-top" data-testid="wallet-page">
      {/* ── Brand-gradient hero ─────────────────────────────────────────
          iOS WalletHubPage.swift:169 — eyebrow + 36pt balance + role-
          aware sub-copy. Driver sees "AVAILABLE TO WITHDRAW" + payout
          settle hint; rider sees "TAGO CREDIT" + top-up hint. */}
      <div
        data-testid="wallet-hub-hero"
        className="px-6 pt-10 pb-8 text-center flex flex-col items-center gap-1.5"
        style={{
          background: 'linear-gradient(180deg, rgba(58,90,228,0.12) 0%, rgba(58,90,228,0.04) 60%, transparent 100%)',
        }}
      >
        <p
          id="wallet-balance-label"
          data-testid="wallet-hub-eyebrow"
          className="text-[11px] font-extrabold tracking-[0.16em] text-text-secondary uppercase"
        >
          {isDriver ? 'Available to withdraw' : 'Tago credit'}
        </p>
        <h1
          className="text-4xl font-extrabold text-text-primary"
          data-testid="wallet-balance"
          aria-labelledby="wallet-balance-label"
          aria-live="polite"
        >
          {formatCents(balance)}
        </h1>
        <p className="text-xs text-text-secondary max-w-xs">
          {isDriver
            ? 'Earnings settle to your bank ~2 business days after withdraw.'
            : 'Use credit toward rides — top up anytime.'}
        </p>
      </div>

      {/* ── Quick-actions grid ──────────────────────────────────────────
          iOS WalletHubPage.swift:216 — 2×2 for driver (Add funds /
          Withdraw / Cards / Payouts); 1×2 for rider (Add funds +
          Cards only). Withdraw routes through WithdrawSheet when a
          bank is linked + balance > 0; otherwise it drops into the
          Stripe payouts onboarding (mirrors iOS `showPayouts`
          fallback). */}
      <div className="px-6 pt-4">
        <div className={['grid gap-3', isDriver ? 'grid-cols-2' : 'grid-cols-2'].join(' ')}>
          <WalletActionCard
            testId="wallet-hub-action-add-funds"
            aliasTestId="add-funds-button"
            iconBg="bg-primary/10"
            iconColor="text-primary"
            title="Add funds"
            subtitle="Top up your credit"
            onClick={() => navigate('/wallet/add')}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v8M8 12h8" />
              </svg>
            }
          />
          {isDriver && (
            <WalletActionCard
              testId="wallet-hub-action-withdraw"
              aliasTestId="withdraw-button"
              iconBg="bg-success/10"
              iconColor="text-success"
              title="Withdraw"
              subtitle="Send to your bank"
              disabled={!canWithdraw && hasBank}
              onClick={() => {
                if (!hasBank) {
                  navigate('/stripe/payouts')
                  return
                }
                if (!canWithdraw) return
                setWithdrawOpen(true)
              }}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8 12l4 4 4-4M12 8v8" />
                </svg>
              }
            />
          )}
          <WalletActionCard
            testId="wallet-hub-action-cards"
            aliasTestId="payment-methods-link"
            iconBg="bg-primary/10"
            iconColor="text-primary"
            title="Cards"
            subtitle="Manage payment methods"
            onClick={() => navigate('/payment/methods')}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <rect x="2" y="6" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            }
          />
          {isDriver && (
            <WalletActionCard
              testId="wallet-hub-action-payouts"
              iconBg="bg-warning/10"
              iconColor="text-warning"
              title="Payouts"
              subtitle="Bank + payout settings"
              onClick={() => navigate('/stripe/payouts')}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <path d="M3 21h18" />
                  <path d="M5 21V9l7-5 7 5v12" />
                  <path d="M9 21v-6h6v6" />
                </svg>
              }
            />
          )}
        </div>
      </div>

      {/* ── Bank prompt (driver, no bank, balance > 0) ────────────────
          iOS WalletHubPage.swift:324 — glass card with warning border
          + chevron pointing into /stripe/payouts. Replaces the older
          wallet-bank-banner; same `wallet-bank-banner` testid retained
          for backwards compatibility with existing tests. */}
      {showBankBanner && (
        <div className="px-6 pt-3">
          <button
            type="button"
            data-testid="wallet-bank-banner"
            onClick={() => navigate('/stripe/payouts')}
            className="w-full rounded-2xl border border-warning/60 bg-white px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-left"
          >
            <div className="h-9 w-9 shrink-0 rounded-full bg-warning/15 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-warning" aria-hidden="true">
                <path d="M3 21h18" />
                <path d="M5 21V9l7-5 7 5v12" />
                <path d="M9 21v-6h6v6" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary">Add a bank to cash out</p>
              <p className="text-xs text-text-secondary mt-0.5">
                {formatCents(balance)} is waiting in your wallet
              </p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 text-text-secondary shrink-0" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
            <span data-testid="wallet-bank-banner-cta" className="sr-only">Link Bank Account</span>
          </button>
        </div>
      )}

      {/* ── Pending-earnings banner ───────────────────────────────────
          iOS WalletHubPage.swift:489 — driver-only, 1-line glass card
          with hourglass icon + total/count + chevron. Routes to
          /wallet/pending where the full list + per-ride Nudge CTAs
          live (mirrors iOS PendingEarningsPage). The inline list
          that used to render here moved into PendingEarningsPage. */}
      {isDriver && pendingCount > 0 && (
        <div className="px-6 pt-3">
          <button
            type="button"
            data-testid="pending-earnings-banner"
            onClick={() => navigate('/wallet/pending')}
            className="w-full rounded-2xl bg-white border border-warning/60 px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-left"
          >
            <div className="h-9 w-9 shrink-0 rounded-full bg-warning/15 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-warning" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">
                <span data-testid="pending-earnings-banner-total">{formatCents(pendingTotal)}</span> waiting on {pendingCount} ride{pendingCount === 1 ? '' : 's'}
              </p>
              <p className="text-xs text-text-secondary mt-0.5 truncate">
                Tap to nudge riders to update payment
              </p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 text-text-secondary shrink-0" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Recent activity preview ────────────────────────────────────
          iOS WalletHubPage.swift:376 — eyebrow + cap-at-5 preview +
          "View all" → /wallet/history. The full paginated list +
          day-grouped sections lives on TransactionHistoryPage. */}
      <div className="px-6 pt-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[11px] font-extrabold tracking-[0.16em] text-text-secondary uppercase">
            Recent activity
          </h2>
          {transactions.length > 0 && (
            <button
              type="button"
              data-testid="wallet-view-all-history"
              onClick={() => navigate('/wallet/history')}
              className="text-xs font-bold text-primary active:opacity-70 flex items-center gap-1"
            >
              View all
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}
        </div>

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
                      {formatTxDate(tx.created_at)}
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

// ── Subcomponents ──────────────────────────────────────────────────

/**
 * Glass-style quick-action card matching iOS WalletHubPage.swift:272
 * (`actionCard`). Square-ish tile with icon chip on top, title +
 * subtitle below, hairline border + soft shadow. `aliasTestId` keeps
 * existing test selectors (`add-funds-button`, `withdraw-button`,
 * `payment-methods-link`) clickable so the old test suite passes
 * without rewriting every selector.
 */
function WalletActionCard({
  testId,
  aliasTestId,
  iconBg,
  iconColor,
  title,
  subtitle,
  onClick,
  icon,
  disabled = false,
}: {
  testId: string
  aliasTestId?: string
  iconBg: string
  iconColor: string
  title: string
  subtitle: string
  onClick: () => void
  icon: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-alias-testid={aliasTestId}
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex flex-col items-start gap-2 rounded-2xl bg-white border border-border/60 p-4 min-h-[110px]',
        'shadow-[0_2px_8px_rgba(0,0,0,0.05)] active:scale-[0.98] transition-transform text-left',
        disabled ? 'opacity-60 cursor-not-allowed' : '',
      ].join(' ')}
    >
      <span className={['h-9 w-9 rounded-full flex items-center justify-center shrink-0', iconBg, iconColor].join(' ')}>
        {icon}
      </span>
      <span className="text-sm font-bold text-text-primary">{title}</span>
      <span className="text-[11px] text-text-secondary leading-snug">{subtitle}</span>
      {aliasTestId && (
        <span data-testid={aliasTestId} className="sr-only">{title}</span>
      )}
    </button>
  )
}
