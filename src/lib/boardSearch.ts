/**
 * Client for `POST /api/schedule/board/search` — Tago's smart-match
 * Ride Board search. iOS shipped this in late May 2026; web is
 * adopting the same surface so a search on either platform produces
 * the same ranked results + transit-handoff suggestions.
 *
 * Endpoint contract is documented in `server/routes/schedule.ts`
 * (`scheduleRouter.post('/board/search', ...)`). Same response shape
 * as the iOS `BoardSearchResult` Swift struct.
 */

import { supabase } from '@/lib/supabase'
import type { ScheduledRide } from '@/components/schedule/boardTypes'

export type BoardSearchMatchType = 'direct' | 'transit_handoff' | 'endpoint'

/// One transit-leg option (rendered as e.g. "BART Yellow Line · 28 min").
/// Populated by the server's `computeTransitDropoffSuggestions` engine,
/// which queries Google Directions for real transit timings.
export interface BoardSearchTransitOption {
  type: string
  icon: string
  line_name: string
  departure_stop?: string
  arrival_stop?: string
  duration_minutes?: number
  walk_minutes: number
  total_minutes: number
}

/// Handoff details for `match_type === 'transit_handoff'` — null for
/// direct + endpoint matches.
export interface BoardSearchTransitHandoff {
  station_name: string
  station_place_id: string
  station_address: string
  station_lat: number
  station_lng: number
  walk_to_station_minutes: number
  transit_to_dest_minutes: number
  total_rider_minutes: number
  transit_option: BoardSearchTransitOption | null
}

/// A single result row. Inherits everything on `ScheduledRide` plus
/// the per-result match metadata the server tacks on.
export interface BoardSearchResult extends ScheduledRide {
  match_type?: BoardSearchMatchType
  corridor_origin_metres?: number | null
  corridor_dest_metres?: number | null
  transit_handoff?: BoardSearchTransitHandoff | null
  // origin_distance_metres / dest_distance_metres / etc. live on
  // ScheduledRide already as legacy fields.
}

export interface BoardSearchParams {
  originLat: number
  originLng: number
  destinationLat: number
  destinationLng: number
  /** YYYY-MM-DD in the user's local tz. */
  tripDate: string
  /** HH:MM:SS or null for Anytime. */
  tripTime: string | null
  /** 'driver' (default — rider searching for drivers) or 'rider' (driver searching for riders). */
  mode: 'driver' | 'rider'
}

export interface BoardSearchResponse {
  results: BoardSearchResult[]
}

/**
 * Send a smart-match query. Throws on transport error; returns the
 * raw response body on success.
 */
export async function runBoardSearch(params: BoardSearchParams): Promise<BoardSearchResponse> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch('/api/schedule/board/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      origin_lat: params.originLat,
      origin_lng: params.originLng,
      destination_lat: params.destinationLat,
      destination_lng: params.destinationLng,
      trip_date: params.tripDate,
      trip_time: params.tripTime,
      mode: params.mode,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`board/search ${res.status}: ${text.slice(0, 200)}`)
  }
  return await res.json() as BoardSearchResponse
}
