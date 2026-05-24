/**
 * v1.2 F17 — Segment lifecycle + per-rider settlement.
 *
 * A *segment* is a continuous stretch during which the set of riders
 * physically in the car does not change. Segments are bounded by QR
 * scans:
 *   • Rider scans /start → close current segment, open new one with
 *     rider added to active_rider_ids.
 *   • Rider scans /end → close current segment, open new one with
 *     rider removed (if others remain) OR no new segment (last rider).
 *
 * Cost per segment:
 *   gas_cost_cents  = round((distance_m / 1609.34 / mpg) × gas$/gal × 100)
 *   time_cost_cents = round(duration_seconds × (PER_MIN_CENTS / 60))
 *   segment_cost    = gas_cost_cents + time_cost_cents
 *   per_rider_share = round(segment_cost / max(1, |active_rider_ids|))
 *
 * Per-rider total at THIS rider's dropoff scan:
 *   base_share     = Σ over segments-they-were-in of per_rider_share
 *   total_cents    = max(MIN_FARE_CENTS, base_share)
 *                  + caregiver_share + companion_share
 *
 * Settlement plumbing reuses chargeRideViaWallet + creditDriverEarning
 * which are already idempotent on (riderId, rideId) — multi-rider trips
 * naturally produce unique keys because each rider has their own rides
 * row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from './supabaseAdmin.ts'

// Fare constants — duplicated from rides.ts so this module stays free
// of route-handler imports. Future F15 will pull these from the
// pricing_config table; today they're hardcoded to match rides.ts.
const KM_TO_MILES = 0.621371
const MIN_FARE_CENTS = 500
const PER_MIN_CENTS = 5
const DEFAULT_MPG = 25

export interface SegmentRow {
  id: string
  trip_id: string
  segment_index: number
  started_at: string
  ended_at: string | null
  distance_meters: number
  duration_seconds: number
  active_rider_ids: string[]
  gas_cost_cents: number
  time_cost_cents: number
}

export interface RiderShareTotals {
  base_share_cents: number
  caregiver_share_cents: number
  companion_share_cents: number
  total_cents: number
  segments_in_count: number
}

// ── Open / close segments ──────────────────────────────────────────────

/**
 * Find the open (ended_at IS NULL) segment for a trip, if any.
 */
export async function findOpenSegment(
  tripId: string,
  client: SupabaseClient = supabaseAdmin,
): Promise<SegmentRow | null> {
  const { data, error } = await client
    .from('ride_segments')
    .select('id, trip_id, segment_index, started_at, ended_at, distance_meters, duration_seconds, active_rider_ids, gas_cost_cents, time_cost_cents')
    .eq('trip_id', tripId)
    .is('ended_at', null)
    .order('segment_index', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error ?? !data) return null
  return data as unknown as SegmentRow
}

/**
 * Insert a new segment row. Caller is responsible for closing any
 * prior open segment first. segment_index is one past the highest
 * existing for this trip.
 */
export async function openSegment(
  tripId: string,
  activeRiderIds: string[],
  startedAtIso: string,
  client: SupabaseClient = supabaseAdmin,
): Promise<{ segment: SegmentRow | null; error?: string }> {
  // Find current max segment_index for this trip.
  const { data: prior } = await client
    .from('ride_segments')
    .select('segment_index')
    .eq('trip_id', tripId)
    .order('segment_index', { ascending: false })
    .limit(1)

  const nextIndex = prior && prior.length > 0
    ? ((prior[0] as { segment_index: number }).segment_index + 1)
    : 0

  const { data, error } = await client
    .from('ride_segments')
    .insert({
      trip_id: tripId,
      segment_index: nextIndex,
      started_at: startedAtIso,
      active_rider_ids: activeRiderIds,
    })
    .select('id, trip_id, segment_index, started_at, ended_at, distance_meters, duration_seconds, active_rider_ids, gas_cost_cents, time_cost_cents')
    .single()

  if (error ?? !data) return { segment: null, error: error?.message ?? 'failed to open segment' }
  return { segment: data as unknown as SegmentRow }
}

/**
 * Close a segment: set ended_at, compute duration_seconds, recompute
 * gas_cost_cents + time_cost_cents from distance + duration + gas price.
 * Distance is whatever has already accumulated on the row via
 * recordSegmentDistanceDelta (called from gps-ping).
 */
