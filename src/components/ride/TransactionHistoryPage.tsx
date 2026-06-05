import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/fare'
import BottomNav from '@/components/ui/BottomNav'
import {
  groupByDay,
  isCredit,
  isDriverEarning,
  transactionTitle,
  typeIcon,
  withdrawalEta,
  withdrawalEtaDate,
  type WalletTransaction,
} from '@/lib/transactionDisplay'

/**
 * Full transaction history with cursor pagination. Pushed from the
 * wallet hub's "View all" affordance. Mirrors iOS
 * ios/Tago/Features/Payment/TransactionHistoryPage.swift:
 *
 * - Day-grouped sections ("Today" / "Yesterday" / "Apr 26").
 * - Newest-first cursor pagination via GET /api/wallet/transactions
 *   ?cursor=<iso>&limit=25. Server returns `next_cursor` set to the
 *   oldest row's ISO timestamp; we send it back on the next page,
 *   server filters `created_at < cursor`. When `next_cursor` is null
 *   we know we're done.
 * - Infinite-scroll trigger via IntersectionObserver on a sentinel at
 *   the bottom of the list (iOS uses `.onAppear` on the last row).
 * - Per-row tap routes to /wallet/transaction/:id.
 * - Empty + loading + error states match the hub recent-activity
 *   surface. Footer prints "That's everything." once exhausted.
 */

const PAGE_SIZE = 25

