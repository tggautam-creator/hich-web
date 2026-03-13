/**
 * Google Directions helper — calls the server-side Routes API proxy.
 *
 * The deprecated google.maps.DirectionsService has been replaced with
 * a server endpoint (/api/directions) that uses the Google Routes API
 * (computeRoutes). This avoids CORS issues and deprecation warnings.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DirectionsResult {
  distance_km: number
  duration_min: number
  polyline: string  // encoded polyline for route rendering
  destLat: number
  destLng: number
}

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Fetch driving directions from a lat/lng origin to a place-ID destination.
 * Returns null if the request fails.
 */
export async function getDirections(
  originLat: number,
  originLng: number,
  destPlaceId: string,
): Promise<DirectionsResult | null> {
  try {
    const params = new URLSearchParams({
      originLat: String(originLat),
      originLng: String(originLng),
      destPlaceId,
    })

    const resp = await fetch(`/api/directions?${params.toString()}`)
    if (!resp.ok) return null

    const data = (await resp.json()) as DirectionsResult
    if (!data.distance_km || !data.duration_min) return null

    return data
  } catch {
    return null
  }
}

/**
 * Fetch driving directions from a lat/lng origin to a lat/lng destination.
 * Returns null if the request fails.
 */
export async function getDirectionsByLatLng(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<DirectionsResult | null> {
  try {
    const params = new URLSearchParams({
      originLat: String(originLat),
      originLng: String(originLng),
      destLat: String(destLat),
      destLng: String(destLng),
    })

    const resp = await fetch(`/api/directions?${params.toString()}`)
    if (!resp.ok) return null

    const data = (await resp.json()) as DirectionsResult
    if (!data.distance_km || !data.duration_min) return null

    return data
  } catch {
    return null
  }
}
