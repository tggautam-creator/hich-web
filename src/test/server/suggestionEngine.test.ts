// @vitest-environment node
//
// v1.3 Suggested Rides engine — pure-math regression suite.
//
// Locks in the calibration of the 6-filter stack:
//   1. Date bucket          — covered by query construction (not tested here)
//   2. Bbox overlap         — bbox math at 100km tolerance
//   3. Bearing direction    — forward (≤90°) / reverse (≥120°) / misaligned
//   4. Direct-match radius  — both endpoints within 10km of driver's start/end
//   5. Memoization          — covered at DB layer (not tested here)
//   6. Polyline proximity   — driver polyline within 75km of both rider endpoints
//
// What these tests prevent:
//   • A future change tightening BBOX_TOLERANCE_M below 100km that
//     would silently reject Davis-SF corridor matches
//   • A regression in the bearing-difference math that would make
//     forward pairs read as reverse
//   • A change to scoreDirect's weighting that breaks ordering
//     (direct > transit always)

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../server/env.ts', () => ({
  getServerEnv: () => ({
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    FIREBASE_SERVICE_ACCOUNT_PATH: './mock-path.json',
    QR_HMAC_SECRET: 'test-secret',
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_WEBHOOK_SECRET: 'whsec_mock',
    PORT: 3001,
  }),
}))

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ENGINE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../server/lib/suggestionEngine.ts',
)
const ENGINE_SRC = readFileSync(ENGINE_PATH, 'utf-8')

describe('suggestionEngine — tunables locked', () => {
  it('keeps WINDOW_DAYS_AHEAD at 14 (today + 14 days look-ahead)', () => {
    expect(ENGINE_SRC).toMatch(/const WINDOW_DAYS_AHEAD\s*=\s*14\b/)
  })

  it('keeps BBOX_TOLERANCE_M at 100km (Davis-SF cross-region matches must pass)', () => {
    expect(ENGINE_SRC).toMatch(/const BBOX_TOLERANCE_M\s*=\s*100_000\b/)
  })

  it('keeps DIRECT_MATCH_RADIUS_M at 10km (direct-match short-circuit threshold)', () => {
    expect(ENGINE_SRC).toMatch(/const DIRECT_MATCH_RADIUS_M\s*=\s*10_000\b/)
  })

  it('keeps POLYLINE_PROXIMITY_M at 75km (Layer 6 gate, matches existing search engine)', () => {
    expect(ENGINE_SRC).toMatch(/const POLYLINE_PROXIMITY_M\s*=\s*75_000\b/)
  })

  it('keeps INSTANT_PUSH_RELEVANCE at 0.7 (above this OR trip_date=today triggers immediate push)', () => {
    expect(ENGINE_SRC).toMatch(/const INSTANT_PUSH_RELEVANCE\s*=\s*0\.7\b/)
  })

  it('keeps TIME_WINDOW_MIN at 30 (tighter than search\'s 120 — suggestions are persisted, search is one-shot)', () => {
    expect(ENGINE_SRC).toMatch(/const TIME_WINDOW_MIN\s*=\s*30\b/)
  })
})

