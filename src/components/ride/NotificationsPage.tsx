import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

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

export default function NotificationsPage({
  'data-testid': testId = 'notifications-page',
}: NotificationsPageProps) {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actioningId, setActioningId] = useState<string | null>(null)

  const fetchNotifications = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch('/api/notifications', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (resp.ok) {
        const body = (await resp.json()) as { notifications: NotificationItem[] }
        setNotifications(body.notifications)
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchNotifications()
  }, [fetchNotifications])

  // Mark all as read on mount
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
      } catch {
        // non-fatal
      }
    }
    void markAllRead()
  }, [])

  // Handle accept from a board_request notification
  const handleAccept = useCallback(async (notif: NotificationItem) => {
    const rideId = notif.data['ride_id'] as string | undefined
    if (!rideId || actioningId) return
    setActioningId(notif.id)

    // Optimistically remove from local state before navigating
    setNotifications((prev) => prev.filter((n) => n.id !== notif.id))

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch('/api/schedule/accept-board', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ride_id: rideId }),
      })

      if (res.ok) {
        navigate(`/ride/messaging/${rideId}`, { replace: true })
      }
    } catch {
      // non-fatal
    } finally {
      setActioningId(null)
    }
  }, [actioningId, navigate])

  // Handle decline from a board_request notification
  const handleDecline = useCallback(async (notif: NotificationItem) => {
    const rideId = notif.data['ride_id'] as string | undefined
    if (!rideId || actioningId) return
    setActioningId(notif.id)

    // Remove from list optimistically
    setNotifications((prev) => prev.filter((n) => n.id !== notif.id))

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      await fetch('/api/schedule/decline-board', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ride_id: rideId }),
      })
    } catch {
      // non-fatal
    } finally {
      setActioningId(null)
    }
  }, [actioningId])

  // Handle tapping on accepted/declined notifications
  const handleTap = useCallback((notif: NotificationItem) => {
    const rideId = notif.data['ride_id'] as string | undefined
    if (!rideId) return

    if (notif.type === 'board_accepted') {
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
  }, [navigate])

  function getIcon(type: string): string {
    switch (type) {
      case 'board_request': return '📋'
      case 'board_request_actioned': return '📋'
      case 'board_accepted': return '✅'
      case 'board_declined': return '❌'
      case 'ride_request': return '🚗'
      default: return '🔔'
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
            <p className="text-4xl mb-3">🔔</p>
            <p className="text-text-secondary text-sm">No notifications yet</p>
            <p className="text-text-secondary text-xs mt-1">
              When someone requests your posted ride or offers to drive you, it will appear here.
            </p>
          </div>
        )}

        {!loading && notifications.length > 0 && (
          <div className="divide-y divide-border">
            {notifications.map((notif) => {
              const isBoardRequest = notif.type === 'board_request'
              const isActioned = notif.type === 'board_request_actioned'
              const isAccepted = notif.type === 'board_accepted'
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
                    isAccepted ? 'cursor-pointer active:bg-surface' : '',
                  ].join(' ')}
                  onClick={() => { if (!isBoardRequest && !isActioned) handleTap(notif) }}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-lg">
                      {getIcon(notif.type)}
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
                            onClick={(e) => { e.stopPropagation(); void handleAccept(notif) }}
                            className="flex-1 rounded-2xl bg-success py-2.5 text-sm font-semibold text-white active:opacity-90 disabled:opacity-50"
                          >
                            {isActioning ? 'Accepting…' : 'Accept'}
                          </button>
                          <button
                            data-testid="notif-decline-button"
                            disabled={isActioning}
                            onClick={(e) => { e.stopPropagation(); void handleDecline(notif) }}
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
