// @vitest-environment node
//
// v1.2.1 S3 — Search-engine calibration regression suite.
//
// This is the FIRST PASS of the search-engine test suite scoped in
// `docs/SMART_SEARCH_AUDIT.md` §9. It locks in the constants +
// static-hub-list calibration that S1 + S2.1 shipped. A FUTURE pass
// (S3.2, deferred) will add full integration tests of the
// `/board/search` loop with mocked Google API responses.
//
// What these tests prevent:
//   • Someone accidentally reverts `HANDOFF_MAX_PRECHECK_METRES`
//     from 75 km back to the old 30 km, re-introducing the Davis→SF
//     handoff failure that motivated v1.2.1.
//   • Someone deletes one of the v1.2.1 hub additions (5 I-680 BART
//     stations, 4 ferries, Salesforce Transit Center, 5 mid-Peninsula
//     Caltrain) during a future cleanup, silently losing coverage.
//   • Someone tightens `SEARCH_RADIUS_M` below 4 km and re-introduces
//     the freeway-adjacent-station miss.
//
// Why this matters more than a typical unit test: these aren't bugs
// caught at compile time — they're CALIBRATION values where the
// failure mode is "search results silently get worse without
// anything obviously breaking." Locking the numbers in a test
// surfaces the regression at PR-review time.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Mock the env BEFORE transitSuggestions transitively imports
// `apiUsage.ts` → `supabaseAdmin.ts` (which calls `getServerEnv()`
// at module top-level and throws when SUPABASE_URL is missing).
// Same pattern as schedule.request.test.ts:38.
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

import {
  MAJOR_TRANSIT_HUBS,
  SEARCH_RADIUS_M,
} from '../../../server/lib/transitSuggestions.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const SCHEDULE_TS = readFileSync(resolve(REPO_ROOT, 'server/routes/schedule.ts'), 'utf8')

describe('v1.2.1 S1: search-engine constants', () => {
  it('SEARCH_RADIUS_M is 4000 (bumped from 1500 in S1)', () => {
    // 1500m was too tight for freeway-adjacent BART stations
    // (Walnut Creek BART is ~1-2 km off I-680). 4000m reliably
    // catches them via Google Places Nearby search.
    expect(SEARCH_RADIUS_M).toBe(4000)
  })

  it('HANDOFF_MAX_PRECHECK_METRES is 75_000 in BOTH search branches', () => {
    // 30km was right on the boundary for SF↔East-Bay handoffs
    // (SF sits ~30km from any I-680-routed polyline). 75km is the
    // actual ceiling for reasonable transit legs in the Bay Area
    // (BART end-to-end ~70km, Caltrain SF↔San Jose ~80km).
    //
    // The constant is defined twice in schedule.ts — once in the
    // rider-side search path and once in `runDriverSideSearch`.
    // Both MUST stay in sync; this test fails loudly if either
    // drifts back.
    const matches = SCHEDULE_TS.match(/HANDOFF_MAX_PRECHECK_METRES = 75_000/g) ?? []
    expect(matches.length, 'expected 2 occurrences (rider-side + driver-side)').toBe(2)
  })

  it('no leftover HANDOFF_MAX_PRECHECK_METRES = 30_000 (old value)', () => {
    // Defense-in-depth: catch a partial revert that updates one
    // branch but leaves the other at the old value.
    expect(SCHEDULE_TS).not.toMatch(/HANDOFF_MAX_PRECHECK_METRES = 30_000/)
  })
})