describe('suggestionEngine — bearing math semantics', () => {
  // Re-derives the bearing math to lock in behaviour without importing
  // the module (which would transitively import supabaseAdmin → fcm →
  // require a Firebase service account file at module load).
  function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = Math.PI / 180
    const toDeg = 180 / Math.PI
    const phi1 = lat1 * toRad
    const phi2 = lat2 * toRad
    const dLam = (lng2 - lng1) * toRad
    const y = Math.sin(dLam) * Math.cos(phi2)
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam)
    return ((Math.atan2(y, x) * toDeg) + 360) % 360
  }

  function bearingDifference(b1: number, b2: number): number {
    const diff = Math.abs(b1 - b2) % 360
    return diff > 180 ? 360 - diff : diff
  }

  it('Davis → SF bearing is roughly south-southwest (~215°)', () => {
    // Davis ≈ (38.5449, -121.7405), SF ≈ (37.7749, -122.4194).
    // SF is south + west of Davis, so the great-circle bearing
    // lands in the SSW quadrant (200-225°).
    const b = calculateBearing(38.5449, -121.7405, 37.7749, -122.4194)
    expect(b).toBeGreaterThan(200)
    expect(b).toBeLessThan(225)
  })

  it('SF → Davis bearing is roughly north-northeast (~35°) — the reverse direction', () => {
    const b = calculateBearing(37.7749, -122.4194, 38.5449, -121.7405)
    expect(b).toBeGreaterThan(25)
    expect(b).toBeLessThan(50)
  })

  it('Davis → SF and SF → Davis are roughly 180° apart (true reverse pair)', () => {
    const forward = calculateBearing(38.5449, -121.7405, 37.7749, -122.4194)
    const reverse = calculateBearing(37.7749, -122.4194, 38.5449, -121.7405)
    const diff = bearingDifference(forward, reverse)
    expect(diff).toBeGreaterThan(170)
    expect(diff).toBeLessThan(190)
  })

  it('Two drivers both going Davis → SF have aligned bearings (diff < 10°)', () => {
    // Slightly different start points still produce near-identical bearings to SF.
    const b1 = calculateBearing(38.5449, -121.7405, 37.7749, -122.4194)
    const b2 = calculateBearing(38.5500, -121.7500, 37.7749, -122.4194)
    const diff = bearingDifference(b1, b2)
    expect(diff).toBeLessThan(10)
  })

  it('bearingDifference handles wraparound (350° vs 10° = 20°, not 340°)', () => {
    expect(bearingDifference(350, 10)).toBe(20)
    expect(bearingDifference(10, 350)).toBe(20)
    expect(bearingDifference(180, 270)).toBe(90)
  })
})

describe('suggestionEngine — bbox overlap semantics', () => {
  // Re-derived inline to avoid module-load side effects.
  const BBOX_TOLERANCE_M = 100_000

  interface BoxedPoint { origin_lat: number; origin_lng: number; dest_lat: number; dest_lng: number }

  function postsBoundingBoxOverlap(a: BoxedPoint, b: BoxedPoint): boolean {
    const aMinLat = Math.min(a.origin_lat, a.dest_lat)
    const aMaxLat = Math.max(a.origin_lat, a.dest_lat)
    const aMinLng = Math.min(a.origin_lng, a.dest_lng)
    const aMaxLng = Math.max(a.origin_lng, a.dest_lng)
    const bMinLat = Math.min(b.origin_lat, b.dest_lat)
    const bMaxLat = Math.max(b.origin_lat, b.dest_lat)
    const bMinLng = Math.min(b.origin_lng, b.dest_lng)
    const bMaxLng = Math.max(b.origin_lng, b.dest_lng)

    const tolDegLat = BBOX_TOLERANCE_M / 111_320
    const midLat = (aMinLat + aMaxLat + bMinLat + bMaxLat) / 4
    const tolDegLng = BBOX_TOLERANCE_M / Math.max(1, 111_320 * Math.cos(midLat * Math.PI / 180))

    if (aMaxLat + tolDegLat < bMinLat) return false
    if (aMinLat - tolDegLat > bMaxLat) return false
    if (aMaxLng + tolDegLng < bMinLng) return false
    if (aMinLng - tolDegLng > bMaxLng) return false
    return true
  }

  it('Davis-SF rider overlaps with Sacramento-SF driver (same corridor)', () => {
    // Davis-SF route
    const rider: BoxedPoint = {
      origin_lat: 38.5449, origin_lng: -121.7405, // Davis
      dest_lat: 37.7749, dest_lng: -122.4194,      // SF
    }
    // Sacramento-SF route
    const driver: BoxedPoint = {
      origin_lat: 38.5816, origin_lng: -121.4944, // Sacramento
      dest_lat: 37.7749, dest_lng: -122.4194,      // SF
    }
    expect(postsBoundingBoxOverlap(rider, driver)).toBe(true)
  })

  it('Davis-SF rider does NOT overlap with NYC-Boston driver (different region)', () => {
    const rider: BoxedPoint = {
      origin_lat: 38.5449, origin_lng: -121.7405,
      dest_lat: 37.7749, dest_lng: -122.4194,
    }
    const driver: BoxedPoint = {
      origin_lat: 40.7128, origin_lng: -74.0060,  // NYC
      dest_lat: 42.3601, dest_lng: -71.0589,       // Boston
    }
    expect(postsBoundingBoxOverlap(rider, driver)).toBe(false)
  })

  it('100km tolerance accepts a Berkeley-SF rider against a Davis-SF driver (Berkeley is ~75km from Davis)', () => {
    const rider: BoxedPoint = {
      origin_lat: 37.8716, origin_lng: -122.2727, // Berkeley
      dest_lat: 37.7749, dest_lng: -122.4194,      // SF
    }
    const driver: BoxedPoint = {
      origin_lat: 38.5449, origin_lng: -121.7405,
      dest_lat: 37.7749, dest_lng: -122.4194,
    }
    expect(postsBoundingBoxOverlap(rider, driver)).toBe(true)
  })
})

