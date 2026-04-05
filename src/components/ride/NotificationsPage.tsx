import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import AppIcon from '@/components/ui/AppIcon'
import type { AppIconName } from '@/components/ui/AppIcon'

interface NotificationItem {
  id: string
  user_id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  is_read: boolean
  created_at: string
}

interface NotificationsPageProps {
  'data-testid'?: string
}

/** Format "2026-03-15T10:30:00Z" → "Mar 15, 10:30 AM" */
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

async function fetchNotifications(): Promise<NotificationItem[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const resp = await fetch('/api/notifications', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!resp.ok) throw new Error('Failed to fetch notifications')
  const body = await resp.json() as { notifications: NotificationItem[] }
  return body.notifications
}

export default function NotificationsPage({
  'data-testid': testId = 'notifications-page',
}: NotificationsPageProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [actioningId, setActioningId] = useState<string | null>(null)

  const { data: notifications = [], isLoading: loading } = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
  })

  // Mark all as read on mount (fire-and-forget side effect)
  useEffect(() => {
    async function markAllRead() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        await fetch('/api/notifications/read-all', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
        })
        // Invalidate unread-count badge in other pages
        void queryClient.invalidateQueries({ queryKey: ['unread-count'] })
      } catch {
        // non-fatal
      }
    }
    void markAllRead()
  }, [queryClient])

  const acceptMutation = useMutation({
    mutationFn: async (notif: NotificationItem) => {
      const rideId = notif.data['ride_id'] as string | undefined
      if (!rideId) throw new Error('No ride_id')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const res = await fetch('/api/schedule/accept-board', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ride_id: rideId }),
      })
      if (!res.ok) throw new Error('Failed to accept')
      return rideId
    },
    onMutate: (notif) => {
      setActioningId(notif.id)
      // Optimistic remove
      queryClient.setQueryData<NotificationItem[]>(['notifications'], (prev) =>
        (prev ?? []).filter((n) => n.id !== notif.id)
      )
    },
    onSuccess: (rideId) => {
      navigate(`/ride/messaging/${rideId}`, { replace: true })
    },
    onSettled: () => setActioningId(null),
  })

  const declineMutation = useMutation({
    mutationFn: async (notif: NotificationItem) => {
      const rideId = notif.data['ride_id'] as string | undefined
      if (!rideId) throw new Error('No ride_id')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      await fetch('/api/schedule/decline-board', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ride_id: rideId }),
      })
    },
    onMutate: (notif) => {
      setActioningId(notif.id)
      // Optimistic remove
      queryClient.setQueryData<NotificationItem[]>(['notifications'], (prev) =>
        (prev ?? []).filter((n) => n.id !== notif.id)
      )
    },
    onSettled: () => setActioningId(null),
  })

  // Handle tapping on accepted/declined notifications
  function handleTap(notif: NotificationItem) {
    const rideId = notif.data['ride_id'] as string | undefined
    if (!rideId) return

    if (notif.type === 'board_accepted' || notif.type === 'ride_reminder' || notif.type === 'ride_missed') {
      navigate(`/ride/messaging/${rideId}`)
    } else if (notif.type === 'ride_request') {
      navigate(`/ride/suggestion/${rideId}`, {
        state: {
          riderName: notif.data['rider_name'] as string | undefined,
          destination: notif.data['destination'] as string | undefined,
          distanceKm: notif.data['distance_km'] as string | undefined,
          estimatedEarnings: notif.data['estimated_earnings_cents'] as string | undefined,
          originLat: notif.data['origin_lat'] as string | undefined,
          originLng: notif.data['origin_lng'] as string | undefined,
          destinationLat: notif.data['destination_lat'] as string | undefined,
          destinationLng: notif.data['destination_lng'] as string | undefined,
        },
      })
    }
  }

  function getIconConfig(type: string): { name: AppIconName; color: string } {
    switch (type) {
      case 'board_request':
      case 'board_request_actioned': return { name: 'clipboard', color: 'text-primary' }
      case 'board_accepted':         return { name: 'check-circle', color: 'text-success' }
      case 'board_declined':         return { name: 'x-circle', color: 'text-danger' }
      case 'ride_reminder':          return { name: 'bell', color: 'text-warning' }
      case 'ride_missed':            return { name: 'x-circle', color: 'text-warning' }
      case 'ride_request':           return { name: 'car-request', color: 'text-primary' }
      default:                       return { name: 'bell', color: 'text-text-secondary' }
    }
  }

  return (
    <div
      data-testid={testId}
      className="flex min-h-dvh flex-col bg-surface font-sans"
    >
      {/* Header with back button */}
      <div
        className="bg-white border-b border-border px-4 pb-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
      >
        <div className="flex items-center gap-3">
          <button
            data-testid="back-button"
            onClick={() => navigate(-1)}
            className="p-1 shrink-0 text-text-primary active:opacity-60"
            aria-label="Go back"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="m12 5-7 7 7 7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Notifications</h1>
            <p className="text-xs text-text-secondary mt-0.5">Ride requests, offers & updates</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {!loading && notifications.length === 0 && (
          <div className="text-center py-16 px-6">
            <div className="flex justify-center mb-3"><div className="h-14 w-14 rounded-full bg-surface flex items-center justify-center"><AppIcon name="bell" className="h-7 w-7 text-text-secondary" /></div></div>
            <p className="text-text-secondary text-sm">No notifications yet</p>
            <p className="text-text-secondary text-xs mt-1">
              When someone requests your posted ride or offers to drive you, it will appear here.
            </p>
          </div>
        )}

        {!loading && notifications.length > 0 && (
          <div className="divide-y divide-border">
            {notifications.filter((notif) => {
              // Hide ride_request notifications older than 1 hour — the ride is
              // certainly no longer in 'requested' status by then.
              if (notif.type !== 'ride_request') return true
              return Date.now() - new Date(notif.created_at).getTime() < 60 * 60 * 1000
            }).map((notif) => {
              const isBoardRequest = notif.type === 'board_request'
              const isActioned = notif.type === 'board_request_actioned'
              const isAccepted = notif.type === 'board_accepted'
              const isReminder = notif.type === 'ride_reminder'
              const route = notif.data['route'] as string | undefined
              const tripDate = notif.data['trip_date'] as string | undefined
              const isActioning = actioningId === notif.id

              return (
                <div
                  key={notif.id}
                  data-testid="notification-item"
                  className={[
                    'px-4 py-4',
                    !notif.is_read ? 'bg-primary/5' : 'bg-white',
                    (isAccepted || isReminder) ? 'cursor-pointer active:bg-surface' : '',
                  ].join(' ')}
                  onClick={() => { if (!isBoardRequest && !isActioned) handleTap(notif) }}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface">
                      <AppIcon name={getIconConfig(notif.type).name} className={`h-5 w-5 ${getIconConfig(notif.type).color}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-text-primary">{notif.title}</p>
                        <span className="text-[10px] text-text-secondary shrink-0 ml-2">
                          {formatTimestamp(notif.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-text-secondary mt-0.5">{notif.body}</p>

                      {/* Route info for board requests */}
                      {route && (
                        <p className="text-xs text-text-secondary mt-1.5 truncate">
                          📍 {route}
                          {tripDate && ` · ${new Date(tripDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                        </p>
                      )}

                      {/* Action buttons for board_request */}
                      {isBoardRequest && (
                        <div className="flex gap-2 mt-3">
                          <button
                            data-testid="notif-accept-button"
                            disabled={isActioning}
                            onClick={(e) => { e.stopPropagation(); acceptMutation.mutate(notif) }}
                            className="flex-1 rounded-2xl bg-success py-2.5 text-sm font-semibold text-white active:opacity-90 disabled:opacity-50"
                          >
                            {isActioning ? 'Accepting…' : 'Accept'}
                          </button>
                          <button
                            data-testid="notif-decline-button"
                            disabled={isActioning}
                            onClick={(e) => { e.stopPropagation(); declineMutation.mutate(notif) }}
                            className="flex-1 rounded-2xl border-2 border-danger/30 bg-danger/5 py-2.5 text-sm font-semibold text-danger active:bg-danger/10 disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </div>
                      )}

                      {/* Already responded badge for actioned notifications */}
                      {isActioned && (
                        <p className="text-xs text-text-secondary font-medium mt-2">Already responded</p>
                      )}

                      {/* Tap hint for accepted */}
                      {isAccepted && (
                        <p className="text-xs text-primary font-medium mt-2">Tap to open messaging →</p>
                      )}

                      {/* Tap hint for ride reminder */}
                      {isReminder && (
                        <p className="text-xs text-warning font-medium mt-2">Tap to navigate to pickup →</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
