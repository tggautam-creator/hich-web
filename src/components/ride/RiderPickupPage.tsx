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
import { getNavigationUrl } from '@/lib/pwa'
import JourneyDrawer from '@/components/ride/JourneyDrawer'
import type { Ride, User, Vehicle, GeoPoint } from '@/types/database'

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
  const [unreadChat, setUnreadChat] = useState(0)
  const [cancelledMsg, setCancelledMsg] = useState<string | null>(null)

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

  // Live driver location + ETA
  const [driverLiveLat, setDriverLiveLat] = useState<number | null>(null)
  const [driverLiveLng, setDriverLiveLng] = useState<number | null>(null)
  const [driverEtaMin, setDriverEtaMin] = useState<number | null>(null)

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
          .maybeSingle()
        if (vehicleData) setVehicle(vehicleData)
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
      .on('broadcast', { event: 'driver_cancelled' }, () => {
        // Driver cancelled — show notice then navigate back to matching queue
        setCancelledMsg('Your driver cancelled the ride. Looking for another driver…')
        setTimeout(() => navigate('/rides', { replace: true }), 3000)
      })
      .on('broadcast', { event: 'ride_cancelled' }, () => {
        // Ride fully cancelled
        setCancelledMsg('This ride has been cancelled. We apologize for the inconvenience.')
        setTimeout(() => navigate('/home/rider', { replace: true }), 3000)
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [profile?.id, rideId, navigate])

  // ── Realtime: listen for driver location broadcasts ───────────────────────
  useEffect(() => {
    if (!rideId) return

    const channel = supabase
      .channel(`ride-location:${rideId}`)
      .on('broadcast', { event: 'driver_location' }, (msg) => {
        const data = msg.payload as { lat?: number; lng?: number }
        if (typeof data.lat === 'number' && typeof data.lng === 'number') {
          setDriverLiveLat(data.lat)
          setDriverLiveLng(data.lng)
        }
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [rideId])

  // ── Calculate driver ETA to pickup when driver location updates ──────────
  useEffect(() => {
    if (driverLiveLat == null || driverLiveLng == null || pickupLat == null || pickupLng == null) return

    const distM = haversineMetres(driverLiveLat, driverLiveLng, pickupLat, pickupLng)
    // If very close, show "arriving"
    if (distM < 200) {
      setDriverEtaMin(0)
      return
    }

    // Estimate: avg 30 km/h in city driving
    const etaMin = Math.max(1, Math.round((distM / 1000) / 30 * 60))
    setDriverEtaMin(etaMin)
  }, [driverLiveLat, driverLiveLng, pickupLat, pickupLng])

  // ── Broadcast rider location to driver every 15s ───────────────────────
  useEffect(() => {
    if (!rideId || riderLat == null || riderLng == null) return

    const channel = supabase.channel(`ride-location:${rideId}`)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel.send({
          type: 'broadcast',
          event: 'rider_location',
          payload: { lat: riderLat, lng: riderLng },
        })
      }
    })

    const interval = setInterval(() => {
      void channel.send({
        type: 'broadcast',
        event: 'rider_location',
        payload: { lat: riderLat, lng: riderLng },
      })
    }, 15000)

    return () => {
      clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [rideId, riderLat, riderLng])

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
      .on('broadcast', { event: 'new_message' }, () => setUnreadChat(c => c + 1))
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
    window.open(getNavigationUrl(pickupLat, pickupLng, 'walking', riderLat ?? undefined, riderLng ?? undefined), '_blank')
  }, [pickupLat, pickupLng, riderLat, riderLng])

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

      {/* ── Cancellation overlay ──────────────────────────────────────────── */}
      {cancelledMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-6 rounded-2xl bg-white p-6 text-center shadow-xl">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-danger"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </div>
            <p className="text-base font-semibold text-text-primary">{cancelledMsg}</p>
          </div>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 border-b border-border bg-white z-10"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
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
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative min-h-0">
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

          {/* Live driver marker with ETA badge */}
          {driverLiveLat != null && driverLiveLng != null && (
            <AdvancedMarker position={{ lat: driverLiveLat, lng: driverLiveLng }} title="Driver location">
              <div data-testid="driver-live-marker" className="flex flex-col items-center">
                <div className="bg-primary text-white rounded-full px-2 py-0.5 text-[10px] font-bold shadow-lg mb-0.5 whitespace-nowrap">
                  {driverEtaMin === 0 ? 'Arriving!' : driverEtaMin != null ? `${driverEtaMin} min` : '…'}
                </div>
                <div className="h-7 w-7 rounded-full bg-primary border-2 border-white shadow-lg flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="h-4 w-4" aria-hidden="true">
                    <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
                  </svg>
                </div>
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

      {/* ── Waiting for pickup overlay ───────────────────────────────────── */}
      {!hasPickup && (
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-white/95 backdrop-blur-sm px-5 py-5 text-center rounded-t-3xl shadow-lg">
          <div className="h-12 w-12 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">&#9203;</span>
          </div>
          <p data-testid="waiting-for-pickup" className="text-sm font-medium text-text-primary">
            Waiting for driver to set pickup point&hellip;
          </p>
          <p className="text-xs text-text-secondary mt-1">
            Your driver is choosing the best meeting spot
          </p>
        </div>
      )}

      {error && (
        <div className="absolute bottom-24 left-4 right-4 z-10">
          <p data-testid="ride-error" className="text-sm text-danger text-center bg-white/90 rounded-2xl px-4 py-2 shadow">{error}</p>
        </div>
      )}

      {hasPickup && (
        <JourneyDrawer
          ride={ride}
          driver={driver}
          vehicle={vehicle}
          isRider
          estimatedFare={ride.fare_cents}
          etaMinutes={driverEtaMin}
          distanceKm={walkDistM != null ? walkDistM / 1000 : null}
          onShowQr={() => { setScanning(true); setError(null) }}
          onNavigate={openNavigation}
          onChat={() => { setUnreadChat(0); navigate(`/ride/messaging/${rideId as string}`) }}
          onEmergency={() => setEmergencyOpen(true)}
          unreadChat={unreadChat}
          startRideLabel="Scan QR to Start Ride"
          onSignal={() => { void handleSignal() }}
          signalled={signalled}
          signalling={signalling}
          pickupNote={pickupNote}
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
