/**
 * Persists the driver's most-recently-used `available_seats` value
 * so the Ride Board "Post this search" CTA can pre-fill the seat
 * picker with their typical preference. Web mirror of iOS'
 * `LastSeatsStore.swift`.
 */

const KEY = 'tago:schedulePost.lastSeats.v1'

export function getLastSeats(): number {
  if (typeof localStorage === 'undefined') return 1
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return 1
    const n = Number(raw)
    return Number.isFinite(n) && n >= 1 && n <= 8 ? Math.floor(n) : 1
  } catch {
    return 1
  }
}

export function rememberLastSeats(seats: number): void {
  if (typeof localStorage === 'undefined') return
  if (!Number.isFinite(seats) || seats < 1 || seats > 8) return
  try {
    localStorage.setItem(KEY, String(Math.floor(seats)))
  } catch {
    // ignore
  }
}
