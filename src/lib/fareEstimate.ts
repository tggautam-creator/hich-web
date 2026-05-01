/**
 * Client-side fare estimator for ride-board cards / confirm sheet.
 *
 * Uses haversine × 1.3 road fudge for distance, and an assumed 60 mph
 * (was 35 mph until 2026-05-01) average speed to infer duration. The
 * result is labelled as a range via calculateFareRange so users see
 * this is an estimate, not a quote.
 *
 * 35 → 60 mph: the previous 35 mph default was city-only and inflated
 * duration on routes that include freeway segments — a Davis → San
 * Jose row came out at 181 min vs Apple Maps' real 104 min, pushing
 * the time component from $5 to $9 and making the listing read ~$30
 * when the ride-confirm calculation for the same route showed ~$25.
 * 60 mph is closer to a realistic blended highway+city average for
 * typical inter-city carpool routes; cards are still framed as an "~$X"
 * range so the user understands it's a rough number, not a quote.
 *
 * Gas price defaults to the in-process EIA value cached by `gasPriceCache`
 * (seeded once per cold load), so web ride-board fares match iOS
 * ride-board fares within rounding. Falls back to the formula's hardcoded
 * $3.50 when no live value has been seeded yet.
 *
 * Prefers generic `origin_lat/lng/dest_lat/dest_lng` (stored directly on
 * the ride_schedules row since migration 048, populated for BOTH driver
 * and rider posts). Falls back to `driver_origin_*` for older rows that
 * pre-date the migration.
 */

import { haversineMetres } from '@/lib/geo'
import { calculateFareRange, formatCents } from '@/lib/fare'
import { getCurrentGasPricePerGallon } from '@/lib/gasPriceCache'

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
const AVG_SPEED_KPH = 96 // ≈ 60 mph (was 56 / 35 mph — see header)

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

  const { low, high } = calculateFareRange(
    distance_km,
    duration_min,
    undefined,
    getCurrentGasPricePerGallon(),
  )

  return {
    distance_km,
    duration_min,
    low_cents: low.fare_cents,
    high_cents: high.fare_cents,
    label: `${formatCents(low.fare_cents)}–${formatCents(high.fare_cents)}`,
  }
}
