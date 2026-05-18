/**
 * localStorage-backed recent ride-board searches. Powers the "Recent
 * searches" section on `RideBoardHome.tsx` so a rider can re-run a
 * frequent query (Davis → SFO this Friday) with one tap instead of
 * retyping the form. Mirrors the iOS `RideBoardRecentSearchStore`
 * UserDefaults pattern.
 *
 * Stored as a small JSON array (≤ 5 entries, deduped by route +
 * date) under a versioned key so a future shape change doesn't
 * trip on stale rows.
 */

import type { PlaceSuggestion } from '@/lib/places'

const KEY = 'tago:recent-board-searches.v1'
const LIMIT = 5

export interface RecentBoardSearch {
  id: string
  fromPlaceId: string
  fromMainText: string
  fromFullAddress: string
  fromLat: number
  fromLng: number
  toPlaceId: string
  toMainText: string
  toFullAddress: string
  toLat: number
  toLng: number
  /** `YYYY-MM-DD` in the user's local tz. Matches `/board/search`'s `trip_date`. */
  tripDate: string
  /** `HH:MM:SS` or null when the user kept the Anytime toggle on. */
  tripTime: string | null
  /** 'driver' (rider searching for drivers) | 'rider' (driver searching for riders). */
  mode: 'driver' | 'rider'
  savedAt: number
}

export function getRecentBoardSearches(): RecentBoardSearch[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecentBoardSearch[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveRecentBoardSearch(entry: Omit<RecentBoardSearch, 'id' | 'savedAt'>): void {
  if (typeof localStorage === 'undefined') return
  try {
    const existing = getRecentBoardSearches()
    // Dedupe by (mode, from, to, date) so re-running an existing
    // query refreshes its position rather than piling up.
    const filtered = existing.filter(
      (e) => !(
        e.mode === entry.mode
        && e.fromPlaceId === entry.fromPlaceId
        && e.toPlaceId === entry.toPlaceId
        && e.tripDate === entry.tripDate
      ),
    )
    const next: RecentBoardSearch[] = [
      { ...entry, id: crypto.randomUUID(), savedAt: Date.now() },
      ...filtered,
    ].slice(0, LIMIT)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // localStorage full / disabled — non-fatal.
  }
}

export function clearRecentBoardSearches(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

/** Rebuild a `PlaceSuggestion`-shaped object from a recent entry —
 * used when replaying a saved search so the search inputs render
 * the selected pill without a fresh autocomplete round-trip. */
export function fromRecentToSuggestion(
  entry: RecentBoardSearch,
  side: 'from' | 'to',
): PlaceSuggestion {
  if (side === 'from') {
    return {
      placeId: entry.fromPlaceId,
      mainText: entry.fromMainText,
      secondaryText: stripMain(entry.fromFullAddress, entry.fromMainText),
      fullAddress: entry.fromFullAddress,
      lat: entry.fromLat,
      lng: entry.fromLng,
    }
  }
  return {
    placeId: entry.toPlaceId,
    mainText: entry.toMainText,
    secondaryText: stripMain(entry.toFullAddress, entry.toMainText),
    fullAddress: entry.toFullAddress,
    lat: entry.toLat,
    lng: entry.toLng,
  }
}

function stripMain(full: string, main: string): string {
  return full.startsWith(`${main}, `) ? full.slice(main.length + 2) : full
}
