import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { onForegroundMessage } from '@/lib/fcm'
import { formatCents } from '@/lib/fare'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

// ── Dismiss callback ref (stable across renders) ──────────────────────────────

/** Payload shape sent by the ride request push. */
interface RideRequestData {
  type: 'ride_request'
  ride_id: string
  rider_name?: string
  destination?: string
  distance_km?: string
  estimated_earnings_cents?: string
  origin_lat?: string
  origin_lng?: string
  destination_lat?: string
  destination_lng?: string
}

/** Payload shape sent by the board request push. */
interface BoardRequestData {
  type: 'board_request'
  ride_id: string
  requester_name?: string
  route?: string
  trip_date?: string
  trip_time?: string
}

/** Payload shape for ride cancellation. */
interface RideCancelledData {
  type: 'ride_cancelled'
  ride_id: string
  cancelled_by?: string
}

/** Payload shape sent when a board request is accepted. */
interface BoardAcceptedData {
  type: 'board_accepted'
  ride_id: string
}

interface NotificationState {
  rideId: string
  riderName: string
  destination: string
  distanceKm: string
  estimatedEarnings: string
  originLat: string
  originLng: string
  destinationLat: string
  destinationLng: string
  /** When true, navigate to board-review instead of ride suggestion */
  isBoardRequest?: boolean
  /** When true, this is a re-notification after the selected driver cancelled — show standby screen */
  isRenewal?: boolean
}

interface InboxNotification {
  id: string
  type: string
  data: Record<string, unknown>
  created_at?: string
}

const DISMISS_SECONDS = 90

