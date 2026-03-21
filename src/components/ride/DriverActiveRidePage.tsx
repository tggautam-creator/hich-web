import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import DriverQrSheet from '@/components/ride/DriverQrSheet'
import EmergencySheet from '@/components/ui/EmergencySheet'
import { RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
import CarMarker from '@/components/map/CarMarker'
import { MAP_ID } from '@/lib/mapConstants'
import AppIcon from '@/components/ui/AppIcon'
import type { Ride, User, GeoPoint } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverActiveRidePageProps {
  'data-testid'?: string
}

// Transit info from a transit_dropoff_suggestion message
interface TransitBannerData {
  station_name: string
  transit_options: Array<{ icon: string; line_name: string; departure_stop?: string; arrival_stop?: string; duration_minutes?: number; total_minutes: number }>
  total_rider_minutes: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriverActiveRidePage({ 'data-testid': testId }: DriverActiveRidePageProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)

  const [ride, setRide] = useState<Ride | null>(null)
  const [rider, setRider] = useState<Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg' | 'rating_count'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [endModal, setEndModal] = useState(false)
  const [elapsed, setElapsed] = useState(0) // seconds
  const [riderSignalled, setRiderSignalled] = useState(false)
  const [cancelModal, setCancelModal] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [emergencyOpen, setEmergencyOpen] = useState(false)
  const [unreadChat, setUnreadChat] = useState(0)
  const signalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [transitBanner, setTransitBanner] = useState<TransitBannerData | null>(null)

  // Driver GPS position
  const [driverLat, setDriverLat] = useState<number | null>(null)
  const [driverLng, setDriverLng] = useState<number | null>(null)

  // Route polyline from Directions API
  const [routePolyline, setRoutePolyline] = useState<string | null>(null)
  const [routeEta, setRouteEta] = useState<string | null>(null)
  const [routeDistance, setRouteDistance] = useState<string | null>(null)

  // Journey progress
  const [totalDistanceKm, setTotalDistanceKm] = useState<number | null>(null)
  const [remainingDistanceKm, setRemainingDistanceKm] = useState<number | null>(null)
  const totalDistanceFetched = useRef(false)

  // Phase detection
  const isCoordinating = ride?.status === 'coordinating' || ride?.status === 'accepted'
  const isActive = ride?.status === 'active'

  // ── Fetch ride + rider info ──────────────────────────────────────────────
  useEffect(() => {
    if (!rideId) {
      navigate('/home/driver', { replace: true })
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

      const { data: riderData } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, rating_avg, rating_count')
        .eq('id', rideData.rider_id)
        .single()

      if (riderData) setRider(riderData)

      // Check for the LATEST dropoff-related message. Only show transit banner
      // if the final agreed message is a transit_dropoff_suggestion (not a manual counter).
      try {
        const { data: latestDropoff } = await supabase
          .from('messages')
          .select('type, meta')
          .eq('ride_id', rideId as string)
          .in('type', ['transit_dropoff_suggestion', 'dropoff_suggestion'])
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (latestDropoff?.type === 'transit_dropoff_suggestion' && latestDropoff.meta) {
          const m = latestDropoff.meta as Record<string, unknown>
          setTransitBanner({
            station_name: (m['station_name'] as string) ?? 'Transit Station',
            transit_options: (m['transit_options'] as TransitBannerData['transit_options']) ?? [],
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

  // ── GPS tracking for driver ──────────────────────────────────────────────
  useEffect(() => {
    if (!('geolocation' in navigator)) return

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setDriverLat(pos.coords.latitude)
        setDriverLng(pos.coords.longitude)
      },
      () => { /* silently fail */ },
      { enableHighAccuracy: true, maximumAge: 5000 },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  // ── Fetch directions for route polyline ──────────────────────────────────
  useEffect(() => {
    if (driverLat === null || driverLng === null || !ride) return

    // Coordinating → route from driver to pickup
    // Active → route from pickup to destination
    let originLat: number, originLng: number, destLat: number, destLng: number

    if (isCoordinating) {
      // Route to pickup point if set, otherwise to rider's request origin
      const target = (ride.pickup_point ?? ride.origin) as GeoPoint
      originLat = driverLat
      originLng = driverLng
      destLat = target.coordinates[1]
      destLng = target.coordinates[0]
    } else if (isActive && ride.destination) {
      const dest = ride.destination as GeoPoint
      // Use stored polyline if available to skip API call for the route line
      const storedPolyline = (ride as Record<string, unknown>)['route_polyline'] as string | null
      if (storedPolyline && !routePolyline) {
        setRoutePolyline(storedPolyline)
      }
      if (ride.pickup_point) {
        const pp = ride.pickup_point as GeoPoint
        originLat = pp.coordinates[1]
        originLng = pp.coordinates[0]
      } else {
        originLat = driverLat
        originLng = driverLng
      }
      destLat = dest.coordinates[1]
      destLng = dest.coordinates[0]
    } else {
      return
    }

    async function fetchRoute() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const resp = await fetch(
          `/api/directions?originLat=${originLat}&originLng=${originLng}&destLat=${destLat}&destLng=${destLng}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        )
        if (resp.ok) {
          const data = (await resp.json()) as {
            polyline?: string
            duration_min?: number
            distance_km?: number
          }
          if (data.polyline) setRoutePolyline(data.polyline)
          if (data.duration_min != null) {
            const mins = Math.round(data.duration_min)
            setRouteEta(mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`)
          }
          if (data.distance_km != null) {
            const distMi = data.distance_km * 0.621371
            setRouteDistance(distMi < 0.1
              ? `${Math.round(data.distance_km * 3280.84)} ft`
              : `${distMi.toFixed(1)} mi`)
            // Store total distance once for progress calculation
            if (isActive && !totalDistanceFetched.current) {
              setTotalDistanceKm(data.distance_km)
              totalDistanceFetched.current = true
            }
          }
        }

        // Active phase: also fetch driver GPS → destination for remaining distance
        if (isActive && driverLat !== null && driverLng !== null) {
          const liveResp = await fetch(
            `/api/directions?originLat=${driverLat}&originLng=${driverLng}&destLat=${destLat}&destLng=${destLng}`,
            { headers: { Authorization: `Bearer ${session.access_token}` } },
          )
          if (liveResp.ok) {
            const liveData = (await liveResp.json()) as { distance_km?: number; duration_min?: number }
            if (liveData.distance_km != null) setRemainingDistanceKm(liveData.distance_km)
            if (liveData.duration_min != null) {
              const mins = Math.round(liveData.duration_min)
              setRouteEta(mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`)
            }
          }
        }
      } catch {
        // non-fatal
      }
    }

    void fetchRoute()
    // Re-fetch when phase changes or GPS first locks, not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride?.status, ride?.pickup_point, ride?.origin, ride?.destination, driverLat !== null])

  // ── Timer — ticks every second from started_at ──────────────────────────
  useEffect(() => {
    if (!ride?.started_at) return

    const startMs = new Date(ride.started_at).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - startMs) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [ride?.started_at])

  // ── Listen for Realtime events ──────────────────────────────────────────
  useEffect(() => {
    if (!profile?.id || !rideId) return

    const channel = supabase
      .channel(`rider:${profile.id}`)
      .on('broadcast', { event: 'ride_ended' }, () => {
        navigate(`/ride/summary/${rideId}`, { replace: true })
      })
      .on('broadcast', { event: 'ride_started' }, () => {
        // Ride just started — refresh ride data to get started_at & status
        supabase.from('rides').select('*').eq('id', rideId).single().then(({ data }) => {
          if (data) setRide(data)
        })
      })
      .on('broadcast', { event: 'rider_signal' }, () => {
        setRiderSignalled(true)
        if (signalTimer.current) clearTimeout(signalTimer.current)
        signalTimer.current = setTimeout(() => setRiderSignalled(false), 10000)
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
        navigate(data.status === 'completed' ? `/ride/summary/${rideId}` : '/home/driver', { replace: true })
      } else if (data.status === 'active' && data.started_at) {
        setRide((prev) => {
          if (!prev) return prev
          if (prev.status !== 'active') return { ...prev, status: 'active', started_at: data.started_at }
          return prev
        })
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

  // ── Format elapsed time ─────────────────────────────────────────────────
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`

  // Journey progress (0-100)
  const progress = (totalDistanceKm && remainingDistanceKm != null)
    ? Math.min(100, Math.max(0, Math.round((1 - remainingDistanceKm / totalDistanceKm) * 100)))
    : null

  // ── Cancel ride ────────────────────────────────────────────────────────
  const handleCancel = useCallback(async () => {
    if (!rideId || cancelling) return
    setCancelling(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch(`/api/rides/${rideId}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (resp.ok) {
        navigate('/home/driver', { replace: true })
      } else {
        const body = (await resp.json()) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Failed to cancel')
      }
    } catch {
      setError('Network error')
    } finally {
      setCancelling(false)
      setCancelModal(false)
    }
  }, [rideId, cancelling, navigate])

  // ── Computed positions ──────────────────────────────────────────────────
  const pickupGeo = (ride?.pickup_point ?? ride?.origin) as GeoPoint | undefined
  const pickupPos = pickupGeo
    ? { lat: pickupGeo.coordinates[1], lng: pickupGeo.coordinates[0] }
    : null
  const destPos = ride?.destination
    ? { lat: (ride.destination as GeoPoint).coordinates[1], lng: (ride.destination as GeoPoint).coordinates[0] }
    : null
  const driverPos = driverLat !== null && driverLng !== null
    ? { lat: driverLat, lng: driverLng }
    : null

  const mapCenter = pickupPos ?? destPos ?? { lat: 38.5382, lng: -121.7617 }

  // Points for map bounds fitting
  const boundsPoints = [
    ...(driverPos ? [driverPos] : []),
    ...(pickupPos ? [pickupPos] : []),
    ...(isActive && destPos ? [destPos] : []),
  ]

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div data-testid={testId ?? 'driver-active-ride'} className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!ride) {
    return (
      <div data-testid={testId ?? 'driver-active-ride'} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6">
        <p className="text-center text-danger">{error ?? 'Ride not found'}</p>
        <button type="button" onClick={() => navigate('/home/driver', { replace: true })} className="rounded-2xl bg-primary px-6 py-3 font-semibold text-white">
          Back to Home
        </button>
      </div>
    )
  }

  return (
    <div data-testid={testId ?? 'driver-active-ride'} className="flex min-h-dvh flex-col bg-white font-sans">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 border-b border-border bg-white z-10"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
      >
        <div className="flex items-center gap-3">
          {/* Back button — coordinating phase only (can return later via Rides tab) */}
          {isCoordinating && (
            <button
              data-testid="back-button"
              onClick={() => navigate('/rides', { replace: true })}
              className="p-1 shrink-0 text-text-primary active:opacity-60"
              aria-label="Go back"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                <path d="M19 12H5" /><path d="m12 5-7 7 7 7" />
              </svg>
            </button>
          )}

          {/* Phase badge */}
          {isCoordinating ? (
            <div className="flex items-center gap-1.5 bg-warning/10 px-2.5 py-1 rounded-full" data-testid="enroute-badge">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warning" />
              </span>
              <span className="text-xs font-bold text-warning tracking-wider">EN ROUTE</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-danger/10 px-2.5 py-1 rounded-full" data-testid="live-badge">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
              </span>
              <span className="text-xs font-bold text-danger tracking-wider">LIVE</span>
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-text-primary">{rider?.full_name ?? 'Rider'}</p>
            {isCoordinating && pickupPos && (
              <p className="text-xs text-text-secondary">Driving to pickup</p>
            )}
            {isActive && ride.destination_name && (
              <p className="text-xs text-text-secondary truncate max-w-[180px]">→ {ride.destination_name}</p>
            )}
          </div>
        </div>

        {/* Timer / ETA + Emergency */}
        <div className="flex items-center gap-2">
          <div className="text-right" data-testid="ride-timer">
            {isActive ? (
              <>
                <p className="text-lg font-mono font-bold text-text-primary">{timeStr}</p>
                <p className="text-[10px] text-text-secondary uppercase tracking-wide">Ride Time</p>
              </>
            ) : (
              <>
                <p className="text-lg font-mono font-bold text-text-primary">{routeEta ?? '--'}</p>
                <p className="text-[10px] text-text-secondary uppercase tracking-wide">
                  {routeDistance ? `${routeDistance} away` : 'To Pickup'}
                </p>
              </>
            )}
          </div>
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

      {/* ── Rider signal banner ───────────────────────────────────────────── */}
      {riderSignalled && (
        <div
          data-testid="rider-signal-banner"
          className="bg-success text-white px-4 py-3 text-center text-sm font-semibold animate-pulse"
        >
          📍 Rider is nearby the pickup point!
        </div>
      )}

      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative" style={{ minHeight: '50dvh' }}>
        <Map
          data-testid="active-ride-map"
          mapId={MAP_ID}
          defaultCenter={mapCenter}
          defaultZoom={14}
          gestureHandling="greedy"
          disableDefaultUI
          className="absolute inset-0"
        >
          {/* Driver GPS dot */}
          {driverPos && (
            <AdvancedMarker position={driverPos} title="You">
              <div data-testid="driver-marker" className="flex flex-col items-center">
                <CarMarker size={32} color="#FFFFFF" />
              </div>
            </AdvancedMarker>
          )}

          {/* Pickup point */}
          {pickupPos && (
            <AdvancedMarker position={pickupPos} title="Pickup">
              <div data-testid="pickup-marker" className="flex flex-col items-center">
                <div className="bg-success text-white rounded-full px-2 py-0.5 text-[10px] font-bold shadow mb-0.5">PICKUP</div>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-success drop-shadow-md" aria-hidden="true">
                  <path d="M12 0C7.31 0 3.5 3.81 3.5 8.5c0 7.94 7.81 14.66 8.14 14.93a.5.5 0 0 0 .72 0C12.69 23.16 20.5 16.44 20.5 8.5 20.5 3.81 16.69 0 12 0zm0 12a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>
                </svg>
              </div>
            </AdvancedMarker>
          )}

          {/* Destination (only in active phase) */}
          {isActive && destPos && (
            <AdvancedMarker position={destPos} title="Destination">
              <div className="bg-primary text-white rounded-full px-2 py-0.5 text-[10px] font-bold shadow">DROP-OFF</div>
            </AdvancedMarker>
          )}

          {/* Route polyline */}
          {routePolyline && (
            <RoutePolyline
              encodedPath={routePolyline}
              color={isCoordinating ? '#22C55E' : '#4F46E5'}
              weight={5}
              fitBounds={false}
            />
          )}

          {/* Fit map bounds */}
          {boundsPoints.length >= 2 && <MapBoundsFitter points={boundsPoints} />}
        </Map>

        {/* ETA overlay on map (coordinating phase) */}
        {isCoordinating && routeEta && (
          <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm rounded-2xl px-3 py-2 shadow-lg">
            <p className="text-xs text-text-secondary">To pickup</p>
            <p className="text-sm font-bold text-text-primary">{routeEta} · {routeDistance}</p>
          </div>
        )}
      </div>

      {/* ── Transit banner ─────────────────────────────────────────────── */}
      {transitBanner && (
        <div data-testid="transit-banner" className="px-4 py-3 bg-primary/5 border-t border-border shrink-0">
          <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">
            Rider continues via transit after dropoff
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
              ~{transitBanner.total_rider_minutes} min total to rider&apos;s destination
            </p>
          )}
        </div>
      )}

      {/* ── Rider info ───────────────────────────────────────────────────── */}
      {rider && (
        <div className="px-4 py-3 border-t border-border shrink-0 flex items-center gap-3">
          {rider.avatar_url ? (
            <img src={rider.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
              {rider.full_name?.[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{rider.full_name ?? 'Rider'}</p>
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              {rider.rating_avg != null && <span className="inline-flex items-center gap-0.5"><AppIcon name="star" className="h-3 w-3 text-warning" />{rider.rating_avg.toFixed(1)}</span>}
              {rider.rating_count != null && rider.rating_count > 0 && (
                <span>({rider.rating_count} {rider.rating_count === 1 ? 'ride' : 'rides'})</span>
              )}
              {(!rider.rating_count || rider.rating_count === 0) && (
                <span className="text-warning">New user</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Journey progress bar ──────────────────────────────────────────── */}
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

      {/* ── Action Buttons ──────────────────────────────────────────────── */}
      <div className="px-4 py-3 space-y-3" data-testid="action-grid">
        {/* Row 1: Navigate + QR + Chat */}
        <div className="grid grid-cols-3 gap-3">
          <button
            data-testid="navigate-button"
            onClick={() => {
              const dest = isCoordinating ? pickupPos : destPos
              if (!dest) return
              const url = `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving`
              window.open(url, '_blank')
            }}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-surface py-3.5 active:bg-border transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
              <polygon points="3 11 22 2 13 21 11 13 3 11" />
            </svg>
            <span className="text-xs font-medium text-text-primary">{isCoordinating ? 'Navigate to Pickup' : 'Navigate to Drop Off'}</span>
          </button>

          <button
            data-testid="show-qr-button"
            onClick={() => setQrOpen(true)}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-surface py-3.5 active:bg-border transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="4" height="4" rx="0.5" />
            </svg>
            <span className="text-xs font-medium text-text-primary">Show QR</span>
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

        {/* Row 2: End Ride (only in active phase) */}
        {isActive && (
          <button
            data-testid="end-ride-button"
            onClick={() => setEndModal(true)}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-danger/10 py-3.5 active:bg-danger/20 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-danger" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="9" x2="15" y2="15" />
              <line x1="15" y1="9" x2="9" y2="15" />
            </svg>
            <span className="text-sm font-medium text-danger">End Ride</span>
          </button>
        )}

        {/* Row 2b: Cancel Ride (coordinating phase only — before ride starts) */}
        {isCoordinating && (
          <button
            data-testid="cancel-ride-button"
            onClick={() => setCancelModal(true)}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-danger/10 py-3.5 active:bg-danger/20 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-danger" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span className="text-sm font-medium text-danger">Cancel Ride</span>
          </button>
        )}
      </div>

      {/* ── Cancel Ride Modal ──────────────────────────────────────────── */}
      {cancelModal && (
        <div
          data-testid="cancel-ride-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
          onClick={() => setCancelModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-danger/10">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-danger" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>

              <h3 className="text-lg font-bold text-text-primary mb-2">Cancel This Ride?</h3>
              <p className="text-sm text-text-secondary mb-6">
                The rider will be notified that you cancelled. This cannot be undone.
              </p>

              {error && <p className="text-sm text-danger mb-3">{error}</p>}

              <div className="flex w-full gap-3">
                <button
                  data-testid="modal-keep-ride"
                  onClick={() => setCancelModal(false)}
                  className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold text-text-primary active:bg-surface transition-colors"
                >
                  Keep Ride
                </button>
                <button
                  data-testid="modal-confirm-cancel"
                  onClick={() => { void handleCancel() }}
                  disabled={cancelling}
                  className="flex-1 rounded-2xl bg-danger py-3 text-sm font-semibold text-white active:bg-danger/90 transition-colors disabled:opacity-50"
                >
                  {cancelling ? 'Cancelling…' : 'Yes, Cancel'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── End Ride Modal — "Rider must scan QR" ──────────────────────── */}
      {endModal && (
        <div
          data-testid="end-ride-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
          onClick={() => setEndModal(false)}
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

              <h3 className="text-lg font-bold text-text-primary mb-2">Rider Must Scan QR</h3>
              <p className="text-sm text-text-secondary mb-6">
                To end the ride, show your QR code and have the rider scan it. This confirms drop-off and triggers payment.
              </p>

              <div className="flex w-full gap-3">
                <button
                  data-testid="modal-cancel"
                  onClick={() => setEndModal(false)}
                  className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold text-text-primary active:bg-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  data-testid="modal-show-qr"
                  onClick={() => { setEndModal(false); setQrOpen(true) }}
                  className="flex-1 rounded-2xl bg-primary py-3 text-sm font-semibold text-white active:bg-primary-dark transition-colors"
                >
                  Show QR
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

      {/* ── QR Sheet ────────────────────────────────────────────────────── */}
      <DriverQrSheet
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
        driverId={profile?.id ?? ''}
        rideId={rideId}
      />
    </div>
  )
}
