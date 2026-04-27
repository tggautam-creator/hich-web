import { useState, useRef, useCallback, useEffect } from 'react'
import type { ScheduledRide } from './boardTypes'
import { formatDate, formatTripSchedule } from './boardHelpers'
import { searchPlaces, getPlaceCoordinates } from '@/lib/places'
import type { PlaceSuggestion } from '@/lib/places'
import { supabase } from '@/lib/supabase'
import { estimateScheduleFare } from '@/lib/fareEstimate'

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
}

interface RideBoardConfirmSheetProps {
  ride: ScheduledRide | null
  isRequesting: boolean
  initialEnrichment?: RequestEnrichment | null
  onConfirm: (enrichment: RequestEnrichment) => void
  onCancel: () => void
}

export default function RideBoardConfirmSheet({
  ride,
  isRequesting,
  initialEnrichment,
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

                  {selectedPlace && !loadingTransit && transitSuggestions.length > 0 && (
                    <div className="mt-3" data-testid="transit-suggestions">
                      <p className="text-xs text-text-secondary font-medium mb-2">Transit stops on this route</p>
                      <div className="space-y-1.5">
                        {transitSuggestions.map((ts) => (
                          <button
                            key={`${ts.station_lat}-${ts.station_lng}`}
                            type="button"
                            onClick={() => {
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
                            }}
                            className="w-full flex items-center gap-2.5 rounded-xl bg-surface border border-border/50 px-3 py-2 text-left active:bg-border/30"
                            data-testid="transit-suggestion-item"
                          >
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                              T
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-text-primary truncate">{ts.station_name}</p>
                              <p className="text-[10px] text-text-secondary">
                                {ts.walk_to_station_minutes} min walk · {ts.transit_to_dest_minutes} min transit · {ts.total_rider_minutes} min total
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
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
