/**
 * Server-side polyline utilities.
 *
 * decodePolyline — decodes a Google encoded polyline string into lat/lng pairs.
 * samplePolyline — samples points along a decoded polyline at a given interval.
 * haversineMetres — haversine distance between two lat/lng points.
 */

export interface LatLng {
  lat: number
  lng: number
}

const EARTH_RADIUS_M = 6_371_000
const DEG_TO_RAD = Math.PI / 180

/**
 * Decode a Google encoded polyline string into lat/lng pairs.
 * Pure JS — no external dependencies.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    shift = 0
    result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}

/**
 * Haversine distance between two points in metres.
 */
export function haversineMetres(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const phi1 = lat1 * DEG_TO_RAD
  const phi2 = lat2 * DEG_TO_RAD
  const dPhi = (lat2 - lat1) * DEG_TO_RAD
  const dLam = (lng2 - lng1) * DEG_TO_RAD

  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Project a point onto the closest segment of a polyline and return both
 * the perpendicular distance (in metres) and the fractional position
 * along the entire polyline in [0, 1].
 *
 * Used by Phase C smart search to (a) decide whether a rider's
 * origin/destination is "on" a driver's route, and (b) determine the
 * order they appear along the route — the rider's destination must
 * come AFTER their origin or it's not a valid pickup→drop sequence.
 *
 * Algorithm: small-area equirectangular projection. Polylines for
 * carpool commutes are short enough (typically < 50 km) that the
 * cos(latRef) flattening is accurate to better than a metre. Avoids
 * full great-circle math for every segment which would be ~10× slower
 * with the same effective precision at this scale.
 */
export function projectPointOntoPolyline(
  point: LatLng,
  polyline: LatLng[],
): { distanceM: number; fractionAlong: number } {
  if (polyline.length === 0) {
    return { distanceM: Infinity, fractionAlong: 0 }
  }
  if (polyline.length === 1) {
    return {
      distanceM: haversineMetres(point.lat, point.lng, polyline[0].lat, polyline[0].lng),
      fractionAlong: 0,
    }
  }

  // Reference latitude for the equirectangular projection — pick the
  // midpoint of the bounding box so distortion is balanced across the
  // route. metresPerDegLng shrinks toward the poles by cos(lat).
  let latSum = 0
  for (const p of polyline) latSum += p.lat
  const latRef = latSum / polyline.length
  const metresPerDegLat = 111_320
  const metresPerDegLng = 111_320 * Math.cos(latRef * DEG_TO_RAD)

  // Precompute segment lengths so we can map "I'm 73% along this
  // segment" to "I'm 41% along the whole polyline".
  const segLengthsM: number[] = []
  let totalLengthM = 0
  for (let i = 1; i < polyline.length; i++) {
    const dx = (polyline[i].lng - polyline[i - 1].lng) * metresPerDegLng
    const dy = (polyline[i].lat - polyline[i - 1].lat) * metresPerDegLat
    const len = Math.sqrt(dx * dx + dy * dy)
    segLengthsM.push(len)
    totalLengthM += len
  }

  const px = point.lng * metresPerDegLng
  const py = point.lat * metresPerDegLat

  let bestDistance = Infinity
  let bestFraction = 0
  let cumulativeBeforeSeg = 0

  for (let i = 1; i < polyline.length; i++) {
    const ax = polyline[i - 1].lng * metresPerDegLng
    const ay = polyline[i - 1].lat * metresPerDegLat
    const bx = polyline[i].lng * metresPerDegLng
    const by = polyline[i].lat * metresPerDegLat

    const dx = bx - ax
    const dy = by - ay
    const segLenSq = dx * dx + dy * dy

    // Clamp the projection t to [0, 1] so we don't extrapolate past
    // either segment endpoint — equivalent to "closest point on the
    // segment, which might be one of the two corners."
    let t = 0
    if (segLenSq > 0) {
      t = ((px - ax) * dx + (py - ay) * dy) / segLenSq
      if (t < 0) t = 0
      else if (t > 1) t = 1
    }

    const projX = ax + t * dx
    const projY = ay + t * dy
    const ddx = px - projX
    const ddy = py - projY
    const distSq = ddx * ddx + ddy * ddy

    if (distSq < bestDistance * bestDistance) {
      bestDistance = Math.sqrt(distSq)
      const along = cumulativeBeforeSeg + t * (segLengthsM[i - 1] ?? 0)
      bestFraction = totalLengthM > 0 ? along / totalLengthM : 0
    }

    cumulativeBeforeSeg += segLengthsM[i - 1] ?? 0
  }

  return { distanceM: bestDistance, fractionAlong: bestFraction }
}

/**
 * Sample points along a decoded polyline at the given interval (metres).
 * Always includes the first and last point.
 */
export function samplePolyline(points: LatLng[], intervalM: number): LatLng[] {
  if (points.length === 0) return []
  if (points.length === 1) return [points[0]]

  const sampled: LatLng[] = [points[0]]
  let accumM = 0

  for (let i = 1; i < points.length; i++) {
    const segDist = haversineMetres(
      points[i - 1].lat, points[i - 1].lng,
      points[i].lat, points[i].lng,
    )
    accumM += segDist

    if (accumM >= intervalM) {
      sampled.push(points[i])
      accumM = 0
    }
  }

  // Always include last point
  const last = points[points.length - 1]
  const prevSampled = sampled[sampled.length - 1]
  if (last.lat !== prevSampled.lat || last.lng !== prevSampled.lng) {
    sampled.push(last)
  }

  return sampled
}
