import { describe, it, expect } from 'vitest'
import { calculateBearing, calculateInterceptPoint, haversineMetres } from '@/lib/geo'

describe('calculateBearing', () => {
  it('returns 0 for due north', () => {
    const bearing = calculateBearing(0, 0, 1, 0)
    expect(bearing).toBeCloseTo(0, 0)
  })

  it('returns 90 for due east at equator', () => {
    const bearing = calculateBearing(0, 0, 0, 1)
    expect(bearing).toBeCloseTo(90, 0)
  })

  it('returns 180 for due south', () => {
    const bearing = calculateBearing(1, 0, 0, 0)
    expect(bearing).toBeCloseTo(180, 0)
  })

  it('returns 270 for due west at equator', () => {
    const bearing = calculateBearing(0, 0, 0, -1)
    expect(bearing).toBeCloseTo(270, 0)
  })

  it('returns a value between 0 and 360', () => {
    const bearing = calculateBearing(38.54, -121.76, 37.77, -122.42)
    expect(bearing).toBeGreaterThanOrEqual(0)
    expect(bearing).toBeLessThan(360)
  })
})

// ── calculateInterceptPoint tests ─────────────────────────────────────────────

describe('calculateInterceptPoint', () => {
  // Route along a north-south line at lng -121.76
  const NS_ROUTE = [
    { lat: 38.50, lng: -121.76 },
    { lat: 38.52, lng: -121.76 },
    { lat: 38.54, lng: -121.76 },
    { lat: 38.56, lng: -121.76 },
    { lat: 38.58, lng: -121.76 },
  ]

  it('returns the nearest point on the route for a standard intercept', () => {
    // Rider is slightly east of the route, near the middle
    const result = calculateInterceptPoint(NS_ROUTE, 38.54, -121.758)
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(38.54, 2)
    expect(result!.lng).toBeCloseTo(-121.76, 2)
    expect(result!.walkDistanceM).toBeGreaterThan(0)
    expect(result!.walkDistanceM).toBeLessThan(420) // within 5 min walk
  })

  it('returns the exact point when rider is on the route', () => {
    const result = calculateInterceptPoint(NS_ROUTE, 38.54, -121.76)
    expect(result).not.toBeNull()
    expect(result!.walkDistanceM).toBeLessThan(1) // essentially zero
    expect(result!.walkTimeSeconds).toBeLessThan(1)
  })

  it('returns null when all route points exceed 5-minute walk', () => {
    // Rider is ~5 km east — far beyond 420m max walk
    const result = calculateInterceptPoint(NS_ROUTE, 38.54, -121.70)
    expect(result).toBeNull()
  })

  it('snaps to first segment when rider is nearest to start of route', () => {
    // Rider slightly east of the route's start
    const result = calculateInterceptPoint(NS_ROUTE, 38.50, -121.758)
    expect(result).not.toBeNull()
    expect(result!.segmentIndex).toBe(0)
    expect(result!.lat).toBeCloseTo(38.50, 2)
  })

  it('snaps to last segment when rider is nearest to end of route', () => {
    const result = calculateInterceptPoint(NS_ROUTE, 38.58, -121.758)
    expect(result).not.toBeNull()
    expect(result!.segmentIndex).toBe(3) // last segment index
    expect(result!.lat).toBeCloseTo(38.58, 2)
  })

  it('bearing from rider to intercept is within 5 degrees of perpendicular', () => {
    // Route goes north (bearing ~0°). Rider is east → should walk west (bearing ~270°)
    const result = calculateInterceptPoint(NS_ROUTE, 38.54, -121.758)
    expect(result).not.toBeNull()
    const bearing = calculateBearing(38.54, -121.758, result!.lat, result!.lng)
    // Walking direction should be roughly west (270°), allow ±5°
    expect(bearing).toBeGreaterThan(265)
    expect(bearing).toBeLessThan(275)
  })

  it('returns null for empty route', () => {
    const result = calculateInterceptPoint([], 38.54, -121.76)
    expect(result).toBeNull()
  })

  it('handles single-point route within walk distance', () => {
    const result = calculateInterceptPoint(
      [{ lat: 38.54, lng: -121.76 }],
      38.54, -121.758,
    )
    expect(result).not.toBeNull()
    expect(result!.walkDistanceM).toBeGreaterThan(0)
    expect(result!.segmentIndex).toBe(0)
  })
})

// ── haversineMetres tests ─────────────────────────────────────────────────────

describe('haversineMetres', () => {
  it('returns 0 for same point', () => {
    expect(haversineMetres(38.54, -121.76, 38.54, -121.76)).toBe(0)
  })

  it('returns approximately correct distance for known points', () => {
    // Davis to Sacramento is about 25 km
    const d = haversineMetres(38.5449, -121.7405, 38.5816, -121.4944)
    expect(d).toBeGreaterThan(20_000)
    expect(d).toBeLessThan(30_000)
  })
})