describe('v1.2.1 S1: MAJOR_TRANSIT_HUBS coverage', () => {
  it('contains at least 40 entries (post-v1.2.1 S1+S3)', () => {
    // Floor only — additions are allowed; deletions get flagged.
    // Current count after S1 (added 13 hubs) + S3 (removed 1
    // dedup-colliding Sacramento Valley RT) is 44. Floor set to
    // 40 to allow minor data hygiene without breaking tests.
    expect(MAJOR_TRANSIT_HUBS.length).toBeGreaterThanOrEqual(40)
  })

  // ── I-680 corridor BART (added 2026-05-21) ────────────────────
  // These 5 stations are the natural handoff points for any
  // East-Bay-bound driver heading to SF via BART. Their absence
  // was the second-level cause of the original Davis→SF /
  // Davis→San Jose handoff failure.
  it.each([
    'North Concord/Martinez BART',
    'Pleasant Hill/Contra Costa Centre BART',
    'Lafayette BART',
    'Orinda BART',
    'Rockridge BART',
  ])('I-680 corridor hub present: %s', (name) => {
    expect(MAJOR_TRANSIT_HUBS.some((h) => h.name === name)).toBe(true)
  })

  // ── Bay Area ferries (added 2026-05-21) ───────────────────────
  // Cover the water-handoff scenarios that no BART line reaches
  // (Vallejo → SF, Larkspur → SF, etc.).
  it.each([
    'San Francisco Ferry Building',
    'Vallejo Ferry Terminal',
    'Larkspur Ferry Terminal',
    'Sausalito Ferry Terminal',
  ])('ferry hub present: %s', (name) => {
    expect(MAJOR_TRANSIT_HUBS.some((h) => h.name === name)).toBe(true)
  })

  // ── Salesforce Transit Center (added 2026-05-21) ──────────────
  // Canonical SF intercity bus hub (FlixBus, Greyhound, AC
  // Transit, Muni). Drivers ending in SF can drop intercity-bound
  // riders here.
  it('Salesforce Transit Center present', () => {
    expect(MAJOR_TRANSIT_HUBS.some((h) => h.name === 'Salesforce Transit Center')).toBe(true)
  })

  // ── Mid-Peninsula Caltrain (added 2026-05-21) ─────────────────
  // Closes the SF↔San Jose gap (Millbrae was the only mid-stop
  // before; now riders bound for Redwood City / San Mateo / etc.
  // can be dropped at the right station).
  it.each([
    'Millbrae Caltrain',
    'San Mateo Caltrain',
    'Redwood City Caltrain',
    'Mountain View Caltrain',
    'Sunnyvale Caltrain',
  ])('mid-Peninsula Caltrain hub present: %s', (name) => {
    expect(MAJOR_TRANSIT_HUBS.some((h) => h.name === name)).toBe(true)
  })

  // ── Pre-existing must-haves (regression guard) ────────────────
  // These were in the original 14-entry list before v1.2.1 — but
  // they're so load-bearing for the most common Bay Area corridors
  // that explicit checks are worth the noise.
  it.each([
    'Walnut Creek BART',
    'Embarcadero BART',
    'MacArthur BART',
    'Millbrae BART/Caltrain',
    'San Jose Diridon Caltrain',
    'Davis Amtrak',
  ])('flagship hub still present: %s', (name) => {
    expect(MAJOR_TRANSIT_HUBS.some((h) => h.name === name)).toBe(true)
  })

  it('hub coords are valid (lat -90..90, lng -180..180)', () => {
    for (const hub of MAJOR_TRANSIT_HUBS) {
      expect(hub.lat, `${hub.name} lat out of range`).toBeGreaterThan(-90)
      expect(hub.lat, `${hub.name} lat out of range`).toBeLessThan(90)
      expect(hub.lng, `${hub.name} lng out of range`).toBeGreaterThan(-180)
      expect(hub.lng, `${hub.name} lng out of range`).toBeLessThan(180)
    }
  })

  it('hub placeIds are unique (dedup-key safety)', () => {
    // Empty-string placeIds collide as Map keys in `uniqueStations`
    // (transitSuggestions.ts:530); only the last would survive.
    // Caught + fixed mid-S1 (synthetic:slug prefix). This test
    // prevents the bug from coming back.
    const ids = MAJOR_TRANSIT_HUBS.map((h) => h.placeId)
    const unique = new Set(ids)
    expect(unique.size, 'duplicate placeIds will collide in dedup Map').toBe(ids.length)
    expect(ids.includes(''), 'empty placeIds collide on the empty string').toBe(false)
  })
})

describe('v1.2.1 S1: rejection logging', () => {
  it('rider-side search loop logs silent rejections with reason', () => {
    // The audit identified missing rejection logs as the #1 reason
    // the original Davis→SF / Davis→San Jose bug stayed invisible.
    // This test guards against a future cleanup deleting the log
    // block ("don't need this anymore — it's noise") and re-
    // disabling the debugging hook.
    expect(SCHEDULE_TS).toMatch(/\[board\/search\] rider-side rejected schedule/)
  })

  it('driver-side search loop logs silent rejections with reason', () => {
    expect(SCHEDULE_TS).toMatch(/\[board\/search:driver\] rejected rider schedule/)
  })
})

describe('v1.2.1 S2.1: reverse-handoff branch present', () => {
  it('rider-side path declares reverse_transit_handoff match type', () => {
    // Both `reverseTransitHandoff` enum case (string literal) and
    // its push site must exist. If a future change accidentally
    // removes one, search results lose reverse-handoff coverage
    // entirely.
    expect(SCHEDULE_TS).toMatch(/'reverse_transit_handoff'/)
    expect(SCHEDULE_TS).toMatch(/pendingReverseHandoffs\.push/)
  })

  it('imports computeTransitPickupSuggestions from transitSuggestions', () => {
    expect(SCHEDULE_TS).toMatch(/computeTransitPickupSuggestions/)
  })
})
