/**
 * Geographic utilities — bearing calculation + intercept point.
 */

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const EARTH_RADIUS_M = 6_371_000
const WALKING_SPEED_MS = 1.4   // metres per second
const MAX_WALK_SECONDS = 300   // 5 minutes

/**
 * Haversine distance between two points in metres.
 */
export function haversineMetres(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const φ1 = lat1 * DEG_TO_RAD
  const φ2 = lat2 * DEG_TO_RAD
  const Δφ = (lat2 - lat1) * DEG_TO_RAD
  const Δλ = (lng2 - lng1) * DEG_TO_RAD

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Calculate the initial (forward) bearing from point A to point B.
 * Returns a value in [0, 360) degrees clockwise from north.
 */
export function calculateBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const φ1 = lat1 * DEG_TO_RAD
  const φ2 = lat2 * DEG_TO_RAD
  const Δλ = (lng2 - lng1) * DEG_TO_RAD

  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)

  const θ = Math.atan2(y, x)
  return ((θ * RAD_TO_DEG) + 360) % 360
}

export interface InterceptResult {
  lat: number
  lng: number
  walkDistanceM: number
  walkTimeSeconds: number
  segmentIndex: number
}

/**
 * Given a decoded route polyline and a rider's location, return the nearest
 * point on the route that the rider can walk to in ≤ 5 minutes (1.4 m/s).
 *
 * Algorithm:
 *  1. For each segment of the polyline, project the rider onto the segment
 *     and compute the perpendicular distance.
 *  2. Pick the segment whose projection is closest.
 *  3. If the closest point exceeds max walk distance (5 min × 1.4 m/s = 420 m),
 *     return null — no reachable intercept.
 */
export function calculateInterceptPoint(
  routePoints: ReadonlyArray<{ lat: number; lng: number }>,
  riderLat: number,
  riderLng: number,
): InterceptResult | null {
  if (routePoints.length === 0) return null

  const maxWalkM = WALKING_SPEED_MS * MAX_WALK_SECONDS // 420 m

  let bestDist = Infinity
  let bestLat = 0
  let bestLng = 0
  let bestIdx = 0

  // Single point route — just check distance to that point
  if (routePoints.length === 1) {
    const d = haversineMetres(riderLat, riderLng, routePoints[0].lat, routePoints[0].lng)
    if (d > maxWalkM) return null
    return {
      lat: routePoints[0].lat,
      lng: routePoints[0].lng,
      walkDistanceM: d,
      walkTimeSeconds: d / WALKING_SPEED_MS,
      segmentIndex: 0,
    }
  }

  for (let i = 0; i < routePoints.length - 1; i++) {
    const a = routePoints[i]
    const b = routePoints[i + 1]

    // Project rider onto segment a→b using flat approximation
    // (accurate enough for short segments typical in route polylines)
    const cosLat = Math.cos(riderLat * DEG_TO_RAD)
    const ax = (a.lng - riderLng) * cosLat
    const ay = a.lat - riderLat
    const bx = (b.lng - riderLng) * cosLat
    const by = b.lat - riderLat

    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy

    let t: number
    if (lenSq === 0) {
      t = 0
    } else {
      t = Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / lenSq))
    }

    const projLat = a.lat + t * (b.lat - a.lat)
    const projLng = a.lng + t * (b.lng - a.lng)
    const d = haversineMetres(riderLat, riderLng, projLat, projLng)

    if (d < bestDist) {
      bestDist = d
      bestLat = projLat
      bestLng = projLng
      bestIdx = i
    }
  }

  if (bestDist > maxWalkM) return null

  return {
    lat: bestLat,
    lng: bestLng,
    walkDistanceM: bestDist,
    walkTimeSeconds: bestDist / WALKING_SPEED_MS,
    segmentIndex: bestIdx,
  }
}
