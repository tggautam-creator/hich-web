import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { MapBoundsFitter } from '@/components/map/RoutePreview'
import { MAP_ID } from '@/lib/mapConstants'
import { formatCents, calculateFare } from '@/lib/fare'
import { colors as tokenColors } from '@/lib/tokens'
import type { GeoPoint } from '@/types/database'
import type { PlaceSuggestion } from '@/lib/places'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MultiDriverMapProps {
  'data-testid'?: string
}

interface LocationState {
  destination?: PlaceSuggestion
  fareRange?: { low: { fare_cents: number }; high: { fare_cents: number } }
  originLat?: number
  originLng?: number
  destinationLat?: number
  destinationLng?: number
}

interface DriverOffer {
  offer_id: string
  driver_id: string
  driver: {
    id: string
    full_name: string | null
    avatar_url: string | null
    rating_avg: number | null
    rating_count: number
  } | null
  vehicle: {
    id: string
    make: string
    model: string
    year: number
    color: string
    plate: string
    seats_available: number
    car_photo_url: string | null
  } | null
  location: GeoPoint | null
  heading: number | null
  created_at: string
}

const DRIVER_COLORS = [tokenColors.primary, tokenColors.success, tokenColors.warning, tokenColors.danger, '#8B5CF6', '#EC4899']

// ── Component ─────────────────────────────────────────────────────────────────

