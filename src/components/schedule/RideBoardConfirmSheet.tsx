import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { AdvancedMarker } from '@vis.gl/react-google-maps'
import type { ScheduledRide } from './boardTypes'
import { formatDate, formatTripSchedule } from './boardHelpers'
import { searchPlaces, getPlaceCoordinates } from '@/lib/places'
import type { PlaceSuggestion } from '@/lib/places'
import { supabase } from '@/lib/supabase'
import { estimateScheduleFare } from '@/lib/fareEstimate'
import RideMapPrimitive from '@/components/map/RideMapPrimitive'
import RideBoardTransitStationRow from './RideBoardTransitStationRow'
import CaregiverPickerSection from '@/components/profile/CaregiverPickerSection'
import { useMyCaregivers } from '@/hooks/useCaregivers'
import { useAuthStore } from '@/stores/authStore'
import { haversineMetres } from '@/lib/geo'

export interface RequestEnrichment {
  pickup_lat?: number
  pickup_lng?: number
  pickup_name?: string
  destination_lat?: number
  destination_lng?: number
  destination_name?: string
  destination_flexible: boolean
  note?: string
  // True when the rider explicitly chose "drop me at driver's destination"
  // — server uses this to pre-confirm the dropoff so the driver doesn't
  // have to suggest one in chat for an already-agreed endpoint.
  dropoff_at_driver_destination?: boolean
  /** v1.2 F7.2 — caregiver the rider wants to bring on this trip.
   *  Mirrors iOS RideBoardConfirmViewModel.swift:635 enrichment fold.
   *  Server side: forwarded into the `/api/schedule/request` body so
   *  the eventual rides row carries the attachment. (Server has not
   *  yet read this field on the board-request path — iOS has been
   *  sending it for weeks; landing the wire shape on web here so the
   *  server-side consumption slice can light up both clients at once.) */
  caregiver_id?: string | null
  /** Client-side trip distance estimate (km) used by the server to
   *  recompute the canonical caregiver-fee tier. Mirrors iOS field
   *  `distance_km` on the ScheduleRequestEndpoint payload. */
  distance_km?: number
}

/**
 * v1.2.1 S2.1 — proposed transit hand-off context the parent surface
 * (RideBoard / RideBoardHome) hands to the confirm sheet so it can
 * render a Proposed Handoff Card with direction-aware copy. Forward
 * = driver drops rider at the station; reverse = rider takes transit
 * to the station and meets driver there.
 */
export interface ProposedHandoffContext {
  station_name: string
  direction: 'forward' | 'reverse'
}

interface RideBoardConfirmSheetProps {
  ride: ScheduledRide | null
  isRequesting: boolean
  initialEnrichment?: RequestEnrichment | null
  /** Surfaces the direction-aware Proposed Handoff Card. Mirrors iOS
   *  RideBoardConfirmSheet.swift:421-472. */
  proposedHandoff?: ProposedHandoffContext | null
  onConfirm: (enrichment: RequestEnrichment) => void
  onCancel: () => void
}

