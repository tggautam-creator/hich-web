/**
 * v1.3 Sprint 12 Slice 5b — `GET /api/users/me/stats` fetch helper.
 *
 * Mirrors iOS `UserStatsEndpoint.swift` + the server handler at
 * `server/routes/users.ts:36`. Replaces the web's prior pattern of
 * counting `ridesCompleted = rides.length` over a 50-cap query
 * (under-counts users with >50 rides) and reading rating off the
 * cached `auth.profile` (stale until next refresh).
 *
 * Server returns:
 *   { rides_completed: int, rating_avg: number|null, rating_count: int }
 *
 * Server-side: a `head + exact` count against `rides` filtered to
 * `rider_id OR driver_id` of the caller + `status='completed'`, plus
 * the user's `rating_avg/count` from the canonical `users` row. Single
 * round-trip; matches the no-self-rides invariant so a ride can't
 * satisfy both sides of the OR.
 */
import { supabase } from '@/lib/supabase'

export interface MyStats {
  ridesCompleted: number
  ratingAvg: number | null
  ratingCount: number
}

export class UserStatsApiError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'UserStatsApiError'
    this.status = status
    this.code = code
  }
}

interface ServerSuccess {
  rides_completed: number
  rating_avg: number | null
  rating_count: number
}

interface ServerError {
  error?: { code?: string; message?: string }
}

export async function fetchMyStats(): Promise<MyStats> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new UserStatsApiError(401, 'NO_SESSION', 'Not signed in')
  }
  const resp = await fetch('/api/users/me/stats', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const body = (await resp.json().catch(() => ({}))) as ServerSuccess & ServerError
  if (!resp.ok) {
    throw new UserStatsApiError(
      resp.status,
      body.error?.code ?? null,
      body.error?.message ?? `HTTP ${resp.status}`,
    )
  }
  return {
    ridesCompleted: body.rides_completed ?? 0,
    ratingAvg: body.rating_avg ?? null,
    ratingCount: body.rating_count ?? 0,
  }
}
