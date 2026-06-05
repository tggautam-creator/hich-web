/**
 * v1.3 Sprint 14 — Suggestions API client.
 *
 * Mirrors iOS `SuggestionEndpoints.swift` + server contract at
 * `server/routes/suggestions.ts`. Three endpoints:
 *   - GET  /api/suggestions/top?side=rider|driver — top 3 for home hero
 *   - GET  /api/suggestions/board?limit=20         — paginated list
 *   - POST /api/suggestions/:id/dismiss            — hide for viewer
 *
 * Types use snake_case server names (no camelCase remap layer) so the
 * response shape decodes verbatim — there's no schema drift risk on a
 * pure JSON pass-through path.
 */
import { supabase } from '@/lib/supabase'

export type SuggestionSide = 'rider' | 'driver'

export type SuggestionMatchClassification =
  | 'direct'
  | 'transit_dropoff'
  | 'transit_pickup'

export type SuggestionMatchType =
  | 'same_day_forward'
  | 'routine_recurring'
  | 'reverse_trip'

export interface SuggestionUser {
  id: string
  full_name: string | null
  avatar_url: string | null
  rating_avg: number | null
}

export interface SuggestionScheduleSource {
  id: string
  origin_address: string | null
  dest_address: string | null
  trip_time: string | null
  time_flexible?: boolean | null
}

export interface SuggestionRoutineSource {
  id: string
  route_name: string | null
  day_of_week: number[]
  departure_time: string | null
  arrival_time: string | null
  origin_address: string | null
  dest_address: string | null
  origin?: { type: 'Point'; coordinates: [number, number] } | null
  destination?: { type: 'Point'; coordinates: [number, number] } | null
  /** v1.3 — concrete `ride_schedules` row id for the suggestion's
   *  trip_date when the routine's daily projection exists. Used by
   *  the action buttons to open RideBoardConfirmSheet (which is
   *  schedule-id-oriented). Null when no projection exists. */
  projected_schedule_id: string | null
}

export interface SuggestionSource {
  schedule: SuggestionScheduleSource | null
  routine: SuggestionRoutineSource | null
}

export interface MatchSignals {
  classification: SuggestionMatchClassification
  bearing_diff_deg: number
  time_diff_min: number | null
  origin_distance_m: number
  dest_distance_m: number
  corridor_origin_m: number | null
  corridor_dest_m: number | null
  // Transit handoff fields — present when classification is transit_*
  handoff_total_minutes: number | null
  handoff_station_name: string | null
  handoff_station_address: string | null
  handoff_walk_minutes: number | null
  handoff_transit_minutes: number | null
  handoff_ride_minutes: number | null
  handoff_transit_line: string | null
  handoff_transit_type: string | null
}

export interface Suggestion {
  id: string
  trip_date: string // YYYY-MM-DD (LOCAL TZ — convert before display)
  match_type: SuggestionMatchType
  relevance_score: number
  match_signals: MatchSignals
  side: SuggestionSide // which side the VIEWER is on
  status: string // viewer-side status
  other_user: SuggestionUser | null
  rider_source: SuggestionSource | null
  driver_source: SuggestionSource | null
  created_at: string
}

interface ListResponse {
  results: Suggestion[]
}

export class SuggestionsApiError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'SuggestionsApiError'
    this.status = status
    this.code = code
  }
}

interface ServerError {
  error?: { code?: string; message?: string }
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new SuggestionsApiError(401, 'NO_SESSION', 'Not signed in')
  }
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${session.access_token}`,
    },
  })
}

/**
 * Top suggestions for the home-page hero. `side` filters to one role
 * (rider home → 'rider', driver home → 'driver'). Mirrors iOS
 * `GetSuggestionsTopEndpoint`.
 */
export async function fetchSuggestionsTop(
  side?: SuggestionSide,
): Promise<Suggestion[]> {
  const params = side ? `?side=${side}` : ''
  const resp = await authedFetch(`/api/suggestions/top${params}`)
  const body = (await resp.json().catch(() => ({}))) as Partial<ListResponse> & ServerError
  if (!resp.ok) {
    throw new SuggestionsApiError(
      resp.status,
      body.error?.code ?? null,
      body.error?.message ?? `HTTP ${resp.status}`,
    )
  }
  return body.results ?? []
}

/**
 * Paginated list for the Suggested tab on the ride board. Server
 * caps `limit` at 50. Mirrors iOS `GetSuggestionsBoardEndpoint`.
 */
export async function fetchSuggestionsBoard(limit = 20): Promise<Suggestion[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)))
  const resp = await authedFetch(`/api/suggestions/board?limit=${safeLimit}`)
  const body = (await resp.json().catch(() => ({}))) as Partial<ListResponse> & ServerError
  if (!resp.ok) {
    throw new SuggestionsApiError(
      resp.status,
      body.error?.code ?? null,
      body.error?.message ?? `HTTP ${resp.status}`,
    )
  }
  return body.results ?? []
}

/**
 * Flip the viewer-side status of a suggestion to 'dismissed'.
 * Idempotent. Independent of the other side — they still see it.
 */
export async function dismissSuggestion(suggestionId: string): Promise<void> {
  const resp = await authedFetch(
    `/api/suggestions/${encodeURIComponent(suggestionId)}/dismiss`,
    { method: 'POST' },
  )
  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as ServerError
    throw new SuggestionsApiError(
      resp.status,
      body.error?.code ?? null,
      body.error?.message ?? `HTTP ${resp.status}`,
    )
  }
}
