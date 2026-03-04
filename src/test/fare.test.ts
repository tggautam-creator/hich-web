/**
 * Fare calculation tests
 *
 * Verifies:
 *  1.  Base fare (0 km, 0 min) → clamped to minimum $2.00
 *  2.  Short ride (2 km, 5 min) → still hits minimum $2.00
 *  3.  Medium ride (10 km, 15 min) → 355 cents
 *  4.  Longer ride (30 km, 40 min) → 840 cents
 *  5.  Long ride (100 km, 120 min) → 2500 cents
 *  6.  Very long ride (200 km, 300 min) → clamped to max $40.00
 *  7.  Platform fee is 15% rounded
 *  8.  driver_earns = fare - platform_fee
 *  9.  Fare range: low ≤ high for non-zero inputs
 * 10.  Fare range collapses when both hit the floor
 * 11.  formatCents produces correct dollar strings
 * 12.  Negative distance/duration → clamped to minimum
 */

import { describe, it, expect } from 'vitest'
import { calculateFare, calculateFareRange, formatCents } from '@/lib/fare'

describe('calculateFare', () => {
  it('clamps to minimum $2.00 for 0 km / 0 min', () => {
    // raw = 100 + 0 + 0 = 100 → clamped to 200
    const f = calculateFare(0, 0)
    expect(f.fare_cents).toBe(200)
  })

  it('clamps to minimum for a very short ride (2 km, 5 min)', () => {
    // raw = 100 + 36 + 25 = 161 → clamped to 200
    const f = calculateFare(2, 5)
    expect(f.fare_cents).toBe(200)
  })

  it('calculates correctly for a medium ride (10 km, 15 min)', () => {
    // raw = 100 + 180 + 75 = 355
    const f = calculateFare(10, 15)
    expect(f.fare_cents).toBe(355)
  })

  it('calculates correctly for a longer ride (30 km, 40 min)', () => {
    // raw = 100 + 540 + 200 = 840
    const f = calculateFare(30, 40)
    expect(f.fare_cents).toBe(840)
  })

  it('calculates correctly for a long ride (100 km, 120 min)', () => {
    // raw = 100 + 1800 + 600 = 2500
    const f = calculateFare(100, 120)
    expect(f.fare_cents).toBe(2500)
  })

  it('clamps to maximum $40.00 for an extremely long ride (200 km, 300 min)', () => {
    // raw = 100 + 3600 + 1500 = 5200 → clamped to 4000
    const f = calculateFare(200, 300)
    expect(f.fare_cents).toBe(4000)
  })

  it('clamps to minimum for negative distance and duration', () => {
    const f = calculateFare(-5, -10)
    expect(f.fare_cents).toBe(200)
  })

  it('calculates platform fee as 15% rounded', () => {
    const f = calculateFare(10, 15) // fare = 355
    expect(f.platform_fee_cents).toBe(Math.round(355 * 0.15)) // 53
    expect(f.platform_fee_cents).toBe(53)
  })

  it('driver_earns = fare - platform_fee', () => {
    const f = calculateFare(10, 15) // fare = 355, fee = 53
    expect(f.driver_earns_cents).toBe(355 - 53)
    expect(f.driver_earns_cents).toBe(302)
  })

  it('computes correct breakdown at the maximum cap', () => {
    const f = calculateFare(200, 300) // fare = 4000
    expect(f.platform_fee_cents).toBe(600) // round(4000 * 0.15) = 600
    expect(f.driver_earns_cents).toBe(3400)
  })

  it('computes correct breakdown at the minimum cap', () => {
    const f = calculateFare(0, 0) // fare = 200
    expect(f.platform_fee_cents).toBe(30) // round(200 * 0.15) = 30
    expect(f.driver_earns_cents).toBe(170)
  })
})

describe('calculateFareRange', () => {
  it('low ≤ high for non-zero inputs', () => {
    const range = calculateFareRange(10, 15)
    expect(range.low.fare_cents).toBeLessThanOrEqual(range.high.fare_cents)
  })

  it('applies ±15% variance on distance and duration', () => {
    const range = calculateFareRange(10, 15)
    // low:  100 + 8.5*18 + 12.75*5 = 100 + 153 + 63.75 = 316.75 → 317
    // high: 100 + 11.5*18 + 17.25*5 = 100 + 207 + 86.25 = 393.25 → 393
    expect(range.low.fare_cents).toBe(317)
    expect(range.high.fare_cents).toBe(393)
  })

  it('both collapse to minimum for very short rides', () => {
    const range = calculateFareRange(1, 2)
    expect(range.low.fare_cents).toBe(200)
    expect(range.high.fare_cents).toBe(200)
  })

  it('both collapse to maximum for very long rides', () => {
    const range = calculateFareRange(250, 400)
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
