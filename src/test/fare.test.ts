/**
 * Fare calculation tests — gas-cost-aware formula (no base fare since 2026-05-01)
 *
 * Formula:
 *   gas_cost    = round((distance_km × 0.621371 / mpg) × gas_price × 100)
 *   time_cost   = round(duration_min × 5)                  // 5¢/min
 *   fare_cents  = max(500, gas_cost + time_cost)           // $5 minimum, no upper cap
 *   platform_fee = round(fare × 0) = 0 (zero commission)
 *   driver_earns = fare
 *
 * Defaults: mpg = 25, gas_price = $3.50/gal
 */

import { describe, it, expect } from 'vitest'
import { calculateFare, calculateFareRange, formatCents } from '@/lib/fare'

describe('calculateFare', () => {
  it('clamps to minimum $5.00 for 0 km / 0 min', () => {
    // gas=0, time=0, raw=0 → 500 (minimum)
    const f = calculateFare(0, 0)
    expect(f.fare_cents).toBe(500)
  })

  it('clamps to minimum for a very short ride (2 km, 5 min)', () => {
    // gas=round((2*0.621371/25)*350)=17, time=25, raw=42 → 500
    const f = calculateFare(2, 5)
    expect(f.fare_cents).toBe(500)
  })

  it('clamps to minimum for a medium ride (10 km, 15 min)', () => {
    // gas=round((10*0.621371/25)*350)=87, time=75, raw=162 → 500 (minimum)
    const f = calculateFare(10, 15)
    expect(f.fare_cents).toBe(500)
  })

  it('clamps to minimum for a longer ride (30 km, 40 min)', () => {
    // gas=round((30*0.621371/25)*350)=261, time=200, raw=461 → 500 (minimum)
    const f = calculateFare(30, 40)
    expect(f.fare_cents).toBe(500)
  })

  it('calculates correctly for a long ride (100 km, 120 min)', () => {
    // gas=round((100*0.621371/25)*350)=870, time=600, raw=1470
    const f = calculateFare(100, 120)
    expect(f.fare_cents).toBe(1470)
  })

  it('scales linearly for an extremely long ride (300 km, 400 min)', () => {
    // gas=round((300*0.621371/25)*350)=2610, time=2000, raw=4610 (no upper cap)
    const f = calculateFare(300, 400)
    expect(f.fare_cents).toBe(4610)
  })

  it('clamps to minimum for negative distance and duration', () => {
    const f = calculateFare(-5, -10)
    expect(f.fare_cents).toBe(500)
  })

  it('calculates platform fee as 0 (zero commission)', () => {
    const f = calculateFare(100, 120)
    expect(f.platform_fee_cents).toBe(0)
  })

  it('driver_earns = fare (zero commission)', () => {
    const f = calculateFare(100, 120) // fare = 1470
    expect(f.driver_earns_cents).toBe(1470)
  })

  it('computes correct breakdown for a long uncapped ride', () => {
    const f = calculateFare(300, 400) // fare = 4610 (no cap)
    expect(f.platform_fee_cents).toBe(0)
    expect(f.driver_earns_cents).toBe(4610)
  })

  it('computes correct breakdown at the minimum cap', () => {
    const f = calculateFare(0, 0) // fare = 500
    expect(f.platform_fee_cents).toBe(0)
    expect(f.driver_earns_cents).toBe(500)
  })

  it('includes gas_cost_cents and time_cost_cents in the breakdown', () => {
    const f = calculateFare(10, 15)
    expect(f.gas_cost_cents).toBe(87)
    expect(f.time_cost_cents).toBe(75)
    expect(f.mpg).toBe(25)
    expect(f.gas_price_per_gallon).toBe(3.50)
  })

  it('includes base_fare_cents in the breakdown (zero today)', () => {
    // The base-fare field is always populated even at $0 so render
    // sites can show the line item unconditionally. If TAGO ever
    // monetizes a base fare, this test pins the contract.
    const f = calculateFare(10, 15)
    expect(f.base_fare_cents).toBe(0)
  })

  it('accepts custom mpg and gas price', () => {
    // 40 MPG, $4.00/gal: gas=round((10*0.621371/40)*400)=62, time=75, raw=137 → 500
    const f = calculateFare(10, 15, 40, 4.00)
    expect(f.gas_cost_cents).toBe(62)
    expect(f.mpg).toBe(40)
    expect(f.gas_price_per_gallon).toBe(4.00)
  })
})

describe('calculateFareRange', () => {
  it('low ≤ high for non-zero inputs', () => {
    const range = calculateFareRange(10, 15)
    expect(range.low.fare_cents).toBeLessThanOrEqual(range.high.fare_cents)
  })

  it('applies ±15% variance on distance and duration', () => {
    const range = calculateFareRange(10, 15)
    // low:  (8.5 km, 12.75 min) → gas=74, time=64, raw=138 → 500
    // high: (11.5 km, 17.25 min) → gas=100, time=86, raw=186 → 500
    expect(range.low.fare_cents).toBe(500)
    expect(range.high.fare_cents).toBe(500)
  })

  it('both collapse to minimum for very short rides', () => {
    const range = calculateFareRange(1, 2)
    expect(range.low.fare_cents).toBe(500)
    expect(range.high.fare_cents).toBe(500)
  })

  it('scales proportionally for very long rides (no upper cap)', () => {
    // low:  (255 km, 340 min) → gas=2218, time=1700, raw=3918
    // high: (345 km, 460 min) → gas=3001, time=2300, raw=5301
    const range = calculateFareRange(300, 400)
    expect(range.low.fare_cents).toBe(3918)
    expect(range.high.fare_cents).toBe(5301)
  })
})

describe('formatCents', () => {
  it('formats 1250 cents as "$12.50"', () => {
    expect(formatCents(1250)).toBe('$12.50')
  })

  it('formats 200 cents as "$2.00"', () => {
    expect(formatCents(200)).toBe('$2.00')
  })

  it('formats 4000 cents as "$40.00"', () => {
    expect(formatCents(4000)).toBe('$40.00')
  })

  it('formats 0 cents as "$0.00"', () => {
    expect(formatCents(0)).toBe('$0.00')
  })

  it('formats 99 cents as "$0.99"', () => {
    expect(formatCents(99)).toBe('$0.99')
  })
})