export default function MultiDriverMap({ 'data-testid': testId }: MultiDriverMapProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null
  const [offers, setOffers] = useState<DriverOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [rideOrigin, setRideOrigin] = useState<GeoPoint | null>(null)
  const [rideDestination, setRideDestination] = useState<GeoPoint | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── Fetch ride + offers on mount ────────────────────────────────────────
  useEffect(() => {
    if (!rideId) {
      navigate('/home/rider', { replace: true })
      return
    }

    let cancelled = false

    async function fetchOffers() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Not authenticated')
        setLoading(false)
        return
      }

      const { data: ride } = await supabase
        .from('rides')
        .select('origin, destination')
        .eq('id', rideId as string)
        .single()

      if (ride) {
        setRideOrigin(ride.origin as GeoPoint)
        setRideDestination(ride.destination as GeoPoint | null)
      }

      const resp = await fetch(`/api/rides/${rideId}/offers`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (cancelled) return

      if (resp.ok) {
        const body = (await resp.json()) as { offers: DriverOffer[] }
        setOffers(body.offers ?? [])
      } else {
        setError('Failed to load driver offers')
      }

      setLoading(false)
    }

    void fetchOffers()
    return () => { cancelled = true }
  }, [rideId, navigate])

  // ── Realtime + polling ──────────────────────────────────────────────────
  // Auto-navigate back to WaitingRoom when all drivers cancel (offers drop to 0 after load)
  const hasLoadedRef = useRef(false)
  useEffect(() => {
    if (loading) return
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      // Don't navigate on initial load with 0 offers — that's covered by the error state below
      if (offers.length > 0) return
    }
    if (offers.length === 0 && hasLoadedRef.current) {
      navigate('/ride/waiting', {
        replace: true,
        state: {
          rideId,
          destination: state?.destination,
          fareRange: state?.fareRange,
          originLat: state?.originLat,
          originLng: state?.originLng,
          destinationLat: state?.destinationLat,
          destinationLng: state?.destinationLng,
        },
      })
    }
  }, [offers.length, loading, navigate, rideId, state])

  useEffect(() => {
    if (!rideId) return
    let cancelled = false

    // Subscribe to driver cancellations for this ride
    const channel = supabase
      .channel(`multi-driver:${rideId}`)
      .on('broadcast', { event: 'driver_cancelled' }, (msg) => {
        if (cancelled) return
        const data = msg.payload as Record<string, unknown>
        const cancelledId = data['cancelled_driver_id'] as string | undefined
        if (cancelledId) {
          setOffers((prev) => prev.filter((o) => o.driver_id !== cancelledId))
        }
      })
      .on('broadcast', { event: 'ride_cancelled' }, () => {
        if (cancelled) return
        navigate('/home/rider', { replace: true })
      })
      .subscribe()

    // Polling fallback (8s)
    const poll = setInterval(async () => {
      if (cancelled) return

      const { data: { session } } = await supabase.auth.getSession()
      if (!session || cancelled) return

      // Check ride status
      const { data: rideData } = await supabase
        .from('rides')
        .select('status')
        .eq('id', rideId)
        .single()

      if (cancelled) return
      if (rideData?.status === 'cancelled') {
        navigate('/home/rider', { replace: true })
        return
      }

      // Re-fetch offers
      const resp = await fetch(`/api/rides/${rideId}/offers`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (cancelled || !resp.ok) return
      const body = (await resp.json()) as { offers: DriverOffer[] }
      setOffers(body.offers ?? [])
    }, 8000)

    return () => {
      cancelled = true
      clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [rideId, navigate])

  // ── Select a driver → navigate to WaitingRoom (not chat) ───────────────
  const handleSelectDriver = useCallback(async (driverId: string) => {
    if (!rideId || selecting) return
    setSelecting(driverId)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`/api/rides/${rideId}/select-driver`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ driver_id: driverId }),
      })

      if (resp.ok) {
        const body = (await resp.json()) as { driver_name?: string | null }
        const selectedOffer = offers.find((o) => o.driver_id === driverId)
        const driverName = body.driver_name ?? selectedOffer?.driver?.full_name ?? null

        // Navigate to WaitingRoom with selectedDriverId hint → enters 'driver_choosing_dropoff' phase
        navigate('/ride/waiting', {
          replace: true,
          state: {
            rideId,
            destination: state?.destination,
            fareRange: state?.fareRange,
            originLat: state?.originLat,
            originLng: state?.originLng,
            destinationLat: state?.destinationLat,
            destinationLng: state?.destinationLng,
            selectedDriverId: driverId,
            selectedDriverName: driverName,
          },
        })
      }
    } catch {
      // non-fatal
    } finally {
      setSelecting(null)
    }
  }, [rideId, selecting, navigate, state, offers])

  // ── Loading / error states ──────────────────────────────────────────────
  if (loading) {
    return (
      <div data-testid={testId ?? 'multi-driver-page'} className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error || offers.length === 0) {
    return (
      <div data-testid={testId ?? 'multi-driver-page'} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6">
        <p className="text-center text-danger" data-testid="error-message">{error ?? 'No driver offers found'}</p>
        <button
          type="button"
          onClick={() => navigate('/home/rider', { replace: true })}
          className="rounded-2xl bg-primary px-6 py-3 font-semibold text-white"
        >
          Back to Home
        </button>
      </div>
    )
  }

  // ── Map points ──────────────────────────────────────────────────────────
  const mapPoints: Array<{ lat: number; lng: number }> = []
  if (rideOrigin) {
    mapPoints.push({ lat: rideOrigin.coordinates[1]!, lng: rideOrigin.coordinates[0]! })
  }
  if (rideDestination) {
    mapPoints.push({ lat: rideDestination.coordinates[1]!, lng: rideDestination.coordinates[0]! })
  }
  for (const offer of offers) {
    if (offer.location) {
      mapPoints.push({ lat: offer.location.coordinates[1]!, lng: offer.location.coordinates[0]! })
    }
  }

  const centerLat = mapPoints.length > 0
    ? mapPoints.reduce((s, p) => s + p.lat, 0) / mapPoints.length
    : 38.54
  const centerLng = mapPoints.length > 0
    ? mapPoints.reduce((s, p) => s + p.lng, 0) / mapPoints.length
    : -121.76

  const fare = calculateFare(10, 15)

  return (
    <div data-testid={testId ?? 'multi-driver-page'} className="flex h-dvh flex-col bg-white font-sans overflow-hidden">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 border-b border-border bg-white z-10 shrink-0"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
      >
        <button
          data-testid="back-button"
          onClick={() => navigate('/ride/waiting', {
            replace: true,
            state: {
              rideId,
              destination: state?.destination,
              fareRange: state?.fareRange,
              originLat: state?.originLat,
              originLng: state?.originLng,
              destinationLat: state?.destinationLat,
              destinationLng: state?.destinationLng,
            },
          })}
          className="p-1 shrink-0 text-text-primary active:opacity-60"
          aria-label="Go back"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="m12 5-7 7 7 7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-text-primary">Choose Your Driver</h1>
          <p className="text-xs text-text-secondary">{offers.length} driver{offers.length !== 1 ? 's' : ''} available</p>
        </div>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-success/10 text-success shrink-0">
          {offers.length} offers
        </span>
      </div>

      {/* ── Map ──────────────────────────────────────────────────────────────── */}
      <div className="relative" style={{ height: '45dvh' }}>
        <Map
          mapId={MAP_ID}
          defaultCenter={{ lat: centerLat, lng: centerLng }}
          defaultZoom={13}
          gestureHandling="cooperative"
          disableDefaultUI
          className="h-full w-full"
        >
          {rideOrigin && (
            <AdvancedMarker
              position={{ lat: rideOrigin.coordinates[1]!, lng: rideOrigin.coordinates[0]! }}
              title="Your location"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-primary shadow-lg">
                <div className="h-3 w-3 rounded-full bg-white" />
              </div>
            </AdvancedMarker>
          )}

          {rideDestination && (
            <AdvancedMarker
              position={{ lat: rideDestination.coordinates[1]!, lng: rideDestination.coordinates[0]! }}
              title="Destination"
            >
              <div className="flex h-7 items-center justify-center rounded-full border-[3px] border-white bg-danger px-2 shadow-lg text-[10px] font-bold text-white whitespace-nowrap">
                DROP-OFF
              </div>
            </AdvancedMarker>
          )}

          {offers.map((offer, idx) => {
            if (!offer.location) return null
            const color = DRIVER_COLORS[idx % DRIVER_COLORS.length] as string
            return (
              <AdvancedMarker
                key={offer.offer_id}
                position={{ lat: offer.location.coordinates[1]!, lng: offer.location.coordinates[0]! }}
                title={offer.driver?.full_name ?? `Driver ${idx + 1}`}
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-white shadow-lg text-xs font-bold text-white"
                  style={{ backgroundColor: color }}
                >
                  {idx + 1}
                </div>
              </AdvancedMarker>
            )
          })}

          {mapPoints.length >= 2 && <MapBoundsFitter points={mapPoints} />}
        </Map>
      </div>

      {/* ── Driver cards — horizontal scroll ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-3 pb-2 shrink-0">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Swipe to compare drivers
          </p>
        </div>

        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto px-4 pb-4 snap-x snap-mandatory scrollbar-none flex-1 items-stretch"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
          data-testid="driver-cards"
        >
          {offers.map((offer, idx) => {
            const color = DRIVER_COLORS[idx % DRIVER_COLORS.length] as string
            const driverName = offer.driver?.full_name ?? `Driver ${idx + 1}`
            const rating = offer.driver?.rating_avg
            const vehicle = offer.vehicle

            return (
              <div
                key={offer.offer_id}
                data-testid={`driver-card-${offer.driver_id}`}
                className="snap-center shrink-0 w-[280px] rounded-2xl border border-border bg-white shadow-sm flex flex-col"
              >
                <div className="h-1.5 rounded-t-2xl" style={{ backgroundColor: color }} />

                <div className="p-4 flex flex-col flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="h-11 w-11 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      {offer.driver?.avatar_url ? (
                        <img
                          src={offer.driver.avatar_url}
                          alt={driverName}
                          className="h-11 w-11 rounded-full object-cover"
                        />
                      ) : (
                        <span>{driverName[0]?.toUpperCase() ?? '?'}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-text-primary truncate">{driverName}</p>
                      {rating != null && (
                        <p className="text-xs text-text-secondary">&#x2B50; {rating.toFixed(1)}</p>
                      )}
                    </div>
                    <span
                      className="text-xs font-bold text-white rounded-full h-7 w-7 flex items-center justify-center shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      {idx + 1}
                    </span>
                  </div>

                  {vehicle && (
                    <div className="bg-surface rounded-2xl px-3 py-2 mb-3 space-y-1">
                      <p className="text-xs font-medium text-text-primary">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-[10px] text-text-secondary">
                          <span
                            className="inline-block h-3 w-3 rounded-full border border-border"
                            style={{ backgroundColor: vehicle.color }}
                          />
                          {vehicle.color}
                        </span>
                        <span className="text-[10px] text-text-secondary">|</span>
                        <span className="text-[10px] font-medium text-text-secondary">{vehicle.plate}</span>
                        <span className="text-[10px] text-text-secondary">|</span>
                        <span className="text-[10px] text-text-secondary">{vehicle.seats_available} seat{vehicle.seats_available !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-text-secondary">Est. fare</span>
                    <span className="text-sm font-bold text-text-primary">{formatCents(fare.fare_cents)}</span>
                  </div>

                  <button
                    data-testid={`choose-driver-${offer.driver_id}`}
                    onClick={() => { void handleSelectDriver(offer.driver_id) }}
                    disabled={selecting !== null}
                    className="mt-auto w-full rounded-2xl py-3 text-sm font-semibold text-white active:opacity-90 disabled:opacity-50 transition-colors"
                    style={{ backgroundColor: color }}
                  >
                    {selecting === offer.driver_id ? 'Selecting...' : `Choose ${driverName.split(' ')[0]}`}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
