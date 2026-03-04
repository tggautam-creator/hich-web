/**
 * Fare calculation — single source of truth.
 *
 * Money is always in cents (integers). Display only as dollars.
 *
 * Formula (from PRD):
 *   base  = $1.00  (100 cents)
 *   +distance × $0.18/km  (18 cents/km)
 *   +duration × $0.05/min (5 cents/min)
 *
 *   fare_cents         = max(200, min(4000, round(100 + distance_km * 18 + duration_min * 5)))
 *   platform_fee_cents = round(fare_cents * 0.15)
 *   driver_earns_cents = fare_cents - platform_fee_cents
 */

const MIN_FARE_CENTS    = 200
const MAX_FARE_CENTS    = 4000
const BASE_CENTS        = 100
const PER_KM_CENTS      = 18
const PER_MIN_CENTS     = 5
const PLATFORM_FEE_RATE = 0.15

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FareEstimate {
  fare_cents: number
  platform_fee_cents: number
  driver_earns_cents: number
}

export interface FareRange {
  low:  FareEstimate
  high: FareEstimate
}

// ── Functions ─────────────────────────────────────────────────────────────────

/** Calculate the exact fare for a given distance and duration. */
export function calculateFare(distance_km: number, duration_min: number): FareEstimate {
  const raw = Math.round(BASE_CENTS + distance_km * PER_KM_CENTS + duration_min * PER_MIN_CENTS)
  const fare_cents = Math.max(MIN_FARE_CENTS, Math.min(MAX_FARE_CENTS, raw))
  const platform_fee_cents = Math.round(fare_cents * PLATFORM_FEE_RATE)
  const driver_earns_cents = fare_cents - platform_fee_cents
  return { fare_cents, platform_fee_cents, driver_earns_cents }
}

/**
 * Calculate a fare range (low–high) by applying ±15% variance
 * on the distance and duration estimates.
 */
export function calculateFareRange(distance_km: number, duration_min: number): FareRange {
  const low  = calculateFare(distance_km * 0.85, duration_min * 0.85)
  const high = calculateFare(distance_km * 1.15, duration_min * 1.15)
  return { low, high }
}

/** Format cents as a dollar string, e.g. 1250 → "$12.50" */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
