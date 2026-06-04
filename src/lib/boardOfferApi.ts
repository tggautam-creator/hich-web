/**
 * v1.3 Sprint 12 Slice 6 — `POST /api/schedule/board/offers` client.
 *
 * Driver-side "make an offer on a rider's board post" creator. Mirrors
 * iOS `CreateBoardOfferEndpoint.swift`. The two-phase ride/offer split
 * means this endpoint does NOT create a `rides` row — it just stages a
 * `ride_offers` row attached to the schedule. The rider sees the offer
 * on `BoardOfferAcceptPage`, picks one, and only THEN does the `rides`
 * row land (server-side, on `/board/offers/:id/accept`).
 *
 * Server contract: server/routes/schedule.ts:4532-4886.
 *
 * Only `schedule_id` is required. Every `proposed_*` field is optional;
 * the server falls back to the schedule's posted origin / destination
 * and a system-fare estimate when the driver hasn't proposed alternates
 * (the typical "tap Offer to drive" flow).
 */
import { supabase } from '@/lib/supabase'

export interface CreateBoardOfferBody {
  schedule_id: string
  vehicle_id?: string
  proposed_pickup_lat?: number
  proposed_pickup_lng?: number
  proposed_pickup_name?: string
  proposed_dropoff_lat?: number
  proposed_dropoff_lng?: number
  proposed_dropoff_name?: string
  proposed_fare_cents?: number
  proposed_eta_minutes?: number
  proposed_transit_line_name?: string
  proposed_transit_walk_minutes?: number
  proposed_transit_to_dest_minutes?: number
  proposed_transit_total_minutes?: number
}

export interface CreateBoardOfferResult {
  offer_id: string
  status: string
  created_at: string
}

export class BoardOfferApiError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'BoardOfferApiError'
    this.status = status
    this.code = code
  }
}

interface ServerError {
  error?: { code?: string; message?: string }
}

export async function createBoardOffer(
  body: CreateBoardOfferBody,
): Promise<CreateBoardOfferResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new BoardOfferApiError(401, 'NO_SESSION', 'Not signed in')
  }
  const resp = await fetch('/api/schedule/board/offers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })
  const responseBody = (await resp.json().catch(() => ({}))) as
    Partial<CreateBoardOfferResult> & ServerError
  if (!resp.ok) {
    throw new BoardOfferApiError(
      resp.status,
      responseBody.error?.code ?? null,
      responseBody.error?.message ?? `HTTP ${resp.status}`,
    )
  }
  if (!responseBody.offer_id || !responseBody.status || !responseBody.created_at) {
    throw new BoardOfferApiError(
      500,
      'INVALID_RESPONSE',
      'Server returned an incomplete offer response',
    )
  }
  return {
    offer_id: responseBody.offer_id,
    status: responseBody.status,
    created_at: responseBody.created_at,
  }
}
