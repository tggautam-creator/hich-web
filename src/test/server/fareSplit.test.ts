// @vitest-environment node
/**
 * V4 F6 — computeProjectedSplit: the pre-ride per-rider split estimate.
 *
 * Mirrors the settlement shape (segments.ts → computeRiderTotals): the $5
 * floor applies to the split base only; caregiver + companion seat fees fold
 * on top, un-floored. These pin that contract so the preview and the charge
 * never drift in structure.
 */
import { describe, it, expect } from 'vitest'

import { computeProjectedSplit, MIN_FARE_CENTS } from '../../../server/lib/fareSplit.ts'

describe('computeProjectedSplit', () => {
  it('solo (1 rider) = no split: share equals the solo total', () => {
    const s = computeProjectedSplit(1200, 0, 0, 1)
    expect(s.rider_count).toBe(1)
    expect(s.base_split_cents).toBe(1200)
    expect(s.solo_total_cents).toBe(1200)
    expect(s.your_share_cents).toBe(1200)
  })

  it('splits the base evenly across the expected riders', () => {
    const s = computeProjectedSplit(3000, 0, 0, 3)
    expect(s.rider_count).toBe(3)
    expect(s.base_split_cents).toBe(1000)  // 3000 / 3, above the floor
    expect(s.your_share_cents).toBe(1000)
    expect(s.solo_total_cents).toBe(3000)  // unchanged — the "alone" price
  })

  it('floors each share at $5 even when the even split is lower', () => {
    // 1200 / 3 = 400, below the $5 floor → 500 each (the per-rider minimum).
    const s = computeProjectedSplit(1200, 0, 0, 3)
    expect(s.base_split_cents).toBe(400)
    expect(s.your_share_cents).toBe(MIN_FARE_CENTS) // 500
  })

  it('applies the $5 floor to the split base, not the seat fees', () => {
    // 600 / 3 = 200 → floored to 500. Caregiver $3 + companion $4 fold on top.
    const s = computeProjectedSplit(600, 400, 300, 3)
    expect(s.base_split_cents).toBe(200)
    expect(s.your_share_cents).toBe(MIN_FARE_CENTS + 400 + 300) // 1200
    expect(s.solo_total_cents).toBe(600 + 400 + 300)            // 1300
  })

  it('folds the rider\'s own seat fees on top of the split base (un-split)', () => {
    // Base splits 2 ways; the rider's caregiver + companion fees are theirs alone.
    const s = computeProjectedSplit(2000, 600, 500, 2)
    expect(s.base_split_cents).toBe(1000)
    expect(s.your_share_cents).toBe(1000 + 600 + 500) // 2100
  })

  it('guards a zero / negative rider count to 1 (never divides by zero)', () => {
    expect(computeProjectedSplit(1000, 0, 0, 0).rider_count).toBe(1)
    expect(computeProjectedSplit(1000, 0, 0, 0).your_share_cents).toBe(1000)
    expect(computeProjectedSplit(1000, 0, 0, -5).rider_count).toBe(1)
  })

  it('rounds the split to whole cents', () => {
    const s = computeProjectedSplit(1000, 0, 0, 3) // 333.33 → 333
    expect(s.base_split_cents).toBe(333)
  })
})
