import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { trackEvent } from '@/lib/analytics'
import { getDirectionsByLatLng } from '@/lib/directions'
import QrScanner from '@/components/ride/QrScanner'
import EmergencySheet from '@/components/ui/EmergencySheet'
import { RoutePolyline, MapBoundsFitter, RecenterButton } from '@/components/map/RoutePreview'
import { MAP_ID } from '@/lib/mapConstants'
import { getNavigationUrl } from '@/lib/pwa'
import JourneyDrawer from '@/components/ride/JourneyDrawer'
import type { TransitInfoData } from '@/components/ride/JourneyDrawer'
import type { Ride, User, GeoPoint } from '@/types/database'

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
  const [unreadChat, setUnreadChat] = useState(0)
  const [fitToken, setFitToken] = useState(0)

  // Transit remaining journey
  const [transitInfo, setTransitInfo] = useState<TransitInfoData | null>(null)

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
          .maybeSingle()
        if (vehicleData) setVehicle(vehicleData)
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

  // ── Send GPS pings to server for fare distance tracking (rider backup) ──
  useEffect(() => {
    if (ride?.status !== 'active' || !rideId || !riderPos) return

    const sendPing = async () => {
      if (!riderPos) return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        await fetch(`/api/rides/${rideId}/gps-ping`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ lat: riderPos.lat, lng: riderPos.lng }),
        })
      } catch {
        // Best-effort — driver pings are primary, rider is backup
      }
    }

    void sendPing()
    const interval = setInterval(() => { void sendPing() }, 10_000)
    return () => clearInterval(interval)
  }, [ride?.status, rideId, riderPos])

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
        // Use stored polyline for display if available
        const storedPolyline = (ride as Record<string, unknown>)['route_polyline'] as string | null
        if (storedPolyline) {
          setRoutePolyline(storedPolyline)
        }
        // Always fetch directions for total distance (needed for progress bar)
        if (!totalDistanceFetched.current) {
          const result = await getDirectionsByLatLng(pLat, pLng, dLat, dLng)
          if (result?.polyline && !storedPolyline) setRoutePolyline(result.polyline)
          if (result?.distance_km != null) {
            setTotalDistanceKm(result.distance_km)
            totalDistanceFetched.current = true
          }
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

  // ── Fetch transit remaining journey (when dropoff confirmed) ─────────────
  useEffect(() => {
    if (!ride?.dropoff_confirmed || !rideId) {
      setTransitInfo(null)
      return
    }
    async function fetchTransit() {
      const { data } = await supabase
        .from('messages')
        .select('meta')
        .eq('ride_id', rideId as string)
        .eq('type', 'transit_dropoff_suggestion')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (data?.meta) {
        const m = data.meta as Record<string, unknown>
        setTransitInfo({
          station_name: (m.station_name as string) ?? 'Transit Station',
          transit_options: (m.transit_options as TransitInfoData['transit_options']) ?? [],
          walk_to_station_minutes: (m.walk_to_station_minutes as number) ?? 0,
          transit_to_dest_minutes: (m.transit_to_dest_minutes as number) ?? 0,
          rider_dest_name: (m.rider_dest_name as string) ?? 'Destination',
          total_rider_minutes: (m.total_rider_minutes as number) ?? 0,
          dropoff_lat: (m.station_lat as number) ?? 0,
          dropoff_lng: (m.station_lng as number) ?? 0,
          rider_dest_lat: (m.rider_dest_lat as number) ?? 0,
          rider_dest_lng: (m.rider_dest_lng as number) ?? 0,
        })
      }
    }
    void fetchTransit()
  }, [ride?.dropoff_confirmed, rideId])

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

  // ── Persist progress_pct to ride record ───────────────────────────────
  const lastSavedProgress = useRef<number>(0)
  useEffect(() => {
    if (!rideId || progress == null || !isActive) return
    if (Math.abs(progress - lastSavedProgress.current) < 5) return
    const timer = setTimeout(() => {
      lastSavedProgress.current = progress
      void supabase.from('rides').update({ progress_pct: progress }).eq('id', rideId as string)
    }, 5000)
    return () => clearTimeout(timer)
  }, [rideId, progress, isActive])

  // Open Google Maps navigation
  const openNavigation = useCallback(() => {
    const dest = isActive ? destPos : pickupPos
    if (!dest) return
    window.open(getNavigationUrl(dest.lat, dest.lng, 'driving', riderPos?.lat, riderPos?.lng), '_blank')
  }, [isActive, destPos, pickupPos, riderPos])

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
              <div className="bg-success text-white rounded-full px-2 py-0.5 text-[10px] font-bold shadow max-w-[140px] truncate">{ride?.pickup_note?.split(',')[0] ?? 'Pickup'}</div>
            </AdvancedMarker>
          )}
          {destPos && (
            <AdvancedMarker position={destPos} title="Drop off">
              <div className="text-white rounded-full px-2 py-0.5 text-[10px] font-bold shadow max-w-[140px] truncate" style={{ backgroundColor: '#8B5CF6' }}>{ride?.destination_name?.split(',')[0] ?? 'Drop off'}</div>
            </AdvancedMarker>
          )}
          {riderPos && (
            <AdvancedMarker position={riderPos} title="You">
              <div className="h-4 w-4 rounded-full border-2 border-white shadow" style={{ backgroundColor: '#3B82F6' }} />
            </AdvancedMarker>
          )}
          {routePolyline && (
            <RoutePolyline
              encodedPath={routePolyline}
              color={isActive ? '#4F46E5' : '#16A34A'}
              fitBounds={false}
            />
          )}
          {boundsPoints.length >= 2 && (
            <MapBoundsFitter fitToken={fitToken} points={boundsPoints} />
          )}
        </Map>

        <RecenterButton onClick={() => setFitToken((t) => t + 1)} />
      </div>

      {/* ── Map legend ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-4 py-1.5 bg-white border-b border-border shrink-0">
        <div className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-success" /><span className="text-[10px] font-medium text-text-primary">Pickup</span></div>
        <div className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#8B5CF6' }} /><span className="text-[10px] font-medium text-text-primary">Drop off</span></div>
        <div className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-danger" /><span className="text-[10px] font-medium text-text-primary">Destination</span></div>
      </div>

      {error && (
        <div className="absolute bottom-24 left-4 right-4 z-10">
          <p data-testid="ride-error" className="text-sm text-danger text-center bg-white/90 rounded-2xl px-4 py-2 shadow">{error}</p>
        </div>
      )}

      {/* ── End Ride Modal ─────────────────────────────────────────────── */}
      {endRideModal && (
        <div
          data-testid="end-ride-modal"
          className="fixed inset-0 z-[950] flex items-center justify-center bg-black/50 px-6"
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

      <JourneyDrawer
        ride={ride}
        driver={driver}
        vehicle={vehicle}
        isRider
        estimatedFare={ride.fare_cents}
        etaMinutes={routeEta ? parseInt(routeEta, 10) || null : null}
        distanceKm={routeDistanceKm}
        onShowQr={() => { setScanning(true); setError(null) }}
        onNavigate={openNavigation}
        onChat={() => { setUnreadChat(0); navigate(`/ride/messaging/${rideId as string}`) }}
        onEmergency={() => setEmergencyOpen(true)}
        unreadChat={unreadChat}
        onEndRide={isActive ? () => setEndRideModal(true) : undefined}
        endRideLabel="Scan QR to End Ride"
        hideEta
        transitInfo={transitInfo}
        progress={isActive ? progress : null}
        remainingLabel={routeEta ? `${routeEta} remaining` : undefined}
      />

      <EmergencySheet
        isOpen={emergencyOpen}
        onClose={() => setEmergencyOpen(false)}
        rideId={rideId ?? ''}
      />
    </div>
  )
}
