/**
 * Reverse geocoding via Google Geocoding API.
 * Only call once per GPS session (first fix).
 */

import { env } from '@/lib/env'

interface GeoResult {
  formatted_address?: string
}

interface GeocodeResponse {
  results?: GeoResult[]
  status?: string
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = env.GOOGLE_MAPS_KEY ?? env.GOOGLE_PLACES_KEY
  if (!key) return 'Current Location'

  try {
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(key)}`,
    )
    if (!resp.ok) return 'Current Location'
    const data = (await resp.json()) as GeocodeResponse
    if (data.status !== 'OK' || !data.results?.length) return 'Current Location'
    const parts = data.results[0].formatted_address?.split(',') ?? []
    // Return first 2 comma-separated parts for brevity: "UC Davis, Davis"
    return parts.length >= 2
      ? `${parts[0].trim()}, ${parts[1].trim()}`
      : parts[0]?.trim() ?? 'Current Location'
  } catch {
    return 'Current Location'
  }
}
