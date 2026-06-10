// @vitest-environment node
/**
 * V4 F6 5A — rideStartableToday: scheduled rides (board + Explore) can't be
 * QR-started before trip day. A matched event ride used to be startable
 * weeks early. Pacific-Time calendar-date semantics.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { from: () => { throw new Error('unexpected client use') } },
}))

import { rideStartableToday, tripDayLabel } from '../../../server/routes/rides.ts'

function ptDate(offsetDays: number): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000)
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

describe('rideStartableToday', () => {
  it('instant rides (no trip_date) are always startable', () => {
    expect(rideStartableToday(null)).toBe(true)
    expect(rideStartableToday(undefined)).toBe(true)
  })

  it('today is startable', () => {
    expect(rideStartableToday(ptDate(0))).toBe(true)
  })

  it('past dates stay startable (late trips are not blocked)', () => {
    expect(rideStartableToday(ptDate(-1))).toBe(true)
  })

  it('future dates are NOT startable', () => {
    expect(rideStartableToday(ptDate(1))).toBe(false)
    expect(rideStartableToday(ptDate(18))).toBe(false)
  })
})

describe('tripDayLabel', () => {
  it('formats YYYY-MM-DD as a short weekday label', () => {
    expect(tripDayLabel('2026-06-27')).toBe('Sat, Jun 27')
  })

  it('falls back to the raw string on garbage', () => {
    expect(tripDayLabel('not-a-date')).toBe('not-a-date')
  })
})
