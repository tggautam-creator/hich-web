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
import { reverseGeocode } from '@/lib/geocode'

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
  /** v1.3 — driver-offer transit-station dropoff (mirrors iOS
   *  RiderDropoffChoice.atTransitStation). When set, the offer
   *  proposes dropping the rider at this station + threads the 4
   *  transit-leg fields through so the rider's BoardOfferAcceptPage
   *  renders the full journey card. The destination_* fields above
   *  carry the station coords + name; these add the line-name + leg
   *  breakdown. */
  proposed_transit_line_name?: string
  proposed_transit_walk_minutes?: number
  proposed_transit_to_dest_minutes?: number
  proposed_transit_total_minutes?: number
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

  // Driver-offering-on-rider-post: the driver's OWN destination.
  // Mirrors iOS RideBoardOfferDestinationSection ("Where are you
  // heading?", required field). Without it the server can't compute
  // the driver's route → can't compute transit handoff stations →
  // the whole offer-side transit feature is dead. Slice 1.
  const [driverDestQuery, setDriverDestQuery] = useState('')
  const [driverDestSuggestions, setDriverDestSuggestions] = useState<PlaceSuggestion[]>([])
  const [selectedDriverDest, setSelectedDriverDest] = useState<PlaceSuggestion | null>(null)
  const [driverDestResolving, setDriverDestResolving] = useState(false)
  const driverDestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Slice 3 — rider-dropoff mode for the driver-offer flow. Mirrors
  // iOS RiderDropoffChoice (.atRiderDestination | .atTransitStation).
  // Default false → drop at rider's posted dest. Setting it true
  // surfaces the transit station picker; user must commit a station
  // before the Send button enables.
  const [driverOfferTransitMode, setDriverOfferTransitMode] = useState(false)
  // Driver-offer peeked-station key (mirror of rider-side
  // peekedStationKey). Null in overview mode; set when the driver
  // taps a station row → mini-map zooms to that station + the rider's
  // posted dest, "Use this stop" CTA reveals on the matching row.
  // Cleared on commit + when the fetch returns fresh suggestions.
  const [driverOfferPeekedKey, setDriverOfferPeekedKey] = useState<string | null>(null)

  // Slice 4 — auto-same-dest detection. iOS uses 300m as the proximity
  // threshold (matches the handoff engine's "same place" rule). When
  // the driver's destination is within 300m of the rider's posted
  // destination, transit handoff makes no sense — collapse the radio
  // matrix into a confirmation card instead.
  const driverDestMatchesRiderDest = (() => {
    if (!selectedDriverDest?.lat || !selectedDriverDest?.lng) return false
    if (ride?.dest_lat == null || ride?.dest_lng == null) return false
    return haversineMetres(
      selectedDriverDest.lat,
      selectedDriverDest.lng,
      ride.dest_lat,
      ride.dest_lng,
    ) <= 300
  })()

  // Clear transit mode + any committed station whenever the auto-
  // same-dest path activates — otherwise a stale "transit handoff"
  // selection from before the driver edited their destination would
  // keep the Send button gated.
  useEffect(() => {
    if (driverDestMatchesRiderDest) {
      setDriverOfferTransitMode(false)
      setDriverOfferStation(null)
    }
  }, [driverDestMatchesRiderDest])

  // Transit suggestions (rider-on-driver-post flow only)
  interface TransitSuggestion {
    station_name: string
    station_lat: number
    station_lng: number
    walk_to_station_minutes: number
    transit_to_dest_minutes: number
    total_rider_minutes: number
    transit_line_name?: string | null
  }
  const [transitSuggestions, setTransitSuggestions] = useState<TransitSuggestion[]>([])
  const [loadingTransit, setLoadingTransit] = useState(false)

  // v1.3 — driver-offer transit dropoff state. Mirrors iOS
  // RideBoardConfirmViewModel.RiderDropoffChoice — null means "drop
  // at rider's posted dest" (default); set means "drop at this
  // transit station". Lives separately from the rider-side
  // selectedPlace because the two flows use different defaults.
  const [driverOfferStation, setDriverOfferStation] = useState<TransitSuggestion | null>(null)
  const [driverOfferStations, setDriverOfferStations] = useState<TransitSuggestion[]>([])
  const [loadingDriverOfferTransit, setLoadingDriverOfferTransit] = useState(false)
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

  // Driver-offer transit fetch. Slice 2 rewire: fires when the driver
  // PICKS THEIR OWN destination (selectedDriverDest), not when the
  // sheet opens. Old behaviour passed the rider's posted dest as both
  // the driver's dest AND the rider's dest, which asked the server
  // for transit stops along a zero-length route (rider's pickup to
  // rider's dest, with the "rider" already at their destination).
  // The server returned empty / nonsensical suggestions and the
  // driver saw nothing.
  //
  // Correct shape matching iOS RideBoardConfirmViewModel:
  //   driver_origin = effective driver pickup (alt pickup OR rider's posted pickup)
  //   driver_dest   = the driver's OWN destination (new input from Slice 1)
  //   rider_dest    = rider's posted destination
  // Now the server can compute stations that fall along the driver's
  // actual route + ALSO line up with the rider's final destination
  // via transit.
  useEffect(() => {
    if (!ride) return
    if (ride.mode !== 'rider') return // driver-offering-on-rider-post path only
    if (ride.origin_lat == null || ride.origin_lng == null) return
    if (ride.dest_lat == null || ride.dest_lng == null) return
    if (selectedDriverDest?.lat == null || selectedDriverDest?.lng == null) {
      // No driver dest yet → can't compute. Clear any stale suggestions
      // from a previous selection so the UI doesn't show outdated stops.
      setDriverOfferStations([])
      return
    }

    // Driver origin = alt pickup if picked, else rider's posted pickup.
    const driverOriginLat = selectedPickup?.lat ?? ride.origin_lat
    const driverOriginLng = selectedPickup?.lng ?? ride.origin_lng

    let cancelled = false
    setLoadingDriverOfferTransit(true)
    void (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token
        const res = await fetch('/api/transit/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
          body: JSON.stringify({
            driver_origin_lat: driverOriginLat,
            driver_origin_lng: driverOriginLng,
            driver_dest_lat: selectedDriverDest.lat,
            driver_dest_lng: selectedDriverDest.lng,
            rider_dest_lat: ride.dest_lat,
            rider_dest_lng: ride.dest_lng,
          }),
        })
        if (!cancelled && res.ok) {
          const data = (await res.json()) as { suggestions: TransitSuggestion[] }
          setDriverOfferStations(data.suggestions ?? [])
          // Stale peek invalidation: if the driver edited their dest
          // and the new fetch dropped the previously-peeked station,
          // the mini-map would render zero pins. Reset on every fresh
          // resolve to match the rider-side pattern.
          setDriverOfferPeekedKey(null)
        }
      } catch {
        // Silent — transit suggestions are optional; the default
        // "drop at rider's posted dest" path keeps working.
      } finally {
        if (!cancelled) setLoadingDriverOfferTransit(false)
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride?.id, ride?.mode, ride?.origin_lat, ride?.origin_lng, ride?.dest_lat, ride?.dest_lng, selectedDriverDest?.lat, selectedDriverDest?.lng, selectedPickup?.lat, selectedPickup?.lng])

  // Fetch transit suggestions when rider selects a destination on a
  // driver post. iOS RideBoardConfirmViewModel.swift:494-502 falls back
  // from the legacy `driver_origin_lat/lng` + `driver_dest_lat/lng`
  // (pre-migration-048 fields, only populated on posts that pre-date
  // 2026-05) to the canonical post-048 `origin_lat/lng` + `dest_lat/lng`
  // — which are populated on EVERY post regardless of routine
  // attachment. Web was only checking the legacy fields, so the fetch
  // bailed silently on every modern driver post → user saw no transit
  // suggestions even when iOS does. Mirror the iOS fallback chain.
  const driverOriginLat = ride?.driver_origin_lat ?? ride?.origin_lat ?? null
  const driverOriginLng = ride?.driver_origin_lng ?? ride?.origin_lng ?? null
  const driverDestLat = ride?.driver_dest_lat ?? ride?.dest_lat ?? null
  const driverDestLng = ride?.driver_dest_lng ?? ride?.dest_lng ?? null
  useEffect(() => {
    if (!selectedPlace?.lat || !selectedPlace?.lng || !ride) return
    if (driverOriginLat == null || driverOriginLng == null || driverDestLat == null || driverDestLng == null) return

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
            driver_origin_lat: driverOriginLat,
            driver_origin_lng: driverOriginLng,
            driver_dest_lat: driverDestLat,
            driver_dest_lng: driverDestLng,
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
  }, [selectedPlace?.lat, selectedPlace?.lng, ride, driverOriginLat, driverOriginLng, driverDestLat, driverDestLng])

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

  const handleDriverDestSearch = useCallback((value: string) => {
    setDriverDestQuery(value)
    setSelectedDriverDest(null)
    if (driverDestDebounceRef.current) clearTimeout(driverDestDebounceRef.current)
    if (value.trim().length < 2) { setDriverDestSuggestions([]); return }
    driverDestDebounceRef.current = setTimeout(() => {
      void searchPlaces(value).then(setDriverDestSuggestions)
    }, 300)
  }, [])

  const handleSelectDriverDest = useCallback(async (place: PlaceSuggestion) => {
    setDriverDestQuery(place.fullAddress)
    setDriverDestSuggestions([])
    if (place.lat != null && place.lng != null) {
      setSelectedDriverDest(place)
      return
    }
    setDriverDestResolving(true)
    const coords = await getPlaceCoordinates(place.placeId)
    setDriverDestResolving(false)
    if (coords) {
      setSelectedDriverDest({ ...place, lat: coords.lat, lng: coords.lng })
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

  // v1.3 — "Use my current location" GPS prefill. Mirrors iOS
  // RideBoardConfirmViewModel.prefillPickupFromGPS — gets the browser
  // location, reverse-geocodes for a short label, and synthesizes a
  // PlaceSuggestion that drops straight into selectedPickup so the
  // rider doesn't need to type a search.
  const [gpsResolving, setGpsResolving] = useState(false)
  const [gpsAvailable, setGpsAvailable] = useState(
    typeof navigator !== 'undefined' && Boolean(navigator.geolocation),
  )
  const handleUseCurrentLocation = useCallback(() => {
    if (!navigator.geolocation || gpsResolving) return
    setGpsResolving(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const label = await reverseGeocode(lat, lng).catch(() => '') || 'Current location'
        setPickupQuery(label)
        setPickupSuggestions([])
        setSelectedPickup({
          placeId: 'device-gps',
          mainText: label,
          secondaryText: '',
          fullAddress: label,
          lat,
          lng,
        })
        setGpsResolving(false)
      },
      () => {
        // Permission denied / unavailable — hide the button so we
        // don't keep prompting and the user can fall back to search.
        setGpsResolving(false)
        setGpsAvailable(false)
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }, [gpsResolving])

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
    // v1.3 Sprint 12 Slice 6 — driver-side pickup picker. Mirrors iOS
    // `RideBoardConfirmPickupSection` + threads through to
    // `proposed_pickup_*` on POST /api/schedule/board/offers. Optional:
    // when the driver doesn't pick a pickup, the server falls back to
    // the schedule's posted origin (the "tap Offer to drive" default).
    if (selectedPickup?.lat != null && selectedPickup.lng != null) {
      enrichment.pickup_lat = selectedPickup.lat
      enrichment.pickup_lng = selectedPickup.lng
      enrichment.pickup_name = selectedPickup.fullAddress
    }
    // v1.3 — driver-offer transit-station dropoff (mirrors iOS
    // RiderDropoffChoice.atTransitStation branch at
    // RideBoardConfirmViewModel.swift:788-807). When the driver picked
    // a station, override the dropoff coords + thread the 4 transit
    // breakdown fields through so the rider's accept page renders the
    // full journey card. When no station is picked, the default path
    // (server falls back to the schedule's posted dest) keeps working.
    if (driverOfferStation) {
      enrichment.destination_lat = driverOfferStation.station_lat
      enrichment.destination_lng = driverOfferStation.station_lng
      enrichment.destination_name = driverOfferStation.station_name
      enrichment.proposed_transit_walk_minutes = driverOfferStation.walk_to_station_minutes
      enrichment.proposed_transit_to_dest_minutes = driverOfferStation.transit_to_dest_minutes
      enrichment.proposed_transit_total_minutes = driverOfferStation.total_rider_minutes
      if (driverOfferStation.transit_line_name) {
        enrichment.proposed_transit_line_name = driverOfferStation.transit_line_name
      }
    }
    if (note.trim()) enrichment.note = note.trim().slice(0, 200)
    onConfirm(enrichment)
  }

  // v1.3 Sprint 12 Slice 6 — shared pickup picker markup. Same UI used
  // for both the rider's "where should the driver pick me up?" flow and
  // the new driver's "where will you pick the rider up?" flow.
  const pickupPickerSection = (label: string, placeholder: string) => (
    <div className="mb-5">
      <p className="text-sm font-semibold text-text-primary mb-2">{label}</p>
      {/* v1.3 — "Use my current location" pill. Mirrors iOS
          RideBoardConfirmPickupSection.swift:45-81. Hidden once the
          browser denies geolocation OR if the API isn't available
          (server-side render, ancient browser). */}
      {gpsAvailable && !selectedPickup && (
        <button
          type="button"
          data-testid="pickup-use-current-location"
          onClick={handleUseCurrentLocation}
          disabled={gpsResolving}
          className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary active:bg-primary/20 disabled:opacity-60"
        >
          {gpsResolving ? (
            <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" aria-hidden="true" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3m0 14v3M2 12h3m14 0h3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          )}
          {gpsResolving ? 'Resolving location…' : 'Use my current location'}
        </button>
      )}
      <div className="relative">
        <input
          data-testid="pickup-search"
          type="text"
          value={pickupQuery}
          onChange={(e) => handlePickupSearch(e.target.value)}
          placeholder={placeholder}
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
  )

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

          {/* ── Driver-offering-on-rider-post: pickup picker + note + send ─ */}
          {!isDriverPost && (
            <>
              {/* v1.3 Sprint 12 Slice 6 — driver pickup picker. Mirrors
                  iOS `RideBoardConfirmPickupSection`. Optional — leaving
                  this blank lets the server fall back to the schedule's
                  posted origin (one-tap "Offer to drive" default). */}
              {pickupPickerSection(
                'Where will you pick them up?',
                'Search for a pickup location…',
              )}

              {/* "Where are you heading?" — required driver dest input.
                  Mirrors iOS RideBoardOfferDestinationSection. Without
                  this the server can't compute transit handoff stations,
                  which is why the whole feature was dead on this flow
                  before. Same debounced-Places-autocomplete pattern as
                  the pickup picker above; selection upgrades to a chip
                  + triggers the transit fetch in the next effect. */}
              <div className="mb-5">
                <div className="flex items-baseline gap-2 mb-1">
                  <p className="text-sm font-semibold text-text-primary">Where are you heading?</p>
                  <span className="text-[11px] text-text-secondary">(required)</span>
                </div>
                <p className="text-[11px] text-text-secondary mb-2 leading-snug">
                  Lets us check for transit hand-off options if your route doesn&rsquo;t quite match theirs.
                </p>
                <div className="relative">
                  <input
                    data-testid="driver-dest-search"
                    type="text"
                    value={driverDestQuery}
                    onChange={(e) => handleDriverDestSearch(e.target.value)}
                    placeholder="Search for your destination…"
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
                  />
                  {driverDestResolving && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  )}
                  {driverDestSuggestions.length > 0 && !selectedDriverDest && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl bg-white border border-border shadow-lg max-h-48 overflow-y-auto">
                      {driverDestSuggestions.map((s) => (
                        <button
                          key={s.placeId}
                          data-testid="driver-dest-suggestion"
                          onClick={() => void handleSelectDriverDest(s)}
                          className="w-full text-left px-3 py-2.5 hover:bg-surface border-b border-border/50 last:border-b-0"
                        >
                          <p className="text-sm font-medium text-text-primary">{s.mainText}</p>
                          <p className="text-xs text-text-secondary">{s.secondaryText}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedDriverDest && (
                  <div data-testid="driver-dest-selected" className="mt-2 flex items-center gap-2 rounded-xl bg-success/5 border border-success/20 px-3 py-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <p className="text-xs text-text-primary font-medium truncate">{selectedDriverDest.fullAddress}</p>
                  </div>
                )}
              </div>

              {/* Slice 4 — auto-same-dest banner. When the driver's
                  destination is within 300m of the rider's posted dest,
                  transit handoff is moot — skip the radio + transit
                  picker entirely and surface a green confirmation card
                  matching iOS sameDestinationCard. */}
              {selectedDriverDest && driverDestMatchesRiderDest && (
                <div
                  data-testid="driver-offer-same-dest-card"
                  className="mb-5 rounded-2xl border border-success/30 bg-success/10 p-3 flex items-start gap-3"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-success shrink-0 mt-0.5" aria-hidden="true">
                    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 14.5L6.5 12l1.4-1.4 3.1 3.1 6.6-6.6L19 8.5l-8 8z" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-text-primary">
                      You&rsquo;re heading to the same place
                    </p>
                    <p className="text-[11px] text-text-secondary mt-0.5">
                      We&rsquo;ll drop them at {ride.dest_address}.
                    </p>
                  </div>
                </div>
              )}

              {/* Slice 3 — Dropoff matrix. Mirrors iOS
                  RideBoardOfferDropoffSection. Renders once the driver
                  has picked a destination so transit suggestions can
                  be meaningfully gated against the radio. Before that
                  the rider's posted dest is the only sensible choice
                  anyway, so the matrix stays hidden. Skipped entirely
                  when the auto-same-dest card above is showing. */}
              {selectedDriverDest && !driverDestMatchesRiderDest && (
                <div className="mb-5">
                  <p className="text-sm font-semibold text-text-primary mb-2">
                    Where will the rider be dropped off?
                  </p>
                  <div className="space-y-1.5">
                    {/* Radio A — Drop at rider's posted destination */}
                    <button
                      type="button"
                      data-testid="driver-offer-drop-at-dest"
                      onClick={() => {
                        setDriverOfferTransitMode(false)
                        setDriverOfferStation(null)
                      }}
                      className={`w-full text-left rounded-xl px-3 py-2.5 border transition-colors flex items-start gap-3 ${
                        !driverOfferTransitMode
                          ? 'bg-primary/10 border-primary/40'
                          : 'bg-white border-border active:bg-surface'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                          !driverOfferTransitMode ? 'border-primary' : 'border-text-secondary/40'
                        }`}
                      >
                        {!driverOfferTransitMode && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-text-primary">
                          Drop at their destination
                        </p>
                        <p className="text-[11px] text-text-secondary truncate">
                          {ride.dest_address}
                        </p>
                      </span>
                    </button>

                    {/* Radio B — Hand off via transit */}
                    <button
                      type="button"
                      data-testid="driver-offer-handoff-transit"
                      onClick={() => setDriverOfferTransitMode(true)}
                      className={`w-full text-left rounded-xl px-3 py-2.5 border transition-colors flex items-start gap-3 ${
                        driverOfferTransitMode
                          ? 'bg-primary/10 border-primary/40'
                          : 'bg-white border-border active:bg-surface'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                          driverOfferTransitMode ? 'border-primary' : 'border-text-secondary/40'
                        }`}
                      >
                        {driverOfferTransitMode && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-text-primary">
                          Hand off via transit
                        </p>
                        <p className="text-[11px] text-text-secondary truncate">
                          {driverOfferStation
                            ? `Drop at ${driverOfferStation.station_name} · rider takes transit`
                            : 'Pick a station below'}
                        </p>
                      </span>
                    </button>

                    {/* Transit station picker — only visible inside the
                        transit branch. Matches iOS DropoffSection
                        gating: radio B opens the list; radio A hides it. */}
                    {driverOfferTransitMode && (
                      <div data-testid="driver-offer-transit-picker" className="pl-7 space-y-1.5 pt-1">
                        {loadingDriverOfferTransit && driverOfferStations.length === 0 && (
                          <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary">
                            <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" aria-hidden="true" />
                            Looking for transit hand-off options&hellip;
                          </div>
                        )}
                        {/* Slice 4 — empty-state copy matching iOS
                            emptyTransitNotice. Surfaces when the
                            fetch resolved but the server returned no
                            stations (no transit lines pass near the
                            driver's route + the rider's destination). */}
                        {!loadingDriverOfferTransit && driverOfferStations.length === 0 && (
                          <div
                            data-testid="driver-offer-transit-empty"
                            className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5"
                          >
                            <p className="text-xs font-semibold text-text-primary">
                              No transit hand-off options on this route.
                            </p>
                            <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">
                              Switch back to &ldquo;Drop at their destination&rdquo; if you&rsquo;re willing to detour, or close this offer.
                            </p>
                          </div>
                        )}
                        {/* Slice 6 (this turn) — mini-map + numbered
                            station rows + peek/commit pattern. Same
                            UX the rider-side has had since Sprint 10
                            Slice 4. iOS RideBoardOfferDropoffSection
                            uses the same RideBoardTransitMiniMap +
                            transitRow primitives for the driver-
                            offer flow. Driver sees their own pickup
                            (P pin), their own destination (D pin),
                            plus the rider's posted destination
                            (orange R pin) so the spatial relationship
                            is unambiguous. */}
                        {driverOfferStations.length > 0 && (() => {
                          const peeked = driverOfferPeekedKey != null
                            ? driverOfferStations.find(
                                (s) => `${s.station_lat}-${s.station_lng}` === driverOfferPeekedKey,
                              ) ?? null
                            : null
                          const isPeekMode = peeked != null
                          const driverDestPos = selectedDriverDest?.lat != null && selectedDriverDest?.lng != null
                            ? { lat: selectedDriverDest.lat, lng: selectedDriverDest.lng }
                            : null
                          const driverPickupPos = (selectedPickup?.lat != null && selectedPickup?.lng != null)
                            ? { lat: selectedPickup.lat, lng: selectedPickup.lng }
                            : (ride.origin_lat != null && ride.origin_lng != null)
                              ? { lat: ride.origin_lat, lng: ride.origin_lng }
                              : null
                          const riderDestPos = (ride.dest_lat != null && ride.dest_lng != null)
                            ? { lat: ride.dest_lat, lng: ride.dest_lng }
                            : null
                          const boundsPoints: Array<{ lat: number; lng: number }> = isPeekMode
                            ? [
                                { lat: peeked.station_lat, lng: peeked.station_lng },
                                ...(riderDestPos ? [riderDestPos] : []),
                              ]
                            : [
                                ...driverOfferStations.map((s) => ({ lat: s.station_lat, lng: s.station_lng })),
                                ...(riderDestPos ? [riderDestPos] : []),
                                ...(driverPickupPos ? [driverPickupPos] : []),
                                ...(driverDestPos ? [driverDestPos] : []),
                              ]
                          return (
                            <>
                              <RideMapPrimitive
                                data-testid="driver-offer-transit-mini-map"
                                className="rounded-2xl overflow-hidden border border-border mb-2"
                                height="180px"
                                defaultZoom={12}
                                defaultCenter={
                                  driverOfferStations[0]
                                    ? { lat: driverOfferStations[0].station_lat, lng: driverOfferStations[0].station_lng }
                                    : undefined
                                }
                                boundsPoints={boundsPoints}
                              >
                                {/* Numbered station pins. Peek mode collapses
                                    to just the peeked station + rider dest
                                    so the camera tightens. */}
                                {(isPeekMode ? [peeked] : driverOfferStations).map((s, displayIdx) => {
                                  const realIdx = isPeekMode
                                    ? driverOfferStations.findIndex(
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
                                        data-testid={`driver-offer-mini-map-station-${realIdx}`}
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

                                {/* Rider destination — always present. */}
                                {riderDestPos && (
                                  <AdvancedMarker
                                    position={riderDestPos}
                                    zIndex={5}
                                  >
                                    <div
                                      data-testid="driver-offer-mini-map-rider-dest"
                                      className="flex h-5 w-5 items-center justify-center rounded-full bg-warning border-2 border-white shadow text-[8px] font-bold text-white"
                                    >
                                      R
                                    </div>
                                  </AdvancedMarker>
                                )}

                                {/* Driver context pins — overview only.
                                    P = driver pickup, D = driver dest. */}
                                {!isPeekMode && driverPickupPos && (
                                  <AdvancedMarker position={driverPickupPos} zIndex={3}>
                                    <div
                                      data-testid="driver-offer-mini-map-driver-origin"
                                      className="flex h-5 w-5 items-center justify-center rounded-full bg-success border-2 border-white shadow text-[8px] font-bold text-white"
                                    >
                                      P
                                    </div>
                                  </AdvancedMarker>
                                )}
                                {!isPeekMode && driverDestPos && (
                                  <AdvancedMarker position={driverDestPos} zIndex={0}>
                                    <div
                                      data-testid="driver-offer-mini-map-driver-dest"
                                      className="flex h-5 w-5 items-center justify-center rounded-full bg-text-primary border-2 border-white shadow text-[8px] font-bold text-white"
                                    >
                                      D
                                    </div>
                                  </AdvancedMarker>
                                )}
                              </RideMapPrimitive>

                              <div className="space-y-1.5">
                                {driverOfferStations.map((s, idx) => {
                                  const key = `${s.station_lat}-${s.station_lng}`
                                  const isThisPeeked = driverOfferPeekedKey === key
                                  return (
                                    <RideBoardTransitStationRow
                                      key={key}
                                      index={idx}
                                      stationName={s.station_name}
                                      walkToStationMinutes={s.walk_to_station_minutes}
                                      transitToDestMinutes={s.transit_to_dest_minutes}
                                      totalRiderMinutes={s.total_rider_minutes}
                                      isPeeked={isThisPeeked}
                                      onTapPeek={() => {
                                        setDriverOfferPeekedKey((prev) => (prev === key ? null : key))
                                      }}
                                      onCommit={() => {
                                        setDriverOfferStation(s)
                                        setDriverOfferPeekedKey(null)
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
                  </div>
                </div>
              )}

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

              {/* Submit gate (Slices 1-3):
                  - driver dest required (Slice 1's iOS-parity required input)
                  - if transit mode is on, a station must be committed
                  Disabled state mirrors iOS canSubmitDriverOffer. */}
              {(() => {
                const canSubmit = !!selectedDriverDest
                  && (!driverOfferTransitMode || driverOfferStation != null)
                return (
                  <button
                    data-testid="confirm-send-button"
                    disabled={isRequesting || !canSubmit}
                    onClick={handleDriverSubmit}
                    className="mb-3 w-full rounded-2xl py-3.5 text-sm font-semibold text-white active:opacity-90 disabled:opacity-50 bg-primary"
                  >
                    {isRequesting ? 'Sending…' : 'Send Offer'}
                  </button>
                )
              })()}
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
              {pickupPickerSection(
                'Where should the driver pick you up?',
                'Search for your pickup location…',
              )}

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
                              // Same iOS legacy → canonical fallback used
                              // in the transit fetch above so the driver
                              // origin / dest pins land on the mini-map
                              // for modern (post-048) driver posts too.
                              ...(driverOriginLat != null && driverOriginLng != null
                                ? [{ lat: driverOriginLat, lng: driverOriginLng }]
                                : []),
                              ...(driverDestLat != null && driverDestLng != null
                                ? [{ lat: driverDestLat, lng: driverDestLng }]
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
                  {/* Slice 5 — rider-side empty-state. iOS shows this
                      under the destination once the fetch resolves
                      with zero stations (no transit lines pass near
                      the driver's route → the rider's destination).
                      Without it the rider just sees their selected
                      destination and nothing else, which reads as a
                      broken UI rather than "transit doesn't help here." */}
                  {selectedPlace && !loadingTransit && transitSuggestions.length === 0 && (
                    <div
                      data-testid="rider-transit-empty"
                      className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5"
                    >
                      <p className="text-xs font-semibold text-text-primary">
                        No transit hand-off options on this route.
                      </p>
                      <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">
                        The driver will drop you at this destination directly.
                      </p>
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
