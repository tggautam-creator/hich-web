import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import { RoutePolyline, MapBoundsFitter } from '@/components/map/RoutePreview'
import { MAP_ID } from '@/lib/mapConstants'
import type { TransitDropoffSuggestion } from '@/components/ride/TransitSuggestionCard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DropoffSelectionProps {
  'data-testid'?: string
}

interface DropoffLocationState {
  driverDestLat: number
  driverDestLng: number
  driverDestName: string
  riderName?: string | null
  riderDestName?: string | null
  riderDestLat?: number | null
  riderDestLng?: number | null
  pickupLat?: number | null
  pickupLng?: number | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DropoffSelection({
  'data-testid': testId = 'dropoff-selection',
}: DropoffSelectionProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as DropoffLocationState | null

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<TransitDropoffSuggestion[]>([])
  const [driverRoutePolyline, setDriverRoutePolyline] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [picking, setPicking] = useState(false)
  const [cancelModal, setCancelModal] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const cardRefs = useRef<globalThis.Map<number, HTMLDivElement>>(new globalThis.Map())
  const fetchedRef = useRef(false)

  // Recovered destination — populated from DB when navigation state is missing.
  // This handles the race where handleDriverSelected() navigates here without
  // state because the offer's driver_destination wasn't written to DB yet.
  const [recoveredDest, setRecoveredDest] = useState<{
    lat: number; lng: number; name: string
  } | null>(null)

  // Effective destination: prefer navigation state, fall back to DB recovery
  const effLat = state?.driverDestLat ?? recoveredDest?.lat ?? null
  const effLng = state?.driverDestLng ?? recoveredDest?.lng ?? null
  const effName = state?.driverDestName ?? recoveredDest?.name ?? ''

  // Guard: if no destination coords, try recovering from the ride / offer rows
  // before redirecting home. This handles the case where we arrived via a
  // navigation that didn't carry state (e.g. handleDriverSelected fallback).
  const [recovering, setRecovering] = useState(!state?.driverDestLat && !!rideId)
  useEffect(() => {
    if (effLat || !rideId) { setRecovering(false); return }

    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/home/driver', { replace: true }); return }

      // Try ride row first — /select-driver copies destination here
      const { data: rideRow } = await supabase
        .from('rides')
        .select('driver_destination, driver_destination_name, driver_id, status')
        .eq('id', rideId as string)
        .single()

      if (rideRow?.driver_destination && rideRow.driver_id === session.user.id) {
        const geo = rideRow.driver_destination as { coordinates: [number, number] }
        setRecoveredDest({
          lat: geo.coordinates[1],
          lng: geo.coordinates[0],
          name: (rideRow.driver_destination_name as string | null) ?? '',
        })
        setRecovering(false)
        return
      }

      // Selected driver with no destination yet — send to suggestion form to enter one
      if (rideRow?.driver_id === session.user.id && !rideRow?.driver_destination) {
        navigate(`/ride/suggestion/${rideId}`, { replace: true })
        return
      }

      // Fall back to offer row — only trust if this driver's offer is 'selected'
      const { data: offer } = await supabase
        .from('ride_offers')
        .select('driver_destination, driver_destination_name, status')
        .eq('ride_id', rideId as string)
        .eq('driver_id', session.user.id)
        .maybeSingle()

      if (offer?.driver_destination && offer.status === 'selected') {
        const geo = offer.driver_destination as { coordinates: [number, number] }
        setRecoveredDest({
          lat: geo.coordinates[1],
          lng: geo.coordinates[0],
          name: (offer.driver_destination_name as string | null) ?? '',
        })
        setRecovering(false)
        return
      }

      navigate('/home/driver', { replace: true })
    })()
  }, [effLat, rideId, navigate])

  // Fetch transit suggestions once destination is known
  useEffect(() => {
    if (!effLat || !effLng || !rideId || fetchedRef.current) return
    fetchedRef.current = true
    void fetchSuggestions(effLat, effLng, effName)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, effLat])

  async function fetchSuggestions(lat: number, lng: number, name: string) {
    setLoading(true)
    setError(null)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) return

      const resp = await fetch(`/api/rides/${rideId}/driver-destination`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          destination_lat: lat,
          destination_lng: lng,
          destination_name: name,
        }),
      })

      if (resp.ok) {
        const data = (await resp.json()) as {
          suggestions?: TransitDropoffSuggestion[]
          polyline?: string
        }
        setSuggestions(data.suggestions ?? [])
        setDriverRoutePolyline(data.polyline ?? null)
        if ((data.suggestions ?? []).length > 0) setSelectedIdx(0)
        trackEvent('driver_dropoff_page_loaded', {
          ride_id: rideId,
          suggestion_count: (data.suggestions ?? []).length,
        })
      } else {
        const body = (await resp.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Could not load drop-off suggestions')
      }
    } catch {
      setError('Network error — could not load drop-off suggestions')
    } finally {
      setLoading(false)
    }
  }

  function handleRetry() {
    if (!effLat || !effLng) return
    fetchedRef.current = false
    void fetchSuggestions(effLat, effLng, effName)
  }

  // Cancel ride from dropoff selection
  const handleCancelRide = useCallback(async () => {
    if (!rideId || cancelling) return
    setCancelling(true)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) return
      const resp = await fetch(`/api/rides/${rideId}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      })
      await resp.json().catch(() => ({}))
    } finally {
      navigate('/home/driver', { replace: true })
    }
  }, [rideId, cancelling, navigate])

  // Notify server that driver is done choosing dropoff → sets ride to 'coordinating'
  // and broadcasts to rider via REST (reliable, no ephemeral WebSocket)
  const broadcastDropoffDone = useCallback(async () => {
    if (!rideId) return
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) return
      await fetch(`/api/rides/${rideId}/dropoff-done`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch { /* non-fatal */ }
  }, [rideId])

  // Select rider's final destination (no transit suggestion needed)
  function handlePickRiderDest() {
    trackEvent('driver_picked_rider_dest', { ride_id: rideId })
    void broadcastDropoffDone()
    navigate(`/ride/messaging/${rideId}`, {
      replace: true,
      state: { driverDestinationSet: true },
    })
  }

  // Pick a transit station
  const handlePickStation = useCallback(async (suggestion: TransitDropoffSuggestion) => {
    setPicking(true)
    setError(null)

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) return

      const resp = await fetch(`/api/rides/${rideId}/suggest-transit-dropoff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          station_name: suggestion.station_name,
          station_lat: suggestion.station_lat,
          station_lng: suggestion.station_lng,
          station_place_id: suggestion.station_place_id,
          station_address: suggestion.station_address,
          transit_options: suggestion.transit_options,
          walk_to_station_minutes: suggestion.walk_to_station_minutes,
          transit_to_dest_minutes: suggestion.transit_to_dest_minutes,
          total_rider_minutes: suggestion.total_rider_minutes,
          transit_polyline: suggestion.transit_polyline ?? null,
          rider_progress_pct: suggestion.rider_progress_pct ?? null,
        }),
      })

      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { error?: { message?: string } } | null
        setError(body?.error?.message ?? 'Failed to suggest dropoff')
        setPicking(false)
        return
      }

      trackEvent('driver_picked_dropoff', {
        ride_id: rideId,
        station: suggestion.station_name,
        progress_pct: suggestion.rider_progress_pct,
      })

      // Transit message was already broadcast server-side, but also broadcast
      // dropoff_done for the WaitingRoom fallback listener
      void broadcastDropoffDone()

      navigate(`/ride/messaging/${rideId}`, {
        replace: true,
        state: { driverDestinationSet: true },
      })
    } catch {
      setError('Network error')
      setPicking(false)
    }
  }, [rideId, navigate, broadcastDropoffDone])

  // Scroll selected card into view
  useEffect(() => {
    if (selectedIdx !== null) {
      const el = cardRefs.current.get(selectedIdx)
      if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedIdx])

  // ── Map bounds ──────────────────────────────────────────────────────────────
  const boundsPoints = useMemo(() => {
    const pts: Array<{ lat: number; lng: number }> = suggestions.map(s => ({
      lat: s.station_lat,
      lng: s.station_lng,
    }))
    if (state?.pickupLat != null && state.pickupLng != null) {
      pts.push({ lat: state.pickupLat, lng: state.pickupLng })
    }
    if (state?.riderDestLat != null && state.riderDestLng != null) {
      pts.push({ lat: state.riderDestLat, lng: state.riderDestLng })
    }
    if (effLat != null && effLng != null) {
      pts.push({ lat: effLat, lng: effLng })
    }
    return pts
  }, [suggestions, state, effLat, effLng])

  if (recovering) {
    return (
      <div data-testid={testId} className="flex h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!effLat || !effLng || !rideId) return null

  const riderName = state?.riderName ?? 'the rider'
  const riderDestName = state?.riderDestName ?? 'their destination'

  return (
    <div
      data-testid={testId}
      className="flex h-dvh flex-col bg-surface overflow-hidden"
    >
      {/* ── Route map ───────────────────────────────────────────────────────── */}
      <div className="relative w-full shrink-0" style={{ height: '30dvh' }}>
        {boundsPoints.length >= 1 ? (
          <Map
            mapId={MAP_ID}
            defaultCenter={boundsPoints[0]}
            defaultZoom={11}
            gestureHandling="cooperative"
            disableDefaultUI
            className="h-full w-full"
          >
            {/* Driver route polyline */}
            {driverRoutePolyline && (
              <RoutePolyline encodedPath={driverRoutePolyline} color="#4F46E5" weight={4} fitBounds={false} />
            )}

            {/* Pickup marker */}
            {state?.pickupLat != null && state.pickupLng != null && (
              <AdvancedMarker position={{ lat: state.pickupLat, lng: state.pickupLng }}>
                <div className="flex h-6 items-center justify-center rounded-full border-2 border-white bg-success px-2 shadow-md text-[10px] font-bold text-white whitespace-nowrap">
                  PICKUP
                </div>
              </AdvancedMarker>
            )}

            {/* Rider destination marker */}
            {state?.riderDestLat != null && state.riderDestLng != null && (
              <AdvancedMarker position={{ lat: state.riderDestLat, lng: state.riderDestLng }} zIndex={2}>
                <div className="flex h-6 items-center justify-center rounded-full border-2 border-white bg-danger px-2 shadow-md text-[10px] font-bold text-white whitespace-nowrap">
                  DROP-OFF
                </div>
              </AdvancedMarker>
            )}

            {/* Driver destination marker */}
            <AdvancedMarker position={{ lat: effLat, lng: effLng }} zIndex={0}>
              <div className="flex h-6 items-center justify-center rounded-full border-2 border-white bg-warning px-2 shadow-md text-[10px] font-bold text-white whitespace-nowrap">
                YOUR DEST
              </div>
            </AdvancedMarker>

            {/* Station markers */}
            {suggestions.map((s, idx) => (
              <AdvancedMarker
                key={s.station_place_id}
                position={{ lat: s.station_lat, lng: s.station_lng }}
                onClick={() => setSelectedIdx(idx)}
                zIndex={selectedIdx === idx ? 10 : 1}
              >
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white shadow-md text-xs font-bold text-white transition-transform ${
                    selectedIdx === idx ? 'bg-primary scale-125' : 'bg-text-secondary scale-100'
                  }`}
                >
                  {idx + 1}
                </div>
              </AdvancedMarker>
            ))}

            {/* Transit polyline for selected station */}
            {selectedIdx !== null && suggestions[selectedIdx]?.transit_polyline && (
              <RoutePolyline
                encodedPath={suggestions[selectedIdx].transit_polyline as string}
                color="#10B981"
                weight={3}
                fitBounds={false}
              />
            )}

            {boundsPoints.length >= 2 && <MapBoundsFitter points={boundsPoints} />}
          </Map>
        ) : (
          <div className="flex h-full items-center justify-center bg-primary-light">
            {loading ? (
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            ) : (
              <p className="text-sm text-text-secondary">Route preview unavailable</p>
            )}
          </div>
        )}
      </div>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <h1 className="text-lg font-bold text-text-primary">Choose a drop-off point</h1>
        <p className="text-xs text-text-secondary mt-0.5">
          Pick a station along your route, or take {riderName} all the way.
        </p>
      </div>

      {/* ── Scrollable options ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2.5 min-h-0">

        {/* Option 0: Drop off at rider's destination (always visible) */}
        <button
          type="button"
          data-testid="rider-dest-option"
          onClick={handlePickRiderDest}
          disabled={picking}
          className="w-full rounded-2xl bg-white border-2 border-success/30 p-4 text-left shadow-sm active:bg-success/5 disabled:opacity-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-primary">
                Drop off at rider&apos;s destination
              </p>
              <p className="text-xs text-text-secondary truncate mt-0.5">
                {riderDestName} — 100% of journey
              </p>
            </div>
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-success/10 shrink-0">
              <span className="text-[10px] font-bold text-success">100%</span>
            </div>
          </div>
        </button>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-2.5" data-testid="loading-skeleton">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl bg-white border border-border p-4 space-y-2 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="h-7 w-7 rounded-full bg-surface animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-2/3 rounded-full bg-surface animate-pulse" />
                    <div className="h-2.5 w-1/3 rounded-full bg-surface animate-pulse" />
                  </div>
                </div>
                <div className="h-2.5 w-full rounded-full bg-surface animate-pulse" />
              </div>
            ))}
            <p className="text-center text-xs text-text-secondary pt-1">
              Finding transit stations along your route&hellip;
            </p>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="rounded-2xl bg-danger/5 border border-danger/20 p-4" data-testid="dropoff-error">
            <p className="text-sm text-danger font-medium">{error}</p>
            <div className="flex gap-3 mt-3">
              <button
                type="button"
                onClick={handleRetry}
                className="text-xs font-semibold text-primary active:opacity-70"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => { void broadcastDropoffDone(); navigate(`/ride/messaging/${rideId}`, { replace: true, state: { driverDestinationSet: true } }) }}
                className="text-xs font-semibold text-text-secondary active:opacity-70"
              >
                Skip to chat
              </button>
            </div>
          </div>
        )}

        {/* No suggestions found */}
        {!loading && !error && suggestions.length === 0 && (
          <div className="rounded-2xl bg-white border border-border p-4 text-center" data-testid="no-suggestions">
            <p className="text-sm text-text-secondary">
              No transit stations found along your route. You can drop the rider at their destination or coordinate in chat.
            </p>
            <button
              type="button"
              onClick={() => { void broadcastDropoffDone(); navigate(`/ride/messaging/${rideId}`, { replace: true, state: { driverDestinationSet: true } }) }}
              className="mt-3 text-xs font-semibold text-primary active:opacity-70"
            >
              Continue to chat
            </button>
          </div>
        )}

        {/* Transit station cards */}
        {!loading && suggestions.map((s, idx) => (
          <div
            key={s.station_place_id}
            ref={(el) => { if (el) cardRefs.current.set(idx, el); else cardRefs.current.delete(idx) }}
            role="button"
            tabIndex={0}
            data-testid="transit-station-option"
            onClick={() => {
              if (picking) return
              if (selectedIdx === idx) {
                void handlePickStation(s)
              } else {
                setSelectedIdx(idx)
              }
            }}
            className={`w-full rounded-2xl bg-white border p-4 text-left shadow-sm cursor-pointer transition-all ${
              picking ? 'opacity-60 pointer-events-none' : ''
            } ${
              selectedIdx === idx ? 'border-primary ring-2 ring-primary/20' : 'border-border'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {/* Numbered marker */}
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white mt-0.5 ${
                selectedIdx === idx ? 'bg-primary' : 'bg-text-secondary'
              }`}>
                {idx + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text-primary truncate">
                  {s.station_name}
                </p>
                {s.station_address && (
                  <p className="text-[10px] text-text-secondary truncate mt-0.5">
                    {s.station_address}
                  </p>
                )}
                {s.rider_progress_pct != null && s.rider_progress_pct > 0 && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <div className="flex-1 h-1.5 rounded-full bg-border max-w-[100px]">
                      <div
                        className="h-1.5 rounded-full bg-success"
                        style={{ width: `${Math.min(100, s.rider_progress_pct)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-medium text-success">{s.rider_progress_pct}% of the way</span>
                  </div>
                )}
              </div>
              {picking && selectedIdx === idx && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0 mt-1" />
              )}
            </div>

            {/* Walk info */}
            {s.walk_to_station_minutes > 0 && (
              <div className="flex items-center gap-2 mt-2 pl-9 text-[10px] text-text-secondary">
                <span>{s.walk_to_station_minutes} min walk to station</span>
              </div>
            )}

            {/* Transit legs */}
            <div className="mt-1.5 space-y-1 pl-9">
              {s.transit_options.slice(0, 3).map((opt, optIdx) => (
                <div key={`${opt.type}-${opt.line_name}-${optIdx}`} className="flex items-center gap-1.5 text-[10px]">
                  <span className="shrink-0">{opt.icon}</span>
                  <span className="font-semibold text-text-primary shrink-0">{opt.line_name}</span>
                  {opt.departure_stop && opt.arrival_stop ? (
                    <>
                      <span className="text-text-secondary truncate">
                        {opt.departure_stop} → {opt.arrival_stop}
                      </span>
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

            {/* Summary */}
            <div className="mt-1.5 pt-1.5 border-t border-border/50 pl-9">
              <p className="text-[10px] text-text-secondary">
                ~{s.total_rider_minutes} min total to destination
                <span>{' · '}{s.driver_detour_minutes > 0 ? `+${s.driver_detour_minutes} min detour` : 'On your route'}</span>
              </p>
            </div>

            {/* Confirm button when selected */}
            {selectedIdx === idx && !picking && (
              <div className="mt-2 pt-2 border-t border-border ml-9">
                <button
                  data-testid="confirm-station-button"
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handlePickStation(s) }}
                  className="w-full rounded-xl bg-primary py-2.5 text-xs font-semibold text-white active:opacity-90"
                >
                  Suggest this station
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Cancel ride button ──────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-t border-border shrink-0" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
        <button
          data-testid="cancel-ride-button"
          type="button"
          onClick={() => setCancelModal(true)}
          className="w-full rounded-2xl py-3 text-sm font-semibold text-danger border border-danger/30 bg-danger/5 active:bg-danger/10 transition-colors"
        >
          Cancel Ride
        </button>
      </div>

      {/* Cancel confirmation modal */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-6 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-text-primary text-center mb-2">Cancel Ride?</h3>
            <p className="text-sm text-text-secondary text-center mb-5">
              This will cancel the ride and notify the rider. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                data-testid="cancel-modal-keep"
                type="button"
                onClick={() => setCancelModal(false)}
                className="flex-1 rounded-2xl py-3 text-sm font-semibold text-text-primary bg-surface active:bg-border transition-colors"
              >
                Keep Ride
              </button>
              <button
                data-testid="cancel-modal-confirm"
                type="button"
                onClick={() => { void handleCancelRide() }}
                disabled={cancelling}
                className="flex-1 rounded-2xl py-3 text-sm font-semibold text-white bg-danger active:bg-danger/90 transition-colors disabled:opacity-50"
              >
                {cancelling ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
