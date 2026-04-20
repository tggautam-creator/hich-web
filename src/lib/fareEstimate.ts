/**
 * Client-side fare estimator for ride-board cards / confirm sheet.
 *
 * Uses haversine × 1.3 road fudge for distance, and an assumed 35 mph
 * average speed to infer duration. The result is labelled as a range
 * via calculateFareRange so users see this is an estimate, not a quote.
 *
 * Prefers generic `origin_lat/lng/dest_lat/dest_lng` (stored directly on
 * the ride_schedules row since migration 048, populated for BOTH driver
 * and rider posts). Falls back to `driver_origin_*` for older rows that
 * pre-date the migration.
 */

import { haversineMetres } from '@/lib/geo'
import { calculateFareRange, formatCents } from '@/lib/fare'

interface FareEstimateInput {
  origin_lat?: number | null
  origin_lng?: number | null
  dest_lat?: number | null
  dest_lng?: number | null
  driver_origin_lat?: number | null
  driver_origin_lng?: number | null
  driver_dest_lat?: number | null
  driver_dest_lng?: number | null
}

export interface FareEstimateResult {
  distance_km: number
  duration_min: number
  low_cents: number
  high_cents: number
  label: string
}

const ROAD_FUDGE = 1.3
const AVG_SPEED_KPH = 56 // ≈ 35 mph

export function estimateScheduleFare(
  input: FareEstimateInput,
): FareEstimateResult | null {
  const oLat = input.origin_lat ?? input.driver_origin_lat
  const oLng = input.origin_lng ?? input.driver_origin_lng
  const dLat = input.dest_lat   ?? input.driver_dest_lat
  const dLng = input.dest_lng   ?? input.driver_dest_lng

  if (oLat == null || oLng == null || dLat == null || dLng == null) return null

  const metres = haversineMetres(oLat, oLng, dLat, dLng)
  if (!Number.isFinite(metres) || metres <= 0) return null

  const distance_km = (metres / 1000) * ROAD_FUDGE
  const duration_min = (distance_km / AVG_SPEED_KPH) * 60

  const { low, high } = calculateFareRange(distance_km, duration_min)

  return {
    distance_km,
    duration_min,
    low_cents: low.fare_cents,
    high_cents: high.fare_cents,
    label: `${formatCents(low.fare_cents)}–${formatCents(high.fare_cents)}`,
  }
}
