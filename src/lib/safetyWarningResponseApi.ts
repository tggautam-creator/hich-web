/**
 * v1.3 Sprint 11 Slice 4b — POST /api/rides/:id/safety-warning-response.
 *
 * Mirrors iOS `SafetyWarningResponseEndpoint.swift` 1:1. The five
 * actions split into three server branches:
 *   - `rider_in_car` / `driver_in_car`  → 200 { ok, action, ride_ended:false }
 *                                          (server flips divergence_state='responded',
 *                                          broadcasts warning_responded)
 *   - `rider_left`   / `driver_left`    → 200 { ok, action, ride_ended:true,
 *                                                fare_cents }
 *                                          (server finalises the ride via
 *                                          `endRideForSafety`, broadcasts ride_ended +
 *                                          safety_ended)
 *   - `help_requested`                  → 200 { ok, action, ride_ended:false,
 *                                                share_token, share_expires_at,
 *                                                trusted_contacts:[] }
 *                                          (server mints a 4h location_shares token +
 *                                          returns the user's trusted contacts so the
 *                                          client can pre-fill SMS)
 *
 * Error mapping:
 *   - 403 NOT_PARTICIPANT — caller is neither rider nor driver
 *   - 403 WRONG_ROLE       — action prefix mismatches caller's role
 *   - 409 NO_ACTIVE_WARNING / NOT_ACTIVE — warning already responded
 *     (the OTHER party tapped first, or ride already ended). iOS
 *     treats both as silent dismiss — see
 *     `RideSafetyCheckOverlay.isStaleResponseTap` for the
 *     rationale. We surface the codes on `SafetyWarningResponseApiError.code`
 *     so the overlay can branch.
 */
import { supabase } from '@/lib/supabase'

export type SafetyWarningResponseAction =
  | 'rider_in_car'
  | 'driver_in_car'
  | 'rider_left'
  | 'driver_left'
  | 'help_requested'

export interface TrustedContactRef {
  id: string
  name: string
  phone: string
}

export interface SafetyWarningResponseResult {
  ok: boolean
  action: SafetyWarningResponseAction
  ride_ended: boolean
  fare_cents?: number | null
  share_token?: string | null
  share_expires_at?: string | null
  trusted_contacts?: TrustedContactRef[] | null
}

export type SafetyWarningResponseErrorCode =
  | 'NOT_PARTICIPANT'
  | 'WRONG_ROLE'
  | 'NO_ACTIVE_WARNING'
  | 'NOT_ACTIVE'
  | 'NOT_FOUND'
  | 'INVALID_ACTION'
  | 'UNAUTHENTICATED'
  | 'NETWORK'
  | 'UNKNOWN'

export class SafetyWarningResponseApiError extends Error {
  readonly code: SafetyWarningResponseErrorCode
  readonly status: number | null

  constructor(code: SafetyWarningResponseErrorCode, message: string, status: number | null) {
    super(message)
    this.code = code
    this.status = status
    this.name = 'SafetyWarningResponseApiError'
  }
}

/**
 * Pattern-match server stale-tap codes — iOS `isStaleResponseTap`
 * equivalent. When the other party flipped state to 'responded'
 * before this client's tap landed, we get one of these codes back
 * and the overlay treats it as a successful silent dismiss.
 */
export function isStaleResponseTap(err: unknown): boolean {
  return err instanceof SafetyWarningResponseApiError
    && err.status === 409
    && (err.code === 'NO_ACTIVE_WARNING' || err.code === 'NOT_ACTIVE')
}

export async function postSafetyWarningResponse(
  rideId: string,
  action: SafetyWarningResponseAction,
): Promise<SafetyWarningResponseResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new SafetyWarningResponseApiError('UNAUTHENTICATED', 'Not signed in', null)
  }

  let resp: Response
  try {
    resp = await fetch(`/api/rides/${encodeURIComponent(rideId)}/safety-warning-response`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action }),
    })
  } catch {
    throw new SafetyWarningResponseApiError('NETWORK', 'Network error', null)
  }

  if (!resp.ok) {
    let code: SafetyWarningResponseErrorCode = 'UNKNOWN'
    let message = `Request failed (${resp.status})`
    try {
      const body = (await resp.json()) as { error?: { code?: string; message?: string } }
      if (typeof body.error?.code === 'string') code = body.error.code as SafetyWarningResponseErrorCode
      if (typeof body.error?.message === 'string') message = body.error.message
    } catch {
      // fall through with default copy
    }
    throw new SafetyWarningResponseApiError(code, message, resp.status)
  }

  return (await resp.json()) as SafetyWarningResponseResult
}

/**
 * Verbatim against iOS `RideSafetyCheckOverlay.helpComposedBody(url:)`
 * — surfaced when the overlay opens an `sms:` deep-link / Web Share
 * sheet so the recipient sees the same message both platforms send.
 */
export function helpComposedBody(url: string): string {
  return `I'm using Tago and might need help. Live tracking link (expires in 4 hrs): ${url}`
}
