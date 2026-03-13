import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/fare'
import { getDirectionsByLatLng } from '@/lib/directions'
import { RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
import type { Ride, User } from '@/types/database'

const COUNTDOWN_SECONDS = 90

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

  const [data, setData] = useState<RideWithRider | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS)
  const [submitting, setSubmitting] = useState(false)
  // Polyline from rider pickup → destination
  const [ridePolyline, setRidePolyline] = useState<string | null>(null)
  // Polyline from driver → rider pickup
  const [pickupPolyline, setPickupPolyline] = useState<string | null>(null)
  // Driver's current location
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

      setData({ ride, rider })
      setLoading(false)
    }

    void fetchRide()
  }, [rideId, navigate])

  // ── Decline helper ────────────────────────────────────────────────────────
  const handleDecline = useCallback(async () => {
    if (!rideId) return
    setSubmitting(true)
    await supabase
      .from('rides')
      .update({ status: 'cancelled' as const })
      .eq('id', rideId)
    navigate('/home/driver', { replace: true })
  }, [rideId, navigate])

  // ── Countdown timer (auto-decline on expiry) ─────────────────────────────
  useEffect(() => {
    if (loading || error) return

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
  }, [loading, error, handleDecline])

  // ── Accept ────────────────────────────────────────────────────────────────
  async function handleAccept() {
    if (!rideId) return
    setSubmitting(true)

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch(`/api/rides/${rideId}/accept`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Failed to accept ride')
        setSubmitting(false)
        return
      }

      navigate(`/ride/messaging/${rideId}`, { replace: true })
    } catch {
      setError('Network error — could not accept ride')
      setSubmitting(false)
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

    // Fetch pickup → destination polyline
    void getDirectionsByLatLng(oLat, oLng, dLat, dLng).then((result) => {
      if (result?.polyline) setRidePolyline(result.polyline)
    })
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
          className="rounded-xl bg-primary px-6 py-3 font-semibold text-white"
        >
          Back to Home
        </button>
      </div>
    )
  }

  if (!data) return null

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

  const estimatedEarnings = ride.fare_cents
    ? formatCents(ride.fare_cents - Math.round(ride.fare_cents * 0.15))
    : (ns?.estimatedEarnings ?? '–')
  const fareCents = ride.fare_cents ? formatCents(ride.fare_cents) : '–'
  const riderRating = rider.rating_avg?.toFixed(1) ?? '–'
  const progressPct = (secondsLeft / COUNTDOWN_SECONDS) * 100

  // ── Collect all map points for bounds fitting ────────────────────────────
  const mapPoints: Array<{ lat: number; lng: number }> = []
  if (hasOrigin) mapPoints.push({ lat: oLat, lng: oLng })
  if (hasDest) mapPoints.push({ lat: dLat, lng: dLng })
  if (driverLoc) mapPoints.push(driverLoc)

  return (
    <div
      data-testid={testId}
      className="flex min-h-dvh flex-col bg-surface"
    >
      {/* ── Route map (top, Uber-style) ─────────────────────────────────────── */}
      <div
        className="relative w-full"
        style={{ height: '40dvh' }}
        data-testid="map-preview"
      >
        {hasRoute ? (
          <Map
            mapId="8cb10228438378796542e8f0"
            defaultCenter={{ lat: (oLat + dLat) / 2, lng: (oLng + dLng) / 2 }}
            defaultZoom={11}
            gestureHandling="cooperative"
            disableDefaultUI
            className="h-full w-full"
          >
            {/* Driver marker (blue car) */}
            {driverLoc && (
              <AdvancedMarker position={driverLoc} title="Your Location">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-blue-600 shadow-lg text-xs">
                  🚗
                </div>
              </AdvancedMarker>
            )}
            {/* Rider pickup marker (green P) */}
            <AdvancedMarker position={{ lat: oLat, lng: oLng }} title="Pickup">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-green-500 shadow-lg text-xs font-bold text-white">
                P
              </div>
            </AdvancedMarker>
            {/* Final destination marker (red D) */}
            <AdvancedMarker position={{ lat: dLat, lng: dLng }} title="Destination">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-red-500 shadow-lg text-xs font-bold text-white">
                D
              </div>
            </AdvancedMarker>
            {/* Driver → Pickup polyline (dashed gray) */}
            {pickupPolyline && (
              <RoutePolyline encodedPath={pickupPolyline} color="#6B7280" weight={3} fitBounds={false} />
            )}
            {/* Pickup → Destination polyline (blue) */}
            {ridePolyline && (
              <RoutePolyline encodedPath={ridePolyline} color="#4F46E5" weight={4} fitBounds={false} />
            )}
            {/* Fit bounds to all 3 points */}
            {mapPoints.length >= 2 && <MapBoundsFitter points={mapPoints} />}
          </Map>
        ) : (
          <div className="flex h-full items-center justify-center bg-primary-light">
            <p className="text-sm text-text-secondary">Route preview unavailable</p>
          </div>
        )}

        {/* Countdown overlay */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 shadow-md backdrop-blur-sm">
          <span className="text-sm font-semibold text-warning" data-testid="countdown-text">{secondsLeft}s</span>
        </div>
        {/* Back button overlay */}
        <button
          type="button"
          onClick={() => void handleDecline()}
          className="absolute top-3 left-3 flex items-center gap-1 rounded-full bg-white/90 px-3 py-1.5 shadow-md backdrop-blur-sm text-sm text-text-secondary"
          data-testid="back-button"
        >
          ← Back
        </button>
      </div>

      {/* ── Countdown progress bar ──────────────────────────────────────────── */}
      <div className="h-1 bg-border">
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
              <span className="text-xl">🧑</span>
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
          <div className="text-right">
            <p className="text-xs text-text-secondary">You Earn</p>
            <p className="text-lg font-bold text-success" data-testid="driver-earnings">
              {estimatedEarnings}
            </p>
          </div>
        </div>
      </div>

      {/* ── Route summary ───────────────────────────────────────────────────── */}
      <div className="mx-4 mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-text-secondary">Total Fare</p>
            <p className="text-lg font-bold text-text-primary" data-testid="total-fare">
              {fareCents}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-text-secondary">Distance</p>
            <p className="text-lg font-bold text-text-primary">
              {ns?.distanceKm ? `${(Number(ns.distanceKm) * 0.621371).toFixed(1)} mi` : '–'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <div className="mt-auto px-4 pb-8 pt-4">
        <button
          type="button"
          onClick={() => void handleAccept()}
          disabled={submitting}
          className="mb-3 w-full rounded-xl bg-success py-3.5 text-center font-semibold text-white active:opacity-90 disabled:opacity-50"
          data-testid="accept-button"
        >
          {submitting ? 'Accepting…' : 'Accept Ride'}
        </button>
        <button
          type="button"
          onClick={() => void handleDecline()}
          disabled={submitting}
          className="w-full rounded-xl border-2 border-danger py-3 text-center font-semibold text-danger active:bg-danger active:text-white disabled:opacity-50"
          data-testid="decline-button"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
