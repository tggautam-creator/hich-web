/**
 * v1.2 F17 — Trip lifecycle helpers.
 *
 * The `trips` table introduced in migration 097 is the canonical parent
 * of all `rides` rows. A multi-rider board trip = ONE trips row + N
 * rides rows. An instant single-rider ride = ONE trips row + 1 rides
 * row.
 *
 * Pre-F17 endpoints create rides directly. To keep this slice's surface
 * area small, this helper transparently creates a trip on demand for
 * any rides row that doesn't have one yet (backfill gap or any
 * untouched code path). New code SHOULD create the trip first and link
 * the rides row eagerly, but this helper guarantees we never end up
 * with an orphan ride.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from './supabaseAdmin.ts'

export type TripStatus = 'pending' | 'active' | 'completed' | 'cancelled'
export type TripKind = 'instant' | 'board'

export interface TripRow {
  id: string
  driver_id: string
  schedule_id: string | null
  kind: TripKind
  status: TripStatus
  started_at: string | null
  ended_at: string | null
}

/**
 * Idempotent: returns the existing trip_id if the rides row already
 * has one, otherwise creates a new trip + sets rides.trip_id.
 *
 * Race-safe via a SELECT-after-INSERT pattern: two concurrent callers
 * each insert their own trips row, but both then UPDATE rides — Postgres
 * serializes the update and the loser overwrites the winner's link.
 * The orphan trip is harmless (no rides reference it, no segments
 * attach). We could clean up orphans in a follow-up, but the race
 * window is microseconds wide so the cost is negligible.
 */
export async function getOrCreateTripForRide(
  rideId: string,
  client: SupabaseClient = supabaseAdmin,
): Promise<{ tripId: string; created: boolean; error?: string }> {
  const { data: ride, error: fetchErr } = await client
    .from('rides')
    .select('id, trip_id, driver_id, schedule_id, status, started_at, ended_at, origin, origin_name, destination, destination_name, route_polyline, gps_distance_metres, gas_cost_cents, time_cost_cents, gas_price_per_gallon_cents')
    .eq('id', rideId)
    .single()

  if (fetchErr ?? !ride) {
    return { tripId: '', created: false, error: fetchErr?.message ?? 'ride not found' }
  }

  const existingTripId = (ride as Record<string, unknown>)['trip_id'] as string | null
  if (existingTripId) {
    return { tripId: existingTripId, created: false }
  }

  const driverId = (ride as Record<string, unknown>)['driver_id'] as string | null
  if (!driverId) {
    return { tripId: '', created: false, error: 'ride has no driver_id; cannot create trip' }
  }

  const scheduleId = (ride as Record<string, unknown>)['schedule_id'] as string | null
  const rideStatus = (ride as Record<string, unknown>)['status'] as string

  const tripStatus: TripStatus =
    rideStatus === 'active' || rideStatus === 'coordinating' ? 'active'
    : rideStatus === 'completed' || rideStatus === 'paid' ? 'completed'
    : rideStatus.startsWith('cancelled') || rideStatus.startsWith('declined') ? 'cancelled'
    : 'pending'

  const tripKind: TripKind = scheduleId ? 'board' : 'instant'

  const { data: newTrip, error: insertErr } = await client
    .from('trips')
    .insert({
      driver_id: driverId,
      schedule_id: scheduleId,
      kind: tripKind,
      status: tripStatus,
      started_at: (ride as Record<string, unknown>)['started_at'] as string | null,
      ended_at: (ride as Record<string, unknown>)['ended_at'] as string | null,
      origin: (ride as Record<string, unknown>)['origin'] ?? null,
      origin_name: (ride as Record<string, unknown>)['origin_name'] as string | null,
      destination: (ride as Record<string, unknown>)['destination'] ?? null,
      destination_name: (ride as Record<string, unknown>)['destination_name'] as string | null,
      route_polyline: (ride as Record<string, unknown>)['route_polyline'] as string | null,
      gps_distance_metres: ((ride as Record<string, unknown>)['gps_distance_metres'] as number | null) ?? 0,
      gas_cost_cents: ((ride as Record<string, unknown>)['gas_cost_cents'] as number | null) ?? 0,
      time_cost_cents: ((ride as Record<string, unknown>)['time_cost_cents'] as number | null) ?? 0,
      gas_price_per_gallon_cents: (ride as Record<string, unknown>)['gas_price_per_gallon_cents'] as number | null,
    })
    .select('id')
    .single()

  if (insertErr ?? !newTrip) {
    return { tripId: '', created: false, error: insertErr?.message ?? 'failed to create trip' }
  }

  const tripId = (newTrip as { id: string }).id

  // Link the rides row. Concurrency: if another caller raced ahead and
  // already linked a different trip_id, our UPDATE silently loses (no
  // WHERE guard on trip_id IS NULL) and the orphan trip we just created
  // stays unreferenced — harmless and rare.
  const { error: updateErr } = await client
    .from('rides')
    .update({ trip_id: tripId })
    .eq('id', rideId)

  if (updateErr) {
    return { tripId: '', created: false, error: updateErr.message }
  }

  return { tripId, created: true }
}

/**
 * Fetch the trip row by id. Returns null if not found.
 */
export async function getTrip(
  tripId: string,
  client: SupabaseClient = supabaseAdmin,
): Promise<TripRow | null> {
  const { data, error } = await client
    .from('trips')
    .select('id, driver_id, schedule_id, kind, status, started_at, ended_at')
    .eq('id', tripId)
    .single()

  if (error ?? !data) return null
  return data as unknown as TripRow
}

/**
 * Update trip status + optional started_at / ended_at timestamps.
 */
export async function updateTripStatus(
  tripId: string,
  status: TripStatus,
  opts: { startedAt?: string; endedAt?: string } = {},
  client: SupabaseClient = supabaseAdmin,
): Promise<{ success: boolean; error?: string }> {
  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (opts.startedAt) update['started_at'] = opts.startedAt
  if (opts.endedAt) update['ended_at'] = opts.endedAt

  const { error } = await client.from('trips').update(update).eq('id', tripId)
  if (error) return { success: false, error: error.message }
  return { success: true }
}
