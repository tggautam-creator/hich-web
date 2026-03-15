import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { formatCents, type FareRange } from '@/lib/fare'
import type { PlaceSuggestion } from '@/lib/places'
import { RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
import { MAP_ID } from '@/lib/mapConstants'
import { useAuthStore } from '@/stores/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WaitingRoomProps {
  'data-testid'?: string
}

interface LocationState {
  destination: PlaceSuggestion
  fareRange: FareRange
  rideId: string
  originLat?: number
  originLng?: number
  destinationLat?: number
  destinationLng?: number
  polyline?: string
}

interface DriverOfferInfo {
  driver_id: string
  driver_name: string | null
  driver_avatar: string | null
  driver_rating: number | null
  driver_rating_count: number
  overlap_pct: number | null
  driver_destination_name: string | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WaitingRoom({ 'data-testid': testId }: WaitingRoomProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null
  const profile = useAuthStore((s) => s.profile)

  const [isCancelling, setCancelling] = useState(false)
  const [driverOffers, setDriverOffers] = useState<DriverOfferInfo[]>([])
  const [driverChoosingDropoff, setDriverChoosingDropoff] = useState(false)
  const [selectedDriverName, setSelectedDriverName] = useState<string | null>(null)
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Redirect if missing required state
  useEffect(() => {
    if (!state?.rideId) {
      navigate('/home/rider', { replace: true })
    }
  }, [state, navigate])

  // Auto-select logic: after first offer, wait 15s then decide
  const handleSelectOrNavigate = useCallback((offers: DriverOfferInfo[]) => {
    if (!state?.rideId) return
    const navState = {
      destination: state.destination,
      destinationLat: state.destinationLat,
      destinationLng: state.destinationLng,
    }

    if (offers.length === 1) {
      // Single driver — auto-select
      void (async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          const resp = await fetch(`/api/rides/${state.rideId}/select-driver`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ driver_id: offers[0].driver_id }),
          })

          // Driver always goes through DropoffSelection after accepting.
          // Wait here until they finish choosing a drop-off point.
          if (resp.ok) {
            const body = await resp.json() as { driver_name?: string | null }
            setSelectedDriverName(body.driver_name ?? offers[0].driver_name)
            setDriverChoosingDropoff(true)
            return
          }
        }
        navigate(`/ride/messaging/${state.rideId}`, { replace: true, state: navState })
      })()
    } else {
      // Multiple drivers — navigate to multi-driver selection
      navigate(`/ride/multi-driver/${state.rideId}`, { replace: true, state: navState })
    }
  }, [state, navigate])

  // Poll ride_offers and ride status every 5s as a reliable fallback for Realtime.
  // This ensures the rider sees driver acceptances even if server Realtime is down.
  useEffect(() => {
    if (!state?.rideId) return
    let cancelled = false

    const poll = async () => {
      if (cancelled) return

      // Check ride status first — if coordinating, go to chat; if cancelled, go home
      const { data: rideData } = await supabase
        .from('rides')
        .select('status, driver_id')
        .eq('id', state.rideId)
        .single()

      if (cancelled || !rideData) return

      if (rideData.status === 'coordinating') {
        navigate(`/ride/messaging/${state.rideId}`, {
          replace: true,
          state: {
            destination: state.destination,
            destinationLat: state.destinationLat,
            destinationLng: state.destinationLng,
          },
        })
        return
      }

      if (rideData.status === 'cancelled') {
        navigate('/home/rider', { replace: true })
        return
      }

      // If ride reverted to requested with no driver (driver cancelled), reset state
      if (rideData.status === 'requested' && !rideData.driver_id && driverChoosingDropoff) {
        setDriverChoosingDropoff(false)
        setSelectedDriverName(null)
        setDriverOffers((prev) => prev.filter(() => false)) // clear all
      }

      // Check for new driver offers
      const { data: existingOffers } = await supabase
        .from('ride_offers')
        .select('driver_id, driver_destination_name, overlap_pct, status')
        .eq('ride_id', state.rideId)
        .eq('status', 'pending')

      if (cancelled || !existingOffers || existingOffers.length === 0) return

      const driverIds = existingOffers.map(o => o.driver_id)
      const { data: drivers } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, rating_avg, rating_count')
        .in('id', driverIds)

      if (cancelled) return

      const driverMap: Record<string, { full_name: string | null; avatar_url: string | null; rating_avg: number | null; rating_count: number }> = {}
      for (const d of drivers ?? []) driverMap[d.id] = d

      const offers: DriverOfferInfo[] = existingOffers.map((row) => {
        const driver = driverMap[row.driver_id]
        return {
          driver_id: row.driver_id,
          driver_name: driver?.full_name ?? null,
          driver_avatar: driver?.avatar_url ?? null,
          driver_rating: driver?.rating_avg ?? null,
          driver_rating_count: driver?.rating_count ?? 0,
          overlap_pct: row.overlap_pct,
          driver_destination_name: row.driver_destination_name,
        }
      })

      setDriverOffers((prev) => {
        const existing = new Set(prev.map(o => o.driver_id))
        const newOffers = offers.filter(o => !existing.has(o.driver_id))
        if (newOffers.length === 0) return prev
        const merged = [...prev, ...newOffers]

        // Start auto-select timer if this is the first batch and no timer running
        if (prev.length === 0 && merged.length >= 1 && !selectionTimerRef.current) {
          selectionTimerRef.current = setTimeout(() => {
            handleSelectOrNavigate(merged)
          }, 15000)
        }

        return merged
      })
    }

    // Run immediately on mount, then every 5 seconds
    void poll()
    const interval = setInterval(() => void poll(), 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [state, navigate, handleSelectOrNavigate, driverChoosingDropoff])

  // Subscribe to ride acceptance via Supabase Realtime broadcast
  useEffect(() => {
    if (!state?.rideId || !profile?.id) return

    const channel = supabase
      .channel(`waiting:${profile.id}`)
      .on('broadcast', { event: 'ride_accepted' }, (msg) => {
        const data = msg.payload as Record<string, unknown>
        const rideId = data['ride_id'] as string | undefined
        const driverId = data['driver_id'] as string | undefined
        if (rideId !== state.rideId || !driverId) return

        const offer: DriverOfferInfo = {
          driver_id: driverId,
          driver_name: typeof data['driver_name'] === 'string' ? data['driver_name'] : null,
          driver_avatar: typeof data['driver_avatar'] === 'string' ? data['driver_avatar'] : null,
          driver_rating: typeof data['driver_rating'] === 'number' ? data['driver_rating'] : null,
          driver_rating_count: typeof data['driver_rating_count'] === 'number' ? data['driver_rating_count'] : 0,
          overlap_pct: typeof data['overlap_pct'] === 'number' ? data['overlap_pct'] : null,
          driver_destination_name: typeof data['driver_destination_name'] === 'string' ? data['driver_destination_name'] : null,
        }

        // If broadcast didn't include driver name, fetch it from DB
        if (!offer.driver_name) {
          void supabase
            .from('users')
            .select('full_name, avatar_url, rating_avg, rating_count')
            .eq('id', driverId)
            .single()
            .then(({ data: driverUser }) => {
              if (driverUser?.full_name) {
                setDriverOffers((prev) =>
                  prev.map((o) =>
                    o.driver_id === driverId
                      ? {
                          ...o,
                          driver_name: driverUser.full_name,
                          driver_avatar: driverUser.avatar_url ?? o.driver_avatar,
                          driver_rating: driverUser.rating_avg ?? o.driver_rating,
                          driver_rating_count: driverUser.rating_count ?? o.driver_rating_count,
                        }
                      : o,
                  ),
                )
              }
            })
        }

        setDriverOffers((prev) => {
          if (prev.some(o => o.driver_id === driverId)) return prev
          const updated = [...prev, offer]

          // First offer: start 15s timer
          if (updated.length === 1) {
            selectionTimerRef.current = setTimeout(() => {
              handleSelectOrNavigate(updated)
            }, 15000)
          }

          // Second+ offer: clear old timer, start a shorter 5s timer
          // to give a few more seconds for additional offers
          if (updated.length > 1 && selectionTimerRef.current) {
            clearTimeout(selectionTimerRef.current)
            selectionTimerRef.current = setTimeout(() => {
              handleSelectOrNavigate(updated)
            }, 5000)
          }

          return updated
        })
      })
      .on('broadcast', { event: 'driver_cancelled' }, (msg) => {
        const data = msg.payload as Record<string, unknown>
        if (data['ride_id'] !== state.rideId) return

        // Reset to "finding driver" state
        setDriverChoosingDropoff(false)
        setSelectedDriverName(null)
        if (selectionTimerRef.current) {
          clearTimeout(selectionTimerRef.current)
          selectionTimerRef.current = null
        }

        // Remove the cancelled driver from offers
        const cancelledId = data['cancelled_driver_id'] as string | undefined
        if (cancelledId) {
          setDriverOffers((prev) => prev.filter(o => o.driver_id !== cancelledId))
        }
      })
      .subscribe()

    return () => {
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current)
      void supabase.removeChannel(channel)
    }
  }, [state, profile?.id, handleSelectOrNavigate])

  // Listen for driver finishing dropoff selection (when driverChoosingDropoff is true)
  useEffect(() => {
    if (!driverChoosingDropoff || !state?.rideId) return

    const navState = {
      destination: state.destination,
      destinationLat: state.destinationLat,
      destinationLng: state.destinationLng,
    }

    const goToChat = () => {
      navigate(`/ride/messaging/${state.rideId}`, { replace: true, state: navState })
    }

    let cancelled = false

    const channel = supabase
      .channel(`chat:${state.rideId}`)
      .on('broadcast', { event: 'new_message' }, (msg) => {
        const payload = msg.payload as Record<string, unknown>
        if (payload['type'] === 'transit_dropoff_suggestion') {
          goToChat()
        }
      })
      .on('broadcast', { event: 'dropoff_done' }, () => {
        goToChat()
      })
      .on('broadcast', { event: 'ride_cancelled' }, () => {
        navigate('/home/rider', { replace: true })
      })
      .on('broadcast', { event: 'driver_cancelled' }, () => {
        // Driver cancelled during dropoff selection — reset to finding driver state
        setDriverChoosingDropoff(false)
        setSelectedDriverName(null)
      })
      .subscribe()

    // Poll ride status every 5s as a reliable fallback.
    // - If ride reverted to 'requested' → driver cancelled, reset to finding mode
    // - If ride has messages → driver finished dropoff, go to chat
    // - If ride is 'coordinating' → go to chat
    // - After 60s total → go to chat anyway
    const startTime = Date.now()
    const poll = setInterval(() => {
      if (cancelled) return
      void supabase
        .from('rides')
        .select('status, driver_id')
        .eq('id', state.rideId)
        .single()
        .then(({ data: rideData }) => {
          if (cancelled || !rideData) return
          if (rideData.status === 'requested' || !rideData.driver_id) {
            // Driver cancelled — revert to finding driver state
            setDriverChoosingDropoff(false)
            setSelectedDriverName(null)
            setDriverOffers((prev) => prev.filter(o => o.driver_id !== rideData.driver_id))
          } else if (rideData.status === 'coordinating') {
            goToChat()
          } else if (rideData.status === 'cancelled') {
            navigate('/home/rider', { replace: true })
          } else if (Date.now() - startTime > 60000) {
            // 60s hard fallback
            goToChat()
          }
        })
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [driverChoosingDropoff, state, navigate])

  if (!state?.rideId) return null

  const destination = state.destination
  const fareRange = state.fareRange
  const fareDisplay = fareRange
    ? (fareRange.low.fare_cents === fareRange.high.fare_cents
        ? formatCents(fareRange.low.fare_cents)
        : `${formatCents(fareRange.low.fare_cents)}–${formatCents(fareRange.high.fare_cents)}`)
    : null

  // ── Map coordinates ─────────────────────────────────────────────────────
  const oLat = state.originLat ?? 0
  const oLng = state.originLng ?? 0
  const dLat = state.destinationLat ?? 0
  const dLng = state.destinationLng ?? 0
  const hasRoute = oLat !== 0 && oLng !== 0 && dLat !== 0 && dLng !== 0

  async function handleCancel() {
    setCancelling(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/home/rider', { replace: true })
        return
      }
      await fetch(`/api/rides/${state!.rideId}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
    } finally {
      navigate('/home/rider', { replace: true })
    }
  }

  // Status text based on offers
  const statusText = driverChoosingDropoff
    ? `${selectedDriverName ?? 'Driver'} is choosing a drop-off point…`
    : driverOffers.length === 0
      ? 'Finding you a driver…'
      : driverOffers.length === 1
        ? `${driverOffers[0].driver_name ?? 'A driver'} accepted!`
        : `${driverOffers.length} drivers accepted — choosing best match…`

  return (
    <div
      data-testid={testId ?? 'waiting-room-page'}
      className="min-h-dvh w-full bg-white flex flex-col font-sans"
    >

      {/* ── Route preview map ────────────────────────────────────────────────── */}
      <div className="relative w-full" style={{ height: driverOffers.length > 0 ? '35dvh' : '45dvh' }}>
        {hasRoute ? (
          <Map
            mapId={MAP_ID}
            defaultCenter={{ lat: (oLat + dLat) / 2, lng: (oLng + dLng) / 2 }}
            defaultZoom={12}
            gestureHandling="cooperative"
            disableDefaultUI
            className="h-full w-full"
          >
            {/* Pickup marker */}
            <AdvancedMarker position={{ lat: oLat, lng: oLng }} title="Pickup">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-success shadow-lg text-xs font-bold text-white">
                P
              </div>
            </AdvancedMarker>
            {/* Destination marker */}
            <AdvancedMarker position={{ lat: dLat, lng: dLng }} title="Destination">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-danger shadow-lg text-xs font-bold text-white">
                D
              </div>
            </AdvancedMarker>
            {state.polyline ? (
              <RoutePolyline encodedPath={state.polyline} />
            ) : (
              <MapBoundsFitter points={[{ lat: oLat, lng: oLng }, { lat: dLat, lng: dLng }]} />
            )}
          </Map>
        ) : (
          <div className="flex h-full items-center justify-center bg-surface">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {/* Overlay: status badge */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 shadow-lg backdrop-blur-sm">
          <span className="relative flex h-3 w-3">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${driverChoosingDropoff ? 'bg-primary' : driverOffers.length > 0 ? 'bg-success' : 'bg-primary'} opacity-75`} />
            <span className={`relative inline-flex h-3 w-3 rounded-full ${driverChoosingDropoff ? 'bg-primary' : driverOffers.length > 0 ? 'bg-success' : 'bg-primary'}`} />
          </span>
          <span data-testid="status-text" className="text-sm font-semibold text-text-primary">
            {statusText}
          </span>
        </div>
      </div>

      {/* ── Bottom panel ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col px-5 pt-5 gap-4">

        {/* Destination + fare card */}
        {destination && (
        <div className="bg-surface rounded-2xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-primary mt-0.5" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <div className="min-w-0">
              <p data-testid="destination-name" className="text-sm font-medium text-text-primary truncate">
                {destination.mainText}
              </p>
              <p className="text-xs text-text-secondary truncate">{destination.secondaryText}</p>
            </div>
          </div>

          {fareDisplay && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Estimated fare</span>
            <span data-testid="fare-display" className="text-lg font-bold text-text-primary">{fareDisplay}</span>
          </div>
          )}
        </div>
        )}

        {/* Driver offer cards */}
        {driverOffers.length > 0 && (
          <div className="space-y-3" data-testid="driver-offers">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              {driverOffers.length === 1 ? 'Driver accepted' : `${driverOffers.length} drivers accepted`}
            </p>
            {driverOffers.map((offer) => (
              <div
                key={offer.driver_id}
                data-testid="driver-offer-card"
                className="bg-surface rounded-2xl p-4 space-y-2.5"
              >
                <div className="flex items-center gap-3">
                  {offer.driver_avatar ? (
                    <img src={offer.driver_avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-light">
                      <span className="text-lg">🧑</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">
                      {offer.driver_name ?? 'Driver'}
                    </p>
                    {offer.driver_rating != null && (
                      <div className="flex items-center gap-1">
                        <span className="text-warning text-xs">★</span>
                        <span className="text-xs text-text-secondary">{offer.driver_rating.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {offer.overlap_pct != null && (
                  <div className="flex items-center gap-2.5">
                    <div className="h-1.5 flex-1 rounded-full bg-border overflow-hidden max-w-[140px]">
                      <div
                        className="h-full rounded-full bg-success transition-all"
                        style={{ width: `${offer.overlap_pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-success shrink-0">
                      {offer.overlap_pct}% of your journey
                    </span>
                  </div>
                )}

                {offer.driver_destination_name && (
                  <p className="text-[10px] text-text-secondary">
                    Heading to: {offer.driver_destination_name}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {driverOffers.length === 0 && !driverChoosingDropoff && (
          <p className="text-center text-sm text-text-secondary">
            Sit tight — we're notifying nearby drivers
          </p>
        )}

        {/* Driver is choosing a drop-off point — show a waiting card */}
        {driverChoosingDropoff && (
          <div data-testid="driver-choosing-dropoff" className="bg-primary/5 border border-primary/15 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0" />
              <p className="text-sm font-medium text-text-primary">
                <span className="font-semibold">{selectedDriverName ?? 'Your driver'}</span> is selecting a drop-off point for you
              </p>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">
              They&apos;re reviewing transit options along their route so you can reach your destination easily. You&apos;ll be in chat shortly.
            </p>
          </div>
        )}
      </div>

      {/* ── Cancel button ─────────────────────────────────────────────────────── */}
      <div
        className="px-5 pb-4"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
      >
        <button
          data-testid="cancel-button"
          onClick={() => { void handleCancel() }}
          disabled={isCancelling}
          className="w-full rounded-2xl py-4 text-base font-semibold text-danger border-2 border-danger/30 bg-danger/5 active:bg-danger/10 transition-colors disabled:opacity-50"
        >
          {isCancelling ? 'Cancelling…' : 'Cancel Ride'}
        </button>
      </div>
    </div>
  )
}
