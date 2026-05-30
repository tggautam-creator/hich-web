import { describe, it, expect } from 'vitest'
import {
  CALIFORNIA_FOUR_YEAR_UNIVERSITIES,
  graduationYearOptions,
  schoolPickerOptions,
} from '@/lib/universities'

describe('CALIFORNIA_FOUR_YEAR_UNIVERSITIES', () => {
  it('exposes a deterministic list (50 entries spanning UC/CSU/privates)', () => {
    expect(CALIFORNIA_FOUR_YEAR_UNIVERSITIES.length).toBe(50)
    expect(CALIFORNIA_FOUR_YEAR_UNIVERSITIES).toContain('UC Davis')
    expect(CALIFORNIA_FOUR_YEAR_UNIVERSITIES).toContain('Cal Poly San Luis Obispo')
    expect(CALIFORNIA_FOUR_YEAR_UNIVERSITIES).toContain('Stanford University')
  })

  it('has no duplicates', () => {
    const set = new Set(CALIFORNIA_FOUR_YEAR_UNIVERSITIES)
    expect(set.size).toBe(CALIFORNIA_FOUR_YEAR_UNIVERSITIES.length)
  })
})

describe('schoolPickerOptions', () => {
  it('returns no legacy entry when saved value is null / blank', () => {
    expect(schoolPickerOptions(null).legacy).toBeNull()
    expect(schoolPickerOptions(undefined).legacy).toBeNull()
    expect(schoolPickerOptions('').legacy).toBeNull()
    expect(schoolPickerOptions('   ').legacy).toBeNull()
  })

  it('returns no legacy entry when saved value matches the canonical list', () => {
    expect(schoolPickerOptions('UC Davis').legacy).toBeNull()
    expect(schoolPickerOptions('Stanford University').legacy).toBeNull()
  })

  it('splices legacy value when saved string is not in the canonical list', () => {
    expect(schoolPickerOptions('Harvard').legacy).toBe('Harvard')
    expect(schoolPickerOptions('MIT ').legacy).toBe('MIT')
  })
})

describe('graduationYearOptions', () => {
  // Use a fixed "now" so the window is deterministic.
  const FIXED_NOW = new Date('2026-06-15')

  it('returns a 17-year window centred slightly forward of today', () => {
    const years = graduationYearOptions(null, FIXED_NOW)
    // currentYear - 6 ... currentYear + 10  →  2020 ... 2036
    expect(years[0]).toBe(2036)
    expect(years[years.length - 1]).toBe(2020)
    expect(years.length).toBe(17)
  })

  it('sorts descending so the latest years are first', () => {
    const years = graduationYearOptions(null, FIXED_NOW)
    for (let i = 1; i < years.length; i++) {
      expect(years[i]).toBeLessThan(years[i - 1]!)
    }
  })

  it('splices a saved year that falls outside the default window', () => {
    const years = graduationYearOptions(2010, FIXED_NOW)
    expect(years).toContain(2010)
    expect(years.length).toBe(18)
  })

  it('ignores out-of-range saved years (< 1980 or > 2100)', () => {
    const years = graduationYearOptions(1900, FIXED_NOW)
    expect(years).not.toContain(1900)
    expect(years.length).toBe(17)
  })

  it('de-duplicates if the saved year is already inside the default window', () => {
    const years = graduationYearOptions(2026, FIXED_NOW)
    expect(years.filter((y) => y === 2026)).toHaveLength(1)
    expect(years.length).toBe(17)
  })
})
