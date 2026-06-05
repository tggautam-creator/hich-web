import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/fare'
import BottomNav from '@/components/ui/BottomNav'

/**
 * Driver-side "Pending earnings" page (web port of
 * ios/Tago/Features/Payment/PendingEarningsPage.swift). Lists
 * completed rides whose rider payment never settled — the driver
 * hasn't been credited yet. Each row has a "Nudge rider" CTA that
 * hits POST /api/rides/:id/nudge-rider; 60s per-ride cooldown is
 * enforced server-side and mirrored as a live countdown on the button.
 *
 * Wired from WalletPage's pending-earnings banner when count > 0.
 * Replaces the prior inline "Payments in limbo" section on the
 * wallet hub — keeping the hub clean and dedicating a screen to the
 * lookup/nudge loop.
 */

interface PendingEarning {
  ride_id: string
  rider_id: string
  rider_name: string | null
  fare_cents: number
  ended_at: string
  destination_name: string | null
  payment_status: 'pending' | 'failed'
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

function statusCopy(p: PendingEarning): string {
  if (p.payment_status === 'failed') return 'Card declined — rider needs to update payment'
  if (p.payment_status === 'pending') return 'No card on file at end of ride'
  return 'Settling…'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PendingEarningsPage() {
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['wallet-pending-earnings'],
    queryFn: fetchPendingEarnings,
  })
  const pending = data?.pending ?? []
  const total = data?.total_cents ?? 0

  const [nudgingRideId, setNudgingRideId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [cooldownEndByRide, setCooldownEndByRide] = useState<Record<string, number>>({})
  const [nowTick, setNowTick] = useState(() => Date.now())

  // Run a 1Hz tick only while at least one cooldown is still in the
  // future. Mirrors the iOS `clockTick` driving the countdown.
  useEffect(() => {
    const hasActive = Object.values(cooldownEndByRide).some((end) => end > Date.now())
    if (!hasActive) return
    const id = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [cooldownEndByRide])

  function cooldownSecondsRemaining(rideId: string): number {
    const end = cooldownEndByRide[rideId]
    if (!end) return 0
    const remaining = Math.ceil((end - nowTick) / 1000)
    return remaining > 0 ? remaining : 0
  }

  async function handleNudge(rideId: string) {
    if (nudgingRideId) return
    setNudgingRideId(rideId)
    setActionError(null)
    // Optimistic 60s cooldown (matches server NUDGE_COOLDOWN_MS).
    // Overwritten if the server returns 429 with retry_after_seconds.
    setCooldownEndByRide((prev) => ({ ...prev, [rideId]: Date.now() + 60_000 }))
    setNowTick(Date.now())
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setCooldownEndByRide((prev) => {
          const next = { ...prev }
          delete next[rideId]
          return next
        })
        setActionError('Please sign in.')
        return
      }
      const resp = await fetch(`/api/rides/${rideId}/nudge-rider`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as {
          error?: { message?: string }
          retry_after_seconds?: number
        }
        if (resp.status === 429 && typeof body.retry_after_seconds === 'number') {
          setCooldownEndByRide((prev) => ({
            ...prev,
            [rideId]: Date.now() + body.retry_after_seconds! * 1000,
          }))
          setNowTick(Date.now())
          return
        }
        // Other failure paths — drop the optimistic cooldown so the
        // user can retry immediately.
        setCooldownEndByRide((prev) => {
          const next = { ...prev }
          delete next[rideId]
          return next
        })
        setActionError(body.error?.message ?? 'Could not send nudge.')
      }
    } catch {
      setCooldownEndByRide((prev) => {
        const next = { ...prev }
        delete next[rideId]
        return next
      })
      setActionError('Network error. Please try again.')
    } finally {
      setNudgingRideId(null)
    }
  }