export async function closeSegment(
  segmentId: string,
  endedAtIso: string,
  gasPricePerGallon: number,
  client: SupabaseClient = supabaseAdmin,
): Promise<{ segment: SegmentRow | null; error?: string }> {
  // Read current row to compute duration + cost.
  const { data: cur, error: fetchErr } = await client
    .from('ride_segments')
    .select('id, trip_id, segment_index, started_at, ended_at, distance_meters, duration_seconds, active_rider_ids, gas_cost_cents, time_cost_cents')
    .eq('id', segmentId)
    .single()

  if (fetchErr ?? !cur) return { segment: null, error: fetchErr?.message ?? 'segment not found' }

  const row = cur as unknown as SegmentRow
  if (row.ended_at) {
    return { segment: row }
  }

  const startMs = new Date(row.started_at).getTime()
  const endMs = new Date(endedAtIso).getTime()
  const durationSec = Math.max(0, Math.round((endMs - startMs) / 1000))

  const distanceMiles = (row.distance_meters / 1000) * KM_TO_MILES
  const gallonsUsed = distanceMiles / DEFAULT_MPG
  const gasCostCents = Math.round(gallonsUsed * gasPricePerGallon * 100)
  const durationMin = durationSec / 60
  const timeCostCents = Math.round(durationMin * PER_MIN_CENTS)

  const { data, error } = await client
    .from('ride_segments')
    .update({
      ended_at: endedAtIso,
      duration_seconds: durationSec,
      gas_cost_cents: gasCostCents,
      time_cost_cents: timeCostCents,
    })
    .eq('id', segmentId)
    .select('id, trip_id, segment_index, started_at, ended_at, distance_meters, duration_seconds, active_rider_ids, gas_cost_cents, time_cost_cents')
    .single()

  if (error ?? !data) return { segment: null, error: error?.message ?? 'failed to close segment' }
  return { segment: data as unknown as SegmentRow }
}

/**
 * Add `metres` to the currently-open segment of `tripId`. Called from
 * the gps-ping handler each time a driver moves. Idempotent on small
 * jitter (caller passes a clamped delta from rides.ts gps-ping logic).
 * If no segment is open (e.g. trip not yet started, or this is the
 * gap between segments during a rider scan), the delta is silently
 * dropped — fine, since gaps are sub-second.
 */
export async function recordSegmentDistanceDelta(
  tripId: string,
  metres: number,
  client: SupabaseClient = supabaseAdmin,
): Promise<{ success: boolean; error?: string }> {
  if (metres <= 0) return { success: true }

  const open = await findOpenSegment(tripId, client)
  if (!open) return { success: true }

  const { error } = await client
    .from('ride_segments')
    .update({ distance_meters: open.distance_meters + Math.round(metres) })
    .eq('id', open.id)
    .is('ended_at', null)

  if (error) return { success: false, error: error.message }
  return { success: true }
}

/**
 * Close the open segment (if any) for this trip + open a new one with
 * `riderId` added to active_rider_ids. Used by /start when a rider
 * scans in.
 */
export async function addRiderToOpenSegment(
  tripId: string,
  riderId: string,
  atIso: string,
  gasPricePerGallon: number,
  client: SupabaseClient = supabaseAdmin,
): Promise<{ newSegment: SegmentRow | null; closedSegment: SegmentRow | null; error?: string }> {
  const open = await findOpenSegment(tripId, client)
  let closed: SegmentRow | null = null
  let activeRiders: string[] = []

  if (open) {
    if (open.active_rider_ids.includes(riderId)) {
      // Already in the segment — nothing to do (replay of /start).
      return { newSegment: open, closedSegment: null }
    }
    const closeRes = await closeSegment(open.id, atIso, gasPricePerGallon, client)
    if (closeRes.error || !closeRes.segment) {
      return { newSegment: null, closedSegment: null, error: closeRes.error }
    }
    closed = closeRes.segment
    activeRiders = [...open.active_rider_ids, riderId]
  } else {
    activeRiders = [riderId]
  }

  const openRes = await openSegment(tripId, activeRiders, atIso, client)
  if (openRes.error || !openRes.segment) {
    return { newSegment: null, closedSegment: closed, error: openRes.error }
  }
  return { newSegment: openRes.segment, closedSegment: closed }
}

/**
 * Close the open segment (if any) for this trip + open a new one with
 * `riderId` removed from active_rider_ids — unless this was the last
 * rider, in which case no new segment is opened. Used by /end when a
 * rider scans out.
 */
export async function removeRiderFromOpenSegment(
  tripId: string,
  riderId: string,
  atIso: string,
  gasPricePerGallon: number,
  client: SupabaseClient = supabaseAdmin,
): Promise<{ closedSegment: SegmentRow | null; nextSegment: SegmentRow | null; wasLast: boolean; error?: string }> {
  const open = await findOpenSegment(tripId, client)
  if (!open) {
    return { closedSegment: null, nextSegment: null, wasLast: true }
  }

  if (!open.active_rider_ids.includes(riderId)) {
    // Rider wasn't in the segment — replay of /end. Treat as no-op.
    return { closedSegment: open, nextSegment: null, wasLast: open.active_rider_ids.length === 0 }
  }

  const closeRes = await closeSegment(open.id, atIso, gasPricePerGallon, client)
  if (closeRes.error || !closeRes.segment) {
    return { closedSegment: null, nextSegment: null, wasLast: false, error: closeRes.error }
  }

  const remaining = open.active_rider_ids.filter((id) => id !== riderId)
  if (remaining.length === 0) {
    return { closedSegment: closeRes.segment, nextSegment: null, wasLast: true }
  }

  const openRes = await openSegment(tripId, remaining, atIso, client)
  if (openRes.error || !openRes.segment) {
    return { closedSegment: closeRes.segment, nextSegment: null, wasLast: false, error: openRes.error }
  }
  return { closedSegment: closeRes.segment, nextSegment: openRes.segment, wasLast: false }
}