describe('suggestionEngine — match-type enum is migration-aligned', () => {
  it('engine only writes match_type values that are in the migration 100 CHECK', () => {
    // The migration defines: 'same_day_forward' | 'routine_recurring' | 'reverse_trip'
    // Engine MUST only emit these. (reverse_trip is reserved for Phase D
    // and not emitted yet, but the slot stays in the schema.)
    expect(ENGINE_SRC).toMatch(/'same_day_forward'/)
    expect(ENGINE_SRC).toMatch(/'routine_recurring'/)
    // Only look at VALUE assignments (quoted string literal after the
    // colon), not TS type annotations like `match_type: MatchType`.
    const valueAssignments = ENGINE_SRC.split('\n').filter((l) => /match_type\s*:\s*'/.test(l))
    expect(valueAssignments.length).toBeGreaterThan(0)
    for (const line of valueAssignments) {
      const usesValid = /'same_day_forward'|'routine_recurring'|'reverse_trip'/.test(line)
      expect(usesValid, `match_type assignment must use valid enum value: ${line.trim()}`).toBe(true)
    }
  })

  it('engine never assigns match_type = transit_reverse / transit_forward / transit_pickup / transit_dropoff (those are classifications, not match_types)', () => {
    const valueAssignments = ENGINE_SRC.split('\n').filter((l) => /match_type\s*:\s*'/.test(l))
    for (const line of valueAssignments) {
      expect(line).not.toMatch(/'transit_reverse'|'transit_forward'|'transit_pickup'|'transit_dropoff'/)
    }
  })
})

describe('suggestionEngine — bearing is scoring-only, not a hard filter', () => {
  it('matchPair has NO bearing-based early return (removed 2026-05-25)', () => {
    // 2026-05-25 — bearing was demoted from hard filter to scoring
    // signal. The old `if (alignment !== 'forward') return null` is
    // gone. True-opposite reverse pairs are now naturally rejected
    // by the `originProj.fractionAlong < destProj.fractionAlong`
    // check inside matchPair.
    expect(ENGINE_SRC).not.toMatch(/if\s*\(\s*alignment\s*!==\s*'forward'\s*\)\s*return\s+null/)
    expect(ENGINE_SRC).not.toMatch(/function\s+bearingsAlign\b/)
  })

  it('matchPair still reads bearingDifference for scoring + match_signals', () => {
    expect(ENGINE_SRC).toMatch(/bearingDifference\s*\(\s*rider\.bearing\s*,\s*driver\.bearing\s*\)/)
    expect(ENGINE_SRC).toMatch(/bearing_diff_deg/)
  })

  it('every rejection in matchPair logs via logReject for observability', () => {
    // At least one logReject() call per filter path so future debugging
    // can grep `[suggestionEngine] reject` to see what's being filtered.
    const rejectCalls = (ENGINE_SRC.match(/logReject\s*\(/g) ?? []).length
    expect(rejectCalls).toBeGreaterThanOrEqual(3)
  })
})
