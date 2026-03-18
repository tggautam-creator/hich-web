/**
 * Transit dropoff suggestion engine.
 *
 * Given a driver's route polyline and a rider's final destination, finds
 * transit stations along the driver's route and scores them by total rider
 * travel time (walk to station + transit to destination).
 */

import { decodePolyline, samplePolyline, haversineMetres } from './polyline.ts'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransitOption {
  type: string
  icon: string
  line_name: string
  departure_stop?: string
  arrival_stop?: string
  duration_minutes?: number
  walk_minutes: number
  total_minutes: number
}

export interface TransitDropoffSuggestion {
  station_name: string
  station_lat: number
  station_lng: number
  station_place_id: string
  station_address: string
  transit_options: TransitOption[]
  walk_to_station_minutes: number
  driver_detour_minutes: number
  transit_to_dest_minutes: number
  total_rider_minutes: number
  rider_progress_pct?: number
  transit_polyline?: string | null
}

interface PlacesNearbyResult {
  places?: Array<{
    id: string
    displayName?: { text: string }
    formattedAddress?: string
    location?: { latitude: number; longitude: number }
  }>
}

interface GoogleDirectionsResponse {
  status: string
  routes?: Array<{
    overview_polyline?: { points: string }
    legs?: Array<{
      duration?: { value: number }
      steps?: Array<{
        travel_mode: string
        duration?: { value: number }
        transit_details?: {
          departure_stop?: { name?: string }
          arrival_stop?: { name?: string }
          line?: {
            short_name?: string
            name?: string
            vehicle?: { type?: string }
          }
        }
      }>
    }>
  }>
}

interface RoutesApiResponse {
  routes?: Array<{
    distanceMeters?: number
    duration?: string
    polyline?: { encodedPolyline?: string }
  }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SAMPLE_INTERVAL_M = 2000       // sample route every 2km
const SEARCH_RADIUS_M = 1000         // 1km radius around each sample point
const MAX_STATIONS = 5               // max results per nearby search
const MAX_SUGGESTIONS = 3            // top N suggestions returned
const STATION_TYPES = [
  'transit_station',
  'subway_station',
  'train_station',
  'bus_station',
  'light_rail_station',
]

const VEHICLE_ICONS: Record<string, string> = {
  BUS: '\u{1F68C}',
  SUBWAY: '\u{1F687}',
  RAIL: '\u{1F686}',
  TRAM: '\u{1F68A}',
  FERRY: '\u26F4\uFE0F',
  CABLE_CAR: '\u{1F6A1}',
  COMMUTER_TRAIN: '\u{1F686}',
  HEAVY_RAIL: '\u{1F686}',
  HIGH_SPEED_TRAIN: '\u{1F684}',
  INTERCITY_BUS: '\u{1F68C}',
  METRO_RAIL: '\u{1F687}',
  MONORAIL: '\u{1F69D}',
  SHARE_TAXI: '\u{1F690}',
  TROLLEYBUS: '\u{1F68E}',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTransitOptions(data: GoogleDirectionsResponse): TransitOption[] {
  if (data.status !== 'OK' || !data.routes?.length) return []

  const options: TransitOption[] = []
  const route = data.routes[0]
  const leg = route.legs?.[0]
  if (!leg?.steps) return []

  const totalMinutes = Math.round((leg.duration?.value ?? 0) / 60)
  let walkSeconds = 0

  for (const step of leg.steps) {
    if (step.travel_mode === 'WALKING') {
      walkSeconds += step.duration?.value ?? 0
    } else if (step.travel_mode === 'TRANSIT' && step.transit_details) {
      const td = step.transit_details
      const vehicleType = td.line?.vehicle?.type ?? 'BUS'
      const lineName = td.line?.short_name ?? td.line?.name ?? 'Transit'
      const stepDurationMin = Math.round((step.duration?.value ?? 0) / 60)

      options.push({
        type: vehicleType,
        icon: VEHICLE_ICONS[vehicleType] ?? '\u{1F68D}',
        line_name: lineName,
        departure_stop: td.departure_stop?.name ?? undefined,
        arrival_stop: td.arrival_stop?.name ?? undefined,
        duration_minutes: stepDurationMin > 0 ? stepDurationMin : undefined,
        walk_minutes: Math.round(walkSeconds / 60),
        total_minutes: totalMinutes,
      })
    }
  }

  return options
}

/**
 * Fetch the driving route polyline between two points using Google Routes API v2.
 */
export async function fetchDrivingRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  apiKey: string,
): Promise<{ polyline: string; durationMin: number; distanceKm: number } | null> {
  const body = {
    origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
    destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    computeAlternativeRoutes: false,
  }

  const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) return null

