/**
 * Transit dropoff suggestion engine.
 *
 * Uses a divergence-point algorithm to find the optimal dropoff zone:
 * 1. Walk along the driver's route, measuring distance to the rider's destination
 * 2. The divergence point = where the driver's route is closest to the rider's dest
 *    (after this, the driver moves away)
 * 3. Search for transit stations only near the divergence zone (1-2 Nearby Search calls)
 * 4. Also check a static list of major transit hubs along the route (zero API calls)
 *
 * This replaces the old sample-every-2km approach, reducing API calls from ~25-35 to ~7-10.
 */

import { decodePolyline, haversineMetres, type LatLng } from './polyline.ts'

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
  ride_with_driver_minutes: number
  ride_distance_km: number
  walk_to_station_minutes: number
  driver_detour_minutes: number
  transit_to_dest_minutes: number
  total_rider_minutes: number
  full_transit_minutes?: number
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

const SEARCH_RADIUS_M = 1500         // radius around divergence point
const MAX_STATIONS = 5               // max results per nearby search
const MAX_SUGGESTIONS = 3            // top N suggestions returned
const MAX_CANDIDATES = 8             // cap station candidates before per-station API calls
const STATION_TYPES = [
  'transit_station',
  'subway_station',
  'train_station',
  'bus_station',
  'light_rail_station',
]

const VEHICLE_ICONS: Record<string, string> = {
  BUS: 'Bus',
  SUBWAY: 'Metro',
  RAIL: 'Rail',
  TRAM: 'Tram',
  FERRY: 'Ferry',
  CABLE_CAR: 'Cable',
  COMMUTER_TRAIN: 'Rail',
  HEAVY_RAIL: 'Rail',
  HIGH_SPEED_TRAIN: 'Rail',
  INTERCITY_BUS: 'Bus',
  METRO_RAIL: 'Metro',
  MONORAIL: 'Rail',
  SHARE_TAXI: 'Taxi',
  TROLLEYBUS: 'Bus',
}

// Average driving speed for duration estimation (km/h)
const AVG_DRIVING_SPEED_KMH = 50

// ── In-memory caches (10-min TTL) ─────────────────────────────────────────────

interface CacheEntry<T> { value: T; expiresAt: number }
const CACHE_TTL_MS = 10 * 60 * 1000

const routeCache = new Map<string, CacheEntry<{ polyline: string; durationMin: number; distanceKm: number }>>()
const nearbyCache = new Map<string, CacheEntry<Array<{ id: string; name: string; address: string; lat: number; lng: number }>>>()
const transitCache = new Map<string, CacheEntry<{ options: TransitOption[]; transitPolyline: string | null }>>()

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) { cache.delete(key); return undefined }
  return entry.value
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

function coordKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  return `${lat1.toFixed(4)},${lng1.toFixed(4)}->${lat2.toFixed(4)},${lng2.toFixed(4)}`
}

function nearbyKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`
}

// ── Major Transit Hubs (static — zero API calls) ─────────────────────────────

interface TransitHub {
  name: string
  lat: number
  lng: number
  placeId: string
  address: string
}

const MAJOR_TRANSIT_HUBS: TransitHub[] = [
  // BART — San Francisco / East Bay / Peninsula
  { name: 'Richmond BART', lat: 37.9369, lng: -122.3533, placeId: 'ChIJKxeF3glohYARiCclSd8QBXE', address: 'Richmond, CA' },
  { name: 'El Cerrito del Norte BART', lat: 37.9252, lng: -122.3170, placeId: 'ChIJzVQnLRRohYARNxV0jQOGkQg', address: 'El Cerrito, CA' },
  { name: 'Berkeley BART', lat: 37.8700, lng: -122.2683, placeId: 'ChIJl9HPogN-hYAR_zGaNeqfpuA', address: 'Berkeley, CA' },
  { name: 'MacArthur BART', lat: 37.8284, lng: -122.2671, placeId: 'ChIJCwfLNwp-hYARhG5CUYzTEO8', address: 'Oakland, CA' },
  { name: '12th St Oakland City Center BART', lat: 37.8033, lng: -122.2719, placeId: 'ChIJp5snqAR-hYARHCnNTQC3MBA', address: 'Oakland, CA' },
  { name: 'Embarcadero BART', lat: 37.7929, lng: -122.3970, placeId: 'ChIJ22_GgEuAhYARl5mBQ1fhKyk', address: 'San Francisco, CA' },
  { name: 'Montgomery St BART', lat: 37.7893, lng: -122.4018, placeId: 'ChIJW4yc0EeAhYAR0Kk3VNfCfQo', address: 'San Francisco, CA' },
  { name: 'Powell St BART', lat: 37.7844, lng: -122.4080, placeId: 'ChIJFbGUvkSAhYARurxMb5xYiBI', address: 'San Francisco, CA' },
  { name: 'Civic Center BART', lat: 37.7796, lng: -122.4141, placeId: 'ChIJkUGNvUSAhYARQN9Snq0BOTI', address: 'San Francisco, CA' },
  { name: '16th St Mission BART', lat: 37.7650, lng: -122.4197, placeId: 'ChIJN04JNUWAhYAR-Nh7rGPYGUY', address: 'San Francisco, CA' },
  { name: '24th St Mission BART', lat: 37.7522, lng: -122.4186, placeId: 'ChIJr0OYoD5-hYARy7qeAqOkk90', address: 'San Francisco, CA' },
  { name: 'Daly City BART', lat: 37.7062, lng: -122.4692, placeId: 'ChIJX1VuxmB0j4AR_gBXFGivapc', address: 'Daly City, CA' },
  { name: 'Millbrae BART/Caltrain', lat: 37.5999, lng: -122.3867, placeId: 'ChIJi3JFMRd0j4AR0IBMS_sEnbc', address: 'Millbrae, CA' },
  { name: 'Fremont BART', lat: 37.5574, lng: -122.0126, placeId: 'ChIJ66bAnUtLhYAR00ELM9HU_yE', address: 'Fremont, CA' },
  { name: 'Warm Springs BART', lat: 37.5024, lng: -121.9395, placeId: 'ChIJF4LfUVE5hYARnimPFnQGYBE', address: 'Fremont, CA' },
  { name: 'Pleasanton BART', lat: 37.7001, lng: -121.8990, placeId: 'ChIJr0K5SbDcj4ARU2dSJirnO50', address: 'Pleasanton, CA' },
  { name: 'Walnut Creek BART', lat: 37.9056, lng: -122.0671, placeId: 'ChIJm_5b6txRhYARj7Oap5rYBHE', address: 'Walnut Creek, CA' },
  { name: 'Concord BART', lat: 37.9737, lng: -122.0291, placeId: 'ChIJ-UBDQJJWhYAROaKjVCzHYNc', address: 'Concord, CA' },
  { name: 'Pittsburg/Bay Point BART', lat: 38.0189, lng: -121.9453, placeId: 'ChIJu0nLqH9ahYARy_vNmbU-DY4', address: 'Pittsburg, CA' },
  { name: 'SFO Airport BART', lat: 37.6161, lng: -122.3920, placeId: 'ChIJuxyJyHh0j4ARxYNaohkydM0', address: 'San Francisco, CA' },
  // Caltrain — Peninsula
  { name: 'San Francisco Caltrain', lat: 37.7764, lng: -122.3942, placeId: 'ChIJ_zM6LDSAhYAR-bOaInEG_sk', address: 'San Francisco, CA' },
  { name: 'Palo Alto Caltrain', lat: 37.4433, lng: -122.1647, placeId: 'ChIJKTeyzOywj4ARMz2hKvRZ1E4', address: 'Palo Alto, CA' },
  { name: 'San Jose Diridon Caltrain', lat: 37.3297, lng: -121.9020, placeId: 'ChIJq_zGJvPLj4AR0YiiKoQ2MbU', address: 'San Jose, CA' },
  // Amtrak Capitol Corridor — Davis to Bay Area
  { name: 'Davis Amtrak', lat: 38.5445, lng: -121.7405, placeId: 'ChIJnULaRpbNmoARjx_0PNHXAiA', address: 'Davis, CA' },
  { name: 'Sacramento Valley Amtrak', lat: 38.5853, lng: -121.5007, placeId: 'ChIJKQjTLBPRmoARi5nKxU4v6FE', address: 'Sacramento, CA' },
  { name: 'Emeryville Amtrak', lat: 37.8420, lng: -122.2926, placeId: 'ChIJhbGG3_5-hYAR_qScbzyH_Pc', address: 'Emeryville, CA' },
  { name: 'Martinez Amtrak', lat: 38.0185, lng: -122.1342, placeId: 'ChIJE4jMGH5ahYARWxN_FGT_nD4', address: 'Martinez, CA' },
  { name: 'Suisun-Fairfield Amtrak', lat: 38.2363, lng: -122.0402, placeId: 'ChIJ_4T8L9zOhIAR30NLlbFk_-Q', address: 'Suisun City, CA' },
  // Sacramento RT Light Rail
  { name: 'Sacramento Valley RT', lat: 38.5853, lng: -121.5007, placeId: 'ChIJKQjTLBPRmoARi5nKxU4v6FE', address: 'Sacramento, CA' },
  { name: '16th St / UCD Med Center RT', lat: 38.5647, lng: -121.4679, placeId: 'ChIJtxzwzpzTmoARH0-4GSIIVHM', address: 'Sacramento, CA' },
]

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
        icon: VEHICLE_ICONS[vehicleType] ?? 'Bus',
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
 * Results are cached for 10 minutes.
 */
export async function fetchDrivingRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  apiKey: string,
): Promise<{ polyline: string; durationMin: number; distanceKm: number } | null> {
  const key = coordKey(originLat, originLng, destLat, destLng)
  const cached = getCached(routeCache, key)
  if (cached) return cached

  const body = {
    origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
    destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
    travelMode: 'DRIVE',
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
  const result = {
    polyline: route.polyline.encodedPolyline,
    durationMin: durationSec / 60,
    distanceKm: (route.distanceMeters ?? 0) / 1000,
  }

  setCache(routeCache, key, result)
  return result
}

/**
 * Search for transit stations near a lat/lng using Google Places Nearby Search (New).
 * Results are cached for 10 minutes.
 */
async function searchNearbyStations(
  lat: number,
  lng: number,
  radiusM: number,
  apiKey: string,
): Promise<Array<{ id: string; name: string; address: string; lat: number; lng: number }>> {
  const key = nearbyKey(lat, lng)
  const cached = getCached(nearbyCache, key)
  if (cached) return cached

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

  const result = (data.places ?? [])
    .filter((p) => p.location?.latitude != null && p.location?.longitude != null)
    .map((p) => ({
      id: p.id,
      name: p.displayName?.text ?? 'Transit Station',
      address: p.formattedAddress ?? '',
      lat: p.location!.latitude,
      lng: p.location!.longitude,
    }))

  setCache(nearbyCache, key, result)
  return result
}

/**
 * Fetch transit directions from a station to the rider's destination.
 * Uses Google Directions API (Legacy) with mode=transit.
 * Results are cached for 10 minutes.
 */
async function fetchTransitFromStation(
  stationLat: number,
  stationLng: number,
  destLat: number,
  destLng: number,
  apiKey: string,
): Promise<{ options: TransitOption[]; transitPolyline: string | null }> {
  const key = coordKey(stationLat, stationLng, destLat, destLng)
  const cached = getCached(transitCache, key)
  if (cached) return cached

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
  const result = { options, transitPolyline }

  setCache(transitCache, key, result)
  return result
}

// ── Divergence-point algorithm (pure math — zero API calls) ───────────────────

/**
 * Find the point on the driver's route closest to the rider's destination.
 * This is the "divergence point" — after this, the driver moves away from
 * where the rider needs to go. The optimal transit dropoff is near here.
 *
 * Returns the divergence point and its index in the route array.
 */
function findDivergencePoint(
  routePoints: LatLng[],
  riderDestLat: number,
  riderDestLng: number,
): { point: LatLng; index: number; distanceM: number } {
  let minDist = Infinity
  let minIndex = 0

  for (let i = 0; i < routePoints.length; i++) {
    const d = haversineMetres(routePoints[i].lat, routePoints[i].lng, riderDestLat, riderDestLng)
    if (d < minDist) {
      minDist = d
      minIndex = i
    }
  }

  return {
    point: routePoints[minIndex],
    index: minIndex,
    distanceM: minDist,
  }
}

/**
 * Find major transit hubs that fall within maxDistanceM of the driver's route.
 * Pure math — zero API calls.
 *
 * Samples route every ~500m for efficiency on long routes.
 */
function findHubsAlongRoute(
  routePoints: LatLng[],
  maxDistanceM: number = 1000,
): Array<{ id: string; name: string; address: string; lat: number; lng: number }> {
  const matches: Array<{ id: string; name: string; address: string; lat: number; lng: number }> = []

  // Sample route points for efficiency (every ~500m ≈ every 5-10 polyline points)
  const step = Math.max(1, Math.floor(routePoints.length / 200))

  for (const hub of MAJOR_TRANSIT_HUBS) {
    let isNearRoute = false
    for (let i = 0; i < routePoints.length; i += step) {
      const d = haversineMetres(routePoints[i].lat, routePoints[i].lng, hub.lat, hub.lng)
      if (d <= maxDistanceM) {
        isNearRoute = true
        break
      }
    }
    if (isNearRoute) {
      matches.push({
        id: hub.placeId,
        name: hub.name,
        address: hub.address,
        lat: hub.lat,
        lng: hub.lng,
      })
    }
  }

  return matches
}

/**
 * Estimate driving duration from polyline total distance.
 * Used as fallback when we have the polyline but don't want to call Routes API again.
 */
function estimateDurationFromPolyline(routePoints: LatLng[]): number {
  let totalM = 0
  for (let i = 1; i < routePoints.length; i++) {
    totalM += haversineMetres(
      routePoints[i - 1].lat, routePoints[i - 1].lng,
      routePoints[i].lat, routePoints[i].lng,
    )
  }
  const totalKm = totalM / 1000
  return (totalKm / AVG_DRIVING_SPEED_KMH) * 60 // minutes
}

// ── Main Engine ───────────────────────────────────────────────────────────────

/**
 * Compute transit dropoff suggestions using the divergence-point algorithm.
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
  }

  // 2. Decode polyline
  const decoded = decodePolyline(polyline)
  if (decoded.length === 0) return { suggestions: [], polyline }

  // Estimate driver direct duration from polyline if we don't have it from API
  if (driverDirectDurationMin === 0) {
    driverDirectDurationMin = estimateDurationFromPolyline(decoded)
  }

  // 3. Find divergence point (pure math — zero API calls)
  const divergence = findDivergencePoint(decoded, riderDestLat, riderDestLng)

  // 4. Find major transit hubs along the route (pure math — zero API calls)
  const hubStations = findHubsAlongRoute(decoded)

  // 5. Search for stations near the divergence point (1-2 Nearby Search API calls)
  //    Also search slightly before divergence for better coverage
  const divergenceIdx = divergence.index
  const beforeDivergenceIdx = Math.max(0, Math.floor(divergenceIdx * 0.7))
  const beforePoint = decoded[beforeDivergenceIdx]

  const [nearbyAtDivergence, nearbyBefore, fullTransitMinutes] = await Promise.all([
    searchNearbyStations(divergence.point.lat, divergence.point.lng, SEARCH_RADIUS_M, apiKey),
    // Only search a second point if it's meaningfully different from divergence (>2km apart)
    haversineMetres(divergence.point.lat, divergence.point.lng, beforePoint.lat, beforePoint.lng) > 2000
      ? searchNearbyStations(beforePoint.lat, beforePoint.lng, SEARCH_RADIUS_M, apiKey)
      : Promise.resolve([]),
    // Fetch full transit baseline in parallel
    fetchTransitFromStation(driverLat, driverLng, riderDestLat, riderDestLng, apiKey)
      .then(({ options }) => options.length > 0 ? options[0].total_minutes : 0)
      .catch(() => 0),
  ])

  // 6. Merge hub stations + nearby results, deduplicate by place ID
  const uniqueStations = new Map<string, { id: string; name: string; address: string; lat: number; lng: number }>()

  for (const station of hubStations) {
    uniqueStations.set(station.id, station)
  }
  for (const station of [...nearbyAtDivergence, ...nearbyBefore]) {
    if (!uniqueStations.has(station.id)) {
      uniqueStations.set(station.id, station)
    }
  }

  if (uniqueStations.size === 0) return { suggestions: [], polyline }

  // 7. For each station candidate, fetch transit + detour
  const candidates: TransitDropoffSuggestion[] = []
  const pickupToDestM = haversineMetres(driverLat, driverLng, riderDestLat, riderDestLng)

  // Cap candidates to avoid excessive API calls
  const stationEntries = [...uniqueStations.values()]
    .filter((station) => {
      // Skip stations that don't get the rider closer to their destination
      const stationToDestM = haversineMetres(station.lat, station.lng, riderDestLat, riderDestLng)
      return pickupToDestM <= 0 || stationToDestM <= pickupToDestM * 0.95
    })
    .slice(0, MAX_CANDIDATES)

  // Process in parallel batches of 5 to avoid rate limits
  const BATCH_SIZE = 5
  for (let i = 0; i < stationEntries.length; i += BATCH_SIZE) {
    const batch = stationEntries.slice(i, i + BATCH_SIZE)

    const results = await Promise.all(
      batch.map(async (station) => {
        // Fetch transit from station to rider destination
        const { options: transitOptions, transitPolyline } = await fetchTransitFromStation(
          station.lat, station.lng,
          riderDestLat, riderDestLng,
          apiKey,
        )

        // Compute walk distance from nearest point on route to station
        const walkToStationM = haversineMetres(
          station.lat, station.lng,
          ...findClosestPointOnRoute(decoded, station.lat, station.lng),
        )
        const walkToStationMin = Math.round(walkToStationM / (1.4 * 60)) // 1.4 m/s walking

        // Estimate driver detour: drive to station vs direct route
        const detourRoute = await fetchDrivingRoute(
          driverLat, driverLng,
          station.lat, station.lng,
          apiKey,
        )
        const rideWithDriverMin = detourRoute
          ? Math.round(detourRoute.durationMin)
          : 0
        const detourMin = detourRoute
          ? Math.max(0, detourRoute.durationMin - driverDirectDurationMin)
          : 0

        const transitToDestMin = transitOptions.length > 0 ? transitOptions[0].total_minutes : 0

        // Compute rider progress: how much closer does this station get the rider?
        const stationToDestM = haversineMetres(station.lat, station.lng, riderDestLat, riderDestLng)
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
          ride_with_driver_minutes: rideWithDriverMin,
          ride_distance_km: detourRoute ? detourRoute.distanceKm : 0,
          walk_to_station_minutes: walkToStationMin,
          driver_detour_minutes: Math.round(detourMin),
          transit_to_dest_minutes: transitToDestMin,
          total_rider_minutes: rideWithDriverMin + walkToStationMin + transitToDestMin,
          full_transit_minutes: fullTransitMinutes > 0 ? fullTransitMinutes : undefined,
          rider_progress_pct: Math.round(progressRatio * 100),
          transit_polyline: transitPolyline,
        } satisfies TransitDropoffSuggestion
      }),
    )

    for (const r of results) {
      if (r) candidates.push(r)
    }
  }

  // 8. Score and sort — lower is better
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
