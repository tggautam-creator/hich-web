import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import QrScanner from '@/components/ride/QrScanner'
import EmergencySheet from '@/components/ui/EmergencySheet'
import { RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
import type { Ride, User, GeoPoint } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RiderActiveRidePageProps {
  'data-testid'?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAP_ID = '8cb10228438378796542e8f0'

// ── Component ─────────────────────────────────────────────────────────────────

export default function RiderActiveRidePage({ 'data-testid': testId }: RiderActiveRidePageProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)

  const [ride, setRide] = useState<Ride | null>(null)
  const [driver, setDriver] = useState<Pick<User, 'id' | 'full_name' | 'avatar_url'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [elapsed, setElapsed] = useState(0) // seconds
  const [manualCode, setManualCode] = useState('')
  const [emergencyOpen, setEmergencyOpen] = useState(false)
  const [routePolyline, setRoutePolyline] = useState<string | null>(null)
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(null)

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
          .select('id, full_name, avatar_url')
          .eq('id', rideData.driver_id)
          .single()

        if (driverData) setDriver(driverData)
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

  // ── Fetch route polyline ────────────────────────────────────────────────
  useEffect(() => {
    if (!ride) return
    const pickup = ride.pickup_point as GeoPoint | null
    const dest = ride.destination as GeoPoint | null

    // Active ride: show route from pickup to destination
    if (ride.status === 'active' && pickup && dest) {
      const pLat = pickup.coordinates[1]
      const pLng = pickup.coordinates[0]
      const dLat = dest.coordinates[1]
      const dLng = dest.coordinates[0]

      fetch(`/api/directions?originLat=${pLat}&originLng=${pLng}&destLat=${dLat}&destLng=${dLng}`)
        .then((r) => r.json())
        .then((data: { polyline?: string }) => {
          if (data.polyline) setRoutePolyline(data.polyline)
        })
        .catch(() => { /* ignore */ })
      return
    }

    // Coordinating: show route from rider to pickup (if rider GPS available)
    if (ride.status === 'coordinating' && pickup && riderPos) {
      const pLat = pickup.coordinates[1]
      const pLng = pickup.coordinates[0]

      fetch(`/api/directions?originLat=${riderPos.lat}&originLng=${riderPos.lng}&destLat=${pLat}&destLng=${pLng}`)
        .then((r) => r.json())
        .then((data: { polyline?: string }) => {
          if (data.polyline) setRoutePolyline(data.polyline)
        })
        .catch(() => { /* ignore */ })
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
  const pickupPos = ride?.pickup_point
    ? { lat: (ride.pickup_point as GeoPoint).coordinates[1], lng: (ride.pickup_point as GeoPoint).coordinates[0] }
    : null
  const destPos = ride?.destination
    ? { lat: (ride.destination as GeoPoint).coordinates[1], lng: (ride.destination as GeoPoint).coordinates[0] }
    : null
  const mapCenter = destPos ?? pickupPos ?? { lat: 38.5382, lng: -121.7617 }

  const isActive = ride?.status === 'active'
  const isCoordinating = ride?.status === 'coordinating'
  const scanLabel = isActive ? 'Scan QR to End Ride' : 'Scan QR to Start Ride'

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
        <button type="button" onClick={() => navigate('/home/rider', { replace: true })} className="rounded-xl bg-primary px-6 py-3 font-semibold text-white">
          Back to Home
        </button>
      </div>
    )
  }

  // ── QR Scanner Overlay ───────────────────────────────────────────────────
  if (scanning) {
    return (
      <div data-testid={testId ?? 'rider-active-ride'} className="flex min-h-dvh flex-col bg-black font-sans">
        {/* Scanner header */}
        <div
          className="flex items-center gap-3 px-4 bg-black z-10"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)', paddingBottom: '0.75rem' }}
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
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-sm">
            <QrScanner
              onScan={handleScan}
              onError={(msg) => setError(msg)}
            />
          </div>
        </div>

        {/* Status bar */}
        <div className="px-6 py-4 bg-black" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}>
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
    <div data-testid={testId ?? 'rider-active-ride'} className="flex min-h-dvh flex-col bg-white font-sans">

      {/* ── Header w/ status badge + timer ─────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 border-b border-border bg-white z-10"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)', paddingBottom: '0.75rem' }}
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
            <div className="flex items-center gap-1.5 bg-yellow-100 px-2.5 py-1 rounded-full" data-testid="enroute-badge">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-yellow-500" />
              </span>
              <span className="text-xs font-bold text-yellow-700 tracking-wider">EN ROUTE</span>
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

        {/* Timer */}
        {isActive && (
          <div className="text-right" data-testid="ride-timer">
            <p className="text-lg font-mono font-bold text-text-primary">{timeStr}</p>
            <p className="text-[10px] text-text-secondary uppercase tracking-wide">Ride Time</p>
          </div>
        )}
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative" style={{ minHeight: '40dvh' }}>
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
              <div className="h-4 w-4 rounded-full bg-blue-500 border-2 border-white shadow" />
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

      {/* ── Chat button ─────────────────────────────────────────────────── */}
      <div className="px-4 py-2 border-t border-border">
        <button
          data-testid="chat-button"
          onClick={() => navigate(`/ride/messaging/${rideId as string}`)}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-surface py-3 active:bg-border transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-sm font-medium text-text-primary">Message {driver?.full_name ?? 'Driver'}</span>
        </button>
      </div>

      {/* ── Manual code entry (desktop fallback) ────────────────────────── */}
      <div className="px-4 py-2 border-t border-border">
        <p className="text-xs text-text-secondary text-center mb-2">Enter driver&apos;s code or scan QR</p>
        <div className="flex gap-2">
          <input
            data-testid="driver-code-input"
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            placeholder="e.g. F520E948"
            maxLength={8}
            className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-center font-mono text-base font-bold tracking-widest text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            data-testid="submit-code-button"
            onClick={handleManualSubmit}
            disabled={submitting || manualCode.trim().length === 0}
            className="rounded-xl bg-primary px-5 py-3 font-semibold text-white disabled:opacity-50 active:bg-primary/90 transition-colors"
          >
            {submitting ? '…' : 'Go'}
          </button>
        </div>
      </div>

      {/* ── Scan QR CTA — primary action, NO "End Ride" button ───────── */}
      <div className="px-4 pb-4" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}>
        {error && (
          <p data-testid="ride-error" className="text-sm text-danger text-center mb-3">{error}</p>
        )}

        <button
          data-testid="scan-qr-button"
          onClick={() => { setScanning(true); setError(null) }}
          className="w-full rounded-2xl bg-success py-4 text-base font-bold text-white shadow-lg active:bg-success/90 transition-colors flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="4" height="4" rx="0.5" />
            <line x1="21" y1="14" x2="21" y2="21" />
            <line x1="14" y1="21" x2="21" y2="21" />
          </svg>
          {scanLabel}
        </button>
      </div>

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
    </div>
  )
}
