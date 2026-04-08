import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { onForegroundMessage } from '@/lib/fcm'
import { calculateFare, formatCents } from '@/lib/fare'
import { getDirectionsByLatLng } from '@/lib/directions'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { reverseGeocode } from '@/lib/geocode'
import AppIcon from '@/components/ui/AppIcon'

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
  rider_rating?: string
  rider_rating_count?: string
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
  riderRating: string
  riderRatingCount: string
  originAddress: string
  /** When true, navigate to board-review instead of ride suggestion */
  isBoardRequest?: boolean
  /** Trip date/time for board requests (e.g. "2026-04-01", "08:30:00") */
  boardTripDate?: string
  boardTripTime?: string
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
  const [queue, setQueue] = useState<NotificationState[]>([])
  const notification = queue[0] ?? null
  const [secondsLeft, setSecondsLeft] = useState(DISMISS_SECONDS)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const dismiss = useCallback(() => {
    setQueue((prev) => prev.slice(1))
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

  const hydrateMissingRideStats = useCallback(async (
    rideId: string,
    originLat: string,
    originLng: string,
    destinationLat: string,
    destinationLng: string,
  ) => {
    const oLat = Number(originLat)
    const oLng = Number(originLng)
    const dLat = Number(destinationLat)
    const dLng = Number(destinationLng)
    if (
      Number.isNaN(oLat)
      || Number.isNaN(oLng)
      || Number.isNaN(dLat)
      || Number.isNaN(dLng)
    ) return

    const dirs = await getDirectionsByLatLng(oLat, oLng, dLat, dLng)
    if (!dirs) return

    const fare = calculateFare(dirs.distance_km, dirs.duration_min)
    setQueue((prev) => prev.map((n) => (
      n.rideId === rideId
        ? {
          ...n,
          distanceKm: String(dirs.distance_km),
          estimatedEarnings: formatCents(fare.driver_earns_cents),
        }
        : n
    )))
  }, [])

  // Handle incoming ride request data from any source
  const handleRideRequest = useCallback((data: RideRequestData, isRenewal?: boolean) => {
    const earningsCents = parseInt(data.estimated_earnings_cents ?? '0', 10)
    const hasDistance = !!data.distance_km && !Number.isNaN(Number(data.distance_km))
    const hasEarnings = earningsCents > 0

    // Deduplicate: when already seen, enrich existing entry instead of adding a duplicate.
    if (seenRideIdsRef.current.has(data.ride_id)) {
      setQueue((prev) => prev.map((n) => {
        if (n.rideId !== data.ride_id) return n
        return {
          ...n,
          riderName: data.rider_name ?? n.riderName,
          destination: data.destination ?? n.destination,
          distanceKm: hasDistance ? data.distance_km ?? n.distanceKm : n.distanceKm,
          estimatedEarnings: hasEarnings ? formatCents(earningsCents) : n.estimatedEarnings,
          originLat: data.origin_lat ?? n.originLat,
          originLng: data.origin_lng ?? n.originLng,
          destinationLat: data.destination_lat ?? n.destinationLat,
          destinationLng: data.destination_lng ?? n.destinationLng,
          riderRating: data.rider_rating ?? n.riderRating,
          riderRatingCount: data.rider_rating_count ?? n.riderRatingCount,
          isRenewal: isRenewal ?? n.isRenewal,
        }
      }))

      if (!hasDistance || !hasEarnings) {
        void hydrateMissingRideStats(
          data.ride_id,
          data.origin_lat ?? '',
          data.origin_lng ?? '',
          data.destination_lat ?? '',
          data.destination_lng ?? '',
        )
      }
      return
    }
    seenRideIdsRef.current.add(data.ride_id)

    const entry: NotificationState = {
      rideId: data.ride_id,
      riderName: data.rider_name ?? 'A rider',
      destination: data.destination ?? 'Nearby destination',
      distanceKm: data.distance_km ?? '–',
      estimatedEarnings: earningsCents > 0 ? formatCents(earningsCents) : '–',
      originLat: data.origin_lat ?? '',
      originLng: data.origin_lng ?? '',
      destinationLat: data.destination_lat ?? '',
      destinationLng: data.destination_lng ?? '',
      riderRating: data.rider_rating ?? '',
      riderRatingCount: data.rider_rating_count ?? '0',
      originAddress: '',
      isRenewal: isRenewal ?? false,
    }
    setQueue((prev) => {
      // If queue is empty, reset countdown
      if (prev.length === 0) setSecondsLeft(DISMISS_SECONDS)
      return [...prev, entry]
    })

    // Reverse geocode origin to get approximate area
    const lat = parseFloat(data.origin_lat ?? '')
    const lng = parseFloat(data.origin_lng ?? '')
    if (!isNaN(lat) && !isNaN(lng)) {
      void reverseGeocode(lat, lng).then((address) => {
        setQueue((prev) =>
          prev.map((n) => n.rideId === data.ride_id ? { ...n, originAddress: address } : n),
        )
      })
    }

    if (!hasDistance || !hasEarnings) {
      void hydrateMissingRideStats(
        data.ride_id,
        data.origin_lat ?? '',
        data.origin_lng ?? '',
        data.destination_lat ?? '',
        data.destination_lng ?? '',
      )
    }
  }, [hydrateMissingRideStats])

  // Handle incoming board request (from ride board)
  const handleBoardRequest = useCallback((data: BoardRequestData) => {
    if (seenRideIdsRef.current.has(data.ride_id)) return
    seenRideIdsRef.current.add(data.ride_id)

    // Build a subtitle from route + trip info when available
    const routeLabel = data.route ?? ''
    const timeLabel = [data.trip_date, data.trip_time].filter(Boolean).join(' at ')
    const destination = routeLabel || timeLabel || ''

    // Auto-dismiss if trip time has already passed
    if (data.trip_date && data.trip_time) {
      const tripDateTime = new Date(`${data.trip_date}T${data.trip_time}`)
      if (!isNaN(tripDateTime.getTime()) && tripDateTime.getTime() < Date.now()) return
    }

    const entry: NotificationState = {
      rideId: data.ride_id,
      riderName: data.requester_name ?? 'Someone',
      destination,
      distanceKm: '–',
      estimatedEarnings: '–',
      originLat: '',
      originLng: '',
      destinationLat: '',
      destinationLng: '',
      riderRating: '',
      riderRatingCount: '0',
      originAddress: '',
      isBoardRequest: true,
      boardTripDate: data.trip_date,
      boardTripTime: data.trip_time,
    }
    setQueue((prev) => {
      if (prev.length === 0) setSecondsLeft(DISMISS_SECONDS)
      return [...prev, entry]
    })
  }, [])

  // Handle board request accepted — show toast and navigate to messaging
  const [acceptedToast, setAcceptedToast] = useState<{ rideId: string } | null>(null)
  const acceptedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seenAcceptedRideIdsRef = useRef<Set<string>>(new Set())

  const handleBoardAccepted = useCallback((data: BoardAcceptedData) => {
    // Prevent duplicate toasts for the same ride (realtime + polling can both fire)
    if (seenAcceptedRideIdsRef.current.has(data.ride_id)) return
    seenAcceptedRideIdsRef.current.add(data.ride_id)
    setAcceptedToast({ rideId: data.ride_id })
    // Auto-dismiss after 10s
    if (acceptedTimerRef.current) clearTimeout(acceptedTimerRef.current)
    acceptedTimerRef.current = setTimeout(() => setAcceptedToast(null), 10000)
  }, [])

  // Ride reminder toast — shown when ride is approaching
  const [reminderToast, setReminderToast] = useState<{ rideId: string } | null>(null)
  const reminderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seenReminderRideIdsRef = useRef<Set<string>>(new Set())

  const handleRideReminder = useCallback((rideId: string) => {
    if (seenReminderRideIdsRef.current.has(rideId)) return
    seenReminderRideIdsRef.current.add(rideId)
    setReminderToast({ rideId })
    if (reminderTimerRef.current) clearTimeout(reminderTimerRef.current)
    reminderTimerRef.current = setTimeout(() => setReminderToast(null), 10000)
  }, [])

  // Cancelled toast — shown when the other party cancels the ride
  const [cancelledToast, setCancelledToast] = useState<{ cancelledBy: string } | null>(null)
  const cancelledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleRideCancelled = useCallback((data: RideCancelledData) => {
    // Remove this ride from the queue (wherever it is)
    setQueue((prev) => prev.filter((n) => n.rideId !== data.ride_id))
    // Show cancellation toast
    setCancelledToast({ cancelledBy: data.cancelled_by ?? 'other party' })
    if (cancelledTimerRef.current) clearTimeout(cancelledTimerRef.current)
    cancelledTimerRef.current = setTimeout(() => setCancelledToast(null), 8000)
  }, [])

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
        if (data.ride_id) {
          setQueue((prev) => prev.filter((n) => n.rideId !== data.ride_id))
        }
      })
      channel.on('broadcast', { event: 'ride_standby' }, (msg) => {
        const data = msg.payload as { ride_id?: string }
        if (data.ride_id) {
          setQueue((prev) => prev.filter((n) => n.rideId !== data.ride_id))
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
      // Just remove any notification for this ride from the queue
      const cancelledRideId = data['ride_id'] as string | undefined
      if (cancelledRideId) {
        setQueue((prev) => prev.filter((n) => n.rideId !== cancelledRideId))
      }
    })
    riderChannel.subscribe()

    return () => {
      if (channel) supabase.removeChannel(channel)
      supabase.removeChannel(boardChannel)
      supabase.removeChannel(riderChannel)
    }
  }, [profile?.id, isDriver, handleRideRequest, handleBoardRequest, handleBoardAccepted, handleRideCancelled, handleDriverSelected])

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
      } else if (payload.data?.type === 'ride_reminder') {
        const rideId = payload.data?.ride_id as string | undefined
        if (rideId) {
          handleRideReminder(rideId)
        }
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
  }, [isDriver, handleRideRequest, handleBoardRequest, handleBoardAccepted, handleRideCancelled, handleRideReminder, handleDriverSelected])

  // Ref to track current queue so the polling callback can skip when
  // a notification is already being displayed without re-creating the effect.
  const queueRef = useRef<NotificationState[]>([])
  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  // Last-resort fallback: poll unread notifications for ride_request entries.
  // Only poll for drivers — riders should never see ride request notifications.
  useEffect(() => {
    if (!profile?.id || !isDriver) return

    let cancelled = false

    const poll = async () => {
      // Don't poll when a notification is already showing
      if (queueRef.current.length > 0) return

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

  // Fallback: poll unread notifications for board_accepted entries (rider side).
  // Handles missed Realtime events when the app is backgrounded.
  useEffect(() => {
    if (!profile?.id || isDriver) return

    let cancelled = false
    const seenAcceptedIdsRef = new Set<string>()

    const poll = async () => {
      // Don't re-show if accepted toast is already visible
      if (acceptedToast) return

      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const resp = await fetch('/api/notifications?unread_only=true&limit=10', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!resp.ok || cancelled) return

        const body = (await resp.json()) as { notifications?: InboxNotification[] }
        const rows = body.notifications ?? []

        for (const notif of rows) {
          if (seenAcceptedIdsRef.has(notif.id)) continue
          seenAcceptedIdsRef.add(notif.id)
          if (seenInboxNotifIdsRef.current.has(notif.id)) continue
          seenInboxNotifIdsRef.current.add(notif.id)

          void fetch(`/api/notifications/${notif.id}/read`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${session.access_token}` },
          }).catch(() => {})

          if (notif.type !== 'board_accepted') continue

          const rideId = notif.data['ride_id'] as string | undefined
          if (rideId) {
            handleBoardAccepted({ type: 'board_accepted', ride_id: rideId })
            break
          }
        }
      } catch {
        // non-fatal fallback path
      }
    }

    void poll()
    const intervalId = setInterval(() => { void poll() }, 10000)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [profile?.id, isDriver, acceptedToast, handleBoardAccepted])

  // Countdown timer — auto-dismiss after 90s (on-demand only, not board requests)
  useEffect(() => {
    if (!notification) return

    // Board requests don't use the 90s countdown — they stay until trip time passes
    if (notification.isBoardRequest) {
      // Check every 60s if trip time has passed
      const checkExpiry = () => {
        if (notification.boardTripDate && notification.boardTripTime) {
          const tripDateTime = new Date(`${notification.boardTripDate}T${notification.boardTripTime}`)
          if (!isNaN(tripDateTime.getTime()) && tripDateTime.getTime() < Date.now()) {
            dismiss()
          }
        }
      }
      const intervalId = setInterval(checkExpiry, 60_000)
      return () => clearInterval(intervalId)
    }

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

  const [accepting, setAccepting] = useState(false)

  async function handleAccept() {
    if (!notification || accepting) return
    setAccepting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch(`/api/rides/${notification.rideId}/accept`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      if (resp.ok) {
        dismiss()
        navigate(`/ride/suggestion/${notification.rideId}`, {
          state: {
            riderName: notification.riderName,
            destination: notification.destination,
            distanceKm: notification.distanceKm,
            estimatedEarnings: notification.estimatedEarnings,
            originLat: notification.originLat,
            originLng: notification.originLng,
            destinationLat: notification.destinationLat,
            destinationLng: notification.destinationLng,
          },
        })
      } else {
        // Ride may already be taken — silently dismiss
        dismiss()
      }
    } catch {
      dismiss()
    } finally {
      setAccepting(false)
    }
  }

  async function handleViewDetails() {
    if (!notification) return
    const { rideId, riderName, destination, distanceKm, estimatedEarnings, originLat, originLng, destinationLat, destinationLng, originAddress, isBoardRequest, isRenewal } = notification
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
            state: { riderName, destination, distanceKm, estimatedEarnings, originLat, originLng, destinationLat, destinationLng, originAddress, isStandbyRenewal: true },
          })
          return
        }
      } catch { /* fall through */ }

      // Ride is 'requested' — show "back in queue" screen.
      // WaitingRoom will auto-select this driver within seconds; the driver_selected
      // Realtime event will then navigate them to DropoffSelection automatically.
      navigate(`/ride/suggestion/${rideId}`, {
        state: { riderName, destination, distanceKm, estimatedEarnings, originLat, originLng, destinationLat, destinationLng, originAddress, isRenewalStandby: true },
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
      state: { riderName, destination, distanceKm, estimatedEarnings, originLat, originLng, destinationLat, destinationLng, originAddress },
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
                <AppIcon name="x-circle" className="h-5 w-5 text-danger" />
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
                <AppIcon name="check-circle" className="h-5 w-5 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-text-primary">Ride Accepted!</p>
                <p className="text-xs text-text-secondary">Set your pickup location</p>
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
                navigate(`/ride/messaging/${acceptedToast.rideId}`, { state: { autoOpenPickup: true } })
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

  // Ride reminder toast — shown when ride is approaching
  if (reminderToast && !notification && !acceptedToast) {
    return createPortal(
      <div className="fixed top-0 left-0 right-0 z-[1200] animate-slide-down">
        <div className="mx-2 mt-2 rounded-2xl border border-warning/30 bg-white shadow-xl">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10 shrink-0">
                <AppIcon name="bell" className="h-5 w-5 text-warning" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-text-primary">Ride Starting Soon!</p>
                <p className="text-xs text-text-secondary">Head to your pickup location</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReminderToast(null)}
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
                navigate(`/ride/messaging/${reminderToast.rideId}`)
                setReminderToast(null)
              }}
              className="w-full rounded-2xl bg-warning py-2.5 text-center text-sm font-semibold text-white active:bg-warning/90"
              data-testid="reminder-open-chat"
            >
              Open Ride
            </button>
          </div>
        </div>
      </div>,
      portalTarget,
    )
  }

  if (!notification) return null

  const distanceMi = isNaN(Number(notification.distanceKm)) ? null : Number(notification.distanceKm) * 0.621371
  const estTimeMin = distanceMi != null ? Math.max(1, Math.round(distanceMi / 35 * 60)) : null
  const ratingVal = parseFloat(notification.riderRating)
  const ratingCount = parseInt(notification.riderRatingCount, 10)

  return createPortal(
    <div
      data-testid={testId}
      className="fixed top-0 left-0 right-0 z-[1200] animate-slide-down"
    >
      {/* Banner card */}
      <div
        className="mx-2 mt-2 rounded-2xl border border-border bg-white shadow-xl overflow-hidden"
        data-testid="ride-request-content"
      >
        {/* Header row */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <AppIcon
              name={notification.isBoardRequest ? 'clipboard' : notification.isRenewal ? 'bell' : 'car-request'}
              className={`h-5 w-5 ${notification.isRenewal ? 'text-text-secondary' : 'text-primary'}`}
            />
            <h3 className="text-sm font-bold text-primary">
              {notification.isBoardRequest ? 'Ride Board Match' : notification.isRenewal ? 'You\'re Back in the Running' : 'New Ride Request'}
            </h3>
            {queue.length > 1 && (
              <span className="ml-2 shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white" data-testid="queue-badge">
                1 of {queue.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="rounded-full p-1 text-text-secondary hover:bg-surface"
          >
            &#10005;
          </button>
        </div>

        {/* Rider info + rating */}
        <div className="flex items-center gap-3 px-4 pb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
            <span className="text-sm font-bold text-primary">{notification.riderName[0]?.toUpperCase() ?? '?'}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-text-primary text-sm truncate" data-testid="rider-name">
              {notification.riderName}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              {!isNaN(ratingVal) && ratingVal > 0 ? (
                <>
                  <span className="inline-flex items-center gap-0.5">
                    <AppIcon name="star" className="h-3 w-3 text-warning" />
                    <span className="font-medium">{ratingVal.toFixed(1)}</span>
                  </span>
                  {ratingCount > 0 && <span>({ratingCount} {ratingCount === 1 ? 'ride' : 'rides'})</span>}
                </>
              ) : (
                <span className="text-warning font-medium">New rider</span>
              )}
            </div>
          </div>
        </div>

        {/* Route addresses */}
        {!notification.isBoardRequest && (
          <div className="mx-4 mb-2 space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-success shrink-0" />
              <p className="text-xs text-text-primary truncate" data-testid="notification-origin">
                {notification.originAddress ? `Near ${notification.originAddress}` : 'Nearby pickup'}
              </p>
            </div>
            <div className="ml-[4.5px] h-2.5 border-l border-dashed border-text-secondary/30" />
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
              <p className="text-xs font-medium text-text-primary truncate" data-testid="notification-destination">
                {notification.destination}
              </p>
            </div>
          </div>
        )}

        {/* Details grid */}
        {!notification.isBoardRequest && (
          <div className="grid grid-cols-3 gap-1 mx-3 mb-2 rounded-2xl bg-surface p-2.5">
            <div className="text-center">
              <p className="text-lg font-bold text-success" data-testid="notification-earnings">
                {notification.estimatedEarnings}
              </p>
              <p className="text-[10px] text-text-secondary">You earn</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-text-primary" data-testid="notification-distance">
                {distanceMi != null ? `${distanceMi.toFixed(1)} mi` : '\u2013'}
              </p>
              <p className="text-[10px] text-text-secondary">Distance</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-text-primary" data-testid="notification-time">
                {estTimeMin != null ? `~${estTimeMin}m` : '\u2013'}
              </p>
              <p className="text-[10px] text-text-secondary">Est. time</p>
            </div>
          </div>
        )}

        {/* Board request destination */}
        {notification.isBoardRequest && notification.destination && (
          <div className="mx-3 mb-2 rounded-2xl bg-surface p-2.5 text-center">
            <p className="text-xs text-text-secondary">Route</p>
            <p className="text-sm font-medium text-text-primary truncate" data-testid="notification-destination">
              {notification.destination}
            </p>
          </div>
        )}

        {/* Disclaimer */}
        {!notification.isBoardRequest && (
          <p className="mx-4 mb-2 text-[10px] text-text-secondary italic leading-tight" data-testid="notification-disclaimer">
            Fare may vary based on actual route. You can set your own drop-off point after accepting.
          </p>
        )}

        {/* Countdown bar (on-demand) or trip time label (board requests) */}
        {notification.isBoardRequest ? (
          notification.boardTripDate && notification.boardTripTime && (
            <div className="mx-3 mb-2 flex items-center justify-center gap-1.5" data-testid="board-trip-time">
              <span className="text-[10px] text-text-secondary">Ride at</span>
              <span className="text-[10px] font-semibold text-text-primary">
                {new Date(`${notification.boardTripDate}T${notification.boardTripTime}`).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
                })}
              </span>
            </div>
          )
        ) : (
          <div className="mx-3 mb-2 flex items-center gap-2">
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
        )}

        {/* Action buttons */}
        <div className="px-3 pb-3 flex gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="flex-1 rounded-2xl border border-border py-2.5 text-center text-sm font-semibold text-text-secondary active:bg-surface transition-colors"
            data-testid="decline-button"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => { void handleViewDetails() }}
            className="flex-1 rounded-2xl border border-primary py-2.5 text-center text-sm font-semibold text-primary active:bg-primary/5 transition-colors"
            data-testid="view-details-button"
          >
            Details
          </button>
          {!notification.isBoardRequest && (
            <button
              type="button"
              onClick={() => { void handleAccept() }}
              disabled={accepting}
              className="flex-1 rounded-2xl bg-success py-2.5 text-center text-sm font-semibold text-white active:bg-success/90 transition-colors disabled:opacity-50"
              data-testid="accept-button"
            >
              {accepting ? 'Accepting\u2026' : 'Accept'}
            </button>
          )}
        </div>
      </div>
    </div>,
    portalTarget,
  )
}
