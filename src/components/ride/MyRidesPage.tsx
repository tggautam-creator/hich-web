import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import BottomNav from '@/components/ui/BottomNav'
import AppIcon from '@/components/ui/AppIcon'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OtherUser {
  id: string
  full_name: string | null
  avatar_url: string | null
  rating_avg: number | null
}

interface Schedule {
  user_id?: string
  mode?: 'driver' | 'rider'
  origin_address: string
  dest_address: string
  trip_date: string
  trip_time: string
  time_type: 'departure' | 'arrival'
}

interface ActiveRide {
  id: string
  rider_id: string
  driver_id: string | null
  status: string
  schedule_id: string | null
  destination_name: string | null
  trip_date: string | null
  trip_time: string | null
  created_at: string
  my_role: 'rider' | 'driver'
  other_user: OtherUser | null
  schedule: Schedule | null
}

interface MultiRiderGroup {
  schedule_id: string
  rides: ActiveRide[]
  schedule: Schedule | null
}

interface MyRidesPageProps {
  'data-testid'?: string
}

/** Format "14:30:00" → "2:30 PM" */
function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number)
  if (h === undefined || m === undefined) return timeStr
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

/** Format "2026-03-15" → "Mar 15" */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getStatusBadge(status: string, myRole: 'rider' | 'driver', isScheduled?: boolean): { label: string; className: string } {
  switch (status) {
    case 'requested':
      return myRole === 'rider'
        ? { label: 'Waiting for Response', className: 'bg-surface text-text-secondary' }
        : { label: 'Pending Request', className: 'bg-warning/10 text-warning' }
    case 'accepted':
      return { label: 'Coordinating', className: 'bg-primary/10 text-primary' }
    case 'coordinating':
      return isScheduled
        ? { label: 'Ride Confirmed', className: 'bg-success/10 text-success' }
        : { label: 'En Route to Pickup', className: 'bg-warning/10 text-warning' }
    case 'active':
      return { label: 'In Progress', className: 'bg-success/10 text-success' }
    default:
      return { label: status, className: 'bg-surface text-text-secondary' }
  }
}

// ── Query functions ────────────────────────────────────────────────────────────

async function fetchActiveRides(): Promise<ActiveRide[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const resp = await fetch('/api/rides/active', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!resp.ok) throw new Error('Failed to fetch rides')
  const body = await resp.json() as { rides: ActiveRide[] }
  return body.rides
}

async function fetchUnreadCount(): Promise<number> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return 0
  const resp = await fetch('/api/notifications/unread-count', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!resp.ok) return 0
  const body = await resp.json() as { count: number }
  return body.count
}

/**
 * Cancel an active ride from MyRides. Routes to the correct endpoint:
 *
 *   - **Board requests** (`status='requested' && schedule_id != null` — the
 *     requester opened a request on someone's posted ride) go to
 *     `PATCH /api/schedule/withdraw-board`. The instant `/cancel` endpoint
 *     leaves these rows in `requested` indefinitely from the rider's POV
 *     because Path B's permanent-cancel branch was written for instant
 *     rides only. iOS already routes this correctly via
 *     `ActiveRideSheet.cancel(_:)` (see WEB_PARITY_REPORT W-T0-1).
 *   - **Everything else** (accepted/coordinating/active instant rides, or
 *     scheduled rides past the requested phase) goes through
 *     `PATCH /api/rides/:id/cancel`.
 */