async function fetchPage(cursor: string | null): Promise<{ transactions: WalletTransaction[]; next_cursor: string | null }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const params = new URLSearchParams()
  params.set('limit', String(PAGE_SIZE))
  if (cursor) params.set('cursor', cursor)
  const res = await fetch(`/api/wallet/transactions?${params.toString()}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch transactions')
  return (await res.json()) as { transactions: WalletTransaction[]; next_cursor: string | null }
}

export default function TransactionHistoryPage() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const isDriver = profile?.is_driver === true
  const hasBank = profile?.stripe_onboarding_complete === true

  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasReachedEnd, setHasReachedEnd] = useState(false)
  const [isLoadingFirst, setIsLoadingFirst] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const sentinelRef = useRef<HTMLDivElement | null>(null)

  async function load(reset: boolean) {
    if (reset) {
      setIsLoadingFirst(true)
      setLoadError(null)
    } else {
      if (isLoadingMore || hasReachedEnd || !cursor) return
      setIsLoadingMore(true)
    }
    try {
      const body = await fetchPage(reset ? null : cursor)
      const next = body.next_cursor
      if (reset) {
        setTransactions(body.transactions)
      } else {
        const existing = new Set(transactions.map((t) => t.id))
        const fresh = body.transactions.filter((t) => !existing.has(t.id))
        setTransactions((prev) => [...prev, ...fresh])
      }
      setCursor(next)
      setHasReachedEnd(next === null)
    } catch (err) {
      if (reset) {
        setLoadError(err instanceof Error ? err.message : 'Unknown error')
      }
      // Soft-fail on pagination — leave the visible list intact, user
      // can scroll back to retry.
    } finally {
      setIsLoadingFirst(false)
      setIsLoadingMore(false)
    }
  }

  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── On-focus refetch (iOS-parity for scenePhase == .active) ──────
  // iOS TransactionHistoryPage re-runs reload() (which resets the
  // cursor) when the app foregrounds. Web mirrors via
  // visibilitychange — fresh page from the newest entry every time
  // the user tabs back in.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      void load(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    if (hasReachedEnd) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        void load(false)
      }
    }, { rootMargin: '200px' })
    observer.observe(node)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasReachedEnd, cursor, transactions.length])

  const grouped = groupByDay(transactions)

  return (
    <div className="min-h-screen bg-surface pb-24 safe-top" data-testid="transaction-history-page">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <button
          type="button"
          data-testid="transaction-history-back"
          onClick={() => navigate('/wallet')}
          aria-label="Back to wallet"
          className="h-9 w-9 rounded-full flex items-center justify-center active:opacity-60"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-text-primary" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-base font-bold text-text-primary">Transactions</h1>
      </div>

      <div className="px-4 pt-2 flex flex-col gap-4">
        {/* ── Loading ────────────────────────────────────────────── */}
        {isLoadingFirst && transactions.length === 0 && (
          <div data-testid="transaction-history-loading" className="flex items-center justify-center gap-2 py-8 text-sm text-text-secondary">
            <span className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading transactions&hellip;
          </div>
        )}

        {/* ── Error banner ──────────────────────────────────────── */}
        {loadError && transactions.length === 0 && (
          <div data-testid="transaction-history-error" className="rounded-2xl bg-white border border-warning/30 px-4 py-3 flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-warning shrink-0 mt-0.5" aria-hidden="true">
              <path fillRule="evenodd" d="M12 1.5a10.5 10.5 0 100 21 10.5 10.5 0 000-21zM12 7a1 1 0 00-1 1v5a1 1 0 102 0V8a1 1 0 00-1-1zm0 9.5a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5z" clipRule="evenodd" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-text-primary">Couldn&rsquo;t load history</p>
              <p className="text-xs text-text-secondary mt-0.5">{loadError}</p>
            </div>
            <button
              type="button"
              data-testid="transaction-history-retry"
              onClick={() => { void load(true) }}
              className="text-xs font-bold text-primary active:opacity-70"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Empty state ────────────────────────────────────────── */}
        {!isLoadingFirst && !loadError && transactions.length === 0 && (
          <div data-testid="transaction-history-empty" className="rounded-2xl bg-white p-8 text-center flex flex-col items-center gap-2 mt-4">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-text-secondary" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className="text-sm font-bold text-text-primary">No transactions yet</p>
            <p className="text-xs text-text-secondary leading-relaxed max-w-xs">
              Top-ups, ride payments, and earnings will appear here.
            </p>
          </div>
        )}

        {/* ── Day-grouped sections ──────────────────────────────── */}
        {grouped.map(({ label, rows }) => (
          <div key={label} className="flex flex-col gap-1">
            <p className="text-[11px] font-extrabold tracking-[0.16em] text-text-secondary uppercase px-2">
              {label}
            </p>
            <div data-testid={`transaction-history-section-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="rounded-2xl bg-white border border-border/60 shadow-[0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden">
              {rows.map((tx, idx) => {
                const isWithdrawalRow = tx.type === 'withdrawal' && !!tx.transfer_id
                const isLandedWithdrawal = isWithdrawalRow
                  && withdrawalEtaDate(tx.created_at).getTime() <= Date.now()
                const isInTransitWithdrawal = isWithdrawalRow && !isLandedWithdrawal
                return (
                  <button
                    key={tx.id}
                    type="button"
                    data-testid="transaction-item"
                    onClick={() => navigate(`/wallet/transaction/${tx.id}`)}
                    className={[
                      'w-full flex items-center justify-between px-4 py-3 text-left active:bg-surface transition-colors',
                      idx < rows.length - 1 ? 'border-b border-border/40' : '',
                    ].join(' ')}
                    aria-label={`View transaction — ${transactionTitle(tx)}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {transactionTitle(tx)}
                      </p>
                      <p className="text-xs text-text-secondary truncate">
                        {new Date(tx.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        {isDriver && !hasBank && isDriverEarning(tx.type) && (
                          <span className="ml-2 text-primary">· Link bank to withdraw</span>
                        )}
                        {isInTransitWithdrawal && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-warning">
                            In transit · expected by {withdrawalEta(tx.created_at)}
                          </span>
                        )}
                        {isLandedWithdrawal && (
                          <span className="ml-2 text-success">· Landed in your bank</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      <p
                        className={['font-semibold tabular-nums', isCredit(tx.type) ? 'text-success' : 'text-danger'].join(' ')}
                        data-testid="transaction-amount"
                        aria-label={`${formatCents(Math.abs(tx.amount_cents))} ${isCredit(tx.type) ? 'credited' : 'debited'}`}
                      >
                        <span aria-hidden="true">
                          {typeIcon(tx.type)}{formatCents(Math.abs(tx.amount_cents))}
                        </span>
                      </p>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-secondary/60" aria-hidden="true">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* ── Footer ───────────────────────────────────────────── */}
        {isLoadingMore && (
          <div data-testid="transaction-history-loading-more" className="flex items-center justify-center gap-2 py-4 text-xs text-text-secondary">
            <span className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading more&hellip;
          </div>
        )}
        {hasReachedEnd && transactions.length >= 8 && (
          <p data-testid="transaction-history-end" className="text-center text-xs text-text-secondary py-4">
            That&rsquo;s everything.
          </p>
        )}

        {/* Sentinel — fires the next page fetch when scrolled into view */}
        <div ref={sentinelRef} aria-hidden="true" className="h-1" />
      </div>

      <BottomNav activeTab="payment" />
    </div>
  )
}
