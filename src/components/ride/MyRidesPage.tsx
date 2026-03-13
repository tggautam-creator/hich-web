import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import BottomNav from '@/components/ui/BottomNav'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OtherUser {
  id: string
  full_name: string | null
  avatar_url: string | null
  rating_avg: number | null
}

interface Schedule {
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
  destination_name: string | null
  trip_date: string | null
  trip_time: string | null
  created_at: string
  my_role: 'rider' | 'driver'
  other_user: OtherUser | null
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function MyRidesPage({
  'data-testid': testId = 'my-rides-page',
}: MyRidesPageProps) {
  const navigate = useNavigate()
  const [rides, setRides] = useState<ActiveRide[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchRides = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch('/api/rides/active', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (resp.ok) {
        const body = (await resp.json()) as { rides: ActiveRide[] }
        setRides(body.rides)
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch unread notification count for bell badge
  const fetchUnread = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch('/api/notifications/unread-count', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (resp.ok) {
        const body = (await resp.json()) as { count: number }
        setUnreadCount(body.count)
      }
    } catch {
      // non-fatal
    }
  }, [])

  useEffect(() => {
    void fetchRides()
    void fetchUnread()
  }, [fetchRides, fetchUnread])

  // Realtime: refresh rides when status changes (cancellation, acceptance, etc.)
  const profile = useAuthStore((s) => s.profile)
  useEffect(() => {
    if (!profile?.id) return

    // Refresh when page becomes visible (covers navigating back after cancel)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void fetchRides()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', () => void fetchRides())

    // Realtime: listen on dedicated MyRides channels
    // Server broadcasts to rider:/driver:/board: channels — we use separate names
    // and also have the server broadcast ride_status_changed to these.
    const ridesChannel = supabase.channel(`myrides:${profile.id}`)
    ridesChannel.on('broadcast', { event: 'ride_status_changed' }, () => {
      void fetchRides()
    })
    ridesChannel.subscribe()

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      supabase.removeChannel(ridesChannel)
    }
  }, [profile?.id, fetchRides])

  function handleTapRide(ride: ActiveRide) {
    const isRider = ride.my_role === 'rider'
    switch (ride.status) {
      case 'requested':
        // Poster sees notification page; requester just waits
        if (!isRider) navigate('/notifications')
        break
      case 'accepted':
        navigate(`/ride/messaging/${ride.id}`)
        break
      case 'coordinating':
        // Both locations confirmed — always go to messaging first
        // (messaging has "Navigate to Pickup" button for both roles)
        navigate(`/ride/messaging/${ride.id}`)
        break
      case 'active':
        navigate(isRider ? `/ride/active-rider/${ride.id}` : `/ride/active-driver/${ride.id}`)
        break
    }
  }

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
            <p className="text-4xl mb-3">🚗</p>
            <p className="text-text-secondary text-sm font-medium">No active rides</p>
            <p className="text-text-secondary text-xs mt-1">
              Request a ride or browse the ride board to get started.
            </p>
            <button
              data-testid="browse-board-button"
              onClick={() => navigate('/rides/board')}
              className="mt-4 px-6 py-3 bg-primary text-white font-semibold rounded-xl text-sm"
            >
              Browse Ride Board
            </button>
          </div>
        )}

        {!loading && rides.length > 0 && (
          <div className="space-y-3">
            {rides.map((ride) => {
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
                    {ride.status === 'requested' && ride.my_role === 'rider' ? 'Waiting for poster to respond…' :
                     ride.status === 'requested' ? 'Tap to accept or decline →' :
                     ride.status === 'accepted' ? 'Tap to open messaging →' :
                     ride.status === 'coordinating' ? 'Tap to open messaging →' :
                     'Tap to view ride →'}
                  </p>
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
