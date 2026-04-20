/** Ride-board filter types + helpers shared between RideBoard and RideBoardFilterSheet. */

export type TimeFilter = 'all' | 'today' | 'week' | 'custom'
export type SeatsFilter = 'any' | '2plus'
export type SortMode = 'recent' | 'nearest'

export interface RideBoardFilters {
  time: TimeFilter
  customDate?: string
  seats: SeatsFilter
  nearMeOnly: boolean
  sort: SortMode
}

export const DEFAULT_FILTERS: RideBoardFilters = {
  time: 'all',
  seats: 'any',
  nearMeOnly: false,
  sort: 'recent',
}

export function countActiveFilters(f: RideBoardFilters): number {
  let n = 0
  if (f.time !== 'all') n++
  if (f.seats !== 'any') n++
  if (f.nearMeOnly) n++
  if (f.sort !== 'recent') n++
  return n
}
