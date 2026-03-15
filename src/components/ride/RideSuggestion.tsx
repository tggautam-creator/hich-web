import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import { getDirectionsByLatLng } from '@/lib/directions'
import { searchPlaces, getPlaceCoordinates } from '@/lib/places'
import type { PlaceSuggestion } from '@/lib/places'
import { RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
import CarMarker from '@/components/map/CarMarker'
import { MAP_ID } from '@/lib/mapConstants'
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

  // ── Driver destination state ──────────────────────────────────────────────
  const [driverDestQuery, setDriverDestQuery] = useState('')
  const [driverDestResults, setDriverDestResults] = useState<PlaceSuggestion[]>([])
  const [selectedDriverDest, setSelectedDriverDest] = useState<PlaceSuggestion | null>(null)
  const [driverDestCoords, setDriverDestCoords] = useState<{ lat: number; lng: number } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const routineAutoFilled = useRef(false)

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
      trackEvent('driver_notified', { ride_id: rideId })
    }

    void fetchRide()
  }, [rideId, navigate])

  // ── Auto-fill destination from driver routines ─────────────────────────────
  useEffect(() => {
    if (routineAutoFilled.current) return
    routineAutoFilled.current = true

    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: routines } = await supabase
        .from('driver_routines')
        .select('dest_address, destination')
        .eq('user_id', session.user.id)
        .eq('is_active', true)
        .limit(1)

      if (routines?.[0]?.dest_address) {
        setDriverDestQuery(routines[0].dest_address)
        const dest = routines[0].destination as unknown as { type: string; coordinates: number[] } | null
        if (dest?.coordinates) {
          setDriverDestCoords({ lat: dest.coordinates[1], lng: dest.coordinates[0] })
        }
      }
    })()
  }, [rideId])

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
    if (!rideId || !data) return
    setSubmitting(true)

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const acceptBody: Record<string, unknown> = {}
      if (driverDestCoords) {
        acceptBody['driver_destination_lat'] = driverDestCoords.lat
        acceptBody['driver_destination_lng'] = driverDestCoords.lng
        acceptBody['driver_destination_name'] = selectedDriverDest?.fullAddress ?? driverDestQuery
      }
      const res = await fetch(`/api/rides/${rideId}/accept`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify(acceptBody),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Failed to accept ride')
        setSubmitting(false)
        return
      }

      trackEvent('driver_accepted', { ride_id: rideId })

      const { ride, rider } = data
      const ns = navStateRef.current
      const oLat = ride.origin?.coordinates?.[1] ?? parseFloat(ns?.originLat ?? '')
      const oLng = ride.origin?.coordinates?.[0] ?? parseFloat(ns?.originLng ?? '')
      const dLat = ride.destination?.coordinates?.[1] ?? parseFloat(ns?.destinationLat ?? '')
      const dLng = ride.destination?.coordinates?.[0] ?? parseFloat(ns?.destinationLng ?? '')

      if (driverDestCoords) {
        // Navigate to drop-off selection page
        navigate(`/ride/dropoff/${rideId}`, {
          replace: true,
          state: {
            driverDestLat: driverDestCoords.lat,
            driverDestLng: driverDestCoords.lng,
            driverDestName: selectedDriverDest?.fullAddress ?? driverDestQuery,
            riderName: rider.full_name,
            riderDestName: ride.destination_name ?? ns?.destination ?? null,
            riderDestLat: isNaN(dLat) ? null : dLat,
            riderDestLng: isNaN(dLng) ? null : dLng,
            pickupLat: isNaN(oLat) ? null : oLat,
            pickupLng: isNaN(oLng) ? null : oLng,
          },
        })
      } else {
        // No destination entered — go straight to messaging
        navigate(`/ride/messaging/${rideId}`, {
          replace: true,
          state: { driverDestinationSet: false },
        })
      }
    } catch {
      setError('Network error — could not accept ride')
      setSubmitting(false)
    }
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
      void searchPlaces(val).then(setDriverDestResults)
    }, 350)
  }

  async function handleDestSelect(place: PlaceSuggestion) {
    setSelectedDriverDest(place)
    setDriverDestQuery(place.fullAddress)
    setDriverDestResults([])
    const coords = await getPlaceCoordinates(place.placeId)
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
          className="rounded-2xl bg-primary px-6 py-3 font-semibold text-white"
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
            {/* Rider pickup marker (green P) */}
            <AdvancedMarker position={{ lat: oLat, lng: oLng }} title="Pickup">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-success shadow-lg text-xs font-bold text-white">
                P
              </div>
            </AdvancedMarker>
            {/* Final destination marker (red D) */}
            <AdvancedMarker position={{ lat: dLat, lng: dLng }} title="Destination">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-danger shadow-lg text-xs font-bold text-white">
                D
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
          &larr; Back
        </button>
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
          {/* Destination snippet */}
          {ride.destination_name && (
            <div className="text-right max-w-[120px]">
              <p className="text-[10px] text-text-secondary">Going to</p>
              <p className="text-xs font-medium text-text-primary truncate">{ride.destination_name}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Driver destination input ──────────────────────────────────────────── */}
      <div className="mx-4 mt-3 rounded-2xl bg-primary/5 border border-primary/20 p-4 shadow-sm" data-testid="driver-destination-card">
        <p className="text-xs font-semibold text-primary mb-1">Where are you headed?</p>
        <p className="text-[10px] text-text-secondary mb-2.5">
          We&apos;ll find transit stations along your route so you can drop off the rider without a detour.
        </p>
        <div className="relative">
          <input
            data-testid="driver-dest-input"
            type="text"
            value={driverDestQuery}
            onChange={(e) => handleDestQueryChange(e.target.value)}
            placeholder="Search your destination..."
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-base text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {driverDestCoords && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-success" aria-hidden="true">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
              </svg>
            </div>
          )}
        </div>

        {/* Autocomplete results dropdown */}
        {driverDestResults.length > 0 && (
          <div className="mt-1 rounded-xl border border-border bg-white shadow-lg max-h-40 overflow-y-auto">
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

      {/* ── Actions (side-by-side) ────────────────────────────────────────────── */}
      <div className="mt-auto px-4 pb-8 pt-4 shrink-0 flex gap-3">
        <button
          type="button"
          onClick={() => void handleDecline()}
          disabled={submitting}
          className="flex-1 rounded-2xl border-2 border-danger py-3 text-center font-semibold text-danger active:bg-danger active:text-white disabled:opacity-50"
          data-testid="decline-button"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => void handleAccept()}
          disabled={submitting || !driverDestCoords}
          className="flex-[2] rounded-2xl bg-success py-3.5 text-center font-semibold text-white shadow-sm active:opacity-90 disabled:opacity-50"
          data-testid="accept-button"
        >
          {submitting ? 'Accepting\u2026' : !driverDestCoords ? 'Enter destination first' : 'Accept Ride'}
        </button>
      </div>
    </div>
  )
}
