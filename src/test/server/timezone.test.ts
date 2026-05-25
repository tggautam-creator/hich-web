// @vitest-environment node
/**
 * Tests for the local-date bucketing helpers used by admin metrics.
 *
 * Hardcoded PDT (UTC-7) cases because admin "today" rollover is
 * what's being fixed; PST (UTC-8) cases are included so DST
 * transitions don't sneak a regression in.
 */
import { describe, it, expect } from 'vitest'

import {
  toLocalDateString,
  localDateStartIso,
  startOfLocalDayIso,
  daysAgoLocalIso,
  addLocalDays,
} from '../../../server/lib/timezone.ts'

describe('toLocalDateString', () => {
  it('returns the PT date for a midnight-UTC instant during PDT', () => {
    // 2026-05-25 00:00 UTC = 2026-05-24 17:00 PT (PDT, UTC-7)
    const utc = new Date('2026-05-25T00:00:00Z')
    expect(toLocalDateString(utc)).toBe('2026-05-24')
  })

  it('returns the PT date for an early-morning-PT instant', () => {
    // 2026-05-25 14:00 UTC = 2026-05-25 07:00 PT (PDT)
    const utc = new Date('2026-05-25T14:00:00Z')
    expect(toLocalDateString(utc)).toBe('2026-05-25')
  })

  it('returns the next PT date one minute past midnight PT', () => {
    // 2026-05-26 07:01 UTC = 2026-05-26 00:01 PT (PDT)
    const utc = new Date('2026-05-26T07:01:00Z')
    expect(toLocalDateString(utc)).toBe('2026-05-26')
  })

  it('handles PST (UTC-8) — December date', () => {
    // 2025-12-25 07:00 UTC = 2025-12-24 23:00 PT (PST, UTC-8)
    const utc = new Date('2025-12-25T07:00:00Z')
    expect(toLocalDateString(utc)).toBe('2025-12-24')
  })

  it('handles PST midnight rollover', () => {
    // 2025-12-25 08:00 UTC = 2025-12-25 00:00 PT (PST)
    const utc = new Date('2025-12-25T08:00:00Z')
    expect(toLocalDateString(utc)).toBe('2025-12-25')
  })

  it('zero-pads month + day', () => {
    // 2026-01-05 14:00 UTC = 2026-01-05 06:00 PT
    const utc = new Date('2026-01-05T14:00:00Z')
    expect(toLocalDateString(utc)).toBe('2026-01-05')
  })
})

describe('localDateStartIso', () => {
  it('returns the UTC instant of midnight PT on the given date (PDT)', () => {
    // 2026-05-25 00:00 PT (PDT, UTC-7) = 2026-05-25 07:00 UTC
    expect(localDateStartIso('2026-05-25')).toBe('2026-05-25T07:00:00.000Z')
  })

  it('returns the UTC instant of midnight PT on the given date (PST)', () => {
    // 2025-12-25 00:00 PT (PST, UTC-8) = 2025-12-25 08:00 UTC
    expect(localDateStartIso('2025-12-25')).toBe('2025-12-25T08:00:00.000Z')
  })

  it('round-trips with toLocalDateString', () => {
    // localDateStartIso('2026-05-25') yields the instant of midnight PT.
    // toLocalDateString of that instant should return '2026-05-25'.
    const iso = localDateStartIso('2026-05-25')
    expect(toLocalDateString(new Date(iso))).toBe('2026-05-25')
  })

  it('throws on malformed input', () => {
    expect(() => localDateStartIso('2026/05/25')).toThrow()
    expect(() => localDateStartIso('not a date')).toThrow()
  })
})

describe('startOfLocalDayIso', () => {
  it('returns midnight-PT for a given instant (PDT case)', () => {
    // 2026-05-25 14:00 UTC = 2026-05-25 07:00 AM PT
    // → midnight-PT of 2026-05-25 = 2026-05-25 07:00 UTC
    const utc = new Date('2026-05-25T14:00:00Z')
    expect(startOfLocalDayIso(utc)).toBe('2026-05-25T07:00:00.000Z')
  })

  it('handles a pre-midnight-PT-but-next-day-UTC instant', () => {
    // 2026-05-25 06:00 UTC = 2026-05-24 23:00 PT → bucket as 5/24
    const utc = new Date('2026-05-25T06:00:00Z')
    expect(startOfLocalDayIso(utc)).toBe('2026-05-24T07:00:00.000Z')
  })
})

describe('daysAgoLocalIso', () => {
  it('returns midnight-PT 7 local days before', () => {
    // 2026-05-25 14:00 UTC → local 2026-05-25 → 7 days back = 2026-05-18
    // → midnight-PT of 2026-05-18 = 2026-05-18 07:00 UTC
    const now = new Date('2026-05-25T14:00:00Z')
    expect(daysAgoLocalIso(now, 7)).toBe('2026-05-18T07:00:00.000Z')
  })

  it('crosses a DST boundary correctly (PDT → PST)', () => {
    // 2026-03-15 12:00 PDT = 2026-03-15 19:00 UTC
    // 7 days back = 2026-03-08 which is the DST boundary day
    // midnight-PT of 2026-03-08 was the PRE-DST clock (still PST until 2 AM)
    // = 2026-03-08 08:00 UTC
    const now = new Date('2026-03-15T19:00:00Z')
    expect(daysAgoLocalIso(now, 7)).toBe('2026-03-08T08:00:00.000Z')
  })
})

describe('addLocalDays', () => {
  it('adds positive days', () => {
    expect(addLocalDays('2026-05-25', 3)).toBe('2026-05-28')
  })

  it('handles month rollover', () => {
    expect(addLocalDays('2026-05-30', 5)).toBe('2026-06-04')
  })

  it('subtracts with negative n', () => {
    expect(addLocalDays('2026-05-25', -1)).toBe('2026-05-24')
  })

  it('handles year rollover', () => {
    expect(addLocalDays('2025-12-30', 5)).toBe('2026-01-04')
  })
})
