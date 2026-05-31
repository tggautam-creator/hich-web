import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatCents } from '@/lib/fare'
import type { Ride, User } from '@/types/database'

/**
 * Sprint 9 Slice 5 SURFACE A — driver-side multi-ride trip-complete panel.
 *
 * Replaces the prior stepper UX (which walked the driver rider-by-rider
 * with inline rating) with the iOS hero-then-list pattern from
 * `ios/Tago/Features/DriverHome/DriverMultiRidePage+TripComplete.swift`
 * lines 60-255:
 *
 *   ┌──────────────────────────────────────┐
 *   │  ← Trip complete                     │
 *   │     All riders dropped off           │
 *   ├──────────────────────────────────────┤
 *   │                                      │
 *   │           ✓ ($25.00)                 │
 *   │      All riders dropped off          │
 *   │            $25.00                    │
 *   │         from 3 riders                │
 *   │                                      │
 *   │   PER-RIDER SUMMARY                  │
 *   │   ┌──────────────────────────────┐   │
 *   │   │ 👤 Alex   Sacramento  $8.50 ›│   │
 *   │   │ 👤 Bee    Davis       $7.50 ›│   │
 *   │   │ 👤 Cee    Berkeley    $9.00 ›│   │
 *   │   └──────────────────────────────┘   │
 *   │                                      │
 *   │   [        Done        ]             │
 *   └──────────────────────────────────────┘
 *
 * Per-rider rows are tappable → opens that rider's RideSummaryPage at
 * `/ride/summary/{rideId}` where Sprint 2's inline rating + tip flow
 * lives (so rating is no longer inline on this page — it's per-ride).
 * Done → `/home/driver`.
 */

interface CompletedRide {
  ride: Pick<Ride, 'id' | 'rider_id' | 'fare_cents' | 'destination_name'>
  rider: Pick<User, 'id' | 'full_name' | 'avatar_url'>
}

interface DriverMultiSummaryFlowProps {
  'data-testid'?: string
}

function initials(name: string | null | undefined): string {
  if (name == null) return '?'
  const trimmed = name.trim()
  if (trimmed.length === 0) return '?'
  return trimmed.charAt(0).toUpperCase()
}