// ── Per-rider share computation ────────────────────────────────────────

/**
 * Fold all segments for a trip into THIS rider's per-rider cost.
 * Returns base_share + the gas + time components separately so admin
 * + the rides row can show a per-rider breakdown (not just the total).
 * Iterates segments where rider_id appears in active_rider_ids and
 * sums each component's (segment_value / active_count). Returns
 * zeros if rider has no segments (defensive; shouldn't happen if
 * /start was scanned).
 */
export async function computeRiderBaseShare(
  tripId: string,
  riderId: string,
  client: SupabaseClient = supabaseAdmin,
): Promise<{
  baseShareCents: number
  gasShareCents: number
  timeShareCents: number
  segmentsInCount: number
}> {
  const { data: segments } = await client
    .from('ride_segments')
    .select('active_rider_ids, gas_cost_cents, time_cost_cents')
    .eq('trip_id', tripId)
    .not('ended_at', 'is', null)

  let gasShare = 0
  let timeShare = 0
  let segCount = 0
  for (const seg of (segments ?? []) as Array<{
    active_rider_ids: string[]
    gas_cost_cents: number
    time_cost_cents: number
  }>) {
    if (!seg.active_rider_ids.includes(riderId)) continue
    const denom = Math.max(1, seg.active_rider_ids.length)
    gasShare += Math.round(seg.gas_cost_cents / denom)
    timeShare += Math.round(seg.time_cost_cents / denom)
    segCount += 1
  }
  return {
    baseShareCents: gasShare + timeShare,
    gasShareCents: gasShare,
    timeShareCents: timeShare,
    segmentsInCount: segCount,
  }
}

/**
 * Compute the rider's final settlement totals: base_share + caregiver +
 * companion, with the per-rider minimum applied to base_share before
 * adding the add-ons. Add-ons are NOT subject to the minimum — they are
 * standalone seat fees.
 */
export function computeRiderTotals(args: {
  baseShareCents: number
  caregiverFareCents: number
  companionFareCents: number
  segmentsInCount: number
}): RiderShareTotals {
  const base = Math.max(MIN_FARE_CENTS, args.baseShareCents)
  const caregiver = Math.max(0, args.caregiverFareCents)
  const companion = Math.max(0, args.companionFareCents)
  return {
    base_share_cents: base,
    caregiver_share_cents: caregiver,
    companion_share_cents: companion,
    total_cents: base + caregiver + companion,
    segments_in_count: args.segmentsInCount,
  }
}

/**
 * Upsert the ride_rider_shares row at THIS rider's dropoff scan with
 * the computed totals + segment count. Idempotent on (ride_id, rider_id).
 */
export async function upsertRiderShare(args: {
  tripId: string
  rideId: string
  riderId: string
  driverId: string
  totals: RiderShareTotals
  finalizedAtIso: string
  client?: SupabaseClient
}): Promise<{ success: boolean; error?: string }> {
  const client = args.client ?? supabaseAdmin
  const { error } = await client
    .from('ride_rider_shares')
    .upsert({
      trip_id: args.tripId,
      ride_id: args.rideId,
      rider_id: args.riderId,
      driver_id: args.driverId,
      base_share_cents: args.totals.base_share_cents,
      caregiver_share_cents: args.totals.caregiver_share_cents,
      companion_share_cents: args.totals.companion_share_cents,
      total_cents: args.totals.total_cents,
      segments_in_count: args.totals.segments_in_count,
      finalized_at: args.finalizedAtIso,
    } as never, { onConflict: 'ride_id,rider_id' })

  if (error) return { success: false, error: error.message }
  return { success: true }
}

/**
 * Mark a rider's share as charged after wallet/Connect settlement
 * completes. Records payment_status + payment_intent_id + charged_at.
 */
export async function markRiderShareCharged(args: {
  rideId: string
  riderId: string
  paymentStatus: 'paid' | 'processing' | 'failed' | 'pending'
  paymentIntentId?: string | null
  chargedAtIso: string
  client?: SupabaseClient
}): Promise<{ success: boolean; error?: string }> {
  const client = args.client ?? supabaseAdmin
  const { error } = await client
    .from('ride_rider_shares')
    .update({
      payment_status: args.paymentStatus,
      payment_intent_id: args.paymentIntentId ?? null,
      charged_at: args.chargedAtIso,
    } as never)
    .eq('ride_id', args.rideId)
    .eq('rider_id', args.riderId)

  if (error) return { success: false, error: error.message }
  return { success: true }
}