  return (
    <div className="min-h-screen bg-surface pb-24 safe-top" data-testid="pending-earnings-page">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <button
          type="button"
          data-testid="pending-earnings-back"
          onClick={() => navigate('/wallet')}
          aria-label="Back to wallet"
          className="h-9 w-9 rounded-full flex items-center justify-center active:opacity-60"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-text-primary" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-base font-bold text-text-primary">Pending earnings</h1>
      </div>

      <div className="px-4 pt-2 flex flex-col gap-4">
        {/* ── Loading ─────────────────────────────────────────────── */}
        {isLoading && pending.length === 0 && (
          <div data-testid="pending-earnings-loading" className="flex items-center justify-center gap-2 py-8 text-sm text-text-secondary">
            <span className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading pending earnings&hellip;
          </div>
        )}

        {/* ── Error banner ────────────────────────────────────────── */}
        {!!error && pending.length === 0 && (
          <div data-testid="pending-earnings-error" className="rounded-2xl bg-white border border-warning/30 px-4 py-3 flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-warning shrink-0 mt-0.5" aria-hidden="true">
              <path fillRule="evenodd" d="M12 1.5a10.5 10.5 0 100 21 10.5 10.5 0 000-21zM12 7a1 1 0 00-1 1v5a1 1 0 102 0V8a1 1 0 00-1-1zm0 9.5a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5z" clipRule="evenodd" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-text-primary">Couldn&rsquo;t load pending earnings</p>
              <p className="text-xs text-text-secondary mt-0.5">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </div>
            <button
              type="button"
              data-testid="pending-earnings-retry"
              onClick={() => { void refetch() }}
              className="text-xs font-bold text-primary active:opacity-70"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────────────── */}
        {!isLoading && !error && pending.length === 0 && (
          <div data-testid="pending-earnings-empty" className="rounded-2xl bg-white p-8 text-center flex flex-col items-center gap-2 mt-4">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10 text-success" aria-hidden="true">
              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
            </svg>
            <p className="text-sm font-bold text-text-primary">All clear</p>
            <p className="text-xs text-text-secondary leading-relaxed max-w-xs">
              No pending earnings. When a rider&rsquo;s payment doesn&rsquo;t go through after a ride, it&rsquo;ll show up here.
            </p>
          </div>
        )}

        {/* ── Total card ──────────────────────────────────────────── */}
        {pending.length > 0 && (
          <div
            data-testid="pending-earnings-total-card"
            className="rounded-2xl bg-white border border-border/60 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-1"
          >
            <p className="text-[10px] font-extrabold tracking-[0.16em] text-text-secondary uppercase">
              Waiting to settle
            </p>
            <p
              data-testid="pending-earnings-total"
              className="text-3xl font-extrabold text-text-primary"
            >
              {formatCents(total)}
            </p>
            <p className="text-xs text-text-secondary">
              {pending.length} ride{pending.length === 1 ? '' : 's'} · these don&rsquo;t show in your wallet yet.
            </p>
          </div>
        )}

        {/* ── Action error ────────────────────────────────────────── */}
        {actionError && (
          <p data-testid="pending-earnings-action-error" className="text-xs text-danger -mt-1">
            {actionError}
          </p>
        )}

        {/* ── Pending rows ────────────────────────────────────────── */}
        {pending.length > 0 && (
          <div className="flex flex-col gap-3" data-testid="pending-earnings-list">
            {pending.map((row) => {
              const isFailed = row.payment_status === 'failed'
              const seconds = cooldownSecondsRemaining(row.ride_id)
              const onCooldown = seconds > 0
              const isInFlight = nudgingRideId === row.ride_id
              return (
                <div
                  key={row.ride_id}
                  data-testid="pending-earnings-row"
                  className="rounded-2xl bg-white border border-border/60 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div className={[
                      'h-9 w-9 rounded-full flex items-center justify-center shrink-0',
                      isFailed ? 'bg-danger/15' : 'bg-warning/15',
                    ].join(' ')}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={['h-4 w-4', isFailed ? 'text-danger' : 'text-warning'].join(' ')} aria-hidden="true">
                        {isFailed ? (
                          <>
                            <rect x="2" y="6" width="20" height="14" rx="2" />
                            <line x1="2" y1="10" x2="22" y2="10" />
                            <line x1="6" y1="14" x2="6.01" y2="14" />
                            <line x1="10" y1="14" x2="14" y2="14" />
                          </>
                        ) : (
                          <>
                            <circle cx="12" cy="12" r="9" />
                            <polyline points="12 7 12 12 15 14" />
                          </>
                        )}
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-text-primary truncate">
                        {row.rider_name ?? 'Rider'}
                      </p>
                      <p className="text-[11px] text-text-secondary truncate">
                        {row.destination_name ?? 'Ride completed'} · {formatDate(row.ended_at)}
                      </p>
                      <p className={['text-[11px] mt-0.5', isFailed ? 'text-danger' : 'text-warning'].join(' ')}>
                        {statusCopy(row)}
                      </p>
                    </div>
                    <p className="text-sm font-extrabold text-text-primary shrink-0 tabular-nums">
                      {formatCents(row.fare_cents)}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="pending-earnings-nudge"
                    onClick={() => { void handleNudge(row.ride_id) }}
                    disabled={onCooldown || isInFlight}
                    className={[
                      'w-full rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2',
                      onCooldown
                        ? 'bg-border text-text-secondary cursor-not-allowed'
                        : 'bg-primary text-white active:opacity-90',
                      isInFlight ? 'opacity-70' : '',
                    ].join(' ')}
                  >
                    {onCooldown ? (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <polyline points="12 7 12 12 15 14" />
                        </svg>
                        Wait {seconds}s
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                          <path d="M12 2a1 1 0 011 1v1.07A7 7 0 0119 11v3l1.71 1.71A1 1 0 0120 17H4a1 1 0 01-.71-1.71L5 14v-3a7 7 0 016-6.93V3a1 1 0 011-1zM10 19a2 2 0 104 0h-4z" />
                        </svg>
                        {isInFlight ? 'Sending…' : 'Nudge rider'}
                      </>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Footer note ─────────────────────────────────────────── */}
        {pending.length > 0 && (
          <p className="text-[11px] text-text-secondary leading-relaxed px-1 pt-1">
            Tago retries the rider&rsquo;s card automatically. Your nudge sends them a push so they can switch cards if needed.
          </p>
        )}
      </div>

      <BottomNav activeTab="payment" />
    </div>
  )
}
