// @vitest-environment node
/**
 * v1.2 F17 — segmented split fare unit tests.
 *
 * Covers the pure math + lifecycle in server/lib/segments.ts. Integration
 * with /start and /end happens via thin call sites in rides.ts that are
 * exercised by the larger rides.endpoints.test.ts suite — this file just
 * proves the math is correct.
 *
 * Test matrix:
 *   1. Single-rider degraded path: math matches pre-F17 fare
 *   2. 2-rider trip: A solo → A+B → A solo (B exits before A)
 *   3. 3-rider trip: A solo → A+B → A+B+C → A+C → A solo
 *   4. computeRiderTotals: minimum applies to base only, add-ons stack
 *   5. Lifecycle: addRider / removeRider open + close in the right order
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  validateStripeEnv: () => undefined,
}))

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  computeRiderTotals,
  computeRiderBaseShare,
  addRiderToOpenSegment,
  removeRiderFromOpenSegment,
  type SegmentRow,
} from '../../../server/lib/segments.ts'

// ── In-memory supabase stub ────────────────────────────────────────────
//
// A small fake that implements just the methods segments.ts touches:
//   .from('ride_segments').select(...).eq(...).is(...).order(...).limit(...).maybeSingle()
//   .from('ride_segments').insert(...).select(...).single()
//   .from('ride_segments').update(...).eq(...).is(...)
//   .from('ride_segments').update(...).eq(...).select(...).single()
//
// Returns chained builders that finally resolve to { data, error }.

interface FakeSegmentsStore {
  rows: SegmentRow[]
}

// Minimal Supabase-shaped fake. Cast to SupabaseClient via `unknown`
// at the instantiation site (signatures don't need to match exactly —
// only the methods segments.ts touches need to work).

function makeFakeSupabase(store: FakeSegmentsStore) {
  return {
    from(_table: string) {
      const filters: Array<(r: SegmentRow) => boolean> = []
      let orderKey: keyof SegmentRow | undefined
      let orderDesc = false
      let limitN: number | undefined
      let pendingInsert: Partial<SegmentRow> | null = null
      let pendingUpdate: Partial<SegmentRow> | null = null

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        select(_cols?: string, _opts?: unknown) {
          return builder
        },
        eq(col: string, val: unknown) {
          filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val)
          return builder
        },
        is(col: string, val: unknown) {
          if (val === null) filters.push((r) => (r as unknown as Record<string, unknown>)[col] === null)
          return builder
        },
        not(col: string, _op: string, val: unknown) {
          if (val === null) filters.push((r) => (r as unknown as Record<string, unknown>)[col] !== null)
          return builder
        },
        order(col: keyof SegmentRow, opts?: { ascending?: boolean }) {
          orderKey = col
          orderDesc = opts?.ascending === false
          return builder
        },
        limit(n: number) {
          limitN = n
          return builder
        },
        insert(values: Partial<SegmentRow>) {
          pendingInsert = values
          return builder
        },
        update(values: Partial<SegmentRow>) {
          pendingUpdate = values
          return builder
        },
        upsert(_values: unknown, _opts: unknown) {
          return Promise.resolve({ data: null, error: null })
        },
        single() {
          return this._resolve(true)
        },
        maybeSingle() {
          return this._resolve(true, true)
        },
        async _resolve(single = false, allowNull = false) {
          if (pendingInsert) {
            const newRow: SegmentRow = {
              id: `seg-${store.rows.length}`,
              trip_id: pendingInsert.trip_id as string,
              segment_index: (pendingInsert.segment_index as number) ?? store.rows.length,
              started_at: pendingInsert.started_at as string,
              ended_at: null,
              distance_meters: 0,
              duration_seconds: 0,
              active_rider_ids: (pendingInsert.active_rider_ids as string[]) ?? [],
              gas_cost_cents: 0,
              time_cost_cents: 0,
            }
            store.rows.push(newRow)
            return { data: newRow, error: null }
          }
          if (pendingUpdate) {
            const target = store.rows.filter((r) => filters.every((f) => f(r)))
            for (const t of target) {
              Object.assign(t, pendingUpdate)
            }
            return { data: target[0] ?? null, error: null }
          }
          let rows = store.rows.filter((r) => filters.every((f) => f(r)))
          if (orderKey) {
            rows = [...rows].sort((a, b) => {
              const av = a[orderKey!] as unknown as number
              const bv = b[orderKey!] as unknown as number
              return orderDesc ? bv - av : av - bv
            })
          }
          if (limitN) rows = rows.slice(0, limitN)
          if (single) {
            const row = rows[0]
            if (!row && !allowNull) return { data: null, error: { message: 'not found' } }
            return { data: row ?? null, error: null }
          }
          return { data: rows, error: null }
        },
        then(resolve: (v: unknown) => unknown) {
          return this._resolve(false).then(resolve)
        },
      }
      return builder
    },
  }
}

const GAS_PRICE = 4.0 // $4/gal

describe('computeRiderTotals', () => {
  it('applies $5 minimum to base_share only, add-ons stack on top', () => {
    const r = computeRiderTotals({
      baseShareCents: 100, // below minimum
      caregiverFareCents: 300,
      companionFareCents: 200,
      segmentsInCount: 1,
    })
    expect(r.base_share_cents).toBe(500) // min applied
    expect(r.caregiver_share_cents).toBe(300)
    expect(r.companion_share_cents).toBe(200)
    expect(r.total_cents).toBe(1000)
  })

  it('passes through when base already exceeds minimum', () => {
    const r = computeRiderTotals({
      baseShareCents: 1234,
      caregiverFareCents: 500,
      companionFareCents: 0,
      segmentsInCount: 3,
    })
    expect(r.base_share_cents).toBe(1234)
    expect(r.total_cents).toBe(1234 + 500)
    expect(r.segments_in_count).toBe(3)
  })

  it('clamps negative add-ons to 0 (defensive)', () => {
    const r = computeRiderTotals({
      baseShareCents: 1000,
      caregiverFareCents: -100,
      companionFareCents: -50,
      segmentsInCount: 1,
    })
    expect(r.caregiver_share_cents).toBe(0)
    expect(r.companion_share_cents).toBe(0)
    expect(r.total_cents).toBe(1000)
  })
})

describe('segment lifecycle', () => {
  let store: FakeSegmentsStore
  let client: SupabaseClient

  beforeEach(() => {
    store = { rows: [] }
    client = makeFakeSupabase(store) as unknown as SupabaseClient
  })

  it('addRiderToOpenSegment with no prior open segment opens segment 0', async () => {
    const res = await addRiderToOpenSegment('trip-1', 'rider-A', '2026-01-01T10:00:00Z', GAS_PRICE, client)
    expect(res.error).toBeUndefined()
    expect(res.closedSegment).toBeNull()
    expect(res.newSegment?.active_rider_ids).toEqual(['rider-A'])
    expect(res.newSegment?.segment_index).toBe(0)
    expect(store.rows.length).toBe(1)
  })

  it('addRiderToOpenSegment with existing open segment closes prior + opens new with rider added', async () => {
    await addRiderToOpenSegment('trip-1', 'rider-A', '2026-01-01T10:00:00Z', GAS_PRICE, client)
    // Set some distance on the first segment so cost computation has substance.
    store.rows[0]!.distance_meters = 16093 // ~10 miles in meters

    const res = await addRiderToOpenSegment('trip-1', 'rider-B', '2026-01-01T10:30:00Z', GAS_PRICE, client)
    expect(res.error).toBeUndefined()
    expect(res.closedSegment?.active_rider_ids).toEqual(['rider-A'])
    expect(res.closedSegment?.ended_at).toBe('2026-01-01T10:30:00Z')
    expect(res.closedSegment?.duration_seconds).toBe(30 * 60) // 30 minutes
    expect(res.newSegment?.active_rider_ids).toEqual(['rider-A', 'rider-B'])
    expect(store.rows.length).toBe(2)
  })

  it('removeRiderFromOpenSegment with multiple riders closes + opens new without that rider', async () => {
    await addRiderToOpenSegment('trip-1', 'rider-A', '2026-01-01T10:00:00Z', GAS_PRICE, client)
    await addRiderToOpenSegment('trip-1', 'rider-B', '2026-01-01T10:30:00Z', GAS_PRICE, client)
    store.rows[1]!.distance_meters = 16093

    const res = await removeRiderFromOpenSegment('trip-1', 'rider-B', '2026-01-01T11:00:00Z', GAS_PRICE, client)
    expect(res.error).toBeUndefined()
    expect(res.wasLast).toBe(false)
    expect(res.closedSegment?.active_rider_ids).toEqual(['rider-A', 'rider-B'])
    expect(res.nextSegment?.active_rider_ids).toEqual(['rider-A'])
    expect(store.rows.length).toBe(3)
  })

  it('removeRiderFromOpenSegment with last rider closes + does NOT open a new segment', async () => {
    await addRiderToOpenSegment('trip-1', 'rider-A', '2026-01-01T10:00:00Z', GAS_PRICE, client)
    store.rows[0]!.distance_meters = 16093

    const res = await removeRiderFromOpenSegment('trip-1', 'rider-A', '2026-01-01T10:30:00Z', GAS_PRICE, client)
    expect(res.error).toBeUndefined()
    expect(res.wasLast).toBe(true)
    expect(res.closedSegment?.ended_at).toBe('2026-01-01T10:30:00Z')
    expect(res.nextSegment).toBeNull()
    expect(store.rows.length).toBe(1)
  })
})

describe('computeRiderBaseShare — split math', () => {
  let store: FakeSegmentsStore
  let client: SupabaseClient

  beforeEach(() => {
    store = { rows: [] }
    client = makeFakeSupabase(store) as unknown as SupabaseClient
  })

  function seedSegment(idx: number, riders: string[], gasCents: number, timeCents: number) {
    store.rows.push({
      id: `seg-${idx}`,
      trip_id: 'trip-1',
      segment_index: idx,
      started_at: `2026-01-01T${10 + idx}:00:00Z`,
      ended_at: `2026-01-01T${11 + idx}:00:00Z`,
      distance_meters: 0,
      duration_seconds: 0,
      active_rider_ids: riders,
      gas_cost_cents: gasCents,
      time_cost_cents: timeCents,
    })
  }

  it('single-rider trip: rider A pays full cost of the single segment', async () => {
    seedSegment(0, ['rider-A'], 800, 250) // $10.50 segment cost
    const { baseShareCents, gasShareCents, timeShareCents, segmentsInCount } =
      await computeRiderBaseShare('trip-1', 'rider-A', client)
    expect(baseShareCents).toBe(1050)
    expect(gasShareCents).toBe(800)
    expect(timeShareCents).toBe(250)
    expect(segmentsInCount).toBe(1)
  })

  it('2-rider trip with shared middle: A pays solo seg + ½ of A+B seg', async () => {
    // Davis → Sac (A solo): $8.30 = 830¢
    // Sac → WC (A+B): $9.00 = 900¢ split 2 ways = 450¢ per rider
    seedSegment(0, ['rider-A'], 600, 230) // 830¢
    seedSegment(1, ['rider-A', 'rider-B'], 700, 200) // 900¢
    // B exits, A continues solo back home — but no further seg for this test
    const a = await computeRiderBaseShare('trip-1', 'rider-A', client)
    const b = await computeRiderBaseShare('trip-1', 'rider-B', client)
    expect(a.baseShareCents).toBe(830 + 450) // 1280
    expect(a.gasShareCents).toBe(600 + 350) // own solo + ½ of $7 gas
    expect(a.timeShareCents).toBe(230 + 100) // own solo + ½ of $2 time
    expect(a.segmentsInCount).toBe(2)
    expect(b.baseShareCents).toBe(450)
    expect(b.gasShareCents).toBe(350)
    expect(b.timeShareCents).toBe(100)
    expect(b.segmentsInCount).toBe(1)
  })

  it('3-rider mid-ride exit: B exits in SF, A and C continue to next stop, then C exits, A continues', async () => {
    // Plan example: A solo Davis→Sac, A+B Sac→WC, A+B+C WC→SF, A+C SF→Berkeley, A solo Berkeley→Oakland
    seedSegment(0, ['rider-A'], 600, 230) // 830¢
    seedSegment(1, ['rider-A', 'rider-B'], 500, 200) // 700¢ → 350¢ each
    seedSegment(2, ['rider-A', 'rider-B', 'rider-C'], 400, 150) // 550¢ → 184¢ each (rounded)
    // B exits
    seedSegment(3, ['rider-A', 'rider-C'], 300, 120) // 420¢ → 210¢ each
    // C exits
    seedSegment(4, ['rider-A'], 200, 80) // 280¢

    const a = await computeRiderBaseShare('trip-1', 'rider-A', client)
    const b = await computeRiderBaseShare('trip-1', 'rider-B', client)
    const c = await computeRiderBaseShare('trip-1', 'rider-C', client)

    expect(a.baseShareCents).toBe(830 + 350 + Math.round(550 / 3) + 210 + 280)
    expect(a.segmentsInCount).toBe(5)
    expect(b.baseShareCents).toBe(350 + Math.round(550 / 3))
    expect(b.segmentsInCount).toBe(2)
    expect(c.baseShareCents).toBe(Math.round(550 / 3) + 210)
    expect(c.segmentsInCount).toBe(2)
  })

  it('rider with no segments returns 0', async () => {
    seedSegment(0, ['rider-A'], 500, 100)
    const z = await computeRiderBaseShare('trip-1', 'rider-Z', client)
    expect(z.baseShareCents).toBe(0)
    expect(z.segmentsInCount).toBe(0)
  })
})
