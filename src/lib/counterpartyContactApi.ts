/**
 * v1.3 Sprint 12 Slice 3 — `GET /api/rides/:rideId/counterparty-contact`
 * fetch helper. Mirrors iOS `CounterpartyContactEndpoint.swift`
 * and the server handler at `server/routes/rides.ts:6993`.
 *
 * Server gates by:
 *   - JWT-authenticated caller
 *   - Caller is the ride's rider_id or driver_id
 *   - Ride status ∈ {accepted, coordinating, active}
 *
 * Outside that window: 403 OUTSIDE_WINDOW (privacy — no phone leak
 * after ride ends). Caller is the ride's party but the counterparty
 * never set a phone: 200 { phone: null }. Caller isn't a party: 403
 * FORBIDDEN.
 *
 * The hook in `useCounterpartyContact` treats any non-200 as
 * "hide the button" — `absent ≠ broken; absent means 'not in scope'`
 * matches the iOS pattern.
 */
import { supabase } from '@/lib/supabase'

export interface CounterpartyContact {
  phone: string | null
  fullName: string | null
}

export class CounterpartyContactApiError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'CounterpartyContactApiError'
    this.status = status
    this.code = code
  }
}

interface ServerResponse {
  phone?: string | null
  full_name?: string | null
  error?: { code?: string; message?: string }
}

export async function fetchCounterpartyContact(rideId: string): Promise<CounterpartyContact> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new CounterpartyContactApiError(401, 'NO_SESSION', 'Not signed in')
  }
  const resp = await fetch(
    `/api/rides/${encodeURIComponent(rideId)}/counterparty-contact`,
    { headers: { Authorization: `Bearer ${session.access_token}` } },
  )
  const body = (await resp.json().catch(() => ({}))) as ServerResponse
  if (!resp.ok) {
    throw new CounterpartyContactApiError(
      resp.status,
      body.error?.code ?? null,
      body.error?.message ?? `HTTP ${resp.status}`,
    )
  }
  return {
    phone: body.phone ?? null,
    fullName: body.full_name ?? null,
  }
}
