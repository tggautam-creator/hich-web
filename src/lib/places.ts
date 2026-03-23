/**
 * Google Places API helpers + recent-destinations localStorage cache.
 *
 * Uses the Google Places New API (v1) which supports CORS — no SDK needed.
 * API key is read from env.GOOGLE_PLACES_KEY (may be undefined in dev without a key).
 *
 * Recent destinations are stored in localStorage under RECENT_KEY,
 * capped at MAX_RECENT entries, deduplicated by placeId.
 */

import { env } from './env'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlaceSuggestion {
  placeId:       string
  mainText:      string   // e.g. "UC Davis Memorial Union"
  secondaryText: string   // e.g. "Davis, CA, USA"
  fullAddress:   string   // e.g. "UC Davis Memorial Union, Davis, CA, USA"
  lat?:          number   // pre-resolved latitude (skips geocode)
  lng?:          number   // pre-resolved longitude (skips geocode)
}

// Google Places New API (v1) — raw response shape
interface RawStructuredFormat {
  mainText:      { text: string }
  secondaryText: { text: string }
}

interface RawPlacePrediction {
  placeId:         string
  text:            { text: string }
  structuredFormat: RawStructuredFormat
}

interface RawSuggestion {
  placePrediction: RawPlacePrediction
}

interface PlacesApiResponse {
  suggestions?: RawSuggestion[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:autocomplete'
const RECENT_KEY      = 'hich:recent-destinations'
const MAX_RECENT      = 5

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Calls the Google Places New API autocomplete endpoint.
 * Returns an empty array if the API key is missing or the request fails.
 */
export async function searchPlaces(input: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
  const key = env.GOOGLE_PLACES_KEY
  if (!key || !input.trim()) return []

  try {
    const requestBody: Record<string, unknown> = { input }
    if (sessionToken) requestBody['sessionToken'] = sessionToken

    const response = await fetch(PLACES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-Goog-Api-Key': key,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) return []

    const data = await response.json() as PlacesApiResponse

    return (data.suggestions ?? []).map((s) => ({
      placeId:       s.placePrediction.placeId,
      mainText:      s.placePrediction.structuredFormat.mainText.text,
      secondaryText: s.placePrediction.structuredFormat.secondaryText.text,
      fullAddress:   s.placePrediction.text.text,
    }))
  } catch {
    return []
  }
}

// ── Place coordinates ─────────────────────────────────────────────────────────

interface PlaceDetailsResponse {
  location?: { latitude: number; longitude: number }
}

/**
 * Fetch lat/lng for a Google placeId via the Places New API (v1).
 * Returns null if the key is missing or the request fails.
 */
export async function getPlaceCoordinates(
  placeId: string,
  sessionToken?: string,
): Promise<{ lat: number; lng: number } | null> {
  const key = env.GOOGLE_PLACES_KEY
  if (!key || !placeId) return null

  try {
    let url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=location&key=${encodeURIComponent(key)}`
    if (sessionToken) url += `&sessionToken=${encodeURIComponent(sessionToken)}`

    const resp = await fetch(url)
    if (!resp.ok) return null
    const data = (await resp.json()) as PlaceDetailsResponse
    if (!data.location) return null
    return { lat: data.location.latitude, lng: data.location.longitude }
  } catch {
    return null
  }
}

/**
 * Geocode an address string to lat/lng using the Google Geocoding API.
 * Used as a fallback when we have an address but no valid placeId.
 */
export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const key = env.GOOGLE_PLACES_KEY
  if (!key || !address) return null

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`
    const resp = await fetch(url)
    if (!resp.ok) return null
    const data = (await resp.json()) as { results?: { geometry?: { location?: { lat: number; lng: number } } }[] }
    const loc = data.results?.[0]?.geometry?.location
    if (!loc) return null
    return { lat: loc.lat, lng: loc.lng }
  } catch {
    return null
  }
}

// ── Recent destinations ───────────────────────────────────────────────────────

/** Read up to MAX_RECENT recent destinations from localStorage. */
export function getRecentDestinations(): PlaceSuggestion[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as PlaceSuggestion[]) : []
  } catch {
    return []
  }
}

/**
 * Prepend a destination to the recent list.
 * Deduplicates by placeId and caps the list at MAX_RECENT.
 */
export function saveRecentDestination(place: PlaceSuggestion): void {
  const updated = [
    place,
    ...getRecentDestinations().filter((p) => p.placeId !== place.placeId),
  ].slice(0, MAX_RECENT)

  localStorage.setItem(RECENT_KEY, JSON.stringify(updated))
}
