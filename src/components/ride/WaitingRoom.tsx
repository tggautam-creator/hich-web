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
  /** Set by MultiDriverMap after selecting a driver */
  selectedDriverId?: string
  selectedDriverName?: string
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

/**
 * Phase state machine:
 * - finding: waiting for drivers to accept
 * - driver_choosing_dropoff: a driver was selected, waiting for them to choose dropoff
 * - navigating_away: about to leave this page (prevents race conditions)
 */
type Phase = 'finding' | 'driver_choosing_dropoff' | 'navigating_away'

// ── Component ─────────────────────────────────────────────────────────────────

export default function WaitingRoom({ 'data-testid': testId }: WaitingRoomProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null
  const profile = useAuthStore((s) => s.profile)

  const [phase, setPhase] = useState<Phase>(() =>
    state?.selectedDriverId ? 'driver_choosing_dropoff' : 'finding',
  )
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const [offers, setOffers] = useState<DriverOfferInfo[]>([])
  const [selectedDriverName, setSelectedDriverName] = useState<string | null>(
    state?.selectedDriverName ?? null,
  )
  const [cancelToast, setCancelToast] = useState<string | null>(null)
  const [isCancelling, setCancelling] = useState(false)
  const [showFallback, setShowFallback] = useState(false)

  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Redirect if missing required state
  useEffect(() => {
    if (!state?.rideId) {
      navigate('/home/rider', { replace: true })
    }
  }, [state, navigate])

  // ── 90-second fallback timer ────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'finding' || offers.length > 0) return
    const timer = setTimeout(() => {
      if (phaseRef.current === 'finding') {
        setShowFallback(true)
      }
    }, 90_000)
    return () => clearTimeout(timer)
  }, [phase, offers.length])

  // ── Auto-select / navigate logic ─────────────────────────────────────────
  const handleSelectOrNavigate = useCallback(
    (currentOffers: DriverOfferInfo[]) => {
      if (!state?.rideId || phaseRef.current !== 'finding') return
      const navState = {
        destination: state.destination,
        destinationLat: state.destinationLat,
        destinationLng: state.destinationLng,
      }

      if (currentOffers.length === 1) {
        // Single driver — auto-select
        void (async () => {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session || phaseRef.current !== 'finding') return

          const resp = await fetch(`/api/rides/${state.rideId}/select-driver`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ driver_id: currentOffers[0]!.driver_id }),
          })

          if (resp.ok) {
            const body = (await resp.json()) as { driver_name?: string | null; driver_has_destination?: boolean }
            setSelectedDriverName(body.driver_name ?? currentOffers[0]!.driver_name)
            setPhase('driver_choosing_dropoff')
          } else {
            // If 409 (offer no longer available), remove this driver and stay in finding phase
            if (resp.status === 409) {
              setOffers((prev) => prev.filter((o) => o.driver_id !== currentOffers[0]!.driver_id))
            } else {
              navigate(`/ride/messaging/${state.rideId}`, { replace: true, state: navState })
            }
          }
        })()
      } else if (currentOffers.length > 1) {
        // Multiple drivers — navigate to multi-driver selection
        setPhase('navigating_away')
        navigate(`/ride/multi-driver/${state.rideId}`, { replace: true, state: navState })
      }
    },
    [state, navigate],
  )

  // ── Single Realtime channel + Single polling interval ─────────────────────
  useEffect(() => {
    if (!state?.rideId || !profile?.id) return
    let cancelled = false

    const rideId = state.rideId

    // ── Realtime channel ────────────────────────────────────────────────
    const channel = supabase
      .channel(`waiting:${profile.id}`)
      .on('broadcast', { event: 'ride_accepted' }, (msg) => {
        if (cancelled || phaseRef.current === 'navigating_away') return
        const data = msg.payload as Record<string, unknown>
        if (data['ride_id'] !== rideId) return
        const driverId = data['driver_id'] as string | undefined
        if (!driverId) return

        const offer: DriverOfferInfo = {
          driver_id: driverId,
          driver_name: typeof data['driver_name'] === 'string' ? data['driver_name'] : null,
          driver_avatar: typeof data['driver_avatar'] === 'string' ? data['driver_avatar'] : null,
          driver_rating: typeof data['driver_rating'] === 'number' ? data['driver_rating'] : null,
          driver_rating_count: typeof data['driver_rating_count'] === 'number' ? data['driver_rating_count'] : 0,
          overlap_pct: typeof data['overlap_pct'] === 'number' ? data['overlap_pct'] : null,
          driver_destination_name: typeof data['driver_destination_name'] === 'string' ? data['driver_destination_name'] : null,
        }

        // Fetch driver info if broadcast didn't include it
        if (!offer.driver_name) {
          void supabase
            .from('users')
            .select('full_name, avatar_url, rating_avg, rating_count')
            .eq('id', driverId)
            .single()
            .then(({ data: driverUser }) => {
              if (driverUser?.full_name) {
                setOffers((prev) =>
                  prev.map((o) =>
                    o.driver_id === driverId
                      ? { ...o, driver_name: driverUser.full_name, driver_avatar: driverUser.avatar_url ?? o.driver_avatar, driver_rating: driverUser.rating_avg ?? o.driver_rating, driver_rating_count: driverUser.rating_count ?? o.driver_rating_count }
                      : o,
                  ),
                )
              }
            })
        }

        setOffers((prev) => {
          if (prev.some((o) => o.driver_id === driverId)) return prev
          const updated = [...prev, offer]

          // Auto-select timer management
          if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current)

          if (updated.length === 1) {
            // First offer: 2s grace period then auto-select
            selectionTimerRef.current = setTimeout(() => handleSelectOrNavigate(updated), 2000)
          } else {
            // Additional offer: 3s to batch then navigate to multi-driver
            selectionTimerRef.current = setTimeout(() => handleSelectOrNavigate(updated), 3000)
          }

          return updated
        })
      })
      .on('broadcast', { event: 'driver_cancelled' }, (msg) => {
        if (cancelled) return
        const data = msg.payload as Record<string, unknown>
        if (data['ride_id'] !== rideId) return

        const cancelledId = data['cancelled_driver_id'] as string | undefined

        // Clear selection timer — cancelled driver may have been the one about to be auto-selected
        if (selectionTimerRef.current) {
          clearTimeout(selectionTimerRef.current)
          selectionTimerRef.current = null
        }

        // Remove cancelled driver from offers
        if (cancelledId) {
          setOffers((prev) => prev.filter((o) => o.driver_id !== cancelledId))
        }

        // Handle based on current phase
        if (phaseRef.current === 'driver_choosing_dropoff') {
          setPhase('finding')
          setSelectedDriverName(null)

          // Show toast
          const standbyCount = typeof data['standby_count'] === 'number' ? data['standby_count'] : 0
          const toastMsg = standbyCount > 0
            ? `Driver cancelled — ${standbyCount} other driver${standbyCount > 1 ? 's' : ''} available`
            : 'Driver cancelled — finding another driver…'
          setCancelToast(toastMsg)
          setTimeout(() => setCancelToast(null), 5000)
        } else if (phaseRef.current === 'finding') {
          // Driver cancelled before we even selected them (Path C)
          setCancelToast('A driver cancelled — still searching…')
          setTimeout(() => setCancelToast(null), 4000)
        }
      })
      .on('broadcast', { event: 'dropoff_done' }, (msg) => {
        if (cancelled || phaseRef.current === 'navigating_away') return
        const data = msg.payload as Record<string, unknown>
        if (data['ride_id'] !== rideId) return
        setPhase('navigating_away')
        navigate(`/ride/messaging/${rideId}`, {
          replace: true,
          state: {
            destination: state.destination,
            destinationLat: state.destinationLat,
            destinationLng: state.destinationLng,
          },
        })
      })
      .on('broadcast', { event: 'ride_cancelled' }, (msg) => {
        if (cancelled) return
        const data = msg.payload as Record<string, unknown>
        if (data['ride_id'] !== rideId) return
        setPhase('navigating_away')
        navigate('/home/rider', { replace: true })
      })
      .subscribe()

    // Also subscribe to the chat channel for transit_dropoff_suggestion during dropoff phase
    const chatChannel = supabase
      .channel(`chat:${rideId}`)
      .on('broadcast', { event: 'new_message' }, (msg) => {
        if (cancelled || phaseRef.current !== 'driver_choosing_dropoff') return
        const payload = msg.payload as Record<string, unknown>
        if (payload['type'] === 'transit_dropoff_suggestion') {
          setPhase('navigating_away')
          navigate(`/ride/messaging/${rideId}`, {
            replace: true,
            state: {
              destination: state.destination,
              destinationLat: state.destinationLat,
              destinationLng: state.destinationLng,
            },
          })
        }
      })
      .on('broadcast', { event: 'dropoff_done' }, () => {
        if (cancelled || phaseRef.current === 'navigating_away') return
        setPhase('navigating_away')
        navigate(`/ride/messaging/${rideId}`, {
          replace: true,
          state: {
            destination: state.destination,
            destinationLat: state.destinationLat,
            destinationLng: state.destinationLng,
          },
        })
      })
      .on('broadcast', { event: 'driver_cancelled' }, (msg) => {
        if (cancelled) return
        const data = msg.payload as Record<string, unknown>
        if (data['ride_id'] !== rideId) return
        // Driver cancelled during dropoff — handled by waiting channel above
      })
      .subscribe()

    // ── Polling interval (5s) ───────────────────────────────────────────
    const poll = async () => {
      if (cancelled) return

      const { data: rideData } = await supabase
        .from('rides')
        .select('status, driver_id')
        .eq('id', rideId)
        .single()

      if (cancelled || !rideData) return

      // Ride coordinating → go to chat
      if (rideData.status === 'coordinating') {
        setPhase('navigating_away')
        navigate(`/ride/messaging/${rideId}`, {
          replace: true,
          state: {
            destination: state.destination,
            destinationLat: state.destinationLat,
            destinationLng: state.destinationLng,
          },
        })
        return
      }

      // Ride cancelled → go home
      if (rideData.status === 'cancelled') {
        setPhase('navigating_away')
        navigate('/home/rider', { replace: true })
        return
      }

      // If ride reverted to 'requested' with no driver while we're in dropoff phase → driver cancelled
      if (rideData.status === 'requested' && !rideData.driver_id && phaseRef.current === 'driver_choosing_dropoff') {
        setPhase('finding')
        setSelectedDriverName(null)
        // Don't wipe offers — the poll below will re-fetch current pending offers
        setCancelToast('Driver cancelled — finding another driver…')
        setTimeout(() => setCancelToast(null), 5000)
      }

      // If we're in 'finding' phase, check for new offers
      if (phaseRef.current === 'finding') {
        const { data: existingOffers } = await supabase
          .from('ride_offers')
          .select('driver_id, driver_destination_name, overlap_pct, status')
          .eq('ride_id', rideId)
          .in('status', ['pending', 'selected'])

        if (cancelled || !existingOffers || existingOffers.length === 0) return

        const driverIds = existingOffers.map((o) => o.driver_id)
        const { data: drivers } = await supabase
          .from('users')
          .select('id, full_name, avatar_url, rating_avg, rating_count')
          .in('id', driverIds)

        if (cancelled) return

        const driverMap: Record<string, { full_name: string | null; avatar_url: string | null; rating_avg: number | null; rating_count: number }> = {}
        for (const d of drivers ?? []) driverMap[d.id] = d

        const polledOffers: DriverOfferInfo[] = existingOffers.map((row) => {
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

        setOffers((prev) => {
          const existing = new Set(prev.map((o) => o.driver_id))
          const newOffers = polledOffers.filter((o) => !existing.has(o.driver_id))
          if (newOffers.length === 0) return prev
          const merged = [...prev, ...newOffers]

          // Start auto-select timer if first batch
          if (prev.length === 0 && merged.length >= 1 && !selectionTimerRef.current) {
            selectionTimerRef.current = setTimeout(() => handleSelectOrNavigate(merged), 2000)
          }

          return merged
        })
      }
    }

    void poll()
    const interval = setInterval(() => void poll(), 10000)

    return () => {
      cancelled = true
      clearInterval(interval)
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current)
      void supabase.removeChannel(channel)
      void supabase.removeChannel(chatChannel)
    }
  }, [state, profile?.id, navigate, handleSelectOrNavigate, setPhase])

  if (!state?.rideId) return null

  const destination = state.destination
  const fareRange = state.fareRange
  const fareDisplay = fareRange
    ? fareRange.low.fare_cents === fareRange.high.fare_cents
      ? formatCents(fareRange.low.fare_cents)
      : `${formatCents(fareRange.low.fare_cents)}–${formatCents(fareRange.high.fare_cents)}`
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

  // Status text based on phase + offers
  const statusText =
    phase === 'driver_choosing_dropoff'
      ? `${selectedDriverName ?? 'Driver'} is choosing a drop-off point…`
      : offers.length === 0
        ? 'Finding you a driver…'
        : offers.length === 1
          ? `${offers[0]!.driver_name ?? 'A driver'} accepted!`
          : `${offers.length} drivers accepted — choosing best match…`

  return (
    <div
      data-testid={testId ?? 'waiting-room-page'}
      className="min-h-dvh w-full bg-white flex flex-col font-sans"
    >

      {/* ── Route preview map ────────────────────────────────────────────────── */}
      <div className="relative w-full" style={{ height: offers.length > 0 ? '35dvh' : '45dvh' }}>
        {hasRoute ? (
          <Map
            mapId={MAP_ID}
            defaultCenter={{ lat: (oLat + dLat) / 2, lng: (oLng + dLng) / 2 }}
            defaultZoom={12}
            gestureHandling="cooperative"
            disableDefaultUI
            className="h-full w-full"
          >
            <AdvancedMarker position={{ lat: oLat, lng: oLng }} title="Pickup">
              <div className="flex h-7 items-center justify-center rounded-full border-[3px] border-white bg-success px-2 shadow-lg text-[10px] font-bold text-white whitespace-nowrap">
                PICKUP
              </div>
            </AdvancedMarker>
            <AdvancedMarker position={{ lat: dLat, lng: dLng }} title="Destination">
              <div className="flex h-7 items-center justify-center rounded-full border-[3px] border-white bg-danger px-2 shadow-lg text-[10px] font-bold text-white whitespace-nowrap">
                DROP-OFF
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
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${phase === 'driver_choosing_dropoff' ? 'bg-primary' : offers.length > 0 ? 'bg-success' : 'bg-primary'} opacity-75`} />
            <span className={`relative inline-flex h-3 w-3 rounded-full ${phase === 'driver_choosing_dropoff' ? 'bg-primary' : offers.length > 0 ? 'bg-success' : 'bg-primary'}`} />
          </span>
          <span data-testid="status-text" className="text-sm font-semibold text-text-primary">
            {statusText}
          </span>
        </div>
      </div>

      {/* ── Cancel toast ─────────────────────────────────────────────────────── */}
      {cancelToast && (
        <div className="mx-5 mt-3 rounded-2xl bg-warning/10 border border-warning/20 px-4 py-3">
          <p data-testid="cancel-toast" className="text-sm font-medium text-warning-dark text-center">
            {cancelToast}
          </p>
        </div>
      )}

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
        {offers.length > 0 && (
          <div className="space-y-3" data-testid="driver-offers">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              {offers.length === 1 ? 'Driver accepted' : `${offers.length} drivers accepted`}
            </p>
            {offers.map((offer) => (
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
                      <span className="text-lg font-semibold text-primary">
                        {offer.driver_name?.[0]?.toUpperCase() ?? '?'}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">
                      {offer.driver_name ?? 'Driver'}
                    </p>
                    {offer.driver_rating != null && (
                      <div className="flex items-center gap-1">
                        <span className="text-warning text-xs">&#x2605;</span>
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

        {offers.length === 0 && phase === 'finding' && !showFallback && (
          <p className="text-center text-sm text-text-secondary">
            Sit tight — we&apos;re notifying nearby drivers
          </p>
        )}

        {/* ── Fallback: no drivers after 90s ─────────────────────────────── */}
        {showFallback && phase === 'finding' && offers.length === 0 && (
          <div data-testid="no-driver-fallback" className="rounded-2xl bg-warning/5 border border-warning/20 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/10">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-warning" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  No drivers available right now
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  Post your trip on the ride board so drivers heading your way can pick it up.
                </p>
              </div>
            </div>

            <button
              data-testid="post-to-board-button"
              onClick={() => {
                void handleCancel()
                navigate('/schedule', {
                  replace: true,
                  state: {
                    prefill: {
                      mode: 'rider' as const,
                      destination: state?.destination,
                      destinationLat: state?.destinationLat,
                      destinationLng: state?.destinationLng,
                      originLat: state?.originLat,
                      originLng: state?.originLng,
                    },
                  },
                })
              }}
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white active:opacity-90 transition-opacity"
            >
              Post on Ride Board
            </button>

            <p className="text-center text-xs text-text-secondary">
              We&apos;ll keep looking while you set up your post
            </p>
          </div>
        )}

        {/* Driver is choosing a drop-off point — show a waiting card */}
        {phase === 'driver_choosing_dropoff' && (
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
