import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isAnytimeToday, bannerDestinationHeadline } from '@/lib/anytime'

describe('isAnytimeToday', () => {
  // Anchor "now" at 2026-05-31 14:00 local. Tests use fake timers so
  // the predicate's `new Date()` default fires at this instant.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns false when time_flexible is false', () => {
    expect(
      isAnytimeToday({ time_flexible: false, trip_date: '2026-05-31' }),
    ).toBe(false)
  })

  it('returns false when time_flexible is null', () => {
    expect(
      isAnytimeToday({ time_flexible: null, trip_date: '2026-05-31' }),
    ).toBe(false)
  })

  it('returns false when time_flexible is missing', () => {
    expect(isAnytimeToday({ trip_date: '2026-05-31' })).toBe(false)
  })

  it('returns false when trip_date is missing on both ride and schedule', () => {
    expect(isAnytimeToday({ time_flexible: true })).toBe(false)
  })

  it('returns true when ride.trip_date is today (local tz)', () => {
    expect(
      isAnytimeToday({ time_flexible: true, trip_date: '2026-05-31' }),
    ).toBe(true)
  })

  it('returns false when ride.trip_date is yesterday', () => {
    expect(
      isAnytimeToday({ time_flexible: true, trip_date: '2026-05-30' }),
    ).toBe(false)
  })

  it('returns false when ride.trip_date is tomorrow', () => {
    expect(
      isAnytimeToday({ time_flexible: true, trip_date: '2026-06-01' }),
    ).toBe(false)
  })

  it('prefers schedule.trip_date over ride.trip_date', () => {
    expect(
      isAnytimeToday({
        time_flexible: true,
        trip_date: '2026-06-01',
        schedule: { trip_date: '2026-05-31' },
      }),
    ).toBe(true)
  })

  it('falls back to ride.trip_date when schedule.trip_date is null', () => {
    expect(
      isAnytimeToday({
        time_flexible: true,
        trip_date: '2026-05-31',
        schedule: { trip_date: null },
      }),
    ).toBe(true)
  })

  it('returns false on malformed trip_date', () => {
    expect(
      isAnytimeToday({ time_flexible: true, trip_date: 'not-a-date' }),
    ).toBe(false)
  })

  it('treats midnight local as still today', () => {
    vi.setSystemTime(new Date(2026, 4, 31, 0, 0, 1))
    expect(
      isAnytimeToday({ time_flexible: true, trip_date: '2026-05-31' }),
    ).toBe(true)
  })

  it('treats one-second-to-midnight local as still today', () => {
    vi.setSystemTime(new Date(2026, 4, 31, 23, 59, 59))
    expect(
      isAnytimeToday({ time_flexible: true, trip_date: '2026-05-31' }),
    ).toBe(true)
  })

  it('does NOT parse trip_date as UTC (would shift to yesterday in negative-offset zone)', () => {
    // If the parser used `new Date('2026-05-31')` (UTC midnight),
    // a PDT browser at 23:59 local on 2026-05-30 would see "today
    // is 2026-05-31" and the predicate would incorrectly fire.
    // We test that anchoring `now` at the LOCAL end-of-day yields
    // the correct local-day comparison regardless of the user's
    // browser tz (since parseLocalDate uses `new Date(y, m-1, d)`).
    vi.setSystemTime(new Date(2026, 4, 30, 23, 59, 59))
    expect(
      isAnytimeToday({ time_flexible: true, trip_date: '2026-05-31' }),
    ).toBe(false)
  })

  it('accepts a now override for deterministic testing', () => {
    const ride = { time_flexible: true, trip_date: '2026-12-25' }
    expect(isAnytimeToday(ride, new Date(2026, 11, 25, 9, 0, 0))).toBe(true)
    expect(isAnytimeToday(ride, new Date(2026, 11, 24, 9, 0, 0))).toBe(false)
  })
})

describe('bannerDestinationHeadline', () => {
  it('uses schedule.dest_address when present', () => {
    expect(
      bannerDestinationHeadline({
        schedule: { dest_address: 'Sacramento, CA 95814' },
      }),
    ).toBe('Sacramento')
  })

  it('falls back to destination_name when schedule is null', () => {
    expect(
      bannerDestinationHeadline({
        destination_name: 'Downtown Berkeley',
      }),
    ).toBe('Downtown Berkeley')
  })

  it('returns null when schedule.dest_address is empty string (matches iOS — `??` only falls back on nil, then guard !isEmpty)', () => {
    // Matches iOS TodaysAnytimeBanner.swift `let raw = schedule?.destAddress ?? destinationName`
    // followed by `guard let raw, !raw.isEmpty else { return nil }`. Swift's `??` does NOT
    // treat empty strings as nil, so an empty `schedule.dest_address` short-circuits to nil
    // and the destination_name fallback never runs. We mirror that behaviour exactly.
    expect(
      bannerDestinationHeadline({
        schedule: { dest_address: '' },
        destination_name: 'Davis',
      }),
    ).toBeNull()
  })

  it('returns null when no destination on either side', () => {
    expect(bannerDestinationHeadline({})).toBeNull()
  })

  it('returns null when both fields are empty strings', () => {
    expect(
      bannerDestinationHeadline({
        schedule: { dest_address: '' },
        destination_name: '',
      }),
    ).toBeNull()
  })

  it('takes only the first comma-separated segment', () => {
    expect(
      bannerDestinationHeadline({
        schedule: { dest_address: '123 Main St, Sacramento, CA 95814' },
      }),
    ).toBe('123 Main St')
  })

  it('trims whitespace from the segment', () => {
    expect(
      bannerDestinationHeadline({
        schedule: { dest_address: '  Sacramento  , CA' },
      }),
    ).toBe('Sacramento')
  })

  it('returns full string when no comma is present', () => {
    expect(
      bannerDestinationHeadline({
        schedule: { dest_address: 'Sacramento' },
      }),
    ).toBe('Sacramento')
  })
})
