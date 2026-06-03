/**
 * v1.3 Sprint 11 Slice 3 — safetyReportCategories unit tests.
 *
 * Pins the role-aware split that closes the iOS↔web parity gap:
 *  - Rider sees driver-facing categories ("Unsafe driving" …)
 *  - Driver sees rider-facing categories ("Rider was aggressive" …)
 *  - Both lists end with `other` as the catch-all
 *  - rawValues match iOS SafetyReportCategory.swift verbatim so the
 *    server's LEGACY_CATEGORY_MAP (report.ts:73-93) accepts them
 *  - SAFETY_REPORT_DETAILS_FOOTER copy matches iOS
 *    ReportSafetyView.detailsFooter verbatim
 */
import { describe, it, expect } from 'vitest'
import {
  availableFor,
  SAFETY_REPORT_DETAILS_FOOTER,
} from '@/lib/safetyReportCategories'

describe('availableFor', () => {
  it('returns 5 rider categories for role="rider" (4 named + other)', () => {
    const list = availableFor('rider')
    expect(list).toHaveLength(5)
    expect(list.map((c) => c.value)).toEqual([
      'unsafe_driving',
      'inappropriate_behavior',
      'wrong_route',
      'no_show',
      'other',
    ])
  })

  it('returns 5 driver categories for role="driver" (4 named + other)', () => {
    const list = availableFor('driver')
    expect(list).toHaveLength(5)
    expect(list.map((c) => c.value)).toEqual([
      'rider_aggression',
      'rider_damage',
      'rider_threat',
      'rider_no_show',
      'other',
    ])
  })

  it('falls back to the rider list when role is null (loading / unknown)', () => {
    expect(availableFor(null).map((c) => c.value)).toEqual([
      'unsafe_driving',
      'inappropriate_behavior',
      'wrong_route',
      'no_show',
      'other',
    ])
  })

  it('labels match iOS SafetyReportCategory.swift verbatim', () => {
    expect(availableFor('rider').find((c) => c.value === 'unsafe_driving')?.label)
      .toBe('Unsafe driving')
    expect(availableFor('rider').find((c) => c.value === 'inappropriate_behavior')?.label)
      .toBe('Driver was inappropriate')
    expect(availableFor('driver').find((c) => c.value === 'rider_aggression')?.label)
      .toBe('Rider was aggressive / hostile')
    expect(availableFor('driver').find((c) => c.value === 'rider_threat')?.label)
      .toBe('Threatening behavior')
    // "other" label is shared across both roles.
    expect(availableFor('rider').find((c) => c.value === 'other')?.label)
      .toBe('Other safety concern')
    expect(availableFor('driver').find((c) => c.value === 'other')?.label)
      .toBe('Other safety concern')
  })
})

describe('SAFETY_REPORT_DETAILS_FOOTER', () => {
  it('matches iOS ReportSafetyView.detailsFooter verbatim', () => {
    expect(SAFETY_REPORT_DETAILS_FOOTER).toBe(
      "Tago's safety team reviews every report. Add as much detail as you can — driver behaviour, location, time, anything that helps.",
    )
  })
})
