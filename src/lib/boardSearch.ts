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

/**
 * v1.2.1 S2.1 (2026-05-21) — added `reverse_transit_handoff` to the
 * union. iOS source: `BoardSearchEndpoint.swift::BoardSearchMatchType`
 * (line 103). Server emits this match type when the rider's pickup is
 * off-route but their destination IS on it — the rider takes transit
 * to a station along the driver's route, meets the driver there, and
 * continues to the destination together. Inverse of `transit_handoff`
 * (driver-drops-rider-then-rider-takes-transit). UI consumers must
 * branch on this case to render the "Meet via transit" badge + pre-fill
 * the rider's pickup (not destination) with the station coords.
 */
export type BoardSearchMatchType =
  | 'direct'
  | 'transit_handoff'
  | 'reverse_transit_handoff'
  | 'endpoint'

/**
 * Discriminator for which way the transit hand-off runs. Mirrors iOS
 * `BoardSearchTransitDirection` (BoardSearchEndpoint.swift:110-116).
 * Defaults to `'forward'` when the server response omits the field —
 * matches iOS's backward-compat decode at line 175/205.
 */
export type BoardSearchTransitDirection = 'forward' | 'reverse'

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

/// Handoff details for `match_type === 'transit_handoff'` or
/// `match_type === 'reverse_transit_handoff'` — null for direct + endpoint
/// matches.
///
/// Field semantics flip per `direction` (v1.2.1 S2.1):
///   • forward: `transit_to_dest_minutes` = transit FROM station TO
///     rider's destination (the last leg after the driver drops them).
///   • reverse: `transit_to_dest_minutes` = transit FROM rider's pickup
///     TO the station (the first leg before the driver picks them up).
/// `total_rider_minutes` is full trip time either way.
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
  /** Optional on the wire — older servers omit. Defaults to `'forward'`
   *  at the consumer per the iOS backward-compat pattern. */
  direction?: BoardSearchTransitDirection
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
