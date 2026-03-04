/**
 * Reverse geocoding via Nominatim (OpenStreetMap) — free, no API key.
 * Rate limit: 1 req/sec. Only call once per GPS session (first fix).
 */

interface NominatimResponse {
  display_name?: string
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=0`,
      { headers: { 'User-Agent': 'HICH-App/1.0' } },
    )
    if (!resp.ok) return 'Current Location'
    const data = (await resp.json()) as NominatimResponse
    const parts = data.display_name?.split(',') ?? []
    // Return first 2 comma-separated parts for brevity: "UC Davis, Davis"
    return parts.length >= 2
      ? `${parts[0].trim()}, ${parts[1].trim()}`
      : parts[0]?.trim() ?? 'Current Location'
  } catch {
    return 'Current Location'
  }
}