  const data = (await resp.json()) as RoutesApiResponse
  const route = data.routes?.[0]
  if (!route?.polyline?.encodedPolyline || !route.duration) return null

  const durationSec = parseInt(route.duration.replace('s', ''), 10)

  return {
    polyline: route.polyline.encodedPolyline,
    durationMin: durationSec / 60,
    distanceKm: (route.distanceMeters ?? 0) / 1000,
  }
}

/**
 * Search for transit stations near a lat/lng using Google Places Nearby Search (New).
 */
async function searchNearbyStations(
  lat: number,
  lng: number,
  radiusM: number,
  apiKey: string,
): Promise<Array<{ id: string; name: string; address: string; lat: number; lng: number }>> {
  const body = {
    includedTypes: STATION_TYPES,
    maxResultCount: MAX_STATIONS,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusM,
      },
    },
  }

  const resp = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) return []

  const data = (await resp.json()) as PlacesNearbyResult

  return (data.places ?? [])
    .filter((p) => p.location?.latitude != null && p.location?.longitude != null)
    .map((p) => ({
      id: p.id,
      name: p.displayName?.text ?? 'Transit Station',
      address: p.formattedAddress ?? '',
      lat: p.location!.latitude,
      lng: p.location!.longitude,
    }))
}

/**
 * Fetch transit directions from a station to the rider's destination.
 * Uses Google Directions API (Legacy) with mode=transit.
 * Returns transit options and the overview polyline for the route.
 */
async function fetchTransitFromStation(
  stationLat: number,
  stationLng: number,
  destLat: number,
  destLng: number,
  apiKey: string,
): Promise<{ options: TransitOption[]; transitPolyline: string | null }> {
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json')
  url.searchParams.set('origin', `${stationLat},${stationLng}`)
  url.searchParams.set('destination', `${destLat},${destLng}`)
  url.searchParams.set('mode', 'transit')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('departure_time', String(Math.floor(Date.now() / 1000)))

  const resp = await fetch(url.toString())
  if (!resp.ok) return { options: [], transitPolyline: null }

  const data = (await resp.json()) as GoogleDirectionsResponse
  const options = parseTransitOptions(data)
  const transitPolyline = data.routes?.[0]?.overview_polyline?.points ?? null
  return { options, transitPolyline }
}

// ── Main Engine ───────────────────────────────────────────────────────────────

/**
 * Compute transit dropoff suggestions along the driver's route.
 *
 * @param driverLat - Driver's current/pickup lat
 * @param driverLng - Driver's current/pickup lng
 * @param driverDestLat - Where the driver is heading
 * @param driverDestLng - Where the driver is heading
 * @param riderDestLat - Rider's final destination
 * @param riderDestLng - Rider's final destination
 * @param apiKey - Google API key (must have Routes, Places, Directions enabled)
 * @param existingPolyline - Optional pre-fetched encoded polyline for driver's route
 */
