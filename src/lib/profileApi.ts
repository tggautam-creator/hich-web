/**
 * v1.3 Sprint 12 Slice 5a — `POST /api/users/me/profile` client.
 *
 * Replaces direct `supabase.from('users').{insert,update}` calls on
 * web. The server uses the service role to read-then-update-or-INSERT,
 * bypassing the RLS race that bit iOS on first-time profile creation
 * (Postgres 42501 "new row violates row-level security policy" when
 * the supabase-swift session JWT lagged the cached user.id).
 *
 * The same race exists on web for the CreateProfilePage INSERT after
 * signup — the auth session is brand new and the RLS policy compares
 * `auth.uid() = users.id`, but the supabase-js session may not have
 * propagated by the time the INSERT fires. Routing through the server
 * eliminates the race + concentrates field validation in one place.
 *
 * Mirrors iOS `UserProfileUpsertEndpoint.swift`. Body fields are all
 * optional; only the provided fields are touched on the existing row.
 * Unknown fields are silently dropped server-side.
 *
 * Server contract: server/routes/users.ts:229-401.
 */
import { supabase } from '@/lib/supabase'

export type Gender =
  | 'male'
  | 'female'
  | 'nonbinary'
  | 'other'
  | 'prefer_not_to_say'

export interface AccessibilityProfile {
  needs_wheelchair?: boolean
  // Future-extensible — the server passes the whole object through.
  [key: string]: unknown
}

export interface ProfileUpdate {
  full_name?: string
  phone?: string | null
  avatar_url?: string | null
  date_of_birth?: string | null // ISO YYYY-MM-DD or null
  gender?: Gender | null
  bio?: string | null
  school?: string | null
  major?: string | null
  graduation_year?: number | null
  has_accessibility_needs?: boolean
  accessibility_profile?: AccessibilityProfile | null
  waive_caregiver_fee?: boolean
}

export class ProfileApiError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'ProfileApiError'
    this.status = status
    this.code = code
  }
}

interface ServerSuccess {
  ok: boolean
  profile?: Record<string, unknown>
}

interface ServerError {
  error?: { code?: string; message?: string }
}

/**
 * Upsert the calling user's profile. Returns the canonical row on
 * success. Throws `ProfileApiError` with the server's error code on
 * failure so callers can branch (`INVALID_NAME` / `INVALID_DOB` /
 * `INVALID_GENDER` / `AUTH_LOOKUP_FAILED` / etc).
 *
 * `phone_verified` is intentionally NOT exposed — the auth flow owns
 * verification state. Callers that need to flip `phone_verified=false`
 * after a phone change should do that via the auth flow's gate, not
 * here (matches iOS — EditProfileSheet doesn't touch the field).
 */
export async function updateMyProfile(
  update: ProfileUpdate,
): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new ProfileApiError(401, 'NO_SESSION', 'Not signed in')
  }
  const resp = await fetch('/api/users/me/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(update),
  })
  const body = (await resp.json().catch(() => ({}))) as ServerSuccess & ServerError
  if (!resp.ok) {
    throw new ProfileApiError(
      resp.status,
      body.error?.code ?? null,
      body.error?.message ?? `HTTP ${resp.status}`,
    )
  }
  return (body.profile ?? {}) as Record<string, unknown>
}
