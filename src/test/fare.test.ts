/**
 * Fare calculation tests — gas-cost-aware formula
 *
 * Formula:
 *   gas_cost    = round((distance_km × 0.621371 / mpg) × gas_price × 100)
 *   time_cost   = round(duration_min × 5)
 *   base        = 100 cents ($1.00)
 *   fare_cents  = max(200, min(4000, base + gas_cost + time_cost))
 *   platform_fee = round(fare × 0) = 0 (zero commission)
 *   driver_earns = fare
 *
 * Defaults: mpg = 25, gas_price = $3.50/gal
 */

import { describe, it, expect } from 'vitest'
import { calculateFare, calculateFareRange, formatCents } from '@/lib/fare'

describe('calculateFare', () => {
  it('clamps to minimum $2.00 for 0 km / 0 min', () => {
    // gas=0, time=0, raw=100 → 200
    const f = calculateFare(0, 0)
    expect(f.fare_cents).toBe(200)
  })

  it('clamps to minimum for a very short ride (2 km, 5 min)', () => {
    // gas=round((2*0.621371/25)*350)=17, time=25, raw=142 → 200
    const f = calculateFare(2, 5)
    expect(f.fare_cents).toBe(200)
  })

  it('calculates correctly for a medium ride (10 km, 15 min)', () => {
    // gas=round((10*0.621371/25)*350)=87, time=75, raw=262
    const f = calculateFare(10, 15)
    expect(f.fare_cents).toBe(262)
  })

  it('calculates correctly for a longer ride (30 km, 40 min)', () => {
    // gas=round((30*0.621371/25)*350)=261, time=200, raw=561
    const f = calculateFare(30, 40)
    expect(f.fare_cents).toBe(561)
  })

  it('calculates correctly for a long ride (100 km, 120 min)', () => {
    // gas=round((100*0.621371/25)*350)=870, time=600, raw=1570
    const f = calculateFare(100, 120)
    expect(f.fare_cents).toBe(1570)
  })

  it('clamps to maximum $40.00 for an extremely long ride (300 km, 400 min)', () => {
    // gas=round((300*0.621371/25)*350)=2610, time=2000, raw=4710 → 4000
    const f = calculateFare(300, 400)
    expect(f.fare_cents).toBe(4000)
  })

  it('clamps to minimum for negative distance and duration', () => {
    const f = calculateFare(-5, -10)
    expect(f.fare_cents).toBe(200)
  })

  it('calculates platform fee as 0 (zero commission)', () => {
    const f = calculateFare(10, 15) // fare = 262
    expect(f.platform_fee_cents).toBe(0)
  })

  it('driver_earns = fare (zero commission)', () => {
    const f = calculateFare(10, 15) // fare = 262
    expect(f.driver_earns_cents).toBe(262)
  })

  it('computes correct breakdown at the maximum cap', () => {
    const f = calculateFare(300, 400) // fare = 4000
    expect(f.platform_fee_cents).toBe(0)
    expect(f.driver_earns_cents).toBe(4000)
  })

  it('computes correct breakdown at the minimum cap', () => {
    const f = calculateFare(0, 0) // fare = 200
    expect(f.platform_fee_cents).toBe(0)
    expect(f.driver_earns_cents).toBe(200)
  })

  it('includes gas_cost_cents and time_cost_cents in the breakdown', () => {
    const f = calculateFare(10, 15)
    expect(f.gas_cost_cents).toBe(87)
    expect(f.time_cost_cents).toBe(75)
    expect(f.base_cents).toBe(100)
    expect(f.mpg).toBe(25)
    expect(f.gas_price_per_gallon).toBe(3.50)
  })

  it('accepts custom mpg and gas price', () => {
    // 40 MPG, $4.00/gal: gas=round((10*0.621371/40)*400)=62, time=75, raw=237
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
    // low:  (8.5 km, 12.75 min) → gas=74, time=64, raw=238
    // high: (11.5 km, 17.25 min) → gas=100, time=86, raw=286
    expect(range.low.fare_cents).toBe(238)
    expect(range.high.fare_cents).toBe(286)
  })

  it('both collapse to minimum for very short rides', () => {
    const range = calculateFareRange(1, 2)
    expect(range.low.fare_cents).toBe(200)
    expect(range.high.fare_cents).toBe(200)
  })

  it('both collapse to maximum for very long rides', () => {
    const range = calculateFareRange(300, 400)
    expect(range.low.fare_cents).toBe(4000)
    expect(range.high.fare_cents).toBe(4000)
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
