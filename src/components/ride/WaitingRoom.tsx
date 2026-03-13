import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { formatCents, type FareRange } from '@/lib/fare'
import type { PlaceSuggestion } from '@/lib/places'
import { RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function WaitingRoom({ 'data-testid': testId }: WaitingRoomProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null
  const profile = useAuthStore((s) => s.profile)

  const [isCancelling, setCancelling] = useState(false)
  const [driverOffers, setDriverOffers] = useState<string[]>([])
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Redirect if missing required state
  useEffect(() => {
    if (!state?.rideId) {
      navigate('/home/rider', { replace: true })
    }
  }, [state, navigate])

  // Auto-select logic: after first offer, wait 15s then decide
  const handleSelectOrNavigate = useCallback((offers: string[]) => {
    if (!state?.rideId) return
    const navState = {
      destination: state.destination,
      destinationLat: state.destinationLat,
      destinationLng: state.destinationLng,
    }

    if (offers.length === 1) {
      // Single driver — auto-select and navigate to messaging
      void (async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          await fetch(`/api/rides/${state.rideId}/select-driver`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ driver_id: offers[0] }),
          })
        }
        navigate(`/ride/messaging/${state.rideId}`, { replace: true, state: navState })
      })()
    } else {
      // Multiple drivers — navigate to multi-driver selection
      navigate(`/ride/multi-driver/${state.rideId}`, { replace: true, state: navState })
    }
  }, [state, navigate])

  // Subscribe to ride acceptance via Supabase Realtime broadcast
  useEffect(() => {
    if (!state?.rideId || !profile?.id) return

    const channel = supabase
      .channel(`waiting:${profile.id}`)
      .on('broadcast', { event: 'ride_accepted' }, (msg) => {
        const data = msg.payload as { ride_id?: string; driver_id?: string }
        if (data.ride_id !== state.rideId || !data.driver_id) return

        setDriverOffers((prev) => {
          if (prev.includes(data.driver_id as string)) return prev
          const updated = [...prev, data.driver_id as string]

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
      .subscribe()

    return () => {
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current)
      void supabase.removeChannel(channel)
    }
  }, [state, profile?.id, handleSelectOrNavigate])

  if (!state?.rideId) return null

  const { destination, fareRange } = state
  const isSingleFare = fareRange.low.fare_cents === fareRange.high.fare_cents
  const fareDisplay = isSingleFare
    ? formatCents(fareRange.low.fare_cents)
    : `${formatCents(fareRange.low.fare_cents)}–${formatCents(fareRange.high.fare_cents)}`

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

  return (
    <div
      data-testid={testId ?? 'waiting-room-page'}
      className="min-h-dvh w-full bg-white flex flex-col font-sans"
    >

      {/* ── Route preview map ────────────────────────────────────────────────── */}
      <div className="relative w-full" style={{ height: '45dvh' }}>
        {hasRoute ? (
          <Map
            mapId="8cb10228438378796542e8f0"
            defaultCenter={{ lat: (oLat + dLat) / 2, lng: (oLng + dLng) / 2 }}
            defaultZoom={12}
            gestureHandling="cooperative"
            disableDefaultUI
            className="h-full w-full"
          >
            {/* Pickup marker */}
            <AdvancedMarker position={{ lat: oLat, lng: oLng }} title="Pickup">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-green-500 shadow-lg text-xs font-bold text-white">
                P
              </div>
            </AdvancedMarker>
            {/* Destination marker */}
            <AdvancedMarker position={{ lat: dLat, lng: dLng }} title="Destination">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-red-500 shadow-lg text-xs font-bold text-white">
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
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
          </span>
          <span data-testid="status-text" className="text-sm font-semibold text-text-primary">
            {driverOffers.length === 0
              ? 'Finding you a driver…'
              : driverOffers.length === 1
                ? '1 driver accepted — waiting for more…'
                : `${driverOffers.length} drivers accepted — choosing soon…`}
          </span>
        </div>
      </div>

      {/* ── Bottom panel ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col px-5 pt-5 gap-4">

        {/* Destination + fare card */}
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

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Estimated fare</span>
            <span data-testid="fare-display" className="text-lg font-bold text-text-primary">{fareDisplay}</span>
          </div>
        </div>

        <p className="text-center text-sm text-text-secondary">
          Sit tight — we're notifying nearby drivers
        </p>
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