export default function RideBoardConfirmSheet({
  ride,
  isRequesting,
  initialEnrichment,
  proposedHandoff = null,
  onConfirm,
  onCancel,
}: RideBoardConfirmSheetProps) {
  // Pickup fields (rider-on-driver-post flow only)
  const [pickupQuery, setPickupQuery] = useState('')
  const [pickupSuggestions, setPickupSuggestions] = useState<PlaceSuggestion[]>([])
  const [selectedPickup, setSelectedPickup] = useState<PlaceSuggestion | null>(null)
  const [pickupResolving, setPickupResolving] = useState(false)
  const pickupDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Destination fields (rider-on-driver-post flow only)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [selectedPlace, setSelectedPlace] = useState<PlaceSuggestion | null>(null)
  const [resolving, setResolving] = useState(false)
  const [useDriverDestination, setUseDriverDestination] = useState(true)
  const [note, setNote] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Transit suggestions (rider-on-driver-post flow only)
  interface TransitSuggestion {
    station_name: string
    station_lat: number
    station_lng: number
    walk_to_station_minutes: number
    transit_to_dest_minutes: number
    total_rider_minutes: number
  }
  const [transitSuggestions, setTransitSuggestions] = useState<TransitSuggestion[]>([])
  const [loadingTransit, setLoadingTransit] = useState(false)
  // v1.3 Sprint 10 Slice 4 — peeked station id (one of the
  // suggestion's `station_lat-station_lng` composite keys). null in
  // overview mode; set when the rider taps a station row. Cleared when
  // a fresh `/api/transit/preview` returns (the ride or destination
  // changed) and when the rider commits via "Use this stop".
  const [peekedStationKey, setPeekedStationKey] = useState<string | null>(null)

  // v1.3 Sprint 10 Slice 6 — caregiver picker state. Mirrors iOS
  // RideBoardConfirmSheet.swift:58-61 + caregiverSectionVisible gate
  // at lines 293-299. Only the rider-on-driver-post path (isDriverPost
  // === true) shows the picker; drivers offering on a rider-post don't
  // bring caregivers in v1.2. Gating predicate: viewer profile has
  // accessibility needs + needs wheelchair AND has at least one
  // caregiver on file. `selectedCaregiverId` is the picker's external
  // state — the picker itself toggles between null (off) and a
  // caregiver id (on with first-row auto-select).
  const profile = useAuthStore((s) => s.profile)
  const caregiversQuery = useMyCaregivers()
  const isWheelchairRider = profile?.has_accessibility_needs === true
    && profile.accessibility_profile?.needs_wheelchair === true
  const myCaregivers = isWheelchairRider ? (caregiversQuery.data ?? []) : []
  const [selectedCaregiverId, setSelectedCaregiverId] = useState<string | null>(null)
  // v1.3 Sprint 10 Slice 6 — coarse client-side trip distance for the
  // "+$X" caregiver-tier preview. Prefers the rider's picked pickup +
  // selected destination coords; falls back to the schedule's posted
  // endpoints when either is missing. Server (F7.1) recomputes the
  // canonical tier at submit time. Mirrors iOS confirmSheetDistanceKM
  // at RideBoardConfirmSheet.swift:305-319. Lives up here (above the
  // `if (!ride) return null` early return) so React's hook order
  // stays stable across mount/unmount cycles.
  const distanceKmEstimate = useMemo(() => {
    const pickupLat = selectedPickup?.lat ?? ride?.origin_lat ?? null
    const pickupLng = selectedPickup?.lng ?? ride?.origin_lng ?? null
    const destLat = selectedPlace?.lat
      ?? ride?.driver_dest_lat
      ?? ride?.dest_lat
      ?? null
    const destLng = selectedPlace?.lng
      ?? ride?.driver_dest_lng
      ?? ride?.dest_lng
      ?? null
    if (pickupLat == null || pickupLng == null || destLat == null || destLng == null) return 0
    return haversineMetres(pickupLat, pickupLng, destLat, destLng) / 1000
  }, [selectedPickup?.lat, selectedPickup?.lng, selectedPlace?.lat, selectedPlace?.lng, ride?.origin_lat, ride?.origin_lng, ride?.driver_dest_lat, ride?.driver_dest_lng, ride?.dest_lat, ride?.dest_lng])

  // Reset/prefill state when ride changes
  useEffect(() => {
    setPickupQuery('')
    setPickupSuggestions([])
    setSelectedPickup(null)
    setQuery('')
    setSuggestions([])
    setSelectedPlace(null)
    setUseDriverDestination(true)
    setNote('')
    setTransitSuggestions([])
    setPeekedStationKey(null)

    if (!initialEnrichment) return

    if (initialEnrichment.pickup_lat != null && initialEnrichment.pickup_lng != null) {
      const pickupName = initialEnrichment.pickup_name ?? 'Selected pickup'
      setPickupQuery(pickupName)
      setSelectedPickup({
        placeId: '',
        mainText: pickupName,
        secondaryText: '',
        fullAddress: pickupName,
        lat: initialEnrichment.pickup_lat,
        lng: initialEnrichment.pickup_lng,
      })
    }

    if (initialEnrichment.destination_lat != null && initialEnrichment.destination_lng != null) {
      const destinationName = initialEnrichment.destination_name ?? 'Selected destination'
      const isDriverDefaultDestination = destinationName === ride?.dest_address

      if (isDriverDefaultDestination) {
        setUseDriverDestination(true)
      } else {
        setUseDriverDestination(false)
        setQuery(destinationName)
        setSelectedPlace({
          placeId: '',
          mainText: destinationName,
          secondaryText: '',
          fullAddress: destinationName,
          lat: initialEnrichment.destination_lat,
          lng: initialEnrichment.destination_lng,
        })
      }
    }

    if (initialEnrichment.note) {
      setNote(initialEnrichment.note)
    }
  }, [ride?.id, ride?.dest_address, initialEnrichment])

  // Fetch transit suggestions when rider selects a destination
  useEffect(() => {
    if (!selectedPlace?.lat || !selectedPlace?.lng || !ride) return
    if (!ride.driver_origin_lat || !ride.driver_origin_lng || !ride.driver_dest_lat || !ride.driver_dest_lng) return

    let cancelled = false
    setLoadingTransit(true)

    void (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token
        const res = await fetch('/api/transit/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token ?? ''}`,
          },
          body: JSON.stringify({
            driver_origin_lat: ride.driver_origin_lat,
            driver_origin_lng: ride.driver_origin_lng,
            driver_dest_lat: ride.driver_dest_lat,
            driver_dest_lng: ride.driver_dest_lng,
            rider_dest_lat: selectedPlace.lat,
            rider_dest_lng: selectedPlace.lng,
          }),
        })
        if (!cancelled && res.ok) {
          const data = (await res.json()) as { suggestions: TransitSuggestion[] }
          setTransitSuggestions(data.suggestions ?? [])
          // Reset peek when the suggestion set changes — a stale peek
          // pointing at a no-longer-listed station would render zero
          // pins on the mini-map.
          setPeekedStationKey(null)
        }
      } catch {
        // Silently fail — transit suggestions are optional
      } finally {
        if (!cancelled) setLoadingTransit(false)
      }
    })()

    return () => { cancelled = true }
  }, [selectedPlace?.lat, selectedPlace?.lng, ride])

  const handleSearch = useCallback((value: string) => {
    setQuery(value)
    setSelectedPlace(null)
    setUseDriverDestination(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (value.trim().length < 2) { setSuggestions([]); return }
    debounceRef.current = setTimeout(() => {
      void searchPlaces(value).then(setSuggestions)
    }, 300)
  }, [])

  const handleSelectPlace = useCallback(async (place: PlaceSuggestion) => {
    setQuery(place.fullAddress)
    setSuggestions([])
    setUseDriverDestination(false)
    if (place.lat != null && place.lng != null) {
      setSelectedPlace(place)
      return
    }
    setResolving(true)
    const coords = await getPlaceCoordinates(place.placeId)
    setResolving(false)
    if (coords) {
      setSelectedPlace({ ...place, lat: coords.lat, lng: coords.lng })
    }
  }, [])

  const handlePickupSearch = useCallback((value: string) => {
    setPickupQuery(value)
    setSelectedPickup(null)
    if (pickupDebounceRef.current) clearTimeout(pickupDebounceRef.current)
    if (value.trim().length < 2) { setPickupSuggestions([]); return }
    pickupDebounceRef.current = setTimeout(() => {
      void searchPlaces(value).then(setPickupSuggestions)
    }, 300)
  }, [])

  const handleSelectPickup = useCallback(async (place: PlaceSuggestion) => {
    setPickupQuery(place.fullAddress)
    setPickupSuggestions([])
    if (place.lat != null && place.lng != null) {
      setSelectedPickup(place)
      return
    }
    setPickupResolving(true)
    const coords = await getPlaceCoordinates(place.placeId)
    setPickupResolving(false)
    if (coords) {
      setSelectedPickup({ ...place, lat: coords.lat, lng: coords.lng })
    }
  }, [])

  if (!ride) return null

  const isDriverPost = ride.mode === 'driver'
  const poster = ride.poster
  const initial = poster?.full_name?.[0]?.toUpperCase() ?? '?'

  // v1.3 Sprint 10 Slice 6 — caregiver-section render gate. Only on
  // the rider-on-driver-post branch (isDriverPost === true) AND when
  // the viewer is an accessibility rider with caregivers on file.
  // NOTE: distanceKmEstimate useMemo is hoisted ABOVE the
  // `if (!ride) return null` early return to keep React hook order
  // stable across mount/unmount cycles. React requires every hook to
  // run on every render path; an early return that skips hooks
  // triggers "Rendered more hooks than during the previous render".
  const caregiverSectionVisible = isDriverPost && isWheelchairRider && myCaregivers.length > 0

  const handleRiderSubmit = () => {
    if (!selectedPickup?.lat || !selectedPickup.lng) return
    const usingDriverDest = useDriverDestination && !selectedPlace
    if (!usingDriverDest && (!selectedPlace?.lat || !selectedPlace.lng)) return
    const enrichment: RequestEnrichment = {
      pickup_lat: selectedPickup.lat,
      pickup_lng: selectedPickup.lng,
      pickup_name: selectedPickup.fullAddress,
      destination_flexible: false,
    }
    if (usingDriverDest) {
      if (ride.driver_dest_lat != null && ride.driver_dest_lng != null) {
        enrichment.destination_lat = ride.driver_dest_lat
        enrichment.destination_lng = ride.driver_dest_lng
      }
      enrichment.destination_name = ride.dest_address
      enrichment.dropoff_at_driver_destination = true
    } else if (selectedPlace?.lat != null && selectedPlace.lng != null) {
      enrichment.destination_lat = selectedPlace.lat
      enrichment.destination_lng = selectedPlace.lng
      enrichment.destination_name = selectedPlace.fullAddress
    }
    if (note.trim()) enrichment.note = note.trim().slice(0, 200)
    // v1.3 Sprint 10 Slice 6 — forward caregiver_id + distance_km
    // when the picker is mounted + the rider has a caregiver selected.
    // Server-side consumption on the board-request path is missing
    // today (same situation as iOS — both clients have been sending
    // these fields against /api/schedule/request which silently drops
    // them); landing the wire shape here so a future server slice can
    // light up both clients at once.
    if (caregiverSectionVisible && selectedCaregiverId != null) {
      enrichment.caregiver_id = selectedCaregiverId
      enrichment.distance_km = distanceKmEstimate
    }
    onConfirm(enrichment)
  }

  const handleDriverSubmit = () => {
    const enrichment: RequestEnrichment = { destination_flexible: false }
    if (note.trim()) enrichment.note = note.trim().slice(0, 200)
    onConfirm(enrichment)
  }

  const canRiderSubmit =
    selectedPickup != null && (useDriverDestination || selectedPlace != null)
  const fareEstimate = estimateScheduleFare(ride)

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="confirm-backdrop"
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onCancel}
      />

      {/* Sheet */}
      <div
        data-testid="confirm-sheet"
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl bg-white shadow-xl max-h-[90dvh] overflow-y-auto"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2 sticky top-0 bg-white z-10">
          <div className="h-1.5 w-12 rounded-full bg-border" />
        </div>

        <div className="px-5 pb-4">
          {/* Title */}
          <h3 className="text-lg font-bold text-text-primary text-center mb-4">
            {isDriverPost ? 'Request This Ride' : 'Offer to Drive'}
          </h3>

          {/* Poster info */}
          <div className="flex items-center gap-3 mb-4">
            <div className={[
              'h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm',
              isDriverPost ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
            ].join(' ')}>
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-text-primary text-sm">{poster?.full_name ?? 'Unknown'}</p>
              {poster?.rating_avg != null && (
                <p className="text-xs text-text-secondary">★ {poster.rating_avg.toFixed(1)}</p>
              )}
            </div>
          </div>

          {/* v1.2.1 S2.1 — Proposed Handoff Card. Mirrors iOS
              RideBoardConfirmSheet.swift:421-472. Direction-aware copy
              + tint: forward = warning ("Driver drops you at X — you
              continue by transit"), reverse = primary ("You take
              transit to X — driver picks you up there"). The actual
              pickup / destination fields are still pre-filled via
              `initialEnrichment` lower down — this card is the
              hero context cue. Hidden when proposedHandoff is null. */}
          {proposedHandoff && (
            <div
              data-testid="proposed-handoff-card"
              data-direction={proposedHandoff.direction}
              className={
                proposedHandoff.direction === 'reverse'
                  ? 'mb-4 rounded-2xl border border-primary/30 bg-primary/5 px-3 py-2.5'
                  : 'mb-4 rounded-2xl border border-warning/30 bg-warning/5 px-3 py-2.5'
              }
            >
              <p
                className={
                  proposedHandoff.direction === 'reverse'
                    ? 'text-[10px] font-extrabold uppercase tracking-wider text-primary'
                    : 'text-[10px] font-extrabold uppercase tracking-wider text-warning'
                }
              >
                Transit hand-off
              </p>
              <p className="mt-0.5 text-sm font-bold text-text-primary">
                {proposedHandoff.direction === 'reverse'
                  ? `You take transit to ${proposedHandoff.station_name}`
                  : `Driver drops you at ${proposedHandoff.station_name}`}
              </p>
              <p className="mt-0.5 text-xs text-text-secondary">
                {proposedHandoff.direction === 'reverse'
                  ? 'Driver picks you up there and continues to your destination.'
                  : 'You continue by transit from there to your destination.'}
              </p>
            </div>
          )}

          {/* Route summary */}
          <div className="rounded-2xl bg-surface p-3 mb-4 space-y-1.5">
            <div className="flex items-start gap-2">
              <span className="text-success mt-0.5 text-xs">●</span>
              <p className="text-xs text-text-primary">{ride.origin_address}</p>
            </div>
            <div className="ml-[5px] h-2 border-l border-dashed border-text-secondary/30" />
            <div className="flex items-start gap-2">
              <span className="text-danger mt-0.5 text-xs">●</span>
              <p className="text-xs text-text-primary">{ride.dest_address}</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-text-secondary pt-1">
              <span>{formatDate(ride.trip_date)}</span>
              <span>{formatTripSchedule({ trip_time: ride.trip_time, time_type: ride.time_type, time_flexible: ride.time_flexible })}</span>
            </div>
          </div>

          {/* Fare estimate */}
          {fareEstimate && (
            <div
              data-testid="fare-estimate"
              className="mb-5 rounded-2xl bg-primary/5 border border-primary/15 px-3 py-2.5 flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary shrink-0" aria-hidden="true">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                <span className="text-xs font-medium text-text-primary">Estimated fare</span>
              </div>
              <span className="text-sm font-bold text-primary">{fareEstimate.label}</span>
            </div>
          )}

          {/* ── Driver-offering-on-rider-post: minimal review only ───────── */}
          {!isDriverPost && (
            <>
              <div className="mb-5">
                <p className="text-sm font-semibold text-text-primary mb-2">
                  Add a note <span className="text-text-secondary font-normal">(optional)</span>
                </p>
                <div className="relative">
                  <textarea
                    data-testid="request-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 200))}
                    placeholder="e.g. Happy to help, have a big trunk for luggage…"
                    rows={2}
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none resize-none"
                  />
                  <span className="absolute bottom-2 right-3 text-xs text-text-secondary">{note.length}/200</span>
                </div>
              </div>

              <button
                data-testid="confirm-send-button"
                disabled={isRequesting}
                onClick={handleDriverSubmit}
                className="mb-3 w-full rounded-2xl py-3.5 text-sm font-semibold text-white active:opacity-90 disabled:opacity-50 bg-primary"
              >
                {isRequesting ? 'Sending…' : 'Send Offer'}
              </button>
              <button
                data-testid="confirm-cancel-button"
                onClick={onCancel}
                className="w-full rounded-2xl py-3 text-sm font-semibold text-text-secondary active:bg-surface"
              >
                Cancel
              </button>
            </>
          )}

          {/* ── Rider-requesting-driver-post: pickup + destination form ── */}
          {isDriverPost && (
            <>
              <div className="mb-5">
                <p className="text-sm font-semibold text-text-primary mb-2">Where should the driver pick you up?</p>
                <div className="relative">
                  <input
                    data-testid="pickup-search"
                    type="text"
                    value={pickupQuery}
                    onChange={(e) => handlePickupSearch(e.target.value)}
                    placeholder="Search for your pickup location..."
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
                  />
                  {pickupResolving && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  )}
                  {selectedPickup && (
                    <div className="mt-2 flex items-center gap-2 rounded-xl bg-success/5 border border-success/20 px-3 py-2">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <p className="text-xs text-text-primary font-medium truncate">{selectedPickup.fullAddress}</p>
                    </div>
                  )}

                  {pickupSuggestions.length > 0 && !selectedPickup && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl bg-white border border-border shadow-lg max-h-48 overflow-y-auto">
                      {pickupSuggestions.map((s) => (
                        <button
                          key={s.placeId}
                          data-testid="pickup-suggestion"
                          onClick={() => void handleSelectPickup(s)}
                          className="w-full text-left px-3 py-2.5 hover:bg-surface border-b border-border/50 last:border-b-0"
                        >
                          <p className="text-sm font-medium text-text-primary">{s.mainText}</p>
                          <p className="text-xs text-text-secondary">{s.secondaryText}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-5">
                <p className="text-sm font-semibold text-text-primary mb-3">Where are you headed?</p>

                {/* Default: use driver's destination */}
                <button
                  type="button"
                  data-testid="use-driver-destination"
                  onClick={() => {
                    setUseDriverDestination(true)
                    setSelectedPlace(null)
                    setQuery('')
                    setSuggestions([])
                  }}
                  className={[
                    'mb-3 w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left border',
                    useDriverDestination && !selectedPlace
                      ? 'bg-primary/5 border-primary'
                      : 'bg-white border-border',
                  ].join(' ')}
                >
                  <div className={[
                    'h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0',
                    useDriverDestination && !selectedPlace ? 'border-primary' : 'border-border',
                  ].join(' ')}>
                    {useDriverDestination && !selectedPlace && (
                      <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-text-secondary">Drop me at driver&apos;s destination</p>
                    <p className="text-sm font-medium text-text-primary truncate">{ride.dest_address}</p>
                  </div>
                </button>

                <p className="text-xs text-text-secondary mb-2">Or choose a different drop-off:</p>

                <div className="relative">
                  <input
                    data-testid="destination-search"
                    type="text"
                    value={query}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search for your destination..."
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
                  />
                  {resolving && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  )}
                  {selectedPlace && (
                    <div className="mt-2 flex items-center gap-2 rounded-xl bg-success/5 border border-success/20 px-3 py-2">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <p className="text-xs text-text-primary font-medium truncate">{selectedPlace.fullAddress}</p>
                    </div>
                  )}

                  {/* v1.3 Sprint 10 Slice 4 — transit mini-map + numbered
                      station rows with peek state. Mirrors iOS
                      RideBoardTransitMiniMap (180pt) +
                      RideBoardConfirmDestinationSection.transitRow
                      (lines 199-343). Overview state: numbered station
                      pins + rider dest + driver origin + driver dest
                      context pins. Peek state: only peeked station +
                      rider dest (camera tightens via bounds-fit).
                      Commit happens via "Use this stop" on the peeked
                      card — tap-to-peek does NOT commit. */}
                  {selectedPlace && !loadingTransit && transitSuggestions.length > 0 && (
                    <div className="mt-3" data-testid="transit-suggestions">
                      <p className="text-xs text-text-secondary font-medium mb-2">Transit stops on this route</p>
                      {(() => {
                        // Identify the peeked station (or null when in overview).
                        const peeked = peekedStationKey != null
                          ? transitSuggestions.find(
                              (s) => `${s.station_lat}-${s.station_lng}` === peekedStationKey,
                            ) ?? null
                          : null

                        // Bounds points + AdvancedMarker children change per
                        // mode. Both modes render through the shared
                        // `RideMapPrimitive` (Slice 3).
                        const isPeekMode = peeked != null
                        const boundsPoints: Array<{ lat: number; lng: number }> = isPeekMode
                          ? [
                              { lat: peeked.station_lat, lng: peeked.station_lng },
                              ...(selectedPlace.lat != null && selectedPlace.lng != null
                                ? [{ lat: selectedPlace.lat, lng: selectedPlace.lng }]
                                : []),
                            ]
                          : [
                              ...transitSuggestions.map((s) => ({ lat: s.station_lat, lng: s.station_lng })),
                              ...(selectedPlace.lat != null && selectedPlace.lng != null
                                ? [{ lat: selectedPlace.lat, lng: selectedPlace.lng }]
                                : []),
                              ...(ride?.driver_origin_lat != null && ride.driver_origin_lng != null
                                ? [{ lat: ride.driver_origin_lat, lng: ride.driver_origin_lng }]
                                : []),
                              ...(ride?.driver_dest_lat != null && ride.driver_dest_lng != null
                                ? [{ lat: ride.driver_dest_lat, lng: ride.driver_dest_lng }]
                                : []),
                            ]
                        return (
                          <>
                            <RideMapPrimitive
                              data-testid="transit-mini-map"
                              className="rounded-2xl overflow-hidden border border-border mb-2"
                              height="180px"
                              defaultZoom={12}
                              defaultCenter={
                                transitSuggestions[0]
                                  ? { lat: transitSuggestions[0].station_lat, lng: transitSuggestions[0].station_lng }
                                  : undefined
                              }
                              boundsPoints={boundsPoints}
                            >
                              {/* Station pins — numbered. In peek mode only the
                                  peeked station renders so the camera tightens
                                  on it + rider dest. */}
                              {(isPeekMode ? [peeked] : transitSuggestions).map((s, displayIdx) => {
                                const realIdx = isPeekMode
                                  ? transitSuggestions.findIndex(
                                      (t) => t.station_lat === s.station_lat && t.station_lng === s.station_lng,
                                    )
                                  : displayIdx
                                const isThisPeeked = peeked != null
                                  && peeked.station_lat === s.station_lat
                                  && peeked.station_lng === s.station_lng
                                return (
                                  <AdvancedMarker
                                    key={`${s.station_lat}-${s.station_lng}`}
                                    position={{ lat: s.station_lat, lng: s.station_lng }}
                                    zIndex={isThisPeeked ? 10 : 1}
                                  >
                                    <div
                                      data-testid={`transit-mini-map-station-${realIdx}`}
                                      className={[
                                        'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white shadow-md text-xs font-bold text-white transition-transform',
                                        isThisPeeked ? 'bg-primary scale-125' : 'bg-primary',
                                      ].join(' ')}
                                    >
                                      {realIdx + 1}
                                    </div>
                                  </AdvancedMarker>
                                )
                              })}

                              {/* Rider destination pin — always present (overview
                                  + peek). Anchors the auto-fit so the rider
                                  sees the spatial relationship station ↔ dest. */}
                              {selectedPlace.lat != null && selectedPlace.lng != null && (
                                <AdvancedMarker
                                  position={{ lat: selectedPlace.lat, lng: selectedPlace.lng }}
                                  zIndex={5}
                                >
                                  <div
                                    data-testid="transit-mini-map-rider-dest"
                                    className="flex h-5 w-5 items-center justify-center rounded-full bg-danger border-2 border-white shadow text-[8px] font-bold text-white"
                                  >
                                    D
                                  </div>
                                </AdvancedMarker>
                              )}

                              {/* Driver origin + destination context pins —
                                  only in overview mode (peek mode drops them
                                  so the camera tightens on station+rider dest). */}
                              {!isPeekMode && ride?.driver_origin_lat != null && ride.driver_origin_lng != null && (
                                <AdvancedMarker
                                  position={{ lat: ride.driver_origin_lat, lng: ride.driver_origin_lng }}
                                  zIndex={3}
                                >
                                  <div
                                    data-testid="transit-mini-map-driver-origin"
                                    className="flex h-5 w-5 items-center justify-center rounded-full bg-success border-2 border-white shadow text-[8px] font-bold text-white"
                                  >
                                    P
                                  </div>
                                </AdvancedMarker>
                              )}
                              {!isPeekMode && ride?.driver_dest_lat != null && ride.driver_dest_lng != null && (
                                <AdvancedMarker
                                  position={{ lat: ride.driver_dest_lat, lng: ride.driver_dest_lng }}
                                  zIndex={0}
                                >
                                  <div
                                    data-testid="transit-mini-map-driver-dest"
                                    className="h-3 w-3 rounded-full bg-text-secondary/60 border-2 border-white shadow"
                                  />
                                </AdvancedMarker>
                              )}
                            </RideMapPrimitive>

                            {/* Station rows — numbered, tap-to-peek, peeked
                                row shows "Use this stop" CTA. */}
                            <div className="space-y-1.5">
                              {transitSuggestions.map((ts, idx) => {
                                const key = `${ts.station_lat}-${ts.station_lng}`
                                const isThisPeeked = peekedStationKey === key
                                return (
                                  <RideBoardTransitStationRow
                                    key={key}
                                    index={idx}
                                    stationName={ts.station_name}
                                    walkToStationMinutes={ts.walk_to_station_minutes}
                                    transitToDestMinutes={ts.transit_to_dest_minutes}
                                    totalRiderMinutes={ts.total_rider_minutes}
                                    isPeeked={isThisPeeked}
                                    onTapPeek={() => {
                                      // Tap toggles peek for that row;
                                      // tapping the already-peeked row
                                      // collapses back to overview.
                                      setPeekedStationKey((prev) => (prev === key ? null : key))
                                    }}
                                    onCommit={() => {
                                      // Commit: swap selectedPlace to the
                                      // station + clear suggestions (the
                                      // pre-Slice-4 tap behaviour, now
                                      // gated behind an explicit CTA).
                                      setSelectedPlace({
                                        placeId: '',
                                        mainText: ts.station_name,
                                        secondaryText: `${ts.walk_to_station_minutes} min walk + ${ts.transit_to_dest_minutes} min transit`,
                                        fullAddress: ts.station_name,
                                        lat: ts.station_lat,
                                        lng: ts.station_lng,
                                      })
                                      setQuery(ts.station_name)
                                      setTransitSuggestions([])
                                      setPeekedStationKey(null)
                                    }}
                                  />
                                )
                              })}
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  )}
                  {selectedPlace && loadingTransit && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
                      <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />
                      Finding transit stops...
                    </div>
                  )}

                  {suggestions.length > 0 && !selectedPlace && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl bg-white border border-border shadow-lg max-h-48 overflow-y-auto">
                      {suggestions.map((s) => (
                        <button
                          key={s.placeId}
                          data-testid="place-suggestion"
                          onClick={() => void handleSelectPlace(s)}
                          className="w-full text-left px-3 py-2.5 hover:bg-surface border-b border-border/50 last:border-b-0"
                        >
                          <p className="text-sm font-medium text-text-primary">{s.mainText}</p>
                          <p className="text-xs text-text-secondary">{s.secondaryText}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* v1.3 Sprint 10 Slice 6 — caregiver picker on rider-
                  on-driver-post path. Mirrors iOS
                  RideBoardConfirmSheet.swift:108-116 mount.
                  Gating: isDriverPost && isWheelchairRider &&
                  myCaregivers.length > 0 (matches iOS
                  caregiverSectionVisible at 293-299). */}
              {caregiverSectionVisible && (
                <div className="mb-5" data-testid="ride-board-confirm-caregiver-picker-block">
                  <CaregiverPickerSection
                    caregivers={myCaregivers}
                    selectedId={selectedCaregiverId}
                    onChange={setSelectedCaregiverId}
                    distanceKm={distanceKmEstimate}
                  />
                </div>
              )}

              <div className="mb-5">
                <p className="text-sm font-semibold text-text-primary mb-2">Add a note <span className="text-text-secondary font-normal">(optional)</span></p>
                <div className="relative">
                  <textarea
                    data-testid="request-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 200))}
                    placeholder="e.g. I have a large bag, I'm at the main gate..."
                    rows={2}
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none resize-none"
                  />
                  <span className="absolute bottom-2 right-3 text-xs text-text-secondary">{note.length}/200</span>
                </div>
              </div>

              <button
                data-testid="confirm-send-button"
                disabled={isRequesting || !canRiderSubmit}
                onClick={handleRiderSubmit}
                className="mb-3 w-full rounded-2xl py-3.5 text-sm font-semibold text-white active:opacity-90 disabled:opacity-50 bg-success"
              >
                {isRequesting ? 'Sending…' : 'Send Request'}
              </button>
              <button
                data-testid="confirm-cancel-button"
                onClick={onCancel}
                className="w-full rounded-2xl py-3 text-sm font-semibold text-text-secondary active:bg-surface"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