export async function computeTransitDropoffSuggestions(
  driverLat: number,
  driverLng: number,
  driverDestLat: number,
  driverDestLng: number,
  riderDestLat: number,
  riderDestLng: number,
  apiKey: string,
  existingPolyline?: string,
): Promise<{ suggestions: TransitDropoffSuggestion[]; polyline: string }> {
  // 1. Get the driver's route polyline
  let polyline = existingPolyline ?? ''
  let driverDirectDurationMin = 0

  if (!polyline) {
    const route = await fetchDrivingRoute(driverLat, driverLng, driverDestLat, driverDestLng, apiKey)
    if (!route) return { suggestions: [], polyline: '' }
    polyline = route.polyline
    driverDirectDurationMin = route.durationMin
  } else {
    // Estimate direct duration from polyline length
    const routeResult = await fetchDrivingRoute(driverLat, driverLng, driverDestLat, driverDestLng, apiKey)
    driverDirectDurationMin = routeResult?.durationMin ?? 0
  }

  // 2. Decode and sample the polyline
  const decoded = decodePolyline(polyline)
  if (decoded.length === 0) return { suggestions: [], polyline }

  const samplePoints = samplePolyline(decoded, SAMPLE_INTERVAL_M)

  // 3. Search for transit stations near each sample point (parallel)
  const stationSearches = samplePoints.map((pt) =>
    searchNearbyStations(pt.lat, pt.lng, SEARCH_RADIUS_M, apiKey),
  )
  const stationResults = await Promise.all(stationSearches)

  // 4. Deduplicate by place ID
  const uniqueStations = new Map<string, { id: string; name: string; address: string; lat: number; lng: number }>()
  for (const batch of stationResults) {
    for (const station of batch) {
      if (!uniqueStations.has(station.id)) {
        uniqueStations.set(station.id, station)
      }
    }
  }

  if (uniqueStations.size === 0) return { suggestions: [], polyline }

  // 5. For each station, fetch transit options to rider's destination + compute detour
  const candidates: TransitDropoffSuggestion[] = []

  // Pre-compute the distance from pickup to rider destination (for progress scoring)
  const pickupToDestM = haversineMetres(driverLat, driverLng, riderDestLat, riderDestLng)

  const stationEntries = [...uniqueStations.values()]

  // Process in parallel batches of 5 to avoid rate limits
  const BATCH_SIZE = 5
  for (let i = 0; i < stationEntries.length; i += BATCH_SIZE) {
    const batch = stationEntries.slice(i, i + BATCH_SIZE)

    const results = await Promise.all(
      batch.map(async (station) => {
        // Filter: skip stations that don't get the rider closer to their destination
        const stationToDestM = haversineMetres(station.lat, station.lng, riderDestLat, riderDestLng)
        if (pickupToDestM > 0 && stationToDestM > pickupToDestM * 0.95) return null

        // Fetch transit from station to rider destination
        const { options: transitOptions, transitPolyline } = await fetchTransitFromStation(
          station.lat, station.lng,
          riderDestLat, riderDestLng,
          apiKey,
        )

        // Compute walk distance from nearest point on route to station
        const walkToStationM = haversineMetres(
          station.lat, station.lng,
          // Find closest point on route to station
          ...findClosestPointOnRoute(decoded, station.lat, station.lng),
        )
        const walkToStationMin = Math.round(walkToStationM / (1.4 * 60)) // 1.4 m/s walking

        // Estimate driver detour: drive to station + station to driver dest vs direct
        const detourRoute = await fetchDrivingRoute(
          driverLat, driverLng,
          station.lat, station.lng,
          apiKey,
        )
        const detourMin = detourRoute
          ? Math.max(0, detourRoute.durationMin - driverDirectDurationMin)
          : 0

        const transitToDestMin = transitOptions.length > 0 ? transitOptions[0].total_minutes : 0

        // Compute rider progress: how much closer does this station get the rider?
        const progressRatio = pickupToDestM > 0
          ? Math.max(0, 1 - (stationToDestM / pickupToDestM))
          : 0

        return {
          station_name: station.name,
          station_lat: station.lat,
          station_lng: station.lng,
          station_place_id: station.id,
          station_address: station.address,
          transit_options: transitOptions,
          walk_to_station_minutes: walkToStationMin,
          driver_detour_minutes: Math.round(detourMin),
          transit_to_dest_minutes: transitToDestMin,
          total_rider_minutes: walkToStationMin + transitToDestMin,
          rider_progress_pct: Math.round(progressRatio * 100),
          transit_polyline: transitPolyline,
        } satisfies TransitDropoffSuggestion
      }),
    )

    for (const r of results) {
      if (r) candidates.push(r)
    }
  }

  // 6. Score and sort — lower is better
  // Weights: transit time (1x) + walk penalty (0.5x) + detour penalty (1x) - progress bonus (15)
  candidates.sort((a, b) => {
    const progressA = (a.rider_progress_pct ?? 0) / 100
    const progressB = (b.rider_progress_pct ?? 0) / 100
    const scoreA =
      a.total_rider_minutes +
      a.walk_to_station_minutes * 0.5 +
      a.driver_detour_minutes * 1 -
      progressA * 15
    const scoreB =
      b.total_rider_minutes +
      b.walk_to_station_minutes * 0.5 +
      b.driver_detour_minutes * 1 -
      progressB * 15
    return scoreA - scoreB
  })

  return {
    suggestions: candidates.slice(0, MAX_SUGGESTIONS),
    polyline,
  }
}

/**
 * Find the closest lat/lng on a route to a given point.
 * Returns [closestLat, closestLng].
 */
function findClosestPointOnRoute(
  routePoints: Array<{ lat: number; lng: number }>,
  targetLat: number,
  targetLng: number,
): [number, number] {
  let bestDist = Infinity
  let bestLat = routePoints[0]?.lat ?? targetLat
  let bestLng = routePoints[0]?.lng ?? targetLng

  for (const pt of routePoints) {
    const d = haversineMetres(targetLat, targetLng, pt.lat, pt.lng)
    if (d < bestDist) {
      bestDist = d
      bestLat = pt.lat
      bestLng = pt.lng
    }
  }

  return [bestLat, bestLng]
}
