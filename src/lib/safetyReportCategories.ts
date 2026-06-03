/**
 * v1.3 Sprint 11 Slice 3 — role-aware safety report categories.
 *
 * Mirrors iOS `SafetyReportCategory.swift` 1:1. The original 5-case
 * rider-perspective set assumed the reporter is a rider complaining
 * about a driver ("unsafe driving" / "wrong route"). The 2026-05-21
 * iOS split added 4 driver-perspective cases (`rider_aggression`,
 * `rider_damage`, `rider_threat`, `rider_no_show`) so a driver
 * filing a safety report against their own rider sees relevant
 * options. Web was rider-only until this slice.
 *
 * `rawValue` strings MUST stay stable — iOS build 7 still POSTs the
 * original 5 values. The server's `LEGACY_CATEGORY_MAP` at
 * `server/routes/report.ts:73-93` accepts all 9 rawValues (rider +
 * driver + shared `other`) and rolls them up to the admin taxonomy:
 *   rider_aggression / rider_threat → safety_during_ride
 *   rider_damage                    → rider_conduct
 *   rider_no_show                   → cancellation_dispute
 */
import type { RideRole } from '@/hooks/useRideRole'

export type SafetyReportCategoryValue =
  // ── Rider perspective (existing build-7-compat cases) ─────────────
  | 'unsafe_driving'
  | 'inappropriate_behavior'
  | 'wrong_route'
  | 'no_show'
  // ── Driver perspective (added 2026-05-21) ────────────────────────
  | 'rider_aggression'
  | 'rider_damage'
  | 'rider_threat'
  | 'rider_no_show'
  // ── Shared catch-all (used by both roles) ────────────────────────
  | 'other'

export interface SafetyReportCategory {
  value: SafetyReportCategoryValue
  /** Human-readable label shown in the picker. Verbatim against iOS
   *  `SafetyReportCategory.label`. */
  label: string
}

const RIDER_CATEGORIES: readonly SafetyReportCategory[] = [
  { value: 'unsafe_driving',         label: 'Unsafe driving' },
  { value: 'inappropriate_behavior', label: 'Driver was inappropriate' },
  { value: 'wrong_route',            label: 'Wrong route / detour' },
  { value: 'no_show',                label: 'Driver no-show / abandonment' },
  { value: 'other',                  label: 'Other safety concern' },
]

const DRIVER_CATEGORIES: readonly SafetyReportCategory[] = [
  { value: 'rider_aggression', label: 'Rider was aggressive / hostile' },
  { value: 'rider_damage',     label: 'Rider damaged the vehicle' },
  { value: 'rider_threat',     label: 'Threatening behavior' },
  { value: 'rider_no_show',    label: 'Rider no-show / abandoned ride' },
  { value: 'other',            label: 'Other safety concern' },
]

/**
 * Which cases to surface to a given viewer role. Each list ends with
 * `other` as a deliberate catch-all so the user always has a
 * fallback when their situation doesn't fit a named bucket.
 *
 * `role === null` (loading / unknown) falls back to the rider list
 * — matches the deployed pre-split behaviour and keeps the
 * EmergencySheet render path stable.
 */
export function availableFor(role: RideRole | null): readonly SafetyReportCategory[] {
  return role === 'driver' ? DRIVER_CATEGORIES : RIDER_CATEGORIES
}

/**
 * Verbatim against iOS `ReportSafetyView.detailsFooter` — surfaced
 * under the description textarea so the user knows what kind of
 * detail helps the safety team triage faster.
 */
export const SAFETY_REPORT_DETAILS_FOOTER =
  "Tago's safety team reviews every report. Add as much detail as you can — driver behaviour, location, time, anything that helps."
