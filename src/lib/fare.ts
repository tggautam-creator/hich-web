/**
 * Fare calculation — single source of truth.
 *
 * Money is always in cents (integers). Display only as dollars.
 *
 * Gas-cost-aware formula:
 *   gas_cost    = (distance_km × 0.621371 / mpg) × gas_price_per_gallon
 *   time_cost   = duration_min × $0.08/min (8 cents/min)
 *   base        = $2.00 (200 cents)
 *   subtotal    = base + gas_cost + time_cost
 *   fare_cents  = max(500, round(subtotal))     // $5 minimum, no upper cap
 *   platform_fee = round(fare × 0) — driver keeps 100% during MVP
 *   driver_earns = fare
 *
 * If mpg/gas_price are not available, falls back to flat per-km rate.
 */

import { DEFAULT_MPG } from '@/lib/fuelEconomy'

export const MIN_FARE_CENTS    = 500
const BASE_CENTS        = 200
const PER_MIN_CENTS     = 8
const PLATFORM_FEE_RATE = 0
const KM_TO_MILES       = 0.621371

/** Average US gas price — updated periodically. Users see this on the breakdown. */
export const DEFAULT_GAS_PRICE_PER_GALLON = 3.50

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FareBreakdown {
  base_cents: number
  gas_cost_cents: number
  time_cost_cents: number
  platform_fee_cents: number
  driver_earns_cents: number
  fare_cents: number
  distance_km: number
  distance_miles: number
  duration_min: number
  mpg: number
  gas_price_per_gallon: number
}

export interface FareEstimate {
  fare_cents: number
  platform_fee_cents: number
  driver_earns_cents: number
}

export interface FareRange {
  low:  FareBreakdown
  high: FareBreakdown
}

// ── Functions ─────────────────────────────────────────────────────────────────

/** Calculate the exact fare with a transparent breakdown. */
export function calculateFare(
  distance_km: number,
  duration_min: number,
  mpg: number = DEFAULT_MPG,
  gas_price_per_gallon: number = DEFAULT_GAS_PRICE_PER_GALLON,
): FareBreakdown {
  const distance_miles = distance_km * KM_TO_MILES
  const gallons_used = mpg > 0 ? distance_miles / mpg : distance_miles / DEFAULT_MPG
  const gas_cost_cents = Math.round(gallons_used * gas_price_per_gallon * 100)
  const time_cost_cents = Math.round(duration_min * PER_MIN_CENTS)

  const raw = BASE_CENTS + gas_cost_cents + time_cost_cents
  const fare_cents = Math.max(MIN_FARE_CENTS, raw)
  const platform_fee_cents = Math.round(fare_cents * PLATFORM_FEE_RATE)
  const driver_earns_cents = fare_cents - platform_fee_cents

  return {
    base_cents: BASE_CENTS,
    gas_cost_cents,
    time_cost_cents,
    platform_fee_cents,
    driver_earns_cents,
    fare_cents,
    distance_km,
    distance_miles,
    duration_min,
    mpg,
    gas_price_per_gallon,
  }
}

/**
 * Calculate a fare range (low–high) by applying ±15% variance
 * on the distance and duration estimates.
 */
export function calculateFareRange(
  distance_km: number,
  duration_min: number,
  mpg: number = DEFAULT_MPG,
  gas_price_per_gallon: number = DEFAULT_GAS_PRICE_PER_GALLON,
): FareRange {
  const low  = calculateFare(distance_km * 0.85, duration_min * 0.85, mpg, gas_price_per_gallon)
  const high = calculateFare(distance_km * 1.15, duration_min * 1.15, mpg, gas_price_per_gallon)
  return { low, high }
}

/** Format cents as a dollar string, e.g. 1250 → "$12.50" */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/**
 * Estimate Stripe processing fee for display purposes.
 * Standard US rate: 2.9% + 30¢
 */
export function estimateStripeFee(amountCents: number): number {
  return Math.round(amountCents * 0.029 + 30)
}
