/**
 * v1.3 Sprint 11 Slice 5 — gated "End ride without QR" secondary
 * button.
 *
 * CLAUDE.md hard rule (Phase 3.4, 2026-05-23): the rider-side
 * manual-end button MUST stay hidden until the ride has been active
 * for both >5 minutes AND >1 km of GPS distance. Without the gate,
 * a rider could end the ride 100m in and pay only the $5 minimum
 * (anti-fraud risk). The driver-side mirror has the same gate
 * (`DriverActiveRidePage.manualEndEligible:757-767` on iOS).
 *
 * This module owns:
 *   1. The two threshold constants (MIN_ELAPSED_SECONDS,
 *      MIN_DISTANCE_METRES) so the rider page, driver page, and
 *      the regression tests all read the same numbers.
 *   2. The `manualEndEligible(elapsed, gpsDistance)` predicate so
 *      the gate logic stays one source of truth.
 *   3. The `postManualEnd(rideId)` POST wrapper around
 *      `/api/rides/:id/safety-end` with body `{ reason: 'manual_end' }`.
 *      Server's safety-end handler (rides.ts:5598+) treats
 *      `reason='manual_end'` as `end_reason='manual_end'` and
 *      finalises via the normal `endRideForSafety` path, which
 *      broadcasts `ride_ended` — the active-ride pages already
 *      subscribe to that and navigate to RideSummary.
 *
 * The pages never write to the rides row directly — every
 * mutation flows through the server route so the
 * `ride_audit_log` trigger captures the actor.
 */
import { supabase } from '@/lib/supabase'

/** Mirrors iOS `DriverActiveRidePage.manualEndMinElapsedSeconds`. */
export const MIN_ELAPSED_SECONDS = 300

/** Mirrors iOS `DriverActiveRidePage.manualEndMinDistanceMetres`. */
export const MIN_DISTANCE_METRES = 1000

/**
 * Mirrors iOS `DriverActiveRidePage.manualEndEligible:764-767`. Both
 * thresholds must clear — meeting only one is not enough. Treats
 * any null/undefined / NaN input as "not eligible" so an in-flight
 * GPS ping doesn't accidentally flip the gate on for a 0-distance
 * ride.
 */
export function manualEndEligible(
  elapsedSeconds: number | null | undefined,
  gpsDistanceMetres: number | null | undefined,
): boolean {
  const elapsed = typeof elapsedSeconds === 'number' && Number.isFinite(elapsedSeconds)
    ? elapsedSeconds : 0
  const distance = typeof gpsDistanceMetres === 'number' && Number.isFinite(gpsDistanceMetres)
    ? gpsDistanceMetres : 0
  return elapsed >= MIN_ELAPSED_SECONDS && distance >= MIN_DISTANCE_METRES
}

export type ManualEndErrorCode =
  | 'NOT_PARTICIPANT'
  | 'NOT_ACTIVE'
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'NETWORK'
  | 'UNKNOWN'

export class ManualEndApiError extends Error {
  readonly code: ManualEndErrorCode
  readonly status: number | null

  constructor(code: ManualEndErrorCode, message: string, status: number | null) {
    super(message)
    this.code = code
    this.status = status
    this.name = 'ManualEndApiError'
  }
}

export interface ManualEndResult {
  ok: boolean
  ride_ended: boolean
  fare_cents: number | null
  end_reason: string
}

export async function postManualEnd(rideId: string): Promise<ManualEndResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new ManualEndApiError('UNAUTHENTICATED', 'Not signed in', null)
  }
  let resp: Response
  try {
    resp = await fetch(`/api/rides/${encodeURIComponent(rideId)}/safety-end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ reason: 'manual_end' }),
    })
  } catch {
    throw new ManualEndApiError('NETWORK', 'Network error', null)
  }
  if (!resp.ok) {
    let code: ManualEndErrorCode = 'UNKNOWN'
    let message = `Request failed (${resp.status})`
    try {
      const body = (await resp.json()) as { error?: { code?: string; message?: string } }
      if (typeof body.error?.code === 'string') code = body.error.code as ManualEndErrorCode
      if (typeof body.error?.message === 'string') message = body.error.message
    } catch {
      // fall through with default copy
    }
    throw new ManualEndApiError(code, message, resp.status)
  }
  const body = (await resp.json()) as Partial<ManualEndResult>
  return {
    ok: body.ok ?? true,
    ride_ended: body.ride_ended ?? true,
    fare_cents: typeof body.fare_cents === 'number' ? body.fare_cents : null,
    end_reason: typeof body.end_reason === 'string' ? body.end_reason : 'manual_end',
  }
}
