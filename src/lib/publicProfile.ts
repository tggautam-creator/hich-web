/**
 * v1.3 Sprint 10 Slice 5 — typed client for
 * `GET /api/users/:id/public-profile`.
 *
 * Mirrors iOS `PublicProfileEndpoint` + `PublicProfile` /
 * `PublicVehicle` Decodable models. Used by the new
 * `UserProfilePreviewSheet` to fetch the full public profile in the
 * background when the sheet opens (poster avatar / driver avatar
 * taps seed the sheet from a snapshot, then this fetch fills in
 * bio / school / vehicle / member-since / rides_completed without
 * a spinner flash).
 *
 * Server contract verified at server/routes/users.ts:337-462.
 * Returns 200 with the documented shape, 404 on missing user, 400 on
 * malformed UUID. Endpoint is auth-required (any signed-in user can
 * read any other user's public-safe fields).
 */
import { supabase } from '@/lib/supabase'

// ── Response shape (matches server/routes/users.ts:439-457) ─────────────

export interface PublicVehicle {
  make: string | null
  model: string | null
  color: string | null
  year: number | null
  /** Plate redacted to last 4 chars server-side (Uber-style). */
  plate_last4: string | null
  wheelchair_capable: boolean
  trunk_size: string | null
}

export interface PublicProfile {
  id: string
  full_name: string | null
  avatar_url: string | null
  is_driver: boolean
  rating_avg: number | null
  rating_count: number
  rides_completed: number
  bio: string | null
  gender: string | null
  school: string | null
  major: string | null
  graduation_year: number | null
  has_accessibility_needs: boolean
  /** Computed: has_accessibility_needs && accessibility_profile.needs_wheelchair. */
  needs_wheelchair: boolean
  waive_caregiver_fee: boolean
  /** ISO 8601 timestamp (users.created_at). */
  member_since: string
  /** Non-null only when subject is a driver AND has an active vehicle row. */
  vehicle: PublicVehicle | null
}

// ── Errors ──────────────────────────────────────────────────────────────

export interface PublicProfileApiError {
  status: number
  code: string
  message: string
}

export class PublicProfileApiException extends Error {
  status: number
  code: string

  constructor({ status, code, message }: PublicProfileApiError) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'PublicProfileApiException'
  }
}

// ── Fetcher ─────────────────────────────────────────────────────────────

/**
 * Fetch the public-safe profile for `userId`. Returns the parsed
 * payload on 200; throws `PublicProfileApiException` on 4xx/5xx or
 * malformed responses (mirrors the iOS behavior — surface error in
 * the sheet's error state).
 */
export async function fetchPublicProfile(userId: string): Promise<PublicProfile> {
  const { data: sessionRes } = await supabase.auth.getSession()
  const token = sessionRes.session?.access_token
  if (!token) {
    throw new PublicProfileApiException({
      status: 0,
      code: 'NO_SESSION',
      message: 'No active session — sign in again.',
    })
  }

  const res = await fetch(`/api/users/${encodeURIComponent(userId)}/public-profile`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as
      | { error?: { code?: string; message?: string } }
      | undefined
    throw new PublicProfileApiException({
      status: res.status,
      code: body?.error?.code ?? 'UNKNOWN',
      message: body?.error?.message ?? `Server returned ${res.status}`,
    })
  }

  const parsed = (await res.json().catch(() => null)) as PublicProfile | null
  // Defensive shape check — same pattern as Slice 3's
  // `fetchShareDetails`. Server is well-typed but a rogue
  // intermediate response (proxy edge case, test fixture, etc.)
  // shouldn't crash the consumer.
  if (
    parsed == null ||
    typeof parsed !== 'object' ||
    typeof (parsed as PublicProfile).id !== 'string'
  ) {
    throw new PublicProfileApiException({
      status: 200,
      code: 'MALFORMED_RESPONSE',
      message: 'Profile response was malformed.',
    })
  }
  return parsed
}
