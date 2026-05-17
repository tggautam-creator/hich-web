import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import { getDirectionsByLatLng } from '@/lib/directions'
import { calculateFare, formatCents } from '@/lib/fare'
import { searchPlaces, getPlaceCoordinates } from '@/lib/places'
import type { PlaceSuggestion } from '@/lib/places'
import { RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
import DeclineReasonSheet from '@/components/ride/DeclineReasonSheet'
import CarMarker from '@/components/map/CarMarker'
import { MAP_ID } from '@/lib/mapConstants'
import AppIcon from '@/components/ui/AppIcon'
import type { Ride, User } from '@/types/database'

const COUNTDOWN_SECONDS = 150

interface RideWithRider {
  ride: Ride
  rider: Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg' | 'rating_count'>
}

/** Data passed from the notification banner via navigation state. */
interface NotificationState {
  riderName?: string
  destination?: string
  distanceKm?: string
  estimatedEarnings?: string
  originLat?: string
  originLng?: string
  destinationLat?: string
  destinationLng?: string
  originAddress?: string
  /** When true, this was a ride_request_renewed — show standby screen immediately */
  isStandbyRenewal?: boolean
  /** When true, driver was on standby and previous driver cancelled — WaitingRoom is auto-selecting */
  isRenewalStandby?: boolean
}

export default function RideSuggestion({
  'data-testid': testId = 'ride-suggestion',
}: {
  'data-testid'?: string
}) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const navState = location.state as NotificationState | null
  // Stabilize navState ref so it doesn't trigger re-fetches on re-render
  const navStateRef = useRef(navState)
  // Whether this page was opened from a ride_request_renewed notification
  const isStandbyRenewal = !!navState?.isStandbyRenewal
  // Whether WaitingRoom is about to auto-select this driver (previous driver cancelled,
  // ride is back to 'requested', driver just needs to wait for driver_selected event)
  const isRenewalStandby = !!navState?.isRenewalStandby

  const [data, setData] = useState<RideWithRider | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS)
  const [submitting, setSubmitting] = useState(false)
  // Sprint 2 W-T1-D3 — two-step accept flow. Stage 1 is the existing
  // suggestion screen with a single big Accept CTA (no destination
  // input). On accept we POST `/accept` with an empty body, lock the
  // ride server-side, then advance to stage 2 (destination entry +
  // explicit Cancel pill). Matches iOS DriverDestinationEntryPage.
  const [acceptStage, setAcceptStage] = useState<'suggestion' | 'destination'>('suggestion')
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  // Polyline from rider pickup → destination
  const [ridePolyline, setRidePolyline] = useState<string | null>(null)
  // Polyline from driver → rider pickup
  const [pickupPolyline, setPickupPolyline] = useState<string | null>(null)
  // Driver's current location
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Driver destination state ──────────────────────────────────────────────
  const [driverDestQuery, setDriverDestQuery] = useState('')
  const [driverDestResults, setDriverDestResults] = useState<PlaceSuggestion[]>([])
  const [selectedDriverDest, setSelectedDriverDest] = useState<PlaceSuggestion | null>(null)
  const [driverDestCoords, setDriverDestCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [standbyMode, setStandbyMode] = useState(() => !!navState?.isStandbyRenewal || !!navState?.isRenewalStandby)
  // True when the driver already has a pending (reverted-from-standby) offer with destination set
  const [isRenewalOffer, setIsRenewalOffer] = useState(false)
  // Computed stats when nav state doesn't have fare/distance
  const [computedStats, setComputedStats] = useState<{ distanceKm: number; durationMin: number; driverEarns: string } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionTokenRef = useRef(crypto.randomUUID())

  // ── Fetch ride + rider ────────────────────────────────────────────────────
  useEffect(() => {
    if (!rideId) {
      navigate('/home/driver', { replace: true })
      return
    }

    const ns = navStateRef.current

    async function fetchRide() {
      const { data: ride, error: rideErr } = await supabase
        .from('rides')
        .select('*')
        .eq('id', rideId as string)
        .single()

      if (rideErr || !ride) {
        // If the DB query fails (e.g. RLS), fall back to notification nav state
        if (ns?.riderName) {
          setData({
            ride: { id: rideId, fare_cents: null } as unknown as Ride,
            rider: {
              id: '',
              full_name: ns.riderName,
              avatar_url: null,
              rating_avg: null,
              rating_count: 0,
            },
          })
          setLoading(false)
          return
        }
        setError('Could not load ride details')
        setLoading(false)
        return
      }

      const { data: rider, error: riderErr } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, rating_avg, rating_count')
        .eq('id', ride.rider_id)
        .single()

      if (riderErr || !rider) {
        // RLS blocks reading other users — fall back to nav state
        if (ns?.riderName) {
          setData({
            ride,
            rider: {
              id: ride.rider_id,
              full_name: ns.riderName,
              avatar_url: null,
              rating_avg: null,
              rating_count: 0,
            },
          })
          setLoading(false)
          return
        }
        setError('Could not load rider details')
        setLoading(false)
        return
      }

      // Ride is no longer open — it was cancelled, accepted, or completed.
      // Show an error instead of the accept form so the driver isn't confused.
      if (ride.status !== 'requested') {
        setError('This ride is no longer available.')
        setLoading(false)
        return
      }

      setData({ ride, rider })
      setLoading(false)
      trackEvent('driver_notified', { ride_id: rideId })
    }

    void fetchRide()
  }, [rideId, navigate])

  // ── Compute fare/distance when nav state doesn't have them ─────────────────
  useEffect(() => {
    // Skip if nav state already has valid values
    const hasNavEarnings = navState?.estimatedEarnings && navState.estimatedEarnings !== '–' && navState.estimatedEarnings !== '$0.00'
    const hasNavDistance = navState?.distanceKm && navState.distanceKm !== '–' && !isNaN(Number(navState.distanceKm))
    if (hasNavEarnings && hasNavDistance) return
    if (!data?.ride) return

    const ride = data.ride
    const origin = ride.origin as unknown as { coordinates: [number, number] } | null
    const dest = ride.destination as unknown as { coordinates: [number, number] } | null
    if (!origin?.coordinates || !dest?.coordinates) return

    const [oLng, oLat] = origin.coordinates
    const [dLng, dLat] = dest.coordinates
    if (!oLat || !oLng || !dLat || !dLng) return

    void getDirectionsByLatLng(oLat, oLng, dLat, dLng).then((dirs) => {
      if (!dirs) return
      const fare = calculateFare(dirs.distance_km, dirs.duration_min)
      setComputedStats({
        distanceKm: dirs.distance_km,
        durationMin: dirs.duration_min,
        driverEarns: formatCents(fare.driver_earns_cents),
      })
    })
  }, [data, navState])

  // ── Check for existing offer (guards against bypassed renewal flags) ─────
  // If the driver already has a standby offer, or a pending offer with a
  // destination already set (renewal case — their previous offer was reverted
  // from standby to pending after the selected driver cancelled), skip the
  // destination form and go straight to standby mode. This handles the race
  // where the polling fallback fires instead of Realtime, so the navigation
  // state doesn't carry isRenewalStandby/isStandbyRenewal flags.
  useEffect(() => {
    if (!rideId || standbyMode) return   // already in standby — no need to check

    async function checkExistingOffer() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: offer } = await supabase
        .from('ride_offers')
        .select('status, driver_destination')
        .eq('ride_id', rideId as string)
        .eq('driver_id', session.user.id)
        .maybeSingle()

      if (!offer) return   // no prior offer — show form normally

      const hasStandby = offer.status === 'standby'
      // Pending + destination already submitted = reverted standby (renewal case)
      const hasRenewal = offer.status === 'pending' && offer.driver_destination !== null

      if (hasStandby || hasRenewal) {
        if (hasRenewal) setIsRenewalOffer(true)
        setStandbyMode(true)
      }
    }

    void checkExistingOffer()
  }, [rideId])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Standby polling — detect when rider selects this driver ─────────────
  // RideRequestNotification handles `driver_selected` via Realtime, but if
  // that event is missed (subscription lag, reconnect), the driver is stuck
  // on standby forever while the rider's WaitingRoom shows them as selected.
  // Poll ride status every 8s as a fallback to catch missed events.
  useEffect(() => {
    if (!rideId || !standbyMode) return

    let cancelled = false

    const poll = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || cancelled) return

      const { data: ride } = await supabase
        .from('rides')
        .select('status, driver_id, driver_destination, driver_destination_name')
        .eq('id', rideId as string)
        .single()

      if (!ride || cancelled) return

      if (ride.status === 'accepted' && ride.driver_id === session.user.id) {
        // Rider selected this driver — navigate to DropoffSelection
        const geo = ride.driver_destination as { coordinates: [number, number] } | null
        const lat = geo ? geo.coordinates[1] : null
        const lng = geo ? geo.coordinates[0] : null
        const destName = (ride.driver_destination_name as string | null) ?? ''

        if (lat && lng) {
          navigate(`/ride/dropoff/${rideId}`, {
            replace: true,
            state: { driverDestLat: lat, driverDestLng: lng, driverDestName: destName },
          })
        } else {
          // Destination not yet on the ride row — check the offer
          const { data: offer } = await supabase
            .from('ride_offers')
            .select('driver_destination, driver_destination_name')
            .eq('ride_id', rideId as string)
            .eq('driver_id', session.user.id)
            .maybeSingle()
          const oGeo = offer?.driver_destination as { coordinates: [number, number] } | null
          const oLat = oGeo ? oGeo.coordinates[1] : null
          const oLng = oGeo ? oGeo.coordinates[0] : null
          if (oLat && oLng) {
            navigate(`/ride/dropoff/${rideId}`, {
              replace: true,
              state: { driverDestLat: oLat, driverDestLng: oLng, driverDestName: offer?.driver_destination_name ?? '' },
            })
          } else {
            navigate(`/ride/dropoff/${rideId}`, { replace: true })
          }
        }
        return
      }

      if (ride.status === 'cancelled' || ride.status === 'completed') {
        navigate('/home/driver', { replace: true })
      }
    }

    void poll()
    const id = setInterval(() => { void poll() }, 8000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [rideId, standbyMode, navigate])

  // ── Decline helpers ───────────────────────────────────────────────────────
  // Decline = "this driver isn't interested." We need to release the
  // ride_offer server-side via PATCH /api/rides/:id/cancel so the matcher
  // can keep fanning out to other drivers. Without this call the offer
  // sits in `pending` until the hourly cleanup cron, locking the rider's
  // queue from this driver's perspective for up to an hour. iOS already
  // does this (`RideSuggestionPage.swift::submitDecline`). Both the
  // explicit Decline button and the auto-decline countdown reach this
  // function. Fire-and-forget — even if the server call fails (e.g. the
  // ride was already actioned by another driver), we still want to
  // navigate the driver home so they aren't stranded.
  //
  // Sprint 2 W-T1-D1 — when the driver taps Decline (not the countdown
  // expiry) we open `DeclineReasonSheet` first so they can optionally
  // log a reason and snooze. The countdown path stays a silent decline
  // because it's unattended.
  const sendDeclineNetwork = useCallback(
    (reason: string | null, snoozeMinutes: number | null) => {
      if (!rideId) return
      void (async () => {
        try {
          const token = (await supabase.auth.getSession()).data.session?.access_token
          if (!token) return
          // Snooze first — durable user intent decoupled from the
          // specific ride (matches iOS submitDecline). Either call
          // failing doesn't roll back the other.
          if (snoozeMinutes != null) {
            void fetch('/api/rides/snooze', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ snooze_minutes: snoozeMinutes }),
            })
          }
          void fetch(`/api/rides/${rideId}/cancel`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: reason ? JSON.stringify({ reason }) : undefined,
          })
        } catch {
          // best-effort — fall through to nav
        }
      })()
    },
    [rideId],
  )

  const handleDecline = useCallback(() => {
    sendDeclineNetwork(null, null)
    navigate('/home/driver', { replace: true })
  }, [navigate, sendDeclineNetwork])

  const [showDeclineSheet, setShowDeclineSheet] = useState(false)

  const openDeclineSheet = useCallback(() => {
    // Pause the countdown the moment the sheet opens so the driver
    // doesn't get yanked mid-choice.
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setShowDeclineSheet(true)
  }, [])

  const submitDeclineWithReason = useCallback(
    (reason: string | null, snoozeMinutes: number | null) => {
      setShowDeclineSheet(false)
      sendDeclineNetwork(reason, snoozeMinutes)
      navigate('/home/driver', { replace: true })
    },
    [navigate, sendDeclineNetwork],
  )

  const closeDeclineSheet = useCallback(() => {
    setShowDeclineSheet(false)
    // Driver swiped away mid-decision — leave the suggestion visible.
    // The countdown effect re-arms below because handleDecline /
    // openDeclineSheet identity haven't changed.
  }, [])

  // ── Countdown timer (auto-decline on expiry) ─────────────────────────────
  // Only runs while the driver hasn't committed yet (stage 1). After
  // accept, the timer is killed — see `handleAcceptStage1`.
  useEffect(() => {
    if (loading || error) return
    if (acceptStage !== 'suggestion') return

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          void handleDecline()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [loading, error, handleDecline, acceptStage])

  // ── Block browser back on stage 2 ────────────────────────────────────────
  // Driver is past the point of return; the only way out is the
  // explicit Cancel pill (with confirm). Mirrors iOS
  // `.interactiveDismissDisabled(true)` on DriverDestinationEntryPage.
  // Pushes a sentinel history entry on entry so the first Back press
  // pops to it (a no-op), then re-pushes another sentinel and opens
  // the confirm dialog — preserves the "Cancel ride?" gate without
  // letting the rider end up on a half-accepted state.
  useEffect(() => {
    if (acceptStage !== 'destination') return
    window.history.pushState({ tagoAcceptStage: 'destination' }, '')
    const onPop = () => {
      // Re-pin history so subsequent backs hit us again.
      window.history.pushState({ tagoAcceptStage: 'destination' }, '')
      setShowCancelConfirm(true)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [acceptStage])

  // ── Accept — stage 1 (commit) ─────────────────────────────────────────────
  // POSTs `/api/rides/:id/accept` with an EMPTY body so the rider
  // sees the `ride_accepted` broadcast immediately. Destination entry
  // happens on stage 2 via `/driver-destination` (separate endpoint).
  // Matches iOS RideSuggestionPage → DriverDestinationEntryPage flow.
  async function handleAcceptStage1() {
    if (!rideId || !data) return
    setSubmitting(true)
    setError(null)

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch(`/api/rides/${rideId}/accept`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({}),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Failed to accept ride')
        setSubmitting(false)
        return
      }

      const resBody = (await res.json()) as { offer_status?: string }
      trackEvent('driver_accepted', { ride_id: rideId })

      // Standby branch: ride already has a selected driver. Stay on
      // the suggestion screen as standby; never advance to stage 2.
      if (resBody.offer_status === 'standby') {
        setStandbyMode(true)
        setSubmitting(false)
        return
      }

      // Kill the 150s "Responds in" countdown — we're past that gate
      // now. Otherwise it ticks down behind the destination screen and
      // auto-declines a ride the driver already committed to.
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setSubmitting(false)
      setAcceptStage('destination')
    } catch {
      setError('Network error — could not accept ride')
      setSubmitting(false)
    }
  }

  // ── Accept — stage 2 (destination) ────────────────────────────────────────
  // PATCHes `/api/rides/:id/driver-destination` with the driver's
  // destination so the server can compute transit dropoff suggestions,
  // then navigates to the dropoff-selection screen carrying the
  // payload it needs.
  async function handleSubmitDestination() {
    if (!rideId || !data || !driverDestCoords) return
    setSubmitting(true)
    setError(null)

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const destName = selectedDriverDest?.fullAddress ?? driverDestQuery
      const res = await fetch(`/api/rides/${rideId}/driver-destination`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({
          destination_lat: driverDestCoords.lat,
          destination_lng: driverDestCoords.lng,
          destination_name: destName,
        }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Failed to save destination')
        setSubmitting(false)
        return
      }

      const { ride, rider } = data
      const ns = navStateRef.current
      const oLat = ride.origin?.coordinates?.[1] ?? parseFloat(ns?.originLat ?? '')
      const oLng = ride.origin?.coordinates?.[0] ?? parseFloat(ns?.originLng ?? '')
      const dLat = ride.destination?.coordinates?.[1] ?? parseFloat(ns?.destinationLat ?? '')
      const dLng = ride.destination?.coordinates?.[0] ?? parseFloat(ns?.destinationLng ?? '')

      navigate(`/ride/dropoff/${rideId}`, {
        replace: true,
        state: {
          driverDestLat: driverDestCoords.lat,
          driverDestLng: driverDestCoords.lng,
          driverDestName: destName,
          riderName: rider.full_name,
          riderDestName: ride.destination_name ?? ns?.destination ?? null,
          riderDestLat: isNaN(dLat) ? null : dLat,
          riderDestLng: isNaN(dLng) ? null : dLng,
          pickupLat: isNaN(oLat) ? null : oLat,
          pickupLng: isNaN(oLng) ? null : oLng,
        },
      })
    } catch {
      setError('Network error — could not save destination')
      setSubmitting(false)
    }
  }

  // ── Cancel after stage 1 commit ──────────────────────────────────────────
  // Driver is past the point of return — explicit confirm before we
  // release the ride. PATCH /cancel with a reason of "Cancelled after
  // accept" so analytics distinguishes this from a pre-accept decline.
  async function handlePostAcceptCancel() {
    setShowCancelConfirm(false)
    if (!rideId) {
      navigate('/home/driver', { replace: true })
      return
    }
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (token) {
        await fetch(`/api/rides/${rideId}/cancel`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reason: 'Cancelled after accept' }),
        })
      }
    } catch {
      // best-effort
    }
    navigate('/home/driver', { replace: true })
  }

  // ── Places autocomplete handler ───────────────────────────────────────────
  function handleDestQueryChange(val: string) {
    setDriverDestQuery(val)
    setSelectedDriverDest(null)
    setDriverDestCoords(null)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length < 3) {
      setDriverDestResults([])
      return
    }
    debounceRef.current = setTimeout(() => {
      void searchPlaces(val, sessionTokenRef.current).then(setDriverDestResults)
    }, 350)
  }

  async function handleDestSelect(place: PlaceSuggestion) {
    setSelectedDriverDest(place)
    setDriverDestQuery(place.fullAddress)
    setDriverDestResults([])
    const coords = await getPlaceCoordinates(place.placeId, sessionTokenRef.current)
    // End session — regenerate token for next search
    sessionTokenRef.current = crypto.randomUUID()
    if (coords) {
      setDriverDestCoords(coords)
    }
  }

  // ── Get driver's current location ────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setDriverLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* location unavailable */ },
      { enableHighAccuracy: true, timeout: 5000 },
    )
  }, [])

  // ── Fetch polylines once data + coords available ─────────────────────────
  useEffect(() => {
    if (!data) return
    const ns = navStateRef.current
    const oLat = data.ride.origin?.coordinates?.[1] ?? parseFloat(ns?.originLat ?? '')
    const oLng = data.ride.origin?.coordinates?.[0] ?? parseFloat(ns?.originLng ?? '')
    const dLat = data.ride.destination?.coordinates?.[1] ?? parseFloat(ns?.destinationLat ?? '')
    const dLng = data.ride.destination?.coordinates?.[0] ?? parseFloat(ns?.destinationLng ?? '')

    if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) return
    if (oLat === dLat && oLng === dLng) return

    // Use stored polyline if available, otherwise fetch from API
    const storedPolyline = (data.ride as Record<string, unknown>)['route_polyline'] as string | null
    if (storedPolyline) {
      setRidePolyline(storedPolyline)
    } else {
      void getDirectionsByLatLng(oLat, oLng, dLat, dLng).then((result) => {
        if (result?.polyline) setRidePolyline(result.polyline)
      })
    }
  }, [data])

  // ── Fetch driver → pickup polyline once we have driver location ──────────
  useEffect(() => {
    if (!data || !driverLoc) return
    const ns = navStateRef.current
    const oLat = data.ride.origin?.coordinates?.[1] ?? parseFloat(ns?.originLat ?? '')
    const oLng = data.ride.origin?.coordinates?.[0] ?? parseFloat(ns?.originLng ?? '')

    if (isNaN(oLat) || isNaN(oLng)) return

    void getDirectionsByLatLng(driverLoc.lat, driverLoc.lng, oLat, oLng).then((result) => {
      if (result?.polyline) setPickupPolyline(result.polyline)
    })
  }, [data, driverLoc])

  // ── Render ────────────────────────────────────────────────────────────────

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

  if (error) {
    return (
      <div
        data-testid={testId}
        className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6"
      >
        <p className="text-center text-danger" data-testid="error-message">
          {error}
        </p>
        <button
          type="button"
          onClick={() => navigate('/home/driver', { replace: true })}
          className="rounded-2xl bg-primary px-6 py-3 font-semibold text-white"
        >
          Back to Home
        </button>
      </div>
    )
  }

  if (!data) return null

  // ── Standby mode — driver joined after rider already selected someone, or
  // reopened from a ride_request_renewed notification ─────────────────────
  if (standbyMode) {
    return (
      <div
        data-testid={testId}
        className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface px-6"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-warning/15">
          <AppIcon name="bell" className="h-8 w-8 text-primary" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-text-primary">
            {isRenewalStandby ? "You're Back First in Line" : "You're on Standby"}
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed max-w-xs">
            {isRenewalStandby || isRenewalOffer
              ? "The previous driver cancelled. Your offer is active — we'll connect you with the rider shortly."
              : isStandbyRenewal
              ? "The previous driver cancelled. You're back in the queue — we'll match you with the rider shortly."
              : "The rider is already coordinating with another driver. We'll notify you if they cancel so you can take over."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/home/driver', { replace: true })}
          className="rounded-2xl bg-primary px-8 py-3 font-semibold text-white shadow-sm"
          data-testid="standby-home-button"
        >
          Back to Home
        </button>
      </div>
    )
  }

  const { ride, rider } = data
  const ns = navStateRef.current

  // ── Extract origin / destination coordinates ────────────────────────────
  const oLat = ride.origin?.coordinates?.[1] ?? parseFloat(ns?.originLat ?? '')
  const oLng = ride.origin?.coordinates?.[0] ?? parseFloat(ns?.originLng ?? '')
  const dLat = ride.destination?.coordinates?.[1] ?? parseFloat(ns?.destinationLat ?? '')
  const dLng = ride.destination?.coordinates?.[0] ?? parseFloat(ns?.destinationLng ?? '')
  const hasOrigin = !isNaN(oLat) && !isNaN(oLng) && oLat !== 0 && oLng !== 0
  const hasDest = !isNaN(dLat) && !isNaN(dLng) && dLat !== 0 && dLng !== 0
  const hasRoute = hasOrigin && hasDest

  const riderRating = rider.rating_avg?.toFixed(1) ?? '–'
  const progressPct = (secondsLeft / COUNTDOWN_SECONDS) * 100

  // ── Collect all map points for bounds fitting ────────────────────────────
  const mapPoints: Array<{ lat: number; lng: number }> = []
  if (hasOrigin) mapPoints.push({ lat: oLat, lng: oLng })
  if (hasDest) mapPoints.push({ lat: dLat, lng: dLng })
  if (driverLoc) mapPoints.push(driverLoc)

  // ── Stage 2 render — destination entry after the ride is committed ──
  if (acceptStage === 'destination') {
    return (
      <div
        data-testid={testId}
        className="flex h-dvh flex-col bg-surface overflow-y-auto"
      >
        {/* Cancel pill in the header — only escape hatch on this screen */}
        <div
          className="flex items-center justify-start px-4 shrink-0"
          style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
        >
          <button
            type="button"
            onClick={() => setShowCancelConfirm(true)}
            data-testid="destination-cancel-button"
            className="inline-flex items-center gap-1 rounded-full bg-danger/10 border border-danger/25 px-3.5 py-1.5 text-xs font-bold text-danger active:bg-danger/15"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Cancel ride
          </button>
        </div>

        {/* Success hero */}
        <div className="mx-4 mt-2 rounded-2xl bg-success/10 border border-success/25 p-5 text-center" data-testid="destination-success-hero">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-success/20">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-8 w-8 text-success" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-text-primary">Ride accepted</h2>
          <p className="mt-1 text-sm text-text-secondary">
            {data?.rider.full_name ?? 'The rider'} has been notified.
          </p>
        </div>

        {/* Instruction */}
        <div className="mx-4 mt-3">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">
            Where are you headed?
          </p>
          <p className="text-xs text-text-secondary">
            We&apos;ll find transit stations along your route so you can drop off the rider without a detour.
          </p>
        </div>

        {/* Destination search */}
        <div className="mx-4 mt-3" data-testid="driver-destination-card">
          <div className="relative">
            <input
              data-testid="driver-dest-input"
              type="text"
              value={driverDestQuery}
              onChange={(e) => handleDestQueryChange(e.target.value)}
              placeholder="Search your destination..."
              className="w-full rounded-xl border border-border bg-white px-3 py-3 text-base text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {driverDestCoords && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-success" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>

          {driverDestResults.length > 0 && (
            <div className="mt-1 rounded-xl border border-border bg-white shadow-lg max-h-60 overflow-y-auto">
              {driverDestResults.map((place) => (
                <button
                  key={place.placeId}
                  type="button"
                  onClick={() => void handleDestSelect(place)}
                  className="w-full text-left px-3 py-2.5 border-b border-border last:border-0 active:bg-surface transition-colors"
                >
                  <p className="text-sm font-medium text-text-primary truncate">{place.mainText}</p>
                  <p className="text-xs text-text-secondary truncate">{place.secondaryText}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="mx-4 mt-3 text-xs text-danger" data-testid="destination-error">
            {error}
          </p>
        )}

        {/* Continue */}
        <div className="mt-auto px-4 pb-8 pt-4 shrink-0">
          <button
            type="button"
            onClick={() => void handleSubmitDestination()}
            disabled={submitting || !driverDestCoords}
            data-testid="destination-continue-button"
            className="w-full rounded-2xl bg-primary py-3.5 text-center font-semibold text-white shadow-sm active:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Continue'}
          </button>
        </div>

        {/* Cancel confirm dialog */}
        {showCancelConfirm && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-6"
            data-testid="cancel-confirm-dialog"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
              <h3 className="text-base font-bold text-text-primary">Cancel this ride?</h3>
              <p className="mt-2 text-sm text-text-secondary">
                The rider has already been notified you accepted. Cancelling now will release the ride back to other drivers.
              </p>
              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  onClick={() => void handlePostAcceptCancel()}
                  data-testid="cancel-confirm-yes"
                  className="w-full rounded-2xl bg-danger py-3 text-sm font-bold text-white active:opacity-90"
                >
                  Yes, cancel ride
                </button>
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(false)}
                  data-testid="cancel-confirm-keep"
                  className="w-full rounded-2xl border border-border py-3 text-sm font-bold text-text-primary active:bg-surface"
                >
                  Keep ride
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      data-testid={testId}
      className="flex h-dvh flex-col bg-surface overflow-y-auto"
    >
      {/* ── Route map (top) ──────────────────────────────────────────────────── */}
      <div
        className="relative w-full shrink-0"
        style={{ height: '35dvh' }}
        data-testid="map-preview"
      >
        {hasRoute ? (
          <Map
            mapId={MAP_ID}
            defaultCenter={{ lat: (oLat + dLat) / 2, lng: (oLng + dLng) / 2 }}
            defaultZoom={11}
            gestureHandling="cooperative"
            disableDefaultUI
            className="h-full w-full"
          >
            {/* Driver marker (blue car) */}
            {driverLoc && (
              <AdvancedMarker position={driverLoc} title="Your Location">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-primary shadow-lg">
                  <CarMarker size={18} color="#FFFFFF" />
                </div>
              </AdvancedMarker>
            )}
            {/* Rider pickup marker (green) */}
            <AdvancedMarker position={{ lat: oLat, lng: oLng }} title="Pickup">
              <div className="flex h-7 items-center justify-center rounded-full border-[3px] border-white bg-success px-2 shadow-lg text-[10px] font-bold text-white whitespace-nowrap max-w-[140px] truncate">
                {ns?.originAddress?.split(',')[0] ?? 'Pickup'}
              </div>
            </AdvancedMarker>
            {/* Rider destination marker (red) */}
            <AdvancedMarker position={{ lat: dLat, lng: dLng }} title="Destination">
              <div className="flex h-7 items-center justify-center rounded-full border-[3px] border-white bg-danger px-2 shadow-lg text-[10px] font-bold text-white whitespace-nowrap max-w-[140px] truncate">
                {ride.destination_name?.split(',')[0] ?? 'Destination'}
              </div>
            </AdvancedMarker>
            {/* Driver → Pickup polyline (dashed gray) */}
            {pickupPolyline && (
              <RoutePolyline encodedPath={pickupPolyline} color="#9CA3AF" weight={3} fitBounds={false} />
            )}
            {/* Pickup → Destination polyline (blue) */}
            {ridePolyline && (
              <RoutePolyline encodedPath={ridePolyline} color="#4F46E5" weight={4} fitBounds={false} />
            )}
            {/* Fit bounds to all points */}
            {mapPoints.length >= 2 && <MapBoundsFitter points={mapPoints} />}
          </Map>
        ) : (
          <div className="flex h-full items-center justify-center bg-primary-light">
            <p className="text-sm text-text-secondary">Route preview unavailable</p>
          </div>
        )}

        {/* Countdown overlay */}
        <div className="absolute right-3 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 shadow-md backdrop-blur-sm" style={{ top: 'max(0.75rem, calc(env(safe-area-inset-top) + 0.75rem))' }}>
          <span className="text-sm font-semibold text-warning" data-testid="countdown-text">{secondsLeft}s</span>
        </div>
        {/* Back button overlay */}
        <button
          type="button"
          onClick={() => void handleDecline()}
          className="absolute left-3 flex items-center gap-1 rounded-full bg-white/90 px-3 py-1.5 shadow-md backdrop-blur-sm text-sm text-text-secondary"
          style={{ top: 'max(0.75rem, calc(env(safe-area-inset-top) + 0.75rem))' }}
          data-testid="back-button"
        >
          &larr; Back
        </button>
      </div>

      {/* ── Map legend ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-4 py-1.5 bg-white border-b border-border shrink-0">
        <div className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-success" /><span className="text-[10px] font-medium text-text-primary">Pickup</span></div>
        <div className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-danger" /><span className="text-[10px] font-medium text-text-primary">Destination</span></div>
      </div>

      {/* ── Countdown progress bar ──────────────────────────────────────────── */}
      <div className="h-1 bg-border shrink-0">
        <div
          className="h-full bg-warning transition-all duration-1000 ease-linear"
          style={{ width: `${progressPct}%` }}
          data-testid="countdown-bar"
        />
      </div>

      {/* ── Rider card ──────────────────────────────────────────────────────── */}
      <div className="mx-4 mt-3 rounded-2xl bg-white p-4 shadow-sm" data-testid="rider-card">
        <div className="flex items-center gap-3">
          {rider.avatar_url ? (
            <img
              src={rider.avatar_url}
              alt=""
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-light">
              <AppIcon name="person" className="h-5 w-5 text-text-secondary" />
            </div>
          )}
          <div className="flex-1">
            <p className="font-semibold text-text-primary" data-testid="rider-name">
              {rider.full_name ?? 'Rider'}
            </p>
            <div className="flex items-center gap-1">
              <span className="text-warning">★</span>
              <span className="text-sm text-text-secondary" data-testid="rider-rating">
                {riderRating}
              </span>
              <span className="text-xs text-text-secondary">
                ({rider.rating_count} rides)
              </span>
            </div>
          </div>
          {/* Destination snippet */}
          {ride.destination_name && (
            <div className="text-right max-w-[120px]">
              <p className="text-[10px] text-text-secondary">Going to</p>
              <p className="text-xs font-medium text-text-primary truncate">{ride.destination_name}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Route & ride stats ────────────────────────────────────────────────── */}
      {(() => {
        const pickupAddr = ns?.originAddress || null
        const destAddr = ride.destination_name || ns?.destination || null
        const hasRoute = pickupAddr || destAddr
        const hasStats = ns?.estimatedEarnings || ns?.distanceKm
        if (!hasRoute && !hasStats) return null
        return (
        <div className="mx-4 mt-3 rounded-2xl bg-white p-4 shadow-sm space-y-3" data-testid="ride-info-card">
          {/* Pickup → Destination addresses */}
          {hasRoute && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-success shrink-0" />
                <p className="text-xs text-text-primary truncate">{pickupAddr ? `Near ${pickupAddr}` : 'Nearby pickup'}</p>
              </div>
              <div className="ml-[4.5px] h-2.5 border-l border-dashed border-text-secondary/30" />
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                <p className="text-xs font-medium text-text-primary truncate">{destAddr ?? 'Destination'}</p>
              </div>
            </div>
          )}

          {/* Stats row: earnings / distance / est. time */}
          {(() => {
            // Prefer nav state values, fall back to computed from directions API
            const navDistKm = Number(navState?.distanceKm)
            const distKm = !isNaN(navDistKm) && navDistKm > 0 ? navDistKm : computedStats?.distanceKm
            const distMi = distKm != null ? distKm * 0.621371 : null
            const etaMin = computedStats?.durationMin
              ? Math.max(1, Math.round(computedStats.durationMin))
              : distMi != null ? Math.max(1, Math.round(distMi / 35 * 60)) : null
            const navEarnings = navState?.estimatedEarnings
            const earnings = navEarnings && navEarnings !== '–' && navEarnings !== '$0.00'
              ? navEarnings
              : computedStats?.driverEarns ?? null
            if (!earnings && distMi == null) return null
            return (
              <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface p-2.5">
                <div className="text-center">
                  <p className="text-lg font-bold text-success">{earnings ?? '\u2013'}</p>
                  <p className="text-[10px] text-text-secondary">You earn</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-text-primary">{distMi != null ? `${distMi.toFixed(1)} mi` : '\u2013'}</p>
                  <p className="text-[10px] text-text-secondary">Distance</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-text-primary">{etaMin != null ? `~${etaMin}m` : '\u2013'}</p>
                  <p className="text-[10px] text-text-secondary">Est. time</p>
                </div>
              </div>
            )
          })()}

          <p className="text-[10px] text-text-secondary italic">
            Fare may vary based on actual route. You can set your own drop-off point after accepting.
          </p>
        </div>
        )
      })()}

      {/* ── Single-decision disclaimer (Sprint 2 W-T1-D3) ─────────────────
          Replaces the driver-destination card on Screen 1. The
          destination prompt now lives on stage 2 — the only decision
          here is Accept vs Decline. Matches iOS RideSuggestionPage
          (`disclaimerCard`, 2026-05-04). */}
      <div className="mx-4 mt-3 rounded-2xl bg-primary/5 border border-primary/20 p-3.5 shadow-sm flex items-start gap-2" data-testid="accept-disclaimer">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden="true">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2h-1v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
        <p className="text-xs text-text-primary leading-snug">
          Only accept if you&apos;re heading this direction now or already on your way and can pick up in a few minutes.
        </p>
      </div>

      {/* ── Actions (side-by-side) ────────────────────────────────────────────── */}
      <div className="mt-auto px-4 pb-8 pt-4 shrink-0 flex gap-3">
        <button
          type="button"
          onClick={openDeclineSheet}
          disabled={submitting}
          className="flex-1 rounded-2xl border-2 border-danger py-3 text-center font-semibold text-danger active:bg-danger active:text-white disabled:opacity-50"
          data-testid="decline-button"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => void handleAcceptStage1()}
          disabled={submitting}
          className="flex-[2] rounded-2xl bg-success py-3.5 text-center font-semibold text-white shadow-sm active:opacity-90 disabled:opacity-50"
          data-testid="accept-button"
        >
          {submitting ? 'Accepting\u2026' : 'Accept Ride'}
        </button>
      </div>

      {/* \u2500\u2500 Decline reason sheet (Sprint 2 W-T1-D1) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
      {showDeclineSheet && (
        <DeclineReasonSheet
          onSubmit={submitDeclineWithReason}
          onCancel={closeDeclineSheet}
        />
      )}
    </div>
  )
}