async function cancelRide(ride: { id: string; status: string; schedule_id: string | null }): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const isPendingBoardRequest = ride.status === 'requested' && ride.schedule_id !== null
  const resp = isPendingBoardRequest
    ? await fetch('/api/schedule/withdraw-board', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ ride_id: ride.id }),
    })
    : await fetch(`/api/rides/${ride.id}/cancel`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })

  if (!resp.ok) throw new Error('Failed to cancel ride')
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MyRidesPage({
  'data-testid': testId = 'my-rides-page',
}: MyRidesPageProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const profile = useAuthStore((s) => s.profile)

  const { data: rides = [], isLoading: loading } = useQuery({
    queryKey: ['active-rides'],
    queryFn: fetchActiveRides,
  })

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['unread-count'],
    queryFn: fetchUnreadCount,
  })

  const cancelMutation = useMutation({
    mutationFn: cancelRide,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['active-rides'] })
    },
  })

  // Realtime + visibility: invalidate queries when ride status changes
  useEffect(() => {
    if (!profile?.id) return

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void queryClient.invalidateQueries({ queryKey: ['active-rides'] })
      }
    }
    const handleFocus = () => void queryClient.invalidateQueries({ queryKey: ['active-rides'] })
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)

    const ridesChannel = supabase.channel(`myrides:${profile.id}`)
    ridesChannel.on('broadcast', { event: 'ride_status_changed' }, () => {
      void queryClient.invalidateQueries({ queryKey: ['active-rides'] })
    })
    ridesChannel.subscribe()

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
      supabase.removeChannel(ridesChannel)
    }
  }, [profile?.id, queryClient])

  // True when the current user is the original board poster and a driver/
  // rider on the other side has responded with an offer that needs the
  // poster's accept/decline. Without this branch the card is a dead-end —
  // the ride sits in 'requested' status with no path to the review page.
  function isOfferAwaitingMyResponse(ride: ActiveRide): boolean {
    if (ride.status !== 'requested') return false
    if (!ride.schedule_id || !ride.schedule) return false
    return ride.schedule.user_id === profile?.id
  }

  function handleTapRide(ride: ActiveRide) {
    const isRider = ride.my_role === 'rider'
    switch (ride.status) {
      case 'requested':
        if (isOfferAwaitingMyResponse(ride)) {
          navigate(`/ride/board-review/${ride.id}`)
        } else if (!isRider) {
          navigate('/notifications')
        }
        break
      case 'accepted':
        navigate(`/ride/messaging/${ride.id}`)
        break
      case 'coordinating':
        navigate(`/ride/messaging/${ride.id}`)
        break
      case 'active':
        navigate(isRider ? `/ride/active-rider/${ride.id}` : `/ride/active-driver/${ride.id}`)
        break
    }
  }

  function handleTapGroup(group: MultiRiderGroup) {
    // Use the most progressed ride's status to decide navigation
    const statusOrder = ['active', 'coordinating', 'accepted', 'requested']
    const lead = group.rides.sort(
      (a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status),
    )[0]
    if (!lead) return
    if (lead.status === 'active') {
      navigate(`/ride/driver-multi/${group.schedule_id}`)
    } else {
      navigate(`/ride/driver-multi/${group.schedule_id}`)
    }
  }

  // Group driver rides that share a schedule_id (multi-rider trips)
  const driverGroups = new Map<string, MultiRiderGroup>()
  const ungroupedRides: ActiveRide[] = []

  for (const ride of rides) {
    if (ride.my_role === 'driver' && ride.schedule_id) {
      const existing = driverGroups.get(ride.schedule_id)
      if (existing) {
        existing.rides.push(ride)
      } else {
        driverGroups.set(ride.schedule_id, {
          schedule_id: ride.schedule_id,
          rides: [ride],
          schedule: ride.schedule,
        })
      }
    } else {
      ungroupedRides.push(ride)
    }
  }

  // Flatten: multi-rider groups + ungrouped rides, sorted by created_at descending
  type ListItem = { type: 'group'; group: MultiRiderGroup } | { type: 'single'; ride: ActiveRide }
  const listItems: ListItem[] = [
    ...Array.from(driverGroups.values()).map((g): ListItem => ({ type: 'group', group: g })),
    ...ungroupedRides.map((r): ListItem => ({ type: 'single', ride: r })),
  ]

  return (
    <div
      data-testid={testId}
      className="flex min-h-dvh flex-col bg-surface font-sans"
    >
      {/* Header */}
      <div
        className="bg-white border-b border-border px-4 pb-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-text-primary">My Rides</h1>
            <p className="text-xs text-text-secondary mt-0.5">Upcoming & active rides</p>
          </div>

          {/* Bell icon for notifications */}
          <button
            data-testid="notifications-bell"
            onClick={() => navigate('/notifications')}
            aria-label="Notifications"
            className="relative p-2 rounded-full hover:bg-surface transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-text-primary" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span
                data-testid="unread-badge"
                className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {!loading && rides.length === 0 && (
          <div className="text-center py-16 px-6">
            <div className="flex justify-center mb-3"><div className="h-14 w-14 rounded-full bg-surface flex items-center justify-center"><AppIcon name="car-request" className="h-7 w-7 text-text-secondary" /></div></div>
            <p className="text-text-secondary text-sm font-medium">No active rides</p>
            <p className="text-text-secondary text-xs mt-1">
              Request a ride or browse the ride board to get started.
            </p>
            <button
              data-testid="browse-board-button"
              onClick={() => navigate('/rides/board')}
              className="mt-4 px-6 py-3 bg-primary text-white font-semibold rounded-2xl text-sm"
            >
              Browse upcoming rides
            </button>
          </div>
        )}

        {!loading && rides.length > 0 && (
          <div className="space-y-3">
            {listItems.map((item) => {
              if (item.type === 'group') {
                const { group } = item
                const sched = group.schedule
                const tripDate = sched?.trip_date
                const tripTime = sched?.trip_time
                // Worst-case status badge: prefer active > coordinating > accepted > requested
                const statusOrder = ['active', 'coordinating', 'accepted', 'requested']
                const worstStatus = group.rides.reduce((best, r) => {
                  return statusOrder.indexOf(r.status) < statusOrder.indexOf(best) ? r.status : best
                }, group.rides[0]?.status ?? 'requested')
                const badge = getStatusBadge(worstStatus, 'driver', true)
                const riderNames = group.rides
                  .map((r) => r.other_user?.full_name ?? 'Rider')
                  .join(' & ')

                return (
                  <button
                    key={group.schedule_id}
                    data-testid="ride-card-group"
                    onClick={() => handleTapGroup(group)}
                    className="w-full rounded-2xl bg-white p-4 shadow-sm border border-border text-left active:bg-surface/50 transition-colors"
                  >
                    {/* Top: multi-rider label + badge */}
                    <div className="flex items-center gap-3 mb-3">
                      {/* Stacked avatars */}
                      <div className="relative h-11 w-14 shrink-0">
                        {group.rides.slice(0, 2).map((r, i) => {
                          const u = r.other_user
                          const init = u?.full_name?.[0]?.toUpperCase() ?? '?'
                          return u?.avatar_url ? (
                            <img
                              key={r.id}
                              src={u.avatar_url}
                              alt=""
                              className={`absolute h-9 w-9 rounded-full object-cover border-2 border-white ${i === 0 ? 'left-0 top-0' : 'left-4 top-2'}`}
                            />
                          ) : (
                            <div
                              key={r.id}
                              className={`absolute flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 border-2 border-white text-primary font-bold text-xs ${i === 0 ? 'left-0 top-0' : 'left-4 top-2'}`}
                            >
                              {init}
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate">
                          {riderNames}
                        </p>
                        <p className="text-xs text-text-secondary">
                          You are the driver · {group.rides.length} riders
                        </p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>

                    {/* Route */}
                    {sched && (
                      <div className="mb-2 space-y-1">
                        <div className="flex items-start gap-2">
                          <span className="text-success mt-0.5 text-xs">●</span>
                          <p className="text-xs text-text-primary truncate">{sched.origin_address}</p>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-danger mt-0.5 text-xs">●</span>
                          <p className="text-xs text-text-primary truncate">{sched.dest_address}</p>
                        </div>
                      </div>
                    )}

                    {/* Date / time */}
                    {(tripDate ?? tripTime) && (
                      <div className="flex items-center gap-3 text-xs text-text-secondary mb-2">
                        {tripDate && <span>{formatDate(tripDate)}</span>}
                        {tripTime && <span>{formatTime(tripTime)}</span>}
                      </div>
                    )}

                    {/* Per-rider status pills */}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {group.rides.map((r) => {
                        const rb = getStatusBadge(r.status, 'driver', true)
                        return (
                          <span key={r.id} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${rb.className}`}>
                            {r.other_user?.full_name?.split(' ')[0] ?? 'Rider'}: {rb.label}
                          </span>
                        )
                      })}
                    </div>

                    <p className="text-xs text-primary font-medium">Tap to manage riders →</p>
                  </button>
                )
              }

              // Single ride card
              const { ride } = item
              const other = ride.other_user
              const initial = other?.full_name?.[0]?.toUpperCase() ?? '?'
              const badge = getStatusBadge(ride.status, ride.my_role, !!ride.schedule)
              const sched = ride.schedule
              const tripDate = sched?.trip_date ?? ride.trip_date
              const tripTime = sched?.trip_time ?? ride.trip_time

              return (
                <button
                  key={ride.id}
                  data-testid="ride-card"
                  onClick={() => handleTapRide(ride)}
                  className="w-full rounded-2xl bg-white p-4 shadow-sm border border-border text-left active:bg-surface/50 transition-colors"
                >
                  {/* Top: other user + status badge */}
                  <div className="flex items-center gap-3 mb-3">
                    {other?.avatar_url ? (
                      <img
                        src={other.avatar_url}
                        alt=""
                        className="h-11 w-11 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                        {initial}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">
                        {other?.full_name ?? (ride.my_role === 'rider' ? 'Driver' : 'Rider')}
                      </p>
                      <p className="text-xs text-text-secondary">
                        You are the {ride.my_role}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>

                  {/* Route info */}
                  {sched && (
                    <div className="mb-2 space-y-1">
                      <div className="flex items-start gap-2">
                        <span className="text-success mt-0.5 text-xs">●</span>
                        <p className="text-xs text-text-primary truncate">{sched.origin_address}</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-danger mt-0.5 text-xs">●</span>
                        <p className="text-xs text-text-primary truncate">{sched.dest_address}</p>
                      </div>
                    </div>
                  )}

                  {!sched && ride.destination_name && (
                    <div className="mb-2 flex items-start gap-2">
                      <span className="text-danger mt-0.5 text-xs">●</span>
                      <p className="text-xs text-text-primary truncate">{ride.destination_name}</p>
                    </div>
                  )}

                  {/* Date / time */}
                  {(tripDate ?? tripTime) && (
                    <div className="flex items-center gap-3 text-xs text-text-secondary">
                      {tripDate && <span>{formatDate(tripDate)}</span>}
                      {tripTime && <span>{formatTime(tripTime)}</span>}
                    </div>
                  )}

                  {/* Tap hint */}
                  <p className="text-xs text-primary font-medium mt-2">
                    {isOfferAwaitingMyResponse(ride) ? "Tap to review driver's offer →" :
                     ride.status === 'requested' && ride.my_role === 'rider' ? 'Waiting for poster to respond…' :
                     ride.status === 'requested' ? 'Tap to accept or decline →' :
                     ride.status === 'accepted' ? 'Tap to open messaging →' :
                     ride.status === 'coordinating' ? 'Tap to open messaging →' :
                     'Tap to view ride →'}
                  </p>

                  {ride.status === 'requested' && ride.my_role === 'rider' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {isOfferAwaitingMyResponse(ride) && (
                        <button
                          data-testid="review-offer-button"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/ride/board-review/${ride.id}`)
                          }}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white active:opacity-90"
                        >
                          Review Offer
                        </button>
                      )}
                      <button
                        data-testid="cancel-requested-ride-button"
                        onClick={(e) => {
                          e.stopPropagation()
                          cancelMutation.mutate({
                            id: ride.id,
                            status: ride.status,
                            schedule_id: ride.schedule_id,
                          })
                        }}
                        className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-1.5 text-xs font-semibold text-danger"
                      >
                        Cancel Request
                      </button>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Link to ride history */}
        {!loading && (
          <button
            data-testid="ride-history-link"
            onClick={() => navigate('/rides/history')}
            className="mt-6 w-full text-center text-sm text-text-secondary font-medium py-3"
          >
            View ride history →
          </button>
        )}
      </div>

      <BottomNav activeTab="rides" />
    </div>
  )
}