export default function RideRequestNotification({
  'data-testid': testId = 'ride-request-notification',
}: {
  'data-testid'?: string
}) {
  const navigate = useNavigate()
  const [notification, setNotification] = useState<NotificationState | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(DISMISS_SECONDS)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const dismiss = useCallback(() => {
    setNotification(null)
    setSecondsLeft(DISMISS_SECONDS)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const profile = useAuthStore((s) => s.profile)
  const isDriver = useAuthStore((s) => s.isDriver)
  const seenInboxNotifIdsRef = useRef<Set<string>>(new Set())
  // Track ride IDs already shown to prevent duplicate notifications from
  // Realtime, FCM, and polling all firing for the same ride.
  const seenRideIdsRef = useRef<Set<string>>(new Set())

  // Ref to track current rideId so the Realtime channel callback
  // always sees the latest value without re-creating the channel.
  const rideIdRef = useRef<string | null>(null)
  useEffect(() => {
    rideIdRef.current = notification?.rideId ?? null
  }, [notification?.rideId])

  // Handle incoming ride request data from any source
  const handleRideRequest = useCallback((data: RideRequestData, isRenewal?: boolean) => {
    // Deduplicate: skip if we've already shown a notification for this ride
    if (seenRideIdsRef.current.has(data.ride_id)) return
    seenRideIdsRef.current.add(data.ride_id)

    const earningsCents = parseInt(data.estimated_earnings_cents ?? '0', 10)
    setNotification({
      rideId: data.ride_id,
      riderName: data.rider_name ?? 'A rider',
      destination: data.destination ?? 'Nearby destination',
      distanceKm: data.distance_km ?? '–',
      estimatedEarnings: earningsCents > 0 ? formatCents(earningsCents) : '–',
      originLat: data.origin_lat ?? '',
      originLng: data.origin_lng ?? '',
      destinationLat: data.destination_lat ?? '',
      destinationLng: data.destination_lng ?? '',
      isRenewal: isRenewal ?? false,
    })
    setSecondsLeft(DISMISS_SECONDS)
  }, [])

  // Handle incoming board request (from ride board)
  const handleBoardRequest = useCallback((data: BoardRequestData) => {
    if (seenRideIdsRef.current.has(data.ride_id)) return
    seenRideIdsRef.current.add(data.ride_id)

    // Build a subtitle from route + trip info when available
    const routeLabel = data.route ?? ''
    const timeLabel = [data.trip_date, data.trip_time].filter(Boolean).join(' at ')
    const destination = routeLabel || timeLabel || ''

    setNotification({
      rideId: data.ride_id,
      riderName: data.requester_name ?? 'Someone',
      destination,
      distanceKm: '–',
      estimatedEarnings: '–',
      originLat: '',
      originLng: '',
      destinationLat: '',
      destinationLng: '',
      isBoardRequest: true,
    })
    setSecondsLeft(DISMISS_SECONDS)
  }, [])

  // Handle board request accepted — show toast and navigate to messaging
  const [acceptedToast, setAcceptedToast] = useState<{ rideId: string } | null>(null)
  const acceptedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleBoardAccepted = useCallback((data: BoardAcceptedData) => {
    setAcceptedToast({ rideId: data.ride_id })
    // Auto-dismiss after 10s
    if (acceptedTimerRef.current) clearTimeout(acceptedTimerRef.current)
    acceptedTimerRef.current = setTimeout(() => setAcceptedToast(null), 10000)
  }, [])

  // Cancelled toast — shown when the other party cancels the ride
  const [cancelledToast, setCancelledToast] = useState<{ cancelledBy: string } | null>(null)
  const cancelledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleRideCancelled = useCallback((data: RideCancelledData) => {
    // If we're showing a notification for this ride, dismiss it
    if (rideIdRef.current && rideIdRef.current === data.ride_id) {
      dismiss()
    }
    // Show cancellation toast
    setCancelledToast({ cancelledBy: data.cancelled_by ?? 'other party' })
    if (cancelledTimerRef.current) clearTimeout(cancelledTimerRef.current)
    cancelledTimerRef.current = setTimeout(() => setCancelledToast(null), 8000)
  }, [dismiss])

  // When WaitingRoom auto-selects this driver after a cancellation, navigate
  // them directly to DropoffSelection without needing to re-call /accept.
  const handleDriverSelected = useCallback(async (
    rideId: string,
    driverDestLat?: number | null,
    driverDestLng?: number | null,
    driverDestName?: string | null,
  ) => {
    dismiss()
    let lat = driverDestLat ?? null
    let lng = driverDestLng ?? null
    let name = driverDestName ?? null
    if (!lat || !lng) {
      // Payload didn't include coords (FCM path) — fetch from offer table first
      try {
        const { data: offer } = await supabase
          .from('ride_offers')
          .select('driver_destination, driver_destination_name')
          .eq('ride_id', rideId)
          .eq('driver_id', profile?.id ?? '')
          .single()
        if (offer?.driver_destination) {
          const geo = offer.driver_destination as { coordinates: [number, number] }
          lat = geo.coordinates[1]
          lng = geo.coordinates[0]
          name = (offer.driver_destination_name as string | null) ?? null
        }
      } catch { /* fall through */ }
    }
    if (!lat || !lng) {
      // Offer may not have destination yet (DB write race) — try the ride row.
      // /select-driver copies driver_destination from offer to ride synchronously.
      try {
        const { data: rideRow } = await supabase
          .from('rides')
          .select('driver_destination, driver_destination_name')
          .eq('id', rideId)
          .single()
        if (rideRow?.driver_destination) {
          const geo = rideRow.driver_destination as { coordinates: [number, number] }
          lat = geo.coordinates[1]
          lng = geo.coordinates[0]
          name = (rideRow.driver_destination_name as string | null) ?? null
        }
      } catch { /* fall through */ }
    }
    if (lat && lng) {
      navigate(`/ride/dropoff/${rideId}`, {
        replace: true,
        state: { driverDestLat: lat, driverDestLng: lng, driverDestName: name ?? '' },
      })
    } else {
      // No destination found — driver is selected but hasn't submitted one yet.
      // Send them to the suggestion form so they can enter their destination.
      navigate(`/ride/suggestion/${rideId}`, { replace: true })
    }
  }, [dismiss, profile?.id, navigate])

  // Primary: Supabase Realtime channel (works on all browsers)
  useEffect(() => {
    if (!profile?.id) return

    // Driver channel — only subscribe if user is a driver
    let channel: ReturnType<typeof supabase.channel> | null = null
    if (isDriver) {
      channel = supabase.channel(`driver:${profile.id}`)
      channel.on('broadcast', { event: 'ride_request' }, (msg) => {
        const data = msg.payload as unknown as RideRequestData
        if (data.type === 'ride_request') handleRideRequest(data)
      })
      channel.on('broadcast', { event: 'ride_cancelled' }, (msg) => {
        const data = msg.payload as { ride_id?: string }
        if (rideIdRef.current && rideIdRef.current === data.ride_id) {
          dismiss()
        }
      })
      channel.on('broadcast', { event: 'ride_standby' }, (msg) => {
        const data = msg.payload as { ride_id?: string }
        if (rideIdRef.current && rideIdRef.current === data.ride_id) {
          dismiss()
        }
      })
      channel.on('broadcast', { event: 'ride_request_renewed' }, (msg) => {
        const data = msg.payload as unknown as RideRequestData
        // Clear dedup guard so this ride can re-appear, then re-show notification
        if (data.ride_id) {
          seenRideIdsRef.current.delete(data.ride_id)
          handleRideRequest({ ...data, type: 'ride_request' }, true)
        }
      })
      channel.on('broadcast', { event: 'driver_selected' }, (msg) => {
        const data = msg.payload as {
          ride_id?: string
          driver_dest_lat?: number | null
          driver_dest_lng?: number | null
          driver_dest_name?: string | null
        }
        if (data.ride_id) {
          void handleDriverSelected(data.ride_id, data.driver_dest_lat, data.driver_dest_lng, data.driver_dest_name)
        }
      })
      channel.subscribe()
    }

    // Board channel — listens for ride board requests and acceptances
    const boardChannel = supabase.channel(`board:${profile.id}`)
    boardChannel.on('broadcast', { event: 'board_request' }, (msg) => {
      const data = msg.payload as unknown as BoardRequestData
      if (data.type === 'board_request') handleBoardRequest(data)
    })
    boardChannel.on('broadcast', { event: 'board_accepted' }, (msg) => {
      const data = msg.payload as unknown as BoardAcceptedData
      if (data.type === 'board_accepted') handleBoardAccepted(data)
    })
    boardChannel.subscribe()

    // Rider channel — listens for ride cancellations (when driver cancels)
    const riderChannel = supabase.channel(`rider:${profile.id}`)
    riderChannel.on('broadcast', { event: 'ride_cancelled' }, (msg) => {
      const data = msg.payload as unknown as RideCancelledData
      if (data.type === 'ride_cancelled') handleRideCancelled(data)
    })
    riderChannel.on('broadcast', { event: 'driver_cancelled' }, (msg) => {
      const data = msg.payload as Record<string, unknown>
      // driver_cancelled means re-match — don't show "Ride Cancelled" toast
      // Just dismiss any active notification for this ride
      if (rideIdRef.current && rideIdRef.current === data['ride_id']) {
        dismiss()
      }
    })
    riderChannel.subscribe()

    return () => {
      if (channel) supabase.removeChannel(channel)
      supabase.removeChannel(boardChannel)
      supabase.removeChannel(riderChannel)
    }
  }, [profile?.id, isDriver, handleRideRequest, handleBoardRequest, handleBoardAccepted, handleRideCancelled, handleDriverSelected, dismiss])

  // Fallback: FCM foreground messages
  useEffect(() => {
    const unsub = onForegroundMessage((payload) => {
      if (payload.data?.type === 'ride_request') {
        if (!isDriver) return
        const data = payload.data as unknown as RideRequestData
        handleRideRequest(data)
      } else if (payload.data?.type === 'board_request') {
        const data = payload.data as unknown as BoardRequestData
        handleBoardRequest(data)
      } else if (payload.data?.type === 'board_accepted') {
        const data = payload.data as unknown as BoardAcceptedData
        handleBoardAccepted(data)
      } else if (payload.data?.type === 'ride_cancelled') {
        const data = payload.data as unknown as RideCancelledData
        handleRideCancelled(data)
      } else if (payload.data?.type === 'driver_cancelled') {
        // driver_cancelled means re-match — don't show cancelled toast
        // The WaitingRoom handler will take care of navigation
      } else if (payload.data?.type === 'ride_request_renewed') {
        // Intentionally ignored in FCM — the Realtime channel handles this.
        // Handling it here too caused duplicate notifications (Realtime + FCM both
        // delete from seenRideIds) which raced with WaitingRoom's auto-select.
        // The driver_selected event (below) is the real transition signal.
      } else if (payload.data?.type === 'driver_selected') {
        if (!isDriver) return
        const data = payload.data as { ride_id?: string }
        if (data.ride_id) {
          void handleDriverSelected(data.ride_id)
        }
      }
    })

    return () => {
      if (unsub) unsub()
    }
  }, [isDriver, handleRideRequest, handleBoardRequest, handleBoardAccepted, handleRideCancelled, handleDriverSelected])

  // Ref to track current notification so the polling callback can skip when
  // a notification is already being displayed without re-creating the effect.
  const notificationRef = useRef<NotificationState | null>(null)
  useEffect(() => {
    notificationRef.current = notification
  }, [notification])

  // Last-resort fallback: poll unread notifications for ride_request entries.
  // Only poll for drivers — riders should never see ride request notifications.
  useEffect(() => {
    if (!profile?.id || !isDriver) return

    let cancelled = false

    const poll = async () => {
      // Don't poll when a notification is already showing
      if (notificationRef.current) return

      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const resp = await fetch('/api/notifications?unread_only=true&limit=20', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!resp.ok || cancelled) return

        const body = (await resp.json()) as { notifications?: InboxNotification[] }
        const rows = body.notifications ?? []

        for (const notif of rows) {
          if (seenInboxNotifIdsRef.current.has(notif.id)) continue
          seenInboxNotifIdsRef.current.add(notif.id)

          // Mark this notification as read so it won't appear in future polls
          void fetch(`/api/notifications/${notif.id}/read`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${session.access_token}` },
          }).catch(() => {})

          if (notif.type !== 'ride_request') continue

          // Skip stale ride requests (older than 2 minutes)
          if (notif.created_at) {
            const ageMs = Date.now() - new Date(notif.created_at).getTime()
            if (ageMs > 2 * 60 * 1000) continue
          }

          const data = notif.data as unknown as RideRequestData
          if (data.type === 'ride_request' && data.ride_id) {
            handleRideRequest(data)
            break
          }
        }
      } catch {
        // non-fatal fallback path
      }
    }

    void poll()
    const intervalId = setInterval(() => { void poll() }, 15000)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [profile?.id, isDriver, handleRideRequest])

  // Countdown timer — auto-dismiss after 90s
  useEffect(() => {
    if (!notification) return

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          dismiss()
          return DISMISS_SECONDS
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [notification, dismiss])

  async function handleViewDetails() {
    if (!notification) return
    const { rideId, riderName, destination, distanceKm, estimatedEarnings, originLat, originLng, destinationLat, destinationLng, isBoardRequest, isRenewal } = notification
    dismiss()

    if (isBoardRequest) {
      navigate(`/ride/board-review/${rideId}`)
      return
    }

    // Renewal notifications: the previously-selected driver cancelled.
    // Never re-run the full /accept flow — WaitingRoom auto-selects from the offer queue.
    // Determine the right screen based on current ride state.
    if (isRenewal) {
      try {
        const { data: rideRow } = await supabase
          .from('rides')
          .select('status, driver_id, driver_destination, driver_destination_name')
          .eq('id', rideId)
          .single()

        if (rideRow?.status === 'accepted' && rideRow.driver_id === profile?.id) {
          // WaitingRoom already selected this driver — go straight to DropoffSelection
          const geo = rideRow.driver_destination as { coordinates: [number, number] } | null
          void handleDriverSelected(
            rideId,
            geo ? geo.coordinates[1] : null,
            geo ? geo.coordinates[0] : null,
            rideRow.driver_destination_name as string | null,
          )
          return
        }

        if (rideRow?.status === 'accepted' && rideRow.driver_id !== profile?.id) {
          // Someone else was auto-selected first — show standby screen
          navigate(`/ride/suggestion/${rideId}`, {
            state: { riderName, destination, distanceKm, estimatedEarnings, originLat, originLng, destinationLat, destinationLng, isStandbyRenewal: true },
          })
          return
        }
      } catch { /* fall through */ }

      // Ride is 'requested' — show "back in queue" screen.
      // WaitingRoom will auto-select this driver within seconds; the driver_selected
      // Realtime event will then navigate them to DropoffSelection automatically.
      navigate(`/ride/suggestion/${rideId}`, {
        state: { riderName, destination, distanceKm, estimatedEarnings, originLat, originLng, destinationLat, destinationLng, isRenewalStandby: true },
      })
      return
    }

    // Quick status check — if the ride is no longer 'requested', skip navigation
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const resp = await fetch(`/api/rides/${rideId}/status`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (resp.ok) {
          const body = (await resp.json()) as { status?: string }
          if (body.status && body.status !== 'requested') return
        }
      }
    } catch {
      // Continue to navigate even if check fails
    }

    navigate(`/ride/suggestion/${rideId}`, {
      state: { riderName, destination, distanceKm, estimatedEarnings, originLat, originLng, destinationLat, destinationLng },
    })
  }

  const portalTarget =
    (typeof document !== 'undefined' && document.getElementById('portal-root')) ||
    (typeof document !== 'undefined' ? document.body : null)

  if (!portalTarget) return null

  // Cancelled toast — shown when the other party cancels the ride
  if (cancelledToast && !notification) {
    return createPortal(
      <div className="fixed top-0 left-0 right-0 z-[1200] animate-slide-down">
        <div className="mx-2 mt-2 rounded-2xl border border-danger/30 bg-white shadow-xl">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger/10 shrink-0">
                <span className="text-lg">❌</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-text-primary">Ride Cancelled</p>
                <p className="text-xs text-text-secondary">
                  The {cancelledToast.cancelledBy} cancelled the ride.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCancelledToast(null)}
              aria-label="Dismiss"
              className="rounded-full p-1 text-text-secondary hover:bg-surface shrink-0"
            >
              ✕
            </button>
          </div>
          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={() => {
                setCancelledToast(null)
                navigate('/rides')
              }}
              className="w-full rounded-2xl bg-danger py-2.5 text-center text-sm font-semibold text-white active:bg-danger/90"
              data-testid="cancelled-view-rides"
            >
              View My Rides
            </button>
          </div>
        </div>
      </div>,
      portalTarget,
    )
  }

  // Accepted toast — shown when a board request is accepted
  if (acceptedToast && !notification) {
    return createPortal(
      <div className="fixed top-0 left-0 right-0 z-[1200] animate-slide-down">
        <div className="mx-2 mt-2 rounded-2xl border border-success/30 bg-white shadow-xl">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10 shrink-0">
                <span className="text-lg">✅</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-text-primary">Ride Accepted!</p>
                <p className="text-xs text-text-secondary">Open chat to coordinate pickup</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAcceptedToast(null)}
              aria-label="Dismiss"
              className="rounded-full p-1 text-text-secondary hover:bg-surface shrink-0"
            >
              ✕
            </button>
          </div>
          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={() => {
                navigate(`/ride/messaging/${acceptedToast.rideId}`)
                setAcceptedToast(null)
              }}
              className="w-full rounded-2xl bg-success py-2.5 text-center text-sm font-semibold text-white active:bg-success/90"
              data-testid="accepted-open-chat"
            >
              Open Chat
            </button>
          </div>
        </div>
      </div>,
      portalTarget,
    )
  }

  if (!notification) return null

  return createPortal(
    <div
      data-testid={testId}
      className="fixed top-0 left-0 right-0 z-[1200] animate-slide-down"
    >
      {/* Banner card */}
      <div
        className="mx-2 mt-2 rounded-2xl border border-border bg-white shadow-xl"
        data-testid="ride-request-content"
      >
        {/* Header row */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">{notification.isBoardRequest ? '📋' : notification.isRenewal ? '🔔' : '🚗'}</span>
            <h3 className="text-sm font-bold text-primary">
              {notification.isBoardRequest ? 'Ride Board Match' : notification.isRenewal ? 'You\'re Back in the Running' : 'New Ride Request'}
            </h3>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="rounded-full p-1 text-text-secondary hover:bg-surface"
          >
            ✕
          </button>
        </div>

        {/* Rider info */}
        <div className="flex items-center gap-3 px-4 pb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-light shrink-0">
            <span className="text-sm">🧑</span>
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-text-primary text-sm truncate" data-testid="rider-name">
              {notification.riderName}
            </p>
            <p className="text-xs text-text-secondary">
              {notification.isBoardRequest ? 'wants to coordinate a ride' : notification.isRenewal ? 'previous driver cancelled — your offer is active' : 'needs a ride'}
            </p>
          </div>
        </div>

        {/* Details row */}
        <div className="grid grid-cols-3 gap-1 mx-3 mb-2 rounded-2xl bg-surface p-2">
          <div className="text-center">
            <p className="text-[10px] text-text-secondary">Destination</p>
            <p className="text-xs font-medium text-text-primary truncate" data-testid="notification-destination">
              {notification.destination}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-text-secondary">Distance</p>
            <p className="text-xs font-medium text-text-primary" data-testid="notification-distance">
              {isNaN(Number(notification.distanceKm)) ? '–' : `${(Number(notification.distanceKm) * 0.621371).toFixed(1)} mi`}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-text-secondary">You earn</p>
            <p className="text-xs font-medium text-success" data-testid="notification-earnings">
              {notification.estimatedEarnings}
            </p>
          </div>
        </div>

        {/* Progress bar + CTA */}
        <div className="px-3 pb-3">
          {/* Countdown bar */}
          <div className="mb-2 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-all duration-1000 ease-linear"
                style={{ width: `${(secondsLeft / DISMISS_SECONDS) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-text-secondary whitespace-nowrap" data-testid="countdown">
              {secondsLeft}s
            </span>
          </div>

          <button
            type="button"
            onClick={handleViewDetails}
            className="w-full rounded-2xl bg-primary py-2.5 text-center text-sm font-semibold text-white active:bg-primary-dark"
            data-testid="view-details-button"
          >
            View Details
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  )
}
