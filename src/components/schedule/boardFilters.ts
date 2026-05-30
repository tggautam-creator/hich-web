/** Ride-board filter types + helpers shared between RideBoard and RideBoardFilterSheet. */

export type TimeFilter = 'all' | 'today' | 'week' | 'custom'
export type SeatsFilter = 'any' | '2plus'
export type SortMode = 'recent' | 'nearest'
/**
 * v1.2 F5.3 — accessibility filter. `'accessibility_only'` keeps only
 * posts where the poster declared a wheelchair need (server returns
 * `needs_wheelchair === true`). Mirrors iOS `RideBoardFilters.AccessibilityFilter`.
 * The spec sketched a 4-option enum (vehicle wheelchair-capable /
 * caregiver-attached / both); the 2-option v1 ships first.
 */
export type AccessibilityFilter = 'any' | 'accessibility_only'

export interface RideBoardFilters {
  time: TimeFilter
  customDate?: string
  seats: SeatsFilter
  nearMeOnly: boolean
  sort: SortMode
  accessibility: AccessibilityFilter
}

export const DEFAULT_FILTERS: RideBoardFilters = {
  time: 'all',
  seats: 'any',
  nearMeOnly: false,
  sort: 'recent',
  accessibility: 'any',
}

export function countActiveFilters(f: RideBoardFilters): number {
  let n = 0
  if (f.time !== 'all') n++
  if (f.seats !== 'any') n++
  if (f.nearMeOnly) n++
  if (f.sort !== 'recent') n++
  if (f.accessibility !== 'any') n++
  return n
}