export default function DriverMultiSummaryFlow({
  'data-testid': testId = 'driver-multi-summary',
}: DriverMultiSummaryFlowProps) {
  const { scheduleId } = useParams<{ scheduleId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const currentUserId = profile?.id ?? null

  const [completedRides, setCompletedRides] = useState<CompletedRide[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!scheduleId || !currentUserId) return

    const { data: rides } = await supabase
      .from('rides')
      .select('id, rider_id, fare_cents, destination_name, driver_id, status')
      .eq('schedule_id', scheduleId)
      .eq('status', 'completed')
      .order('ended_at', { ascending: true })

    if (!rides || rides.length === 0) {
      setLoading(false)
      return
    }

    // Filter to rides this driver actually drove.
    const myRides = (rides as { id: string; rider_id: string | null; fare_cents: number | null; destination_name: string | null; driver_id: string | null; status: string }[])
      .filter((r) => r.driver_id === currentUserId && r.rider_id != null)

    const riderIds = [...new Set(myRides.map((r) => r.rider_id as string))]
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, avatar_url')
      .in('id', riderIds)

    const userLookup: Record<string, Pick<User, 'id' | 'full_name' | 'avatar_url'>> = {}
    for (const u of (users ?? []) as Pick<User, 'id' | 'full_name' | 'avatar_url'>[]) {
      userLookup[u.id] = u
    }

    const items: CompletedRide[] = myRides.map((r) => ({
      ride: {
        id: r.id,
        rider_id: r.rider_id as string,
        fare_cents: r.fare_cents,
        destination_name: r.destination_name,
      },
      rider:
        userLookup[r.rider_id as string] ??
        { id: r.rider_id as string, full_name: 'Rider', avatar_url: null },
    }))

    setCompletedRides(items)
    setLoading(false)
  }, [scheduleId, currentUserId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  if (loading) {
    return (
      <div
        data-testid={testId}
        className="flex min-h-dvh items-center justify-center bg-surface"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (completedRides.length === 0) {
    return (
      <div
        data-testid={testId}
        className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6"
      >
        <p className="text-center text-text-secondary">No completed rides found</p>
        <button
          type="button"
          onClick={() => navigate('/home/driver', { replace: true })}
          className="rounded-2xl bg-primary px-6 py-3 font-semibold text-white"
          data-testid="back-home-button"
        >
          Back to Home
        </button>
      </div>
    )
  }

  const totalCents = completedRides.reduce((acc, cr) => acc + (cr.ride.fare_cents ?? 0), 0)
  const ridersLabel = completedRides.length === 1 ? '1 rider' : `${completedRides.length} riders`

  return (
    <div data-testid={testId} className="flex min-h-dvh flex-col bg-surface">
      {/* Header — mirrors iOS tripCompleteHeader (lines 60-93) */}
      <div
        className="flex items-center gap-3 border-b border-border bg-white px-4 py-3"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)' }}
      >
        <button
          type="button"
          onClick={() => navigate('/home/driver', { replace: true })}
          aria-label="Back"
          data-testid="trip-complete-back"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-text-primary active:scale-95 transition-transform"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex flex-col">
          <h1 className="text-base font-bold text-text-primary">Trip complete</h1>
          <p className="text-xs text-text-secondary">All riders dropped off</p>
        </div>
      </div>

      {/* Scrolling content */}
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
        {/* Hero — mirrors iOS tripCompleteHero (lines 95-135) */}
        <section
          data-testid="trip-complete-hero"
          className="flex flex-col items-center gap-2 rounded-3xl bg-white px-4 py-6 shadow-sm"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-8 w-8 text-success"
              aria-hidden="true"
            >
              {/* SF Symbol "checkmark.seal.fill" equivalent */}
              <path d="M12 1l3 2 3.5-1L19 5l3 2-1 3.5 1 3.5-3 2-.5 3.5-3.5-1-3 2-3-2-3.5 1L5 15l-3-2 1-3.5L2 6l3-2 .5-3.5L9 1.5 12 1zm-1.2 14.2l5.6-5.6L15 8.2l-4.2 4.2L9 10.6 7.6 12l3.2 3.2z" />
            </svg>
          </div>
          <h2 className="text-[22px] font-extrabold tracking-tight text-text-primary">
            All riders dropped off
          </h2>
          <p
            data-testid="trip-complete-total"
            className="text-[36px] font-extrabold tracking-tight text-text-primary tabular-nums"
          >
            {formatCents(totalCents)}
          </p>
          <p className="text-xs text-text-secondary">from {ridersLabel}</p>
        </section>

        {/* Per-rider list — mirrors iOS perRiderList (lines 137-173) */}
        <section className="flex flex-col gap-2">
          <h3 className="px-2 text-[11px] font-extrabold uppercase tracking-wider text-text-secondary">
            PER-RIDER SUMMARY
          </h3>
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            {completedRides.map((cr, idx) => {
              const isLast = idx === completedRides.length - 1
              return (
                <div key={cr.ride.id} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => navigate(`/ride/summary/${cr.ride.id}`)}
                    data-testid={`trip-complete-row-${cr.ride.id}`}
                    className="flex items-center gap-3 px-4 py-3 text-left active:bg-surface transition-colors"
                  >
                    {/* Avatar — iOS tripCompleteAvatar (lines 209-236) */}
                    {cr.rider.avatar_url != null && cr.rider.avatar_url.length > 0 ? (
                      <img
                        src={cr.rider.avatar_url}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary"
                      >
                        {initials(cr.rider.full_name)}
                      </div>
                    )}

                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-bold text-text-primary">
                        {cr.rider.full_name ?? 'Rider'}
                      </span>
                      {cr.ride.destination_name != null && cr.ride.destination_name.length > 0 && (
                        <span className="truncate text-xs text-text-secondary">
                          {cr.ride.destination_name}
                        </span>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {cr.ride.fare_cents != null && (
                        <span className="text-sm font-bold text-success tabular-nums">
                          {formatCents(cr.ride.fare_cents)}
                        </span>
                      )}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3 w-3 text-text-secondary"
                        aria-hidden="true"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </div>
                  </button>
                  {!isLast && <div className="ml-[60px] border-t border-border" />}
                </div>
              )
            })}
          </div>
        </section>

        {/* Done button */}
        <button
          type="button"
          onClick={() => navigate('/home/driver', { replace: true })}
          data-testid="done-button"
          className="w-full rounded-2xl bg-primary py-3 text-base font-bold text-white active:scale-[0.99] transition-transform"
        >
          Done
        </button>
      </div>
    </div>
  )
}
