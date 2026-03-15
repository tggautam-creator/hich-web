import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { calculateInterceptPoint, haversineMetres } from '@/lib/geo'
import { reverseGeocode } from '@/lib/geocode'
import { decodePolyline, RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
import CarMarker from '@/components/map/CarMarker'
import { MAP_ID } from '@/lib/mapConstants'
import { useAuthStore } from '@/stores/authStore'
import DriverQrSheet from '@/components/ride/DriverQrSheet'
import EmergencySheet from '@/components/ui/EmergencySheet'
import type { Ride, User, GeoPoint } from '@/types/database'

interface PickupLocationState {
  mode?: 'pickup' | 'dropoff'
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverPickupPageProps {
  'data-testid'?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WALKING_SPEED_MS = 1.4
const MAX_WALK_M = 420 // 5 min × 1.4 m/s

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriverPickupPage({ 'data-testid': testId }: DriverPickupPageProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const profile = useAuthStore((s) => s.profile)
  const locationState = location.state as PickupLocationState | null
  const isDropoffMode = locationState?.mode === 'dropoff'

  const [ride, setRide] = useState<Ride | null>(null)
  const [rider, setRider] = useState<Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg' | 'rating_count'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [note, setNote] = useState('')

  // QR sheet state (en-route mode)
  const [showQr, setShowQr] = useState(false)
  const [emergencyOpen, setEmergencyOpen] = useState(false)
  const [unreadChat, setUnreadChat] = useState(false)

  // Pickup pin position (driver can drag)
  const [pinLat, setPinLat] = useState<number | null>(null)
  const [pinLng, setPinLng] = useState<number | null>(null)
  const [walkEta, setWalkEta] = useState<number | null>(null) // seconds
  const [walkDist, setWalkDist] = useState<number | null>(null) // metres
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [toastType, setToastType] = useState<'error' | 'success'>('error')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Rider position (from ride origin)
  const riderPos = useMemo(() => ride?.origin
    ? { lat: (ride.origin as GeoPoint).coordinates[1], lng: (ride.origin as GeoPoint).coordinates[0] }
    : null, [ride?.origin])

  // Driver position (from profile location or route start)
  const driverPos = useMemo(() => profile?.home_location
    ? { lat: (profile.home_location as GeoPoint).coordinates[1], lng: (profile.home_location as GeoPoint).coordinates[0] }
    : null, [profile?.home_location])

  // Whether this is the en-route view (pickup already confirmed)
  const isEnRoute = ride?.pickup_confirmed === true && !isDropoffMode

  // Pickup point coordinates for en-route view
  const pickupPos = useMemo(() => ride?.pickup_point
    ? { lat: (ride.pickup_point as GeoPoint).coordinates[1], lng: (ride.pickup_point as GeoPoint).coordinates[0] }
    : null, [ride?.pickup_point])

  // Live driver GPS (for en-route view)
  const [liveDriverLat, setLiveDriverLat] = useState<number | null>(null)
  const [liveDriverLng, setLiveDriverLng] = useState<number | null>(null)
  const [enRoutePolyline, setEnRoutePolyline] = useState<string | null>(null)
  const [pickupAddress, setPickupAddress] = useState<string | null>(null)

  // ── Fetch ride + rider info ──────────────────────────────────────────────
  useEffect(() => {
    if (!rideId) {
      navigate('/home/driver', { replace: true })
      return
    }

    async function fetchData() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Not authenticated')
        setLoading(false)
        return
      }

      const { data: rideData, error: rideErr } = await supabase
        .from('rides')
        .select('*')
        .eq('id', rideId as string)
        .single()

      if (rideErr || !rideData) {
        setError('Could not load ride details')
        setLoading(false)
        return
      }

      setRide(rideData)

      // Fetch rider info
      const { data: riderData } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, rating_avg, rating_count')
        .eq('id', rideData.rider_id)
        .single()

      if (riderData) setRider(riderData)

      // If pickup is already confirmed, skip pin calculation
      if (rideData.pickup_confirmed) {
        setLoading(false)
        return
      }

      // Determine initial pin based on mode
      const riderOrigin = rideData.origin as GeoPoint
      const riderLat = riderOrigin.coordinates[1]
      const riderLng = riderOrigin.coordinates[0]

      if (isDropoffMode) {
        // Dropoff mode: start pin at current destination
        if (rideData.destination) {
          const dest = rideData.destination as GeoPoint
          setPinLat(dest.coordinates[1])
          setPinLng(dest.coordinates[0])
        } else {
          // No destination yet — use rider origin as fallback
          setPinLat(riderLat)
          setPinLng(riderLng)
        }
      } else {
        // Pickup mode: compute intercept point along route
        let initialLat = riderLat
        let initialLng = riderLng

        if (rideData.destination) {
          const dest = rideData.destination as GeoPoint
          try {
            const dirResp = await fetch(
              `/api/directions?originLat=${riderLat}&originLng=${riderLng}&destLat=${dest.coordinates[1]}&destLng=${dest.coordinates[0]}`,
              { headers: { Authorization: `Bearer ${session.access_token}` } },
            )
            if (dirResp.ok) {
              const dirData = (await dirResp.json()) as { polyline?: string }
              if (dirData.polyline) {
                const routePoints = decodePolyline(dirData.polyline)
                const intercept = calculateInterceptPoint(routePoints, riderLat, riderLng)
                if (intercept) {
                  initialLat = intercept.lat
                  initialLng = intercept.lng
                }
              }
            }
          } catch {
            // Fall back to rider origin
          }
        }

        setPinLat(initialLat)
        setPinLng(initialLng)

        // Compute initial walk ETA (pickup mode only)
        const dist = haversineMetres(riderLat, riderLng, initialLat, initialLng)
        setWalkDist(Math.round(dist))
        setWalkEta(Math.round(dist / WALKING_SPEED_MS))
      }

      setLoading(false)
    }

    void fetchData()
  }, [rideId, navigate, profile, isDropoffMode])

  // ── Reverse geocode pickup point for address display ────────────────────
  useEffect(() => {
    if (!pickupPos) return
    void reverseGeocode(pickupPos.lat, pickupPos.lng).then(setPickupAddress)
  }, [pickupPos])

  // ── Realtime: listen for ride_started and rider_signal ──────────────────
  useEffect(() => {
    if (!profile?.id || !rideId) return

    const pickupChannel = supabase
      .channel(`driver-pickup:${profile.id}`)
      .on('broadcast', { event: 'ride_started' }, () => {
        navigate(`/ride/active-driver/${rideId}`, { replace: true })
      })
      .subscribe()

    // Listen on the rider:{driverId} channel for signal events from the rider
    const riderChannel = supabase
      .channel(`rider:${profile.id}`)
      .on('broadcast', { event: 'rider_signal' }, () => {
        setToastMsg('Your rider is at the pickup point!')
        setToastType('success')
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToastMsg(null), 5000)
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(pickupChannel)
      void supabase.removeChannel(riderChannel)
    }
  }, [profile?.id, rideId, navigate])

  // ── Listen for new chat messages (unread badge) ────────────────────────
  useEffect(() => {
    if (!rideId) return
    const ch = supabase
      .channel(`chat-badge:${rideId}`)
      .on('broadcast', { event: 'new_message' }, () => setUnreadChat(true))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [rideId])

  // ── Live GPS tracking for en-route view ──────────────────────────────────
  useEffect(() => {
    if (!isEnRoute || !('geolocation' in navigator)) return

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setLiveDriverLat(pos.coords.latitude)
        setLiveDriverLng(pos.coords.longitude)
      },
      () => { /* silently fail */ },
      { enableHighAccuracy: true, maximumAge: 5000 },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [isEnRoute])

  // ── Fetch route polyline from driver to pickup ───────────────────────────
  useEffect(() => {
    if (!isEnRoute || liveDriverLat === null || liveDriverLng === null || !pickupPos) return

    async function fetchRoute() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const resp = await fetch(
          `/api/directions?originLat=${liveDriverLat}&originLng=${liveDriverLng}&destLat=${pickupPos!.lat}&destLng=${pickupPos!.lng}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        )
        if (resp.ok) {
          const data = (await resp.json()) as { polyline?: string }
          if (data.polyline) setEnRoutePolyline(data.polyline)
        }
      } catch {
        // non-fatal
      }
    }

    void fetchRoute()
    // Only fetch once when GPS first locks, not on every tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnRoute, liveDriverLat !== null, pickupPos?.lat, pickupPos?.lng])

  // ── Handle pin drag ──────────────────────────────────────────────────────
  const handleDragEnd = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return

    const newLat = e.latLng.lat()
    const newLng = e.latLng.lng()

    if (!isDropoffMode) {
      // Pickup mode: enforce walking distance constraint
      if (!riderPos) return
      const dist = haversineMetres(riderPos.lat, riderPos.lng, newLat, newLng)

      if (dist > MAX_WALK_M) {
        setToastMsg("Rider can't walk that far")
        setToastType('error')
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToastMsg(null), 3000)
        return
      }

      setWalkDist(Math.round(dist))
      setWalkEta(Math.round(dist / WALKING_SPEED_MS))
    }

    setPinLat(newLat)
    setPinLng(newLng)
  }, [riderPos, isDropoffMode])

  // ── Confirm pickup or dropoff ──────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (!rideId || pinLat === null || pinLng === null) return
    setSubmitting(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Not authenticated')
        setSubmitting(false)
        return
      }

      const endpoint = isDropoffMode
        ? `/api/rides/${rideId}/dropoff-point`
        : `/api/rides/${rideId}/pickup-point`

      const body = isDropoffMode
        ? { lat: pinLat, lng: pinLng, name: note.trim() || undefined }
        : { lat: pinLat, lng: pinLng, note: note.trim() || undefined }

      const resp = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      })

      if (!resp.ok) {
        const respBody = (await resp.json()) as { error?: { message?: string } }
        setError(respBody.error?.message ?? `Failed to set ${isDropoffMode ? 'dropoff' : 'pickup'} point`)
        setSubmitting(false)
        return
      }

      // Navigate back to chat so rider can accept the suggestion
      navigate(`/ride/messaging/${rideId}`, { replace: true })
    } catch {
      setError('Network error — please try again.')
      setSubmitting(false)
    }
  }, [rideId, pinLat, pinLng, note, navigate, isDropoffMode])

  // ── Open Google Maps for driving navigation ────────────────────────────
  const openNavigation = useCallback(() => {
    const pos = pickupPos
    if (!pos) return
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${pos.lat},${pos.lng}&travelmode=driving`,
      '_blank',
    )
  }, [pickupPos])

  // ── Map center ─────────────────────────────────────────────────────────
  const destPos = useMemo(() => ride?.destination
    ? { lat: (ride.destination as GeoPoint).coordinates[1], lng: (ride.destination as GeoPoint).coordinates[0] }
    : null, [ride?.destination])

  const mapCenter = isEnRoute
    ? (pickupPos ?? { lat: 38.5382, lng: -121.7617 })
    : isDropoffMode
      ? (destPos ?? riderPos ?? { lat: 38.5382, lng: -121.7617 })
      : (riderPos ?? { lat: 38.5382, lng: -121.7617 })

  const walkMinutes = walkEta !== null ? Math.ceil(walkEta / 60) : null
  const walkFeet = walkDist !== null ? Math.round(walkDist * 3.28084) : 0

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div data-testid={testId ?? 'driver-pickup-page'} className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!ride) {
    return (
      <div data-testid={testId ?? 'driver-pickup-page'} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6">
        <p className="text-center text-danger" data-testid="error-message">{error ?? 'Ride not found'}</p>
        <button type="button" onClick={() => navigate('/home/driver', { replace: true })} className="rounded-2xl bg-primary px-6 py-3 font-semibold text-white">
          Back to Home
        </button>
      </div>
    )
  }

  // ── En-Route View (pickup confirmed) ───────────────────────────────────
  if (isEnRoute) {
    return (
      <div data-testid={testId ?? 'driver-pickup-page'} className="flex min-h-dvh flex-col bg-white font-sans">

        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 border-b border-border bg-white z-10"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)', paddingBottom: '0.75rem' }}
        >
          <button
            data-testid="back-button"
            onClick={() => navigate(`/ride/messaging/${rideId as string}`, { replace: true })}
            className="p-1 shrink-0 text-text-primary active:opacity-60"
            aria-label="Go back"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
              <path d="M19 12H5" /><path d="m12 5-7 7 7 7" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-text-primary flex-1">Drive to Pickup</h1>
          <button
            data-testid="emergency-button"
            onClick={() => setEmergencyOpen(true)}
            aria-label="Emergency"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger active:bg-danger/20 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4.5 w-4.5" aria-hidden="true">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z" />
            </svg>
          </button>
        </div>

        {/* Map */}
        <div className="flex-1 relative" style={{ minHeight: '40dvh' }}>
          <Map
            data-testid="pickup-map"
            mapId={MAP_ID}
            defaultCenter={mapCenter}
            defaultZoom={15}
            gestureHandling="greedy"
            disableDefaultUI
            className="absolute inset-0"
          >
            {/* Pickup pin */}
            {pickupPos && (
              <AdvancedMarker position={pickupPos} title="Pickup point">
                <div data-testid="pickup-pin" className="flex flex-col items-center">
                  <div className="bg-success text-white rounded-full px-2 py-1 text-xs font-bold shadow-lg mb-1">
                    PICKUP
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8 text-success drop-shadow-md" aria-hidden="true">
                    <path d="M12 0C7.31 0 3.5 3.81 3.5 8.5c0 7.94 7.81 14.66 8.14 14.93a.5.5 0 0 0 .72 0C12.69 23.16 20.5 16.44 20.5 8.5 20.5 3.81 16.69 0 12 0zm0 12a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>
                  </svg>
                </div>
              </AdvancedMarker>
            )}

            {/* Rider origin — blue dot */}
            {riderPos && (
              <AdvancedMarker position={riderPos} title="Rider location">
                <div data-testid="rider-marker" className="relative flex items-center justify-center">
                  <span className="absolute h-6 w-6 rounded-full bg-primary/30 animate-ping" />
                  <span className="relative h-3 w-3 rounded-full bg-primary border-2 border-white shadow-md" />
                </div>
              </AdvancedMarker>
            )}

            {/* Live driver marker */}
            {liveDriverLat !== null && liveDriverLng !== null && (
              <AdvancedMarker position={{ lat: liveDriverLat, lng: liveDriverLng }} title="You">
                <div data-testid="driver-live-marker">
                  <CarMarker size={32} color="#FFFFFF" />
                </div>
              </AdvancedMarker>
            )}

            {/* Route polyline: driver → pickup */}
            {enRoutePolyline && (
              <RoutePolyline
                encodedPath={enRoutePolyline}
                color="#22C55E"
                weight={5}
                fitBounds={false}
              />
            )}

            {/* Fit map to driver + pickup */}
            {liveDriverLat !== null && liveDriverLng !== null && pickupPos && (
              <MapBoundsFitter points={[
                { lat: liveDriverLat, lng: liveDriverLng },
                pickupPos,
              ]} />
            )}
          </Map>

          {/* Toast notification (rider signal, errors, etc.) */}
          {toastMsg && (
            <div
              data-testid="toast"
              className={`absolute bottom-3 left-3 right-3 text-white rounded-2xl px-4 py-3 text-sm font-medium text-center shadow-lg z-10 ${toastType === 'success' ? 'bg-success' : 'bg-danger'}`}
            >
              {toastMsg}
            </div>
          )}
        </div>

        {/* Bottom info */}
        <div className="shrink-0">

          {/* Compact rider info + route */}
          <div className="px-4 pt-3 pb-2 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              {rider ? (
                rider.avatar_url ? (
                  <img src={rider.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                    {rider.full_name?.[0]?.toUpperCase() ?? '?'}
                  </div>
                )
              ) : null}
              <div className="flex-1 min-w-0">
                <p data-testid="rider-name" className="text-sm font-semibold text-text-primary truncate">
                  {rider?.full_name ?? 'Rider'}
                </p>
                <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                  {rider?.rating_avg != null && <span>⭐ {rider.rating_avg.toFixed(1)}</span>}
                  {(!rider?.rating_count || rider.rating_count === 0) && <span className="text-warning">New</span>}
                </div>
              </div>
            </div>

            {/* Compact route summary */}
            <div className="space-y-1 text-xs">
              {pickupPos && (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-success shrink-0" />
                  <span className="text-text-primary truncate" data-testid="pickup-address">
                    {ride.pickup_note ?? pickupAddress ?? 'Pickup point'}
                  </span>
                </div>
              )}
              {(ride.driver_destination_name ?? ride.destination_name) && (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                  <span className="text-text-primary truncate">
                    {ride.driver_destination_name ?? ride.destination_name}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="px-4 pt-2 pb-3 space-y-2" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
            {/* Show QR — prominent full-width button */}
            <button
              data-testid="show-qr-button"
              onClick={() => setShowQr(true)}
              className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-primary py-4 text-base font-semibold text-white active:bg-primary/90 transition-colors shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="4" height="4" rx="0.5" />
                <line x1="21" y1="14" x2="21" y2="21" />
                <line x1="14" y1="21" x2="21" y2="21" />
              </svg>
              Show QR to Start Ride
            </button>

            {/* Navigate + Chat grid */}
            <div className="grid grid-cols-2 gap-3">
              <button
                data-testid="navigate-button"
                onClick={openNavigation}
                className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-surface py-3 active:bg-border transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
                  <polygon points="3 11 22 2 13 21 11 13 3 11" />
                </svg>
                <span className="text-xs font-medium text-text-primary">Navigate to Pickup</span>
              </button>

              <button
                data-testid="message-rider-button"
                onClick={() => { setUnreadChat(false); navigate(`/ride/messaging/${rideId as string}`) }}
                className="relative flex flex-col items-center justify-center gap-1 rounded-2xl bg-surface py-3 active:bg-border transition-colors"
              >
                {unreadChat && (
                  <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-danger" />
                )}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="text-xs font-medium text-text-primary">Chat</span>
              </button>
            </div>
          </div>
        </div>

        {/* QR Sheet */}
        {profile?.id && (
          <DriverQrSheet
            isOpen={showQr}
            onClose={() => setShowQr(false)}
            driverId={profile.id}
            rideId={rideId}
          />
        )}

        <EmergencySheet
          isOpen={emergencyOpen}
          onClose={() => setEmergencyOpen(false)}
          rideId={rideId ?? ''}
        />
      </div>
    )
  }

  // ── Pin Dropper View (pickup not yet confirmed) ────────────────────────
  return (
    <div data-testid={testId ?? 'driver-pickup-page'} className="flex min-h-dvh flex-col bg-white font-sans">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 border-b border-border bg-white z-10"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)', paddingBottom: '0.75rem' }}
      >
        <button
          data-testid="back-button"
          onClick={() => navigate(-1)}
          className="p-1 shrink-0 text-text-primary active:opacity-60"
          aria-label="Go back"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M19 12H5" /><path d="m12 5-7 7 7 7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-text-primary">{isDropoffMode ? 'Change Dropoff Point' : 'Set Pickup Point'}</h1>
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────────── */}
      <div className="relative" style={{ height: '50dvh' }}>
        <Map
          data-testid="pickup-map"
          mapId={MAP_ID}
          defaultCenter={mapCenter}
          defaultZoom={15}
          gestureHandling="greedy"
          disableDefaultUI
          className="absolute inset-0"
        >
          {/* Rider position — blue dot */}
          {riderPos && (
            <AdvancedMarker position={riderPos} title="Rider location">
              <div data-testid="rider-marker" className="relative flex items-center justify-center">
                <span className="absolute h-6 w-6 rounded-full bg-primary/30 animate-ping" />
                <span className="relative h-3 w-3 rounded-full bg-primary border-2 border-white shadow-md" />
              </div>
            </AdvancedMarker>
          )}

          {/* Driver position — car */}
          {driverPos && (
            <AdvancedMarker position={driverPos} title="Driver location">
              <div data-testid="driver-marker">
                <CarMarker size={32} color="#FFFFFF" />
              </div>
            </AdvancedMarker>
          )}

          {/* Draggable pin */}
          {pinLat !== null && pinLng !== null && (
            <AdvancedMarker
              position={{ lat: pinLat, lng: pinLng }}
              title={isDropoffMode ? 'Dropoff point' : 'Pickup point'}
              draggable
              onDragEnd={handleDragEnd}
            >
              <div data-testid="pickup-pin" className="flex flex-col items-center">
                <div className={`${isDropoffMode ? 'bg-primary' : 'bg-success'} text-white rounded-full px-2 py-1 text-xs font-bold shadow-lg mb-1`}>
                  {isDropoffMode ? 'DROPOFF' : 'PICKUP'}
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={`h-8 w-8 ${isDropoffMode ? 'text-primary' : 'text-success'} drop-shadow-md`} aria-hidden="true">
                  <path d="M12 0C7.31 0 3.5 3.81 3.5 8.5c0 7.94 7.81 14.66 8.14 14.93a.5.5 0 0 0 .72 0C12.69 23.16 20.5 16.44 20.5 8.5 20.5 3.81 16.69 0 12 0zm0 12a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>
                </svg>
              </div>
            </AdvancedMarker>
          )}
        </Map>

        {/* Walk ETA overlay — only in pickup mode */}
        {!isDropoffMode && walkMinutes !== null && (
          <div
            data-testid="walk-eta-overlay"
            className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm rounded-2xl px-3 py-2 shadow-lg"
          >
            <p className="text-xs text-text-secondary">Rider walk</p>
            <p className="text-sm font-bold text-text-primary">
              {walkMinutes} min · {walkFeet} ft
            </p>
          </div>
        )}

        {/* Toast */}
        {toastMsg && (
          <div
            data-testid="toast"
            className={`absolute bottom-3 left-3 right-3 text-white rounded-2xl px-4 py-3 text-sm font-medium text-center shadow-lg ${toastType === 'success' ? 'bg-success' : 'bg-danger'}`}
          >
            {toastMsg}
          </div>
        )}

        {/* Rider info overlay */}
        {rider && (
          <div
            data-testid="rider-info-overlay"
            className="absolute bottom-3 right-3 flex items-center gap-2 rounded-2xl bg-white/90 backdrop-blur-sm px-3 py-2 shadow-lg"
          >
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
              {rider.full_name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0">
              <p data-testid="rider-name" className="text-xs font-semibold text-text-primary truncate">
                {rider.full_name ?? 'Rider'}
              </p>
              {rider.rating_avg != null && (
                <p className="text-[10px] text-text-secondary">⭐ {rider.rating_avg.toFixed(1)}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom card ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col px-5 pt-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
          {isDropoffMode ? 'Drag the pin to adjust dropoff' : 'Drag the pin to adjust pickup'}
        </p>

        {/* Note / name input */}
        <div className="mb-4">
          <label htmlFor="pickup-note" className="text-xs font-medium text-text-secondary mb-1 block">
            {isDropoffMode ? 'Location name (optional)' : 'Note for rider (optional)'}
          </label>
          <input
            id="pickup-note"
            data-testid="pickup-note-input"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isDropoffMode ? 'e.g. Target on 2nd Ave' : "e.g. I'll be by the gas station"}
            maxLength={200}
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-base text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {error && (
          <p data-testid="action-error" className="text-sm text-danger text-center mb-3">{error}</p>
        )}

        <div className="flex-1" />

        <button
          data-testid="confirm-pickup-button"
          onClick={() => { void handleConfirm() }}
          disabled={submitting || pinLat === null}
          className={`w-full rounded-2xl py-4 text-base font-semibold text-white ${isDropoffMode ? 'bg-primary active:bg-primary/90' : 'bg-success active:bg-success/90'} transition-colors disabled:opacity-50 mb-2`}
          style={{ marginBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
        >
          {submitting
            ? (isDropoffMode ? 'Setting dropoff…' : 'Setting pickup…')
            : (isDropoffMode ? 'Confirm Dropoff Point' : 'Confirm Pickup Point')}
        </button>
      </div>
    </div>
  )
}
