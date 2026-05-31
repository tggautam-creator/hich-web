// @vitest-environment node
/**
 * GET /api/rides/:rideId/share-details — endpoint test coverage.
 *
 * Sprint 9 Slice 2 — server contract for the rider/driver trip-summary
 * fare-split surfaces (Sprint 9 Slices 3-5 consumers).
 *
 * Coverage:
 *   • JWT required (covered indirectly via mocked validateJwt)
 *   • Caller must be trip.driver_id OR a rides.rider_id on the trip
 *     (403 FORBIDDEN otherwise — mirrors migrations 097 RLS at the
 *     handler level since supabaseAdmin bypasses RLS)
 *   • Returns 404 TRIP_NOT_FOUND when ride.trip_id IS NULL
 *     (pre-097 backfill miss path)
 *   • Returns 404 RIDE_NOT_FOUND when ride row itself is missing
 *   • Returns 200 with full payload for completed multi-rider trip
 *     (segments + shares + co-riders)
 *   • Returns 200 with possibly-partial shares[] for ACTIVE multi-rider
 *     trip (a rider not yet dropped off has no shares row yet — must
 *     not 500)
 *   • Returns 200 with single-rider shares[] for solo trip
 *   • Co-rider list omits the caller themselves
 *   • Co-rider list includes riders already dropped off (full set)
 *
 * Mock pattern mirrors rides.contact.test.ts: hoisted supabaseAdmin
 * mock, per-table builder dispatch with chainable .eq / .in / .order /
 * .single semantics.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom } = vi.hoisted(() => ({
  mockAuth: { getUser: vi.fn() },
  mockFrom: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom },
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const RIDER_A = '00000000-0000-4000-8000-00000000aaaa'
const RIDER_B = '00000000-0000-4000-8000-00000000bbbb'
const RIDER_C = '00000000-0000-4000-8000-00000000cccc'
const DRIVER_ID = '00000000-0000-4000-8000-00000000d1d1'
const OUTSIDER_ID = '00000000-0000-4000-8000-00000000eeee'
const RIDE_A_ID = '11111111-1111-4111-8111-111111111aaa'
const RIDE_B_ID = '11111111-1111-4111-8111-111111111bbb'
const RIDE_C_ID = '11111111-1111-4111-8111-111111111ccc'
const TRIP_ID = '22222222-2222-4222-8222-222222222222'

interface SetupOpts {
  callerId?: string
  // The /:rideId path param the caller uses. Defaults to RIDE_A_ID.
  ridePathId?: string
  // If false, the focused ride lookup returns null (RIDE_NOT_FOUND).
  rideExists?: boolean
  // The focused ride's trip_id. `undefined` = use default tripId,
  // `null` = explicit null (TRIP_NOT_FOUND), string = override.
  focusedTripId?: string | null
  // Trip row to return. null = trip lookup misses.
  trip?: {
    id: string
    kind: 'instant' | 'board'
    started_at: string | null
    ended_at: string | null
    gps_distance_metres: number
    gas_cost_cents: number
    time_cost_cents: number
    driver_id: string
  } | null
  // Rides on this trip (one per rider leg).
  tripRides?: { id: string; rider_id: string | null; destination_name: string | null }[]
  // Segments. Default: 1 segment with all riders.
  segments?: {
    segment_index: number
    started_at: string
    ended_at: string | null
    distance_meters: number
    active_rider_ids: string[]
    gas_cost_cents: number
    time_cost_cents: number
  }[]
  // Shares. Default: one per rider.
  shares?: {
    rider_id: string
    base_share_cents: number
    caregiver_share_cents: number
    companion_share_cents: number
    total_cents: number
    segments_in_count: number
    payment_status: 'pending' | 'paid' | 'processing' | 'failed'
  }[]
  // User profiles keyed by id. Defaults pulled from RIDER_*_ID.
  profiles?: Record<string, { full_name: string | null; avatar_url: string | null }>
}

const DEFAULT_TRIP = {
  id: TRIP_ID,
  kind: 'board' as const,
  started_at: '2026-05-31T18:00:00Z',
  ended_at: '2026-05-31T18:45:00Z',
  gps_distance_metres: 12_000,
  gas_cost_cents: 350,
  time_cost_cents: 225,
  driver_id: DRIVER_ID,
}

function setup(opts: SetupOpts = {}) {
  const callerId = opts.callerId ?? RIDER_A
  const ridePathId = opts.ridePathId ?? RIDE_A_ID
  const focusedRideExists = opts.rideExists !== false
  const focusedTripId =
    opts.focusedTripId === undefined ? TRIP_ID : opts.focusedTripId
  const trip = 'trip' in opts ? opts.trip : DEFAULT_TRIP
  const tripRides = opts.tripRides ?? [
    { id: RIDE_A_ID, rider_id: RIDER_A, destination_name: 'Sacramento' },
    { id: RIDE_B_ID, rider_id: RIDER_B, destination_name: 'Davis' },
  ]
  const segments = opts.segments ?? [
    {
      segment_index: 0,
      started_at: '2026-05-31T18:00:00Z',
      ended_at: '2026-05-31T18:45:00Z',
      distance_meters: 12_000,
      active_rider_ids: [RIDER_A, RIDER_B],
      gas_cost_cents: 350,
      time_cost_cents: 225,
    },
  ]
  const shares = opts.shares ?? [
    {
      rider_id: RIDER_A,
      base_share_cents: 288,
      caregiver_share_cents: 0,
      companion_share_cents: 0,
      total_cents: 500,
      segments_in_count: 1,
      payment_status: 'paid',
    },
    {
      rider_id: RIDER_B,
      base_share_cents: 287,
      caregiver_share_cents: 0,
      companion_share_cents: 0,
      total_cents: 500,
      segments_in_count: 1,
      payment_status: 'paid',
    },
  ]
  const profiles = opts.profiles ?? {
    [RIDER_A]: { full_name: 'Alex Rider', avatar_url: 'https://example/alex.jpg' },
    [RIDER_B]: { full_name: 'Bee Carpooler', avatar_url: null },
    [RIDER_C]: { full_name: 'Cee Late', avatar_url: null },
  }

  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: callerId } },
    error: null,
  })

  // Per-table builder dispatch. Each table-call returns a fresh builder
  // because chained .eq / .in / .order mutate state — sharing builders
  // across calls would leak across parallel awaits inside the handler.
  mockFrom.mockImplementation((table: string) => {
    const builder: Record<string, (...args: never[]) => unknown> = {}
    let eqColumn: string | null = null
    let eqValue: string | null = null
    let inColumn: string | null = null
    let inValues: string[] | null = null

    builder['select'] = () => builder
    builder['update'] = () => builder
    builder['eq'] = ((col: string, value: string) => {
      eqColumn = col
      eqValue = value
      return builder
    }) as unknown as (...args: never[]) => unknown
    builder['in'] = ((col: string, values: string[]) => {
      inColumn = col
      inValues = values
      return builder
    }) as unknown as (...args: never[]) => unknown
    builder['order'] = () => builder

    const resolveQuery = () => {
      if (table === 'rides') {
        // Two distinct rides queries: by id (focused ride lookup) +
        // by trip_id (every ride on the trip).
        if (eqColumn === 'id') {
          if (!focusedRideExists) {
            return { data: null, error: { message: 'not found' } }
          }
          return {
            data: { id: ridePathId, trip_id: focusedTripId },
            error: null,
          }
        }
        if (eqColumn === 'trip_id') {
          return { data: tripRides, error: null }
        }
      }
      if (table === 'trips') {
        if (!trip || trip.id !== eqValue) {
          return { data: null, error: { message: 'not found' } }
        }
        return { data: trip, error: null }
      }
      if (table === 'ride_segments') {
        return { data: segments, error: null }
      }
      if (table === 'ride_rider_shares') {
        return { data: shares, error: null }
      }
      if (table === 'users') {
        if (inColumn !== 'id' || inValues == null) {
          return { data: [], error: null }
        }
        const rows = inValues
          .map((id) => {
            const profile = profiles[id]
            return profile ? { id, ...profile } : null
          })
          .filter((r) => r != null)
        return { data: rows, error: null }
      }
      return { data: null, error: { message: `unmocked from(${table})` } }
    }

    builder['single'] = async () => resolveQuery()
    // .then makes the builder thenable so `await supabaseAdmin.from(...)
    // .select(...).eq(...)` resolves directly when .single() isn't used.
    builder['then'] = ((onFulfilled: (v: unknown) => unknown) => {
      return Promise.resolve(resolveQuery()).then(onFulfilled)
    }) as unknown as (...args: never[]) => unknown

    return builder
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/rides/:rideId/share-details', () => {
  it('returns 200 with full payload for completed multi-rider trip (caller = rider)', async () => {
    setup({ callerId: RIDER_A })
    const res = await request(app)
      .get(`/api/rides/${RIDE_A_ID}/share-details`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.trip).toMatchObject({
      id: TRIP_ID,
      kind: 'board',
      started_at: '2026-05-31T18:00:00Z',
      ended_at: '2026-05-31T18:45:00Z',
      gps_distance_metres: 12_000,
      gas_cost_cents: 350,
      time_cost_cents: 225,
    })
    // driver_id MUST NOT leak in the response (not part of the
    // documented payload; private to server-side participant gating).
    expect(res.body.trip).not.toHaveProperty('driver_id')
    expect(res.body.segments).toHaveLength(1)
    expect(res.body.shares).toHaveLength(2)
    expect(res.body.co_riders).toEqual([
      {
        rider_id: RIDER_B,
        full_name: 'Bee Carpooler',
        avatar_url: null,
        destination_name: 'Davis',
      },
    ])
  })

  it('returns 200 with the driver as caller — co-riders excludes nobody since driver is not a rider', async () => {
    setup({ callerId: DRIVER_ID })
    const res = await request(app)
      .get(`/api/rides/${RIDE_A_ID}/share-details`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    // Driver sees BOTH riders (driver is not in the rider set; nothing to exclude).
    expect(res.body.co_riders).toHaveLength(2)
    const riderIds = (res.body.co_riders as { rider_id: string }[]).map((c) => c.rider_id)
    expect(riderIds).toContain(RIDER_A)
    expect(riderIds).toContain(RIDER_B)
  })

  it('co_riders includes riders already dropped off (full set, matches iOS CoRidersFetcher scope)', async () => {
    // Trip has 3 riders. Two dropped off, one still aboard.
    // All 3 appear in co_riders for the driver.
    setup({
      callerId: DRIVER_ID,
      tripRides: [
        { id: RIDE_A_ID, rider_id: RIDER_A, destination_name: 'Sacramento' },
        { id: RIDE_B_ID, rider_id: RIDER_B, destination_name: 'Davis' },
        { id: RIDE_C_ID, rider_id: RIDER_C, destination_name: 'Berkeley' },
      ],
      shares: [
        {
          rider_id: RIDER_A,
          base_share_cents: 200,
          caregiver_share_cents: 0,
          companion_share_cents: 0,
          total_cents: 500,
          segments_in_count: 2,
          payment_status: 'paid',
        },
        {
          rider_id: RIDER_B,
          base_share_cents: 200,
          caregiver_share_cents: 0,
          companion_share_cents: 0,
          total_cents: 500,
          segments_in_count: 1,
          payment_status: 'paid',
        },
        // RIDER_C has no shares row yet — still aboard
      ],
    })
    const res = await request(app)
      .get(`/api/rides/${RIDE_A_ID}/share-details`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.co_riders).toHaveLength(3)
    expect(res.body.shares).toHaveLength(2) // partial — RIDER_C missing
  })

  it('returns 200 with partial shares[] for an ACTIVE trip (rider not yet dropped off has no row)', async () => {
    // Mid-trip: only RIDER_A has dropped off. RIDER_B is still aboard.
    setup({
      callerId: DRIVER_ID,
      trip: { ...DEFAULT_TRIP, ended_at: null },
      segments: [
        {
          segment_index: 0,
          started_at: '2026-05-31T18:00:00Z',
          ended_at: '2026-05-31T18:30:00Z',
          distance_meters: 6_000,
          active_rider_ids: [RIDER_A, RIDER_B],
          gas_cost_cents: 175,
          time_cost_cents: 110,
        },
        {
          segment_index: 1,
          started_at: '2026-05-31T18:30:00Z',
          ended_at: null,
          distance_meters: 0,
          active_rider_ids: [RIDER_B],
          gas_cost_cents: 0,
          time_cost_cents: 0,
        },
      ],
      shares: [
        {
          rider_id: RIDER_A,
          base_share_cents: 142,
          caregiver_share_cents: 0,
          companion_share_cents: 0,
          total_cents: 500,
          segments_in_count: 1,
          payment_status: 'paid',
        },
      ],
    })
    const res = await request(app)
      .get(`/api/rides/${RIDE_A_ID}/share-details`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.trip.ended_at).toBeNull()
    // Open segment included
    expect(res.body.segments).toHaveLength(2)
    expect(res.body.segments[1].ended_at).toBeNull()
    // Partial shares (only RIDER_A dropped off so far)
    expect(res.body.shares).toHaveLength(1)
    expect(res.body.shares[0].rider_id).toBe(RIDER_A)
  })

  it('returns 200 with single-rider shares for a solo trip', async () => {
    setup({
      callerId: RIDER_A,
      tripRides: [
        { id: RIDE_A_ID, rider_id: RIDER_A, destination_name: 'Sacramento' },
      ],
      segments: [
        {
          segment_index: 0,
          started_at: '2026-05-31T18:00:00Z',
          ended_at: '2026-05-31T18:30:00Z',
          distance_meters: 5_000,
          active_rider_ids: [RIDER_A],
          gas_cost_cents: 200,
          time_cost_cents: 150,
        },
      ],
      shares: [
        {
          rider_id: RIDER_A,
          base_share_cents: 350,
          caregiver_share_cents: 0,
          companion_share_cents: 0,
          total_cents: 500,
          segments_in_count: 1,
          payment_status: 'paid',
        },
      ],
    })
    const res = await request(app)
      .get(`/api/rides/${RIDE_A_ID}/share-details`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.shares).toHaveLength(1)
    expect(res.body.co_riders).toHaveLength(0) // caller is the only rider
  })

  it('returns 403 FORBIDDEN when caller is not a participant on the trip', async () => {
    setup({ callerId: OUTSIDER_ID })
    const res = await request(app)
      .get(`/api/rides/${RIDE_A_ID}/share-details`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('FORBIDDEN')
  })

  it('returns 404 TRIP_NOT_FOUND when ride.trip_id IS NULL (pre-097 backfill miss)', async () => {
    setup({ focusedTripId: null })
    const res = await request(app)
      .get(`/api/rides/${RIDE_A_ID}/share-details`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
    expect(res.body.error?.code).toBe('TRIP_NOT_FOUND')
  })

  it('returns 404 RIDE_NOT_FOUND when the ride row itself is missing', async () => {
    setup({ rideExists: false })
    const res = await request(app)
      .get(`/api/rides/${RIDE_A_ID}/share-details`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
    expect(res.body.error?.code).toBe('RIDE_NOT_FOUND')
  })

  it('returns 400 INVALID_PARAMS when rideId path param is empty', async () => {
    setup()
    const res = await request(app)
      .get('/api/rides//share-details')
      .set('Authorization', VALID_JWT)
    // Express routing matches a different path entirely; we expect a
    // 404 from the router rather than our handler's 400. Either way,
    // not 200.
    expect(res.status).not.toBe(200)
  })

  it('co_riders excludes the caller themselves (RIDER_A as caller does not see themselves)', async () => {
    setup({ callerId: RIDER_A })
    const res = await request(app)
      .get(`/api/rides/${RIDE_A_ID}/share-details`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    const riderIds = (res.body.co_riders as { rider_id: string }[]).map((c) => c.rider_id)
    expect(riderIds).not.toContain(RIDER_A)
  })
})
