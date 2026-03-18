import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { getDirectionsByLatLng } from '@/lib/directions'
import { haversineMetres } from '@/lib/geo'
import { trackEvent } from '@/lib/analytics'
import { useAuthStore } from '@/stores/authStore'
import QrScanner from '@/components/ride/QrScanner'
import EmergencySheet from '@/components/ui/EmergencySheet'
import { RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
import { MAP_ID } from '@/lib/mapConstants'
import type { Ride, User, Vehicle, GeoPoint } from '@/types/database'

// Transit info from a transit_dropoff_suggestion message
interface TransitBannerData {
  station_name: string
  transit_options: Array<{ icon: string; line_name: string; departure_stop?: string; arrival_stop?: string; duration_minutes?: number; total_minutes: number }>
  total_rider_minutes: number
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RiderPickupPageProps {
  'data-testid'?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WALKING_SPEED_MS = 1.4
const CLOSE_THRESHOLD_M = 100

// ── Component ─────────────────────────────────────────────────────────────────

export default function RiderPickupPage({ 'data-testid': testId }: RiderPickupPageProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)

  const [ride, setRide] = useState<Ride | null>(null)
  const [driver, setDriver] = useState<Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg' | 'rating_count'> | null>(null)
  const [vehicle, setVehicle] = useState<Pick<Vehicle, 'color' | 'plate' | 'make' | 'model'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [signalling, setSignalling] = useState(false)
  const [signalled, setSignalled] = useState(false)
  const [unreadChat, setUnreadChat] = useState(false)

  // QR scanning / manual code entry state
  const [scanning, setScanning] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [emergencyOpen, setEmergencyOpen] = useState(false)

  // Walking route polyline
  const [walkPolyline, setWalkPolyline] = useState<string | null>(null)

  // Pickup point from ride (updated via Realtime)
  const [pickupLat, setPickupLat] = useState<number | null>(null)
  const [pickupLng, setPickupLng] = useState<number | null>(null)
  const [pickupNote, setPickupNote] = useState<string | null>(null)

  // Rider's current GPS position
  const [riderLat, setRiderLat] = useState<number | null>(null)
  const [riderLng, setRiderLng] = useState<number | null>(null)

  // Transit banner data (from transit_dropoff_suggestion message)
  const [transitBanner, setTransitBanner] = useState<TransitBannerData | null>(null)

  const isNearby = (riderLat !== null && riderLng !== null && pickupLat !== null && pickupLng !== null)
    ? haversineMetres(riderLat, riderLng, pickupLat, pickupLng) <= CLOSE_THRESHOLD_M
    : false

  const walkDistM = (riderLat !== null && riderLng !== null && pickupLat !== null && pickupLng !== null)
    ? haversineMetres(riderLat, riderLng, pickupLat, pickupLng)
    : null
  const walkMinutes = walkDistM !== null ? Math.ceil(walkDistM / WALKING_SPEED_MS / 60) : null

  // ── Fetch ride + driver + vehicle ────────────────────────────────────────
  useEffect(() => {
    if (!rideId) {
      navigate('/home/rider', { replace: true })
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

      // Set initial pickup from ride data
      if (rideData.pickup_point) {
        const pp = rideData.pickup_point as GeoPoint
        setPickupLat(pp.coordinates[1])
        setPickupLng(pp.coordinates[0])
      }
      setPickupNote(rideData.pickup_note ?? null)

      // Set rider position from origin
      if (rideData.origin) {
        const origin = rideData.origin as GeoPoint
        setRiderLat(origin.coordinates[1])
        setRiderLng(origin.coordinates[0])
      }

      // Fetch driver
      if (rideData.driver_id) {
        const { data: driverData } = await supabase
          .from('users')
          .select('id, full_name, avatar_url, rating_avg, rating_count')
          .eq('id', rideData.driver_id)
          .single()
        if (driverData) setDriver(driverData)

        // Fetch vehicle
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

  // ── Realtime: listen for pickup_set broadcasts ───────────────────────────
  useEffect(() => {
    if (!profile?.id || !rideId) return

    const channel = supabase
      .channel(`rider-pickup:${profile.id}`)
      .on('broadcast', { event: 'pickup_set' }, (msg) => {
        const data = msg.payload as { lat?: number; lng?: number; note?: string | null }
        if (typeof data.lat === 'number' && typeof data.lng === 'number') {
          setPickupLat(data.lat)
          setPickupLng(data.lng)
          setPickupNote(data.note ?? null)
        }
      })
      .on('broadcast', { event: 'ride_started' }, () => {
        navigate(`/ride/active-rider/${rideId}`, { replace: true })
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [profile?.id, rideId, navigate])

  // ── GPS tracking for rider ───────────────────────────────────────────────
  useEffect(() => {
    if (!('geolocation' in navigator)) return

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setRiderLat(pos.coords.latitude)
        setRiderLng(pos.coords.longitude)
      },
      () => { /* silently fail */ },
      { enableHighAccuracy: true, maximumAge: 5000 },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  // ── Listen for new chat messages (unread badge) ────────────────────────
  useEffect(() => {
    if (!rideId) return
    const ch = supabase
      .channel(`chat-badge:${rideId}`)
      .on('broadcast', { event: 'new_message' }, () => setUnreadChat(true))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [rideId])

  // ── Fetch walking route polyline ─────────────────────────────────────────
  useEffect(() => {
    if (riderLat === null || riderLng === null || pickupLat === null || pickupLng === null) return

    void getDirectionsByLatLng(riderLat, riderLng, pickupLat, pickupLng).then((result) => {
      if (result?.polyline) setWalkPolyline(result.polyline)
    })
    // Only re-fetch when pickup changes, not every GPS tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupLat, pickupLng, riderLat !== null])

  // ── Submit driver code (QR scan or manual entry) ─────────────────────────
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
        body: JSON.stringify({ driver_code: driverCode }),
      })

      const body = (await resp.json()) as { action?: string; ride_id?: string; error?: { message?: string } }

      if (!resp.ok) {
        setError(body.error?.message ?? 'Failed to process code')
        setSubmitting(false)
        setScanning(false)
        return
      }

      if (body.action === 'started') {
        trackEvent('ride_started', { ride_id: rideId })
        navigate(`/ride/active-rider/${rideId}`, { replace: true })
      }
      setSubmitting(false)
      setScanning(false)
    } catch {
      setError('Network error — try again.')
      setSubmitting(false)
      setScanning(false)
    }
  }, [submitting, rideId, navigate])

  const handleScan = useCallback((text: string) => {
    void submitDriverCode(text)
  }, [submitDriverCode])

  const handleManualSubmit = useCallback(() => {
    const code = manualCode.trim()
    if (!code) return
    void submitDriverCode(code)
  }, [manualCode, submitDriverCode])

  // ── Open Google Maps navigation ──────────────────────────────────────────
  const openNavigation = useCallback(() => {
    if (pickupLat === null || pickupLng === null) return
    const url = `https://www.google.com/maps/dir/?api=1&destination=${pickupLat},${pickupLng}&travelmode=walking`
    window.open(url, '_blank')
  }, [pickupLat, pickupLng])

  // ── Signal driver ────────────────────────────────────────────────────────
  const handleSignal = useCallback(async () => {
    if (!rideId || signalling) return
    setSignalling(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`/api/rides/${rideId}/signal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (resp.ok) {
        setSignalled(true)
      } else {
        setError('Could not signal driver — try again')
      }
    } catch {
      setError('Network error — could not signal driver')
    } finally {
      setSignalling(false)
    }
  }, [rideId, signalling])

  // ── Map center ───────────────────────────────────────────────────────────
  const mapCenter = pickupLat !== null && pickupLng !== null
    ? { lat: pickupLat, lng: pickupLng }
    : riderLat !== null && riderLng !== null
      ? { lat: riderLat, lng: riderLng }
      : { lat: 38.5382, lng: -121.7617 }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div data-testid={testId ?? 'rider-pickup-page'} className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!ride) {
    return (
      <div data-testid={testId ?? 'rider-pickup-page'} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6">
        <p className="text-center text-danger" data-testid="error-message">{error ?? 'Ride not found'}</p>
        <button type="button" onClick={() => navigate('/home/rider', { replace: true })} className="rounded-2xl bg-primary px-6 py-3 font-semibold text-white">
          Back to Home
        </button>
      </div>
    )
  }

  const hasPickup = pickupLat !== null && pickupLng !== null

  // ── QR Scanner Overlay ───────────────────────────────────────────────────
  if (scanning) {
    return (
      <div data-testid={testId ?? 'rider-pickup-page'} className="flex h-dvh flex-col bg-black font-sans overflow-hidden">
        <div
          className="flex items-center gap-3 px-4 bg-black z-10 shrink-0"
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

        <div className="flex-1 flex items-center justify-center px-4 min-h-0 overflow-hidden">
          <div className="w-full max-w-sm">
            <QrScanner onScan={handleScan} onError={(msg) => setError(msg)} />
          </div>
        </div>

        <div className="px-6 py-3 bg-black shrink-0" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
          {submitting && (
            <div className="flex items-center justify-center gap-2">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <p className="text-sm text-white">Verifying code…</p>
            </div>
          )}
          {error && <p data-testid="scan-error" className="text-sm text-danger text-center mb-2">{error}</p>}
          {!submitting && !error && (
            <p className="text-sm text-white/70 text-center mb-3">Point your camera at the driver&apos;s QR code</p>
          )}

          {/* Manual code entry — inside scanner */}
          {!submitting && (
            <div className="mt-2">
              <p className="text-xs text-white/50 text-center mb-2">Or enter the code manually</p>
              <div className="flex gap-2">
                <input
                  data-testid="driver-code-input"
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  placeholder="Driver's code"
                  maxLength={8}
                  className="flex-1 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-center font-mono text-base font-bold tracking-widest text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-primary"
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
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div data-testid={testId ?? 'rider-pickup-page'} className="flex h-dvh flex-col bg-white font-sans overflow-hidden">

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
        <h1 className="text-base font-semibold text-text-primary flex-1">Walk to Pickup</h1>
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

      {/* ── Map ─────────────────────────────────────────────────────────────── */}
      <div className="relative shrink-0" style={{ height: '35dvh' }}>
        <Map
          data-testid="pickup-map"
          mapId={MAP_ID}
          defaultCenter={mapCenter}
          defaultZoom={16}
          gestureHandling="greedy"
          disableDefaultUI
          className="absolute inset-0"
        >
          {/* Rider GPS dot */}
          {riderLat !== null && riderLng !== null && (
            <AdvancedMarker position={{ lat: riderLat, lng: riderLng }} title="Your location">
              <div data-testid="rider-marker" className="relative flex items-center justify-center">
                <span className="absolute h-6 w-6 rounded-full bg-primary/30 animate-ping" />
                <span className="relative h-3 w-3 rounded-full bg-primary border-2 border-white shadow-md" />
              </div>
            </AdvancedMarker>
          )}

          {/* Pickup pin */}
          {hasPickup && (
            <AdvancedMarker position={{ lat: pickupLat, lng: pickupLng }} title="Pickup point">
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

          {/* Walking route polyline */}
          {walkPolyline && (
            <RoutePolyline encodedPath={walkPolyline} color="#16A34A" weight={4} fitBounds={false} />
          )}

          {/* Fit map to rider + pickup */}
          {riderLat !== null && riderLng !== null && hasPickup && (
            <MapBoundsFitter points={[
              { lat: riderLat, lng: riderLng },
              { lat: pickupLat, lng: pickupLng },
            ]} />
          )}
        </Map>

        {/* Nearby pulse */}
        {isNearby && (
          <div data-testid="nearby-alert" className="absolute top-3 left-3 right-3 bg-success text-white rounded-2xl px-4 py-3 text-sm font-semibold text-center shadow-lg animate-pulse">
            🟢 You&apos;re almost there!
          </div>
        )}

        {/* Walk ETA */}
        {walkMinutes !== null && !isNearby && hasPickup && (
          <div data-testid="walk-eta" className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm rounded-2xl px-3 py-2 shadow-lg">
            <p className="text-xs text-text-secondary">Walk to pickup</p>
            <p className="text-sm font-bold text-text-primary">
              {walkMinutes} min · {Math.round((walkDistM ?? 0) * 3.28084)} ft
            </p>
          </div>
        )}
      </div>

      {/* ── Bottom info ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-y-auto min-h-0">

        {/* Waiting for pickup */}
        {!hasPickup && (
          <div className="px-5 pt-5 pb-4 text-center">
            <div className="h-12 w-12 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl">⏳</span>
            </div>
            <p data-testid="waiting-for-pickup" className="text-sm font-medium text-text-primary">
              Waiting for driver to set pickup point…
            </p>
            <p className="text-xs text-text-secondary mt-1">
              Your driver is choosing the best meeting spot
            </p>
          </div>
        )}

        {/* Pickup details */}
        {hasPickup && (
          <>
            {/* Pickup note */}
            {pickupNote && (
              <div className="px-5 pt-4 pb-3 border-b border-border">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1">
                  Driver&apos;s note
                </p>
                <p data-testid="pickup-note" className="text-sm font-medium text-text-primary">
                  {pickupNote}
                </p>
              </div>
            )}

            {/* Vehicle info */}
            {vehicle && (
              <div className="px-5 pt-4 pb-3 border-b border-border">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  Look for this car
                </p>
                <div className="flex items-center gap-3" data-testid="vehicle-info">
                  <div className="text-3xl">🚗</div>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">
                      {vehicle.color} {vehicle.make} {vehicle.model}
                    </p>
                    <p data-testid="vehicle-plate" className="text-lg font-bold text-primary tracking-wide">
                      {vehicle.plate}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Driver info */}
            {driver && (
              <div className="px-5 pt-4 pb-3 border-b border-border">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  Your Driver
                </p>
                <div className="flex items-center gap-3">
                  {driver.avatar_url ? (
                    <img src={driver.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                      {driver.full_name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                  )}
                  <div>
                    <p data-testid="driver-name" className="text-sm font-semibold text-text-primary">
                      {driver.full_name ?? 'Driver'}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      {driver.rating_avg != null && (
                        <span>⭐ {driver.rating_avg.toFixed(1)}</span>
                      )}
                      {driver.rating_count > 0 && (
                        <span>({driver.rating_count} {driver.rating_count === 1 ? 'ride' : 'rides'})</span>
                      )}
                      {(!driver.rating_count || driver.rating_count === 0) && (
                        <span className="text-warning">New user</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Transit info banner */}
        {transitBanner && (
          <div data-testid="transit-banner" className="px-5 pt-3 pb-3 border-b border-border">
            <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1.5">
              After dropoff — continue via transit
            </p>
            <p className="text-sm font-semibold text-text-primary mb-1">
              {transitBanner.station_name}
            </p>
            <div className="space-y-1 mt-1">
              {transitBanner.transit_options.slice(0, 3).map((opt, idx) => (
                <div key={`${opt.line_name}-${idx}`} className="flex items-center gap-1.5 text-[10px]">
                  <span className="shrink-0">{opt.icon}</span>
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

        <div className="flex-1" />

        {/* Action buttons */}
        {hasPickup && (
          <div className="px-5 pt-3 space-y-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}>
            {/* Signal button — above the grid */}
            <button
              data-testid="signal-button"
              onClick={() => { void handleSignal() }}
              disabled={signalling || signalled}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium transition-colors disabled:opacity-50 ${
                signalled
                  ? 'bg-success/10 text-success'
                  : 'bg-warning/10 text-warning active:bg-warning/20'
              }`}
            >
              {signalled ? '✓ Driver notified' : signalling ? 'Signalling…' : 'Signal Driver — I\'m Close'}
            </button>

            {/* Scan QR — prominent full-width button */}
            <button
              data-testid="scan-qr-button"
              onClick={() => { setScanning(true); setError(null) }}
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
              Scan QR to Start Ride
            </button>

            {/* Navigate + Chat grid */}
            <div className="grid grid-cols-2 gap-3">
              <button
                data-testid="navigate-button"
                onClick={openNavigation}
                className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-surface py-3.5 active:bg-border transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
                  <polygon points="3 11 22 2 13 21 11 13 3 11" />
                </svg>
                <span className="text-xs font-medium text-text-primary">Navigate</span>
              </button>

              <button
                data-testid="message-driver-button"
                onClick={() => { setUnreadChat(false); navigate(`/ride/messaging/${rideId as string}`) }}
                className="relative flex flex-col items-center justify-center gap-1 rounded-2xl bg-surface py-3.5 active:bg-border transition-colors"
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

            {error && (
              <p data-testid="ride-error" className="text-sm text-danger text-center">{error}</p>
            )}
          </div>
        )}
      </div>

      <EmergencySheet
        isOpen={emergencyOpen}
        onClose={() => setEmergencyOpen(false)}
        rideId={rideId ?? ''}
      />
    </div>
  )
}
