/**
 * Sprint 9 Slice 2/3/5 — typed client + React Query hook for
 * `GET /api/rides/:rideId/share-details`.
 *
 * Returns the canonical multi-rider trip settlement payload (trip +
 * segments + co-riders + per-rider shares) for any ride that has a
 * `trip_id`. Supports both active and completed phases — during the
 * active phase `shares[]` may be partial/empty and `segments[]` may
 * include an open segment with `ended_at = null`.
 *
 * The hook is shared across Slice 3 (rider "Your share" card),
 * Slice 4 (driver "Trip earnings" card), and Slice 5 (MultiRiderSubtitle
 * pill + DriverMultiSummaryFlow). It accepts an `enabled` option so
 * Slice 5 can gate by ride phase without forking the implementation.
 *
 * 404 semantics: when the underlying ride has `trip_id IS NULL` (pre-097
 * backfill miss path), this client returns `null` from the hook's
 * `data` rather than throwing — UI consumers (Slice 3/4/5 cards)
 * silently hide instead of surfacing a thrown error in console.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ── Response shape (matches server/routes/rides.ts share-details handler) ────

export interface ShareDetailsTrip {
  id: string
  kind: 'instant' | 'board'
  started_at: string | null
  ended_at: string | null
  gps_distance_metres: number
  gas_cost_cents: number
  time_cost_cents: number
}

export interface ShareDetailsSegment {
  segment_index: number
  started_at: string
  ended_at: string | null
  distance_meters: number
  active_rider_ids: string[]
  gas_cost_cents: number
  time_cost_cents: number
}

export interface ShareDetailsCoRider {
  rider_id: string
  /** Per-rider rideId — surfaced so the driver "Trip earnings" card can
   *  deep-link each per-rider row to that rider's /ride/summary/:id view
   *  (Sprint 9 Slice 4). */
  ride_id: string
  full_name: string | null
  avatar_url: string | null
  destination_name: string | null
}

export interface ShareDetailsRiderShare {
  rider_id: string
  base_share_cents: number
  caregiver_share_cents: number
  companion_share_cents: number
  total_cents: number
  segments_in_count: number
  payment_status: 'pending' | 'paid' | 'processing' | 'failed'
}

export interface ShareDetails {
  trip: ShareDetailsTrip
  segments: ShareDetailsSegment[]
  co_riders: ShareDetailsCoRider[]
  shares: ShareDetailsRiderShare[]
}

// ── Errors ───────────────────────────────────────────────────────────────────

export interface ShareDetailsApiError {
  status: number
  code: string
  message: string
}

export class ShareDetailsApiException extends Error {
  status: number
  code: string

  constructor({ status, code, message }: ShareDetailsApiError) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'ShareDetailsApiException'
  }
}

// ── Fetcher ──────────────────────────────────────────────────────────────────

/**
 * Fetch the share-details payload for a ride. Returns `null` (NOT throw)
 * on 404 so consumers can silently hide the card for pre-097 backfilled
 * rides without polluting the console with an error.
 */
export async function fetchShareDetails(rideId: string): Promise<ShareDetails | null> {
  const { data: sessionRes } = await supabase.auth.getSession()
  const token = sessionRes.session?.access_token
  if (!token) {
    throw new ShareDetailsApiException({
      status: 0,
      code: 'NO_SESSION',
      message: 'No active session — sign in again.',
    })
  }

  const res = await fetch(`/api/rides/${encodeURIComponent(rideId)}/share-details`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  // Graceful 404 — pre-097 backfilled rides have ride.trip_id IS NULL
  // and the endpoint correctly returns 404 TRIP_NOT_FOUND. We swallow
  // it so the card hides without a thrown error.
  if (res.status === 404) {
    return null
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as
      | { error?: { code?: string; message?: string } }
      | undefined
    throw new ShareDetailsApiException({
      status: res.status,
      code: body?.error?.code ?? 'UNKNOWN',
      message: body?.error?.message ?? `Server returned ${res.status}`,
    })
  }

  const parsed = (await res.json().catch(() => null)) as ShareDetails | null
  // Defensive shape check — a malformed response (e.g. test fixtures
  // that fall through to a generic-success mock returning the wrong
  // body) gets silently coerced to null so the consumer hides the
  // card instead of crashing on `data.shares.find(...)`. Production
  // responses from server/routes/rides.ts always include all 4 keys.
  if (
    parsed == null ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as ShareDetails).shares) ||
    !Array.isArray((parsed as ShareDetails).segments) ||
    !Array.isArray((parsed as ShareDetails).co_riders) ||
    (parsed as ShareDetails).trip == null
  ) {
    return null
  }
  return parsed
}

// ── React Query hook ─────────────────────────────────────────────────────────

const FIVE_MIN_MS = 5 * 60 * 1000

function shareDetailsKey(rideId: string | null | undefined) {
  return ['share-details', rideId ?? 'none'] as const
}

interface UseShareDetailsOptions {
  /**
   * Gate the query. When false, the hook returns `data: undefined` and
   * does not fire the request. Slice 5 sets this to `ride.status in
   * ['coordinating', 'active']` so the MultiRiderSubtitle pill only
   * polls during the live phase; Slice 3/4 leave it as `true` since
   * the post-ride summary is already a one-shot read.
   */
  enabled?: boolean
}

/**
 * Read `/api/rides/:rideId/share-details` with cache + error handling.
 * `data` is `null` when the ride has no trip yet (404 path),
 * `undefined` while loading or while disabled, or the full payload
 * once fetched. Consumers should treat `null` as a silent-hide signal.
 */
export function useShareDetails(
  rideId: string | null | undefined,
  options: UseShareDetailsOptions = {},
) {
  const enabled =
    (options.enabled ?? true) && typeof rideId === 'string' && rideId.length > 0
  return useQuery<ShareDetails | null, ShareDetailsApiException>({
    queryKey: shareDetailsKey(rideId),
    queryFn: () => fetchShareDetails(rideId as string),
    enabled,
    staleTime: FIVE_MIN_MS,
  })
}
