import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { trackEvent } from '@/lib/analytics'
import { getDirectionsByLatLng } from '@/lib/directions'
import QrScanner from '@/components/ride/QrScanner'
import EmergencySheet from '@/components/ui/EmergencySheet'
import { RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
import { MAP_ID } from '@/lib/mapConstants'
import AppIcon from '@/components/ui/AppIcon'
import type { Ride, User, GeoPoint } from '@/types/database'

// Transit info from a transit_dropoff_suggestion message
interface TransitBannerData {
  station_name: string
  transit_options: Array<{ icon: string; line_name: string; departure_stop?: string; arrival_stop?: string; duration_minutes?: number; total_minutes: number }>
  total_rider_minutes: number
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RiderActiveRidePageProps {
  'data-testid'?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

// ── Component ─────────────────────────────────────────────────────────────────

export default function RiderActiveRidePage({ 'data-testid': testId }: RiderActiveRidePageProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)

  const [ride, setRide] = useState<Ride | null>(null)
  const [driver, setDriver] = useState<Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg' | 'rating_count'> | null>(null)
  const [vehicle, setVehicle] = useState<{ color: string; make: string; model: string; plate: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [elapsed, setElapsed] = useState(0) // seconds
  const [manualCode, setManualCode] = useState('')
  const [emergencyOpen, setEmergencyOpen] = useState(false)
  const [endRideModal, setEndRideModal] = useState(false)
  const [routePolyline, setRoutePolyline] = useState<string | null>(null)
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(null)
  const [transitBanner, setTransitBanner] = useState<TransitBannerData | null>(null)
  const [unreadChat, setUnreadChat] = useState(0)

  // ETA + journey progress
  const [routeEta, setRouteEta] = useState<string | null>(null)
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null)
  const [totalDistanceKm, setTotalDistanceKm] = useState<number | null>(null)
  const totalDistanceFetched = useRef(false)

  // ── Fetch ride + driver info ─────────────────────────────────────────────
  useEffect(() => {
    if (!rideId) {
      navigate('/home/rider', { replace: true })
      return
    }

    async function fetchData() {
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

      if (rideData.driver_id) {
        const { data: driverData } = await supabase
          .from('users')
          .select('id, full_name, avatar_url, rating_avg, rating_count')
          .eq('id', rideData.driver_id)
          .single()

        if (driverData) setDriver(driverData)

        const { data: vehicleData } = await supabase
          .from('vehicles')
          .select('color, plate, make, model')
          .eq('user_id', rideData.driver_id)
          .eq('is_active', true)
          .single()
        if (vehicleData) setVehicle(vehicleData)
      }

      // Check for transit dropoff suggestion in messages (non-fatal)
      try {
        const { data: transitMsg } = await supabase
          .from('messages')
          .select('meta')
          .eq('ride_id', rideId as string)
          .eq('type', 'transit_dropoff_suggestion')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (transitMsg?.meta) {
          const m = transitMsg.meta as Record<string, unknown>
          setTransitBanner({
            station_name: (m['station_name'] as string) ?? 'Transit Station',
            transit_options: (m['transit_options'] as Array<{ icon: string; line_name: string; departure_stop?: string; arrival_stop?: string; duration_minutes?: number; total_minutes: number }>) ?? [],
            total_rider_minutes: (m['total_rider_minutes'] as number) ?? 0,
          })
        }
      } catch {
        // Non-fatal — transit banner is optional
      }

      setLoading(false)
    }

    void fetchData()
  }, [rideId, navigate])

  // ── Rider GPS tracking ──────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return
    const watcher = navigator.geolocation.watchPosition(
      (pos) => setRiderPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* ignore GPS error silently */ },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    )
    return () => navigator.geolocation.clearWatch(watcher)
  }, [])

  // ── Fetch route polyline + live ETA ─────────────────────────────────────
  useEffect(() => {
    if (!ride) return
    const pickup = ride.pickup_point as GeoPoint | null
    const dest = ride.destination as GeoPoint | null

    // Active ride: show route from pickup to destination (polyline)
    if (ride.status === 'active' && pickup && dest) {
      const pLat = pickup.coordinates[1]
      const pLng = pickup.coordinates[0]
      const dLat = dest.coordinates[1]
      const dLng = dest.coordinates[0]

      async function fetchActive() {
        // Use stored polyline if available, otherwise fetch from API
        const storedPolyline = (ride as Record<string, unknown>)['route_polyline'] as string | null
        if (storedPolyline) {
          setRoutePolyline(storedPolyline)
        }
        const result = storedPolyline ? null : await getDirectionsByLatLng(pLat, pLng, dLat, dLng)
        if (result?.polyline) setRoutePolyline(result.polyline)
        if (result?.distance_km != null && !totalDistanceFetched.current) {
          setTotalDistanceKm(result.distance_km)
          totalDistanceFetched.current = true
        }

        // Live ETA: rider GPS → destination
        if (riderPos) {
          const eta = await getDirectionsByLatLng(riderPos.lat, riderPos.lng, dLat, dLng)
          if (eta?.duration_min != null) {
            const mins = Math.round(eta.duration_min)
            setRouteEta(mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`)
          }
          if (eta?.distance_km != null) setRouteDistanceKm(eta.distance_km)
        }
      }
      void fetchActive()
      return
    }

    // Coordinating: show route from rider to pickup (if rider GPS available)
    if (ride.status === 'coordinating' && pickup && riderPos) {
      const pLat = pickup.coordinates[1]
      const pLng = pickup.coordinates[0]

      void getDirectionsByLatLng(riderPos.lat, riderPos.lng, pLat, pLng)
        .then((result) => { if (result?.polyline) setRoutePolyline(result.polyline) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride?.status, ride?.pickup_point, ride?.destination, riderPos !== null])

  // ── Timer ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ride?.started_at) return

    const startMs = new Date(ride.started_at).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - startMs) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [ride?.started_at])

  // ── Listen for realtime broadcasts ──────────────────────────────────────
  useEffect(() => {
    if (!profile?.id || !rideId) return

    const channel = supabase
      .channel(`rider-active:${profile.id}`)
      .on('broadcast', { event: 'ride_ended' }, () => {
        navigate(`/ride/summary/${rideId}`, { replace: true })
      })
      .on('broadcast', { event: 'ride_started' }, () => {
        setRide((prev) => prev ? { ...prev, status: 'active', started_at: new Date().toISOString() } : prev)
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [profile?.id, rideId, navigate])

  // ── Polling fallback — catch missed Realtime events ────────────────────
  useEffect(() => {
    if (!rideId) return

    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('rides')
        .select('status, started_at')
        .eq('id', rideId)
        .single()

      if (!data) return

      if (data.status === 'completed' || data.status === 'cancelled') {
        navigate(data.status === 'completed' ? `/ride/summary/${rideId}` : '/home/rider', { replace: true })
      } else if (data.status === 'active' && data.started_at) {
        setRide((prev) => prev && prev.status !== 'active'
          ? { ...prev, status: 'active', started_at: data.started_at }
          : prev,
        )
      }
    }, 15_000)

    return () => clearInterval(poll)
  }, [rideId, navigate])

  // ── Listen for new chat messages (unread badge) ────────────────────────
  useEffect(() => {
    if (!rideId) return
    const ch = supabase
      .channel(`chat-badge:${rideId}`)
      .on('broadcast', { event: 'new_message' }, () => setUnreadChat(c => c + 1))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [rideId])

  // ── Submit driver code (from QR scan or manual entry) ───────────────────
  const submitDriverCode = useCallback(async (driverCode: string) => {
    if (submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Not authenticated')
        setSubmitting(false)
        return
      }

      const resp = await fetch('/api/rides/scan-driver', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ driver_code: driverCode, lat: riderPos?.lat, lng: riderPos?.lng }),
      })

      const body = (await resp.json()) as { action?: string; ride_id?: string; error?: { message?: string } }

      if (!resp.ok) {
        setError(body.error?.message ?? 'Failed to process code')
        setSubmitting(false)
        setScanning(false)
        return
      }

      if (body.action === 'started') {
        // Ride started — update local state, close scanner
        setRide((prev) => prev ? { ...prev, status: 'active', started_at: new Date().toISOString() } : prev)
        setScanning(false)
        setManualCode('')
      } else if (body.action === 'ended') {
        trackEvent('ride_ended', { ride_id: rideId })
        // Ride ended — navigate to summary
        navigate(`/ride/summary/${rideId}`, { replace: true })
        return
      }

      setSubmitting(false)
    } catch {
      setError('Network error — try again.')
      setSubmitting(false)
      setScanning(false)
    }
  }, [submitting, rideId, navigate, riderPos])

  // ── Handle QR scan ──────────────────────────────────────────────────────
  const handleScan = useCallback((text: string) => {
    void submitDriverCode(text)
  }, [submitDriverCode])

  // ── Handle manual code submit ───────────────────────────────────────────
  const handleManualSubmit = useCallback(() => {
    const code = manualCode.trim()
    if (!code) return
    void submitDriverCode(code)
  }, [manualCode, submitDriverCode])

  // ── Format elapsed time ─────────────────────────────────────────────────
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`

  // ── Map positions ───────────────────────────────────────────────────────
  const pickupPos = useMemo(() => ride?.pickup_point
    ? { lat: (ride.pickup_point as GeoPoint).coordinates[1], lng: (ride.pickup_point as GeoPoint).coordinates[0] }
    : null, [ride?.pickup_point])
  const destPos = useMemo(() => ride?.destination
    ? { lat: (ride.destination as GeoPoint).coordinates[1], lng: (ride.destination as GeoPoint).coordinates[0] }
    : null, [ride?.destination])
  const mapCenter = destPos ?? pickupPos ?? { lat: 38.5382, lng: -121.7617 }

  const isActive = ride?.status === 'active'
  const isCoordinating = ride?.status === 'coordinating'

  // Journey progress (0-100)
  const progress = (totalDistanceKm && routeDistanceKm != null)
    ? Math.min(100, Math.max(0, Math.round((1 - routeDistanceKm / totalDistanceKm) * 100)))
    : null

  // Open Google Maps navigation
  const openNavigation = useCallback(() => {
    const dest = isActive ? destPos : pickupPos
    if (!dest) return
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving`, '_blank')
  }, [isActive, destPos, pickupPos])

  // Map bounds points
  const boundsPoints: Array<{ lat: number; lng: number }> = []
  if (pickupPos) boundsPoints.push(pickupPos)
  if (destPos) boundsPoints.push(destPos)
  if (riderPos) boundsPoints.push(riderPos)

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div data-testid={testId ?? 'rider-active-ride'} className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!ride) {
    return (
      <div data-testid={testId ?? 'rider-active-ride'} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6">
        <p className="text-center text-danger">{error ?? 'Ride not found'}</p>
        <button type="button" onClick={() => navigate('/home/rider', { replace: true })} className="rounded-2xl bg-primary px-6 py-3 font-semibold text-white">
          Back to Home
        </button>
      </div>
    )
  }

  // ── QR Scanner Overlay ───────────────────────────────────────────────────
  if (scanning) {
    return (
      <div data-testid={testId ?? 'rider-active-ride'} className="flex h-dvh flex-col bg-black font-sans overflow-hidden">
        {/* Scanner header */}
        <div
          className="flex items-center gap-3 px-4 bg-black z-10 shrink-0"
          style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
        >
          <button
            data-testid="scanner-back"
            onClick={() => { setScanning(false); setError(null) }}
            className="p-1 shrink-0 text-white active:opacity-60"
            aria-label="Close scanner"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
              <path d="M19 12H5" /><path d="m12 5-7 7 7 7" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-white">Scan Driver&apos;s QR Code</h1>
        </div>

        {/* Scanner */}
        <div className="flex-1 flex items-center justify-center px-4 min-h-0 overflow-hidden">
          <div className="w-full max-w-sm">
            <QrScanner
              onScan={handleScan}
              onError={(msg) => setError(msg)}
            />
          </div>
        </div>

        {/* Status bar */}
        <div className="px-6 py-3 bg-black shrink-0" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
          {submitting && (
            <div className="flex items-center justify-center gap-2">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <p className="text-sm text-white">Verifying code…</p>
            </div>
          )}
          {error && (
            <p data-testid="scan-error" className="text-sm text-danger text-center">{error}</p>
          )}
          {!submitting && !error && (
            <p className="text-sm text-white/70 text-center">Point your camera at the driver&apos;s QR code</p>
          )}
        </div>
      </div>
    )
  }

  // ── Main Active Ride Screen ──────────────────────────────────────────────
  return (
    <div data-testid={testId ?? 'rider-active-ride'} className="flex h-dvh flex-col bg-white font-sans overflow-hidden">

      {/* ── Header w/ status badge + timer ─────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 border-b border-border bg-white z-10"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
      >
        <div className="flex items-center gap-3">
          {/* Status badge — green RIDING for active, yellow EN ROUTE for coordinating */}
          {isActive ? (
            <div className="flex items-center gap-1.5 bg-success/10 px-2.5 py-1 rounded-full" data-testid="riding-badge">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
              </span>
              <span className="text-xs font-bold text-success tracking-wider">RIDING</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-warning/10 px-2.5 py-1 rounded-full" data-testid="enroute-badge">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warning" />
              </span>
              <span className="text-xs font-bold text-warning tracking-wider">EN ROUTE</span>
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-text-primary">{driver?.full_name ?? 'Driver'}</p>
            {isCoordinating && ride.pickup_note && (
              <p className="text-xs text-text-secondary truncate max-w-[180px]">Walk to pickup: {ride.pickup_note}</p>
            )}
            {isActive && ride.destination_name && (
              <p className="text-xs text-text-secondary truncate max-w-[180px]">→ {ride.destination_name}</p>
            )}
          </div>
        </div>

        {/* Timer + Emergency */}
        <div className="flex items-center gap-2">
          {isActive && (
            <div className="text-right" data-testid="ride-timer">
              <p className="text-lg font-mono font-bold text-text-primary">{timeStr}</p>
              <p className="text-[10px] text-text-secondary uppercase tracking-wide">Ride Time</p>
            </div>
          )}
          <button
            data-testid="emergency-button"
            onClick={() => setEmergencyOpen(true)}
            aria-label="Emergency"
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger active:bg-danger/20 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4.5 w-4.5" aria-hidden="true">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative min-h-0">
        <Map
          data-testid="active-ride-map"
          mapId={MAP_ID}
          defaultCenter={mapCenter}
          defaultZoom={14}
          gestureHandling="greedy"
          disableDefaultUI
          className="absolute inset-0"
        >
          {pickupPos && (
            <AdvancedMarker position={pickupPos} title="Pickup">
              <div className="bg-success text-white rounded-full px-2 py-0.5 text-[10px] font-bold shadow">PICKUP</div>
            </AdvancedMarker>
          )}
          {destPos && (
            <AdvancedMarker position={destPos} title="Destination">
              <div className="bg-primary text-white rounded-full px-2 py-0.5 text-[10px] font-bold shadow">DROP-OFF</div>
            </AdvancedMarker>
          )}
          {riderPos && (
            <AdvancedMarker position={riderPos} title="You">
              <div className="h-4 w-4 rounded-full bg-primary border-2 border-white shadow" />
            </AdvancedMarker>
          )}
          {routePolyline && (
            <RoutePolyline
              encodedPath={routePolyline}
              color={isActive ? '#4F46E5' : '#16A34A'}
              fitBounds={false}
            />
          )}
          {boundsPoints.length >= 2 && <MapBoundsFitter points={boundsPoints} />}
        </Map>
      </div>

      {/* ── Bottom section (fixed at bottom, map fills remaining) ──── */}

      {/* ── Transit banner ─────────────────────────────────────────────── */}
      {transitBanner && (
        <div data-testid="transit-banner" className="px-4 py-3 bg-primary/5 border-t border-border shrink-0">
          <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">
            After dropoff — continue via transit
          </p>
          <p className="text-sm font-semibold text-text-primary mb-1">
            {transitBanner.station_name}
          </p>
          <div className="space-y-1 mt-1">
            {transitBanner.transit_options.slice(0, 3).map((opt, idx) => (
              <div key={`${opt.line_name}-${idx}`} className="flex items-center gap-1.5 text-[10px]">
                <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 font-semibold text-primary">{opt.icon}</span>
                <span className="font-semibold text-text-primary shrink-0">{opt.line_name}</span>
                {opt.departure_stop && opt.arrival_stop ? (
                  <>
                    <span className="text-text-secondary truncate">{opt.departure_stop} → {opt.arrival_stop}</span>
                    {opt.duration_minutes != null && (
                      <span className="shrink-0 text-text-secondary">· {opt.duration_minutes} min</span>
                    )}
                  </>
                ) : (
                  <span className="text-text-secondary">{opt.total_minutes} min</span>
                )}
              </div>
            ))}
          </div>
          {transitBanner.total_rider_minutes > 0 && (
            <p className="text-[10px] text-text-secondary mt-1">
              ~{transitBanner.total_rider_minutes} min to your destination
            </p>
          )}
        </div>
      )}

      {/* ── Driver + Vehicle info ────────────────────────────────────── */}
      {driver && (
        <div className="px-4 py-3 border-t border-border shrink-0 flex items-center gap-3">
          {driver.avatar_url ? (
            <img src={driver.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
              {driver.full_name?.[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{driver.full_name ?? 'Driver'}</p>
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              {driver.rating_avg != null && <span className="inline-flex items-center gap-0.5"><AppIcon name="star" className="h-3 w-3 text-warning" />{driver.rating_avg.toFixed(1)}</span>}
              {vehicle && (
                <span className="truncate">{vehicle.color} {vehicle.make} {vehicle.model}</span>
              )}
            </div>
          </div>
          {vehicle && (
            <div className="shrink-0 rounded-lg bg-primary/10 px-2.5 py-1">
              <p className="text-xs font-bold text-primary tracking-wide">{vehicle.plate}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Journey progress bar ────────────────────────────────────── */}
      {isActive && progress !== null && (
        <div className="px-4 py-3 border-t border-border shrink-0">
          <div className="h-1.5 rounded-full bg-border overflow-hidden mb-2">
            <div
              data-testid="journey-progress"
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">{progress}% complete</span>
            <span className="font-semibold text-text-primary">{routeEta ?? '--'} remaining</span>
          </div>
        </div>
      )}

      {/* ── Action Buttons ──────────────────────────────────────────── */}
      <div className="px-4 py-3 space-y-3 shrink-0" data-testid="action-grid" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
        {error && (
          <p data-testid="ride-error" className="text-sm text-danger text-center">{error}</p>
        )}

        {/* Row 1: Navigate + Scan QR + Chat (3-col grid, matching driver) */}
        <div className="grid grid-cols-3 gap-3">
          <button
            data-testid="navigate-button"
            onClick={openNavigation}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-surface py-3.5 active:bg-border transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
              <polygon points="3 11 22 2 13 21 11 13 3 11" />
            </svg>
            <span className="text-xs font-medium text-text-primary">{isActive ? 'Navigate to Drop Off' : 'Navigate to Pickup'}</span>
          </button>

          <button
            data-testid="scan-qr-button"
            onClick={() => { setScanning(true); setError(null) }}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-surface py-3.5 active:bg-border transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="4" height="4" rx="0.5" />
            </svg>
            <span className="text-xs font-medium text-text-primary">Scan QR</span>
          </button>

          <button
            data-testid="chat-button"
            onClick={() => { setUnreadChat(0); navigate(`/ride/messaging/${rideId as string}`) }}
            className="relative flex flex-col items-center justify-center gap-1 rounded-2xl bg-surface py-3.5 active:bg-border transition-colors"
          >
            {unreadChat > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white shadow">{unreadChat}</span>
            )}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-xs font-medium text-text-primary">Chat</span>
          </button>
        </div>

        {/* Row 2: End Ride (active only) */}
        {isActive && (
          <button
            data-testid="end-ride-button"
            onClick={() => setEndRideModal(true)}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-danger/10 py-3.5 active:bg-danger/20 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-danger" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="9" x2="15" y2="15" />
              <line x1="15" y1="9" x2="9" y2="15" />
            </svg>
            <span className="text-sm font-medium text-danger">Scan QR to End Ride</span>
          </button>
        )}
      </div>

      {/* ── End Ride Modal ─────────────────────────────────────────────── */}
      {endRideModal && (
        <div
          data-testid="end-ride-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
          onClick={() => setEndRideModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-warning" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="4" height="4" rx="0.5" />
                </svg>
              </div>

              <h3 className="text-lg font-bold text-text-primary mb-2">Scan Driver&apos;s QR Code</h3>
              <p className="text-sm text-text-secondary mb-4">
                Scan the driver&apos;s QR code or enter their code to end the ride and trigger payment.
              </p>

              {/* Manual code entry */}
              <div className="flex gap-2 w-full mb-4">
                <input
                  data-testid="driver-code-input"
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  placeholder="Driver's code"
                  maxLength={8}
                  className="flex-1 rounded-2xl border border-border bg-surface px-4 py-3 text-center font-mono text-base font-bold tracking-widest text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  data-testid="submit-code-button"
                  onClick={handleManualSubmit}
                  disabled={submitting || manualCode.trim().length === 0}
                  className="rounded-2xl bg-primary px-5 py-3 font-semibold text-white disabled:opacity-50 active:bg-primary/90 transition-colors"
                >
                  {submitting ? '…' : 'Go'}
                </button>
              </div>

              {error && (
                <p data-testid="modal-error" className="text-sm text-danger text-center mb-3">{error}</p>
              )}

              <div className="flex w-full gap-3">
                <button
                  data-testid="modal-cancel"
                  onClick={() => setEndRideModal(false)}
                  className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold text-text-primary active:bg-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  data-testid="modal-scan-qr"
                  onClick={() => { setEndRideModal(false); setScanning(true); setError(null) }}
                  className="flex-1 rounded-2xl bg-primary py-3 text-sm font-semibold text-white active:bg-primary/90 transition-colors"
                >
                  Scan QR
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <EmergencySheet
        isOpen={emergencyOpen}
        onClose={() => setEmergencyOpen(false)}
        rideId={rideId ?? ''}
      />
    </div>
  )
}
