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
