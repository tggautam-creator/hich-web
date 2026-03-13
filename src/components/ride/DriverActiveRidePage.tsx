import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import DriverQrSheet from '@/components/ride/DriverQrSheet'
import EmergencySheet from '@/components/ui/EmergencySheet'
import { RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
import type { Ride, User, GeoPoint } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverActiveRidePageProps {
  'data-testid'?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAP_ID = '8cb10228438378796542e8f0'

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriverActiveRidePage({ 'data-testid': testId }: DriverActiveRidePageProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)

  const [ride, setRide] = useState<Ride | null>(null)
  const [rider, setRider] = useState<Pick<User, 'id' | 'full_name' | 'avatar_url'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [endModal, setEndModal] = useState(false)
  const [elapsed, setElapsed] = useState(0) // seconds
  const [riderSignalled, setRiderSignalled] = useState(false)
  const [cancelModal, setCancelModal] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [emergencyOpen, setEmergencyOpen] = useState(false)
  const signalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Driver GPS position
  const [driverLat, setDriverLat] = useState<number | null>(null)
  const [driverLng, setDriverLng] = useState<number | null>(null)

  // Route polyline from Directions API
  const [routePolyline, setRoutePolyline] = useState<string | null>(null)
  const [routeEta, setRouteEta] = useState<string | null>(null)
  const [routeDistance, setRouteDistance] = useState<string | null>(null)

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
        .select('id, full_name, avatar_url')
        .eq('id', rideData.rider_id)
        .single()

      if (riderData) setRider(riderData)
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

    if (isCoordinating && ride.pickup_point) {
      const pp = ride.pickup_point as GeoPoint
      originLat = driverLat
      originLng = driverLng
      destLat = pp.coordinates[1]
      destLng = pp.coordinates[0]
    } else if (isActive && ride.destination) {
      const dest = ride.destination as GeoPoint
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
          }
        }
      } catch {
        // non-fatal
      }
    }

    void fetchRoute()
    // Only re-fetch when phase changes, not on every GPS tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride?.status, ride?.pickup_point, ride?.destination, driverLat !== null])

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

  // ── Format elapsed time ─────────────────────────────────────────────────
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`

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
  const pickupPos = ride?.pickup_point
    ? { lat: (ride.pickup_point as GeoPoint).coordinates[1], lng: (ride.pickup_point as GeoPoint).coordinates[0] }
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
        <button type="button" onClick={() => navigate('/home/driver', { replace: true })} className="rounded-xl bg-primary px-6 py-3 font-semibold text-white">
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
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)', paddingBottom: '0.75rem' }}
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

        {/* Timer / ETA */}
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
                <div className="text-xl">🚗</div>
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
          <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm rounded-xl px-3 py-2 shadow-lg">
            <p className="text-xs text-text-secondary">To pickup</p>
            <p className="text-sm font-bold text-text-primary">{routeEta} · {routeDistance}</p>
          </div>
        )}
      </div>

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
            <span className="text-xs font-medium text-text-primary">Navigate</span>
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
            onClick={() => navigate(`/ride/messaging/${rideId as string}`)}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-surface py-3.5 active:bg-border transition-colors"
          >
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

      {/* ── Emergency FAB ───────────────────────────────────────────── */}
      <button
        data-testid="emergency-button"
        onClick={() => setEmergencyOpen(true)}
        aria-label="Emergency"
        className="fixed bottom-24 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white shadow-lg active:bg-danger/80 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7" aria-hidden="true">
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
        </svg>
      </button>

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
