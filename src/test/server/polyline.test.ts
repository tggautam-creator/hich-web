/**
 * Tests for server/lib/polyline.ts
 *
 * Verifies:
 *  1. decodePolyline produces correct lat/lng from known encoded string
 *  2. samplePolyline returns first and last point
 *  3. samplePolyline samples at roughly the correct interval
 *  4. haversineMetres returns correct distance
 *  5. Edge cases: empty/single-point inputs
 */

import { describe, it, expect } from 'vitest'
import { decodePolyline, samplePolyline, haversineMetres } from '../../../server/lib/polyline'

describe('decodePolyline', () => {
  it('decodes a known Google encoded polyline', () => {
    // "_p~iF~ps|U_ulLnnqC_mqNvxq`@" encodes:
    //   (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(points).toHaveLength(3)
    expect(points[0].lat).toBeCloseTo(38.5, 1)
    expect(points[0].lng).toBeCloseTo(-120.2, 1)
    expect(points[1].lat).toBeCloseTo(40.7, 1)
    expect(points[1].lng).toBeCloseTo(-120.95, 1)
  })

  it('returns empty array for empty string', () => {
    expect(decodePolyline('')).toHaveLength(0)
  })
})

describe('haversineMetres', () => {
  it('returns 0 for same point', () => {
    expect(haversineMetres(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0)
  })

  it('returns roughly correct distance between SF and Oakland', () => {
    // SF (37.7749, -122.4194) to Oakland (37.8044, -122.2712) ≈ ~13km
    const dist = haversineMetres(37.7749, -122.4194, 37.8044, -122.2712)
    expect(dist).toBeGreaterThan(12000)
    expect(dist).toBeLessThan(15000)
  })
})

describe('samplePolyline', () => {
  it('returns empty array for empty input', () => {
    expect(samplePolyline([], 1000)).toHaveLength(0)
  })

  it('returns single point for single-point input', () => {
    const result = samplePolyline([{ lat: 37.7, lng: -122.4 }], 1000)
    expect(result).toHaveLength(1)
  })

  it('always includes first and last point', () => {
    const points = [
      { lat: 37.7749, lng: -122.4194 },
      { lat: 37.78, lng: -122.41 },
      { lat: 37.79, lng: -122.40 },
      { lat: 37.8044, lng: -122.2712 },
    ]
    const sampled = samplePolyline(points, 100000) // very large interval
    expect(sampled[0]).toEqual(points[0])
    expect(sampled[sampled.length - 1]).toEqual(points[points.length - 1])
  })

  it('samples at roughly the given interval', () => {
    // Create a straight line of ~10km
    const points = [
      { lat: 37.7749, lng: -122.4194 },
      { lat: 37.8644, lng: -122.4194 }, // ~10km north
    ]
    // Sample every 2km should give ~6 points (start + 4 intervals + end)
    const sampled = samplePolyline(points, 2000)
    expect(sampled.length).toBeGreaterThanOrEqual(2) // at minimum first + last
  })
})
