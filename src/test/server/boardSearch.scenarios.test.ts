// @vitest-environment node
//
// v1.2.1 S3.2 — Integration tests for the /board/search smart-search
// engine. Exercises the actual route handler end-to-end (via
// supertest) with mocked supabaseAdmin + mocked Google API calls.
//
// Complements `searchEngineCalibration.test.ts` (S3.1):
//   • S3.1: locks constants + static-hub list (cheap, catches drift)
//   • S3.2: locks BEHAVIOR (search loop produces the right match_type
//     for each canonical Bay Area corridor scenario)
//
// Scenarios covered (subset of `docs/SMART_SEARCH_AUDIT.md` §4.1):
//   1. Davis→SF rider × Davis→San Jose driver → REVERSE handoff
//      (the original failing case that motivated v1.2.1)
//   2. SF→Davis rider × San Jose→Davis driver → REVERSE handoff
//      (full reverse coverage — destination is driver's dest)
//   3. Davis→SF rider × Davis→SF driver → DIRECT match (sanity)
//   4. Davis→LA rider × Davis→SF driver → no match (rejection sanity)
//   5. Davis→Berkeley rider × Davis→Marin driver → FORWARD handoff
//      (driver drops rider at Berkeley BART; rider takes BART to dest)
//   6. Davis→SF rider × Davis→San Jose driver, trip_time off by 3h
//      → no match (time-window rejection)
//
// Each scenario uses a trivial 2-3 point polyline that approximates
// the real-world freeway route. Real polylines have hundreds of
// points; for testing the projection math, fewer points still produce
// the right qualitative result (origin-near-start, dest-off-corridor,
// etc.).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'

// ── Mocks (hoisted before any server imports) ─────────────────────────────────

const {
  mockAuth,
  mockFrom,
  mockSendFcmPush,
  mockChannel,
  mockFetchDrivingRoute,
  mockComputeTransitDropoff,
  mockComputeTransitPickup,
} = vi.hoisted(() => {
  const mockAuth = { getUser: vi.fn() }
  const mockFrom = vi.fn()
  const mockSendFcmPush = vi.fn()
  const mockSend = vi.fn().mockResolvedValue(undefined)
  const mockSubscribe = vi.fn().mockImplementation((cb?: (status: string) => void) => {
    if (cb) cb('SUBSCRIBED')
    return { send: mockSend }
  })
  const mockChannel = vi.fn().mockReturnValue({ subscribe: mockSubscribe, send: mockSend })
  // Default fetchDrivingRoute returns a basic Davis→San Jose polyline.
  // Each scenario overrides via .mockResolvedValueOnce().
  const mockFetchDrivingRoute = vi.fn()
  const mockComputeTransitDropoff = vi.fn()
  const mockComputeTransitPickup = vi.fn()
  return {
    mockAuth,
    mockFrom,
    mockSendFcmPush,
    mockChannel,
    mockFetchDrivingRoute,
    mockComputeTransitDropoff,
    mockComputeTransitPickup,
  }
})

vi.mock('../../../server/env.ts', () => ({
  getServerEnv: () => ({
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    FIREBASE_SERVICE_ACCOUNT_PATH: './mock-path.json',
    QR_HMAC_SECRET: 'test-secret',
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_WEBHOOK_SECRET: 'whsec_mock',
    PORT: 3001,
    // GOOGLE_MAPS_KEY required by runDriverSideSearch fast-path
    GOOGLE_MAPS_KEY: 'mock-google-key',
  }),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom, channel: mockChannel },
}))

vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcmPush,
}))

// Mock the entire transit-suggestions module so we control the
// engine output per-scenario. The real implementation makes ~8
// Google API calls per candidate; we replace it with deterministic
// fixture data so we test the SEARCH LOOP integration, not the
// transit engine internals (those have separate calibration tests).
vi.mock('../../../server/lib/transitSuggestions.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../server/lib/transitSuggestions.ts')>(
    '../../../server/lib/transitSuggestions.ts',
  )
  return {
    ...actual,
    fetchDrivingRoute: mockFetchDrivingRoute,
    computeTransitDropoffSuggestions: mockComputeTransitDropoff,
    computeTransitPickupSuggestions: mockComputeTransitPickup,
  }
})

// Mock Stripe — never actually called for /board/search but the
// shared route module loads it at top-level.
vi.mock('stripe', () => {
  const StripeCtor = vi.fn().mockImplementation(() => ({
    paymentMethods: {
      retrieve: vi.fn().mockResolvedValue({ id: 'pm_x', customer: 'cus_x' }),
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  }))
  return { default: StripeCtor }
})

// Process env required by some auth helpers
process.env['GOOGLE_MAPS_KEY'] = 'mock-google-key'

import { app } from '../../../server/app.ts'

// ── Test helpers ──────────────────────────────────────────────────────────────

const VALID_JWT = 'Bearer valid.jwt.token'

/// Google Polyline encoding algorithm — for fixture polylines.
/// Mirrors the standard format that `decodePolyline` consumes.
function encodePolyline(points: Array<[number, number]>): string {
  let result = ''
  let prevLat = 0
  let prevLng = 0
  for (const [lat, lng] of points) {
    const latE5 = Math.round(lat * 1e5)
    const lngE5 = Math.round(lng * 1e5)
    result += encodeValue(latE5 - prevLat) + encodeValue(lngE5 - prevLng)
    prevLat = latE5
    prevLng = lngE5
  }
  return result
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let result = ''
  while (v >= 0x20) {
    result += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v = v >> 5
  }
  result += String.fromCharCode(v + 63)
  return result
}

// ── Fixture coordinates ───────────────────────────────────────────────────────

const DAVIS: [number, number] = [38.5449, -121.7405]
const SF: [number, number] = [37.7749, -122.4194]
const SAN_JOSE: [number, number] = [37.3382, -121.8863]
const BERKELEY: [number, number] = [37.8716, -122.2727]
const LA: [number, number] = [34.0522, -118.2437]
const MARIN: [number, number] = [38.0834, -122.7633]
const MACARTHUR_BART: [number, number] = [37.8284, -122.2671]
const WALNUT_CREEK_BART: [number, number] = [37.9056, -122.0671]
// (SACRAMENTO + BERKELEY_BART intentionally omitted — reserved for
// future scenarios; eslint flagged the unused symbols.)

// ── Polyline fixtures (3 points each: origin, midpoint, dest) ─────────────────

const POLYLINE_DAVIS_TO_SF = encodePolyline([DAVIS, BERKELEY, SF])
const POLYLINE_DAVIS_TO_SAN_JOSE = encodePolyline([DAVIS, WALNUT_CREEK_BART, SAN_JOSE])
const POLYLINE_SAN_JOSE_TO_DAVIS = encodePolyline([SAN_JOSE, WALNUT_CREEK_BART, DAVIS])
const POLYLINE_DAVIS_TO_MARIN = encodePolyline([DAVIS, BERKELEY, MARIN])

// ── Supabase chain mock builder ───────────────────────────────────────────────

/// Builds a chainable thenable that returns `{ data, error }` when
/// awaited. Each chain method (select, eq, in, order, limit) returns
/// the same chain object so the route's query-builder calls compose
/// correctly regardless of order.
function chain(data: unknown, error: unknown = null) {
  const promise = Promise.resolve({ data, error })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    select: () => c,
    eq: () => c,
    in: () => c,
    order: () => c,
    limit: () => c,
    single: () => c,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      promise.then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => promise.catch(reject),
    finally: (cb: () => void) => promise.finally(cb),
  }
  return c
}

/// Wire up supabaseAdmin.from() for the search route's three queries:
///   1. ride_schedules → list of driver/rider posts on tripDate
///   2. users → poster info (joined)
///   3. driver_routines → polyline fallback (rider-side only)
function setupSupabase(args: {
  schedules: unknown[]
  posters: unknown[]
  routines?: unknown[]
}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'ride_schedules') return chain(args.schedules)
    if (table === 'users') return chain(args.posters)
    if (table === 'driver_routines') return chain(args.routines ?? [])
    return chain([])
  })
}

// Default-stub the JWT validator: any token resolves to userId 'searcher-1'.
function setupAuth(userId: string = 'searcher-1') {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/schedule/board/search — integration scenarios', () => {
  beforeEach(() => {
    // Use resetAllMocks (not clearAllMocks) so `mockResolvedValueOnce`
    // queues don't leak between scenarios. Discovered first-pass when
    // Scenario 1's unused-Once value bled into Scenario 2's mock.
    vi.resetAllMocks()
    setupAuth()
    // Defaults — scenarios override with .mockResolvedValueOnce.
    mockComputeTransitDropoff.mockResolvedValue({ suggestions: [], polyline: '' })
    mockComputeTransitPickup.mockResolvedValue({ suggestions: [], polyline: '' })
  })

  // ─────────────────────────────────────────────────────────────────
  // Scenario 1 — The originally-reported failure case.
  // Davis→SF RIDER × Davis→San Jose DRIVER → FORWARD handoff.
  //
  // Rider pickup (Davis) IS on driver's route — that's why this is
  // FORWARD (driver drops rider at intermediate station like Walnut
  // Creek BART, rider takes BART the rest of the way to SF). This
  // is the case where the OLD HANDOFF_MAX_PRECHECK_METRES = 30 km
  // failed silently because SF sits ~30 km from any I-680 polyline
  // at the closest approach. S1 raised the cap to 75 km, unblocking
  // this case.
  // ─────────────────────────────────────────────────────────────────
  it('Scenario 1: Davis→SF rider × Davis→San Jose driver returns FORWARD handoff (the original failing case)', async () => {
    // Driver-side search: a Davis→San Jose driver looking for riders.
    setupSupabase({
      // Rider posted Davis→SF on the date
      schedules: [
        {
          id: 'sched-sf-rider',
          user_id: 'rider-1',
          mode: 'rider',
          trip_date: '2026-06-01',
          trip_time: '08:00:00',
          origin_lat: DAVIS[0],
          origin_lng: DAVIS[1],
          origin_address: 'Davis, CA',
          dest_lat: SF[0],
          dest_lng: SF[1],
          dest_address: 'San Francisco, CA',
          route_origin_geo: { coordinates: [DAVIS[1], DAVIS[0]] },
          route_destination_geo: { coordinates: [SF[1], SF[0]] },
          route_polyline: encodePolyline([DAVIS, BERKELEY, SF]),
          available_seats: 1,
          created_at: '2026-05-21T12:00:00Z',
        },
      ],
      posters: [
        {
          id: 'rider-1',
          full_name: 'Test Rider',
          avatar_url: null,
          rating_avg: 4.8,
          rating_count: 10,
          is_driver: false,
          stripe_customer_id: 'cus_x',
          default_payment_method_id: 'pm_x',
          wallet_balance: 0,
          has_accessibility_needs: false,
          accessibility_profile: null,
        },
      ],
    })

    // Driver's polyline for THEIR search (Davis → San Jose via I-680)
    mockFetchDrivingRoute.mockResolvedValueOnce({
      polyline: POLYLINE_DAVIS_TO_SAN_JOSE,
      durationMin: 120,
      distanceKm: 200,
    })

    // Forward handoff: driver drops rider at Walnut Creek BART,
    // rider takes BART the rest of the way to SF (~50 min transit).
    mockComputeTransitDropoff.mockResolvedValueOnce({
      suggestions: [
        {
          station_name: 'Walnut Creek BART',
          station_lat: WALNUT_CREEK_BART[0],
          station_lng: WALNUT_CREEK_BART[1],
          station_place_id: 'walnut-creek-bart',
          station_address: 'Walnut Creek, CA',
          transit_options: [
            { type: 'SUBWAY', icon: 'Metro', line_name: 'BART Yellow', walk_minutes: 5, total_minutes: 50 },
          ],
          ride_with_driver_minutes: 80,
          ride_distance_km: 100,
          walk_to_station_minutes: 5,
          driver_detour_minutes: 0,
          transit_to_dest_minutes: 50,
          total_rider_minutes: 135,
          rider_progress_pct: 70,
          transit_polyline: null,
        },
      ],
      polyline: POLYLINE_DAVIS_TO_SAN_JOSE,
    })

    const res = await request(app)
      .post('/api/schedule/board/search')
      .set('Authorization', VALID_JWT)
      .send({
        origin_lat: DAVIS[0],
        origin_lng: DAVIS[1],
        destination_lat: SAN_JOSE[0],
        destination_lng: SAN_JOSE[1],
        trip_date: '2026-06-01',
        mode: 'rider',  // driver-side search (looking for rider posts)
      })

    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    const result = res.body.results[0]
    expect(result.match_type).toBe('transit_handoff')
    expect(result.transit_handoff).toBeTruthy()
    expect(result.transit_handoff.direction).toBe('forward')
    expect(result.transit_handoff.station_name).toBe('Walnut Creek BART')
    // Forward handoff engine should have fired
    expect(mockComputeTransitDropoff).toHaveBeenCalledTimes(1)
    // Reverse handoff should NOT have run for this case (origin IS
    // on route, so reverse-eligibility fails on the !originOnCorridor
    // gate)
    expect(mockComputeTransitPickup).not.toHaveBeenCalled()
  })

  // ─────────────────────────────────────────────────────────────────
  // Scenario 2 — Full reverse: destination is driver's destination
  // SF→Davis RIDER × San Jose→Davis DRIVER → REVERSE handoff
  // ─────────────────────────────────────────────────────────────────
  it('Scenario 2: SF→Davis rider × San Jose→Davis driver returns REVERSE handoff (dest near-end)', async () => {
    setupSupabase({
      schedules: [
        {
          id: 'sched-sf-davis-rider',
          user_id: 'rider-2',
          mode: 'rider',
          trip_date: '2026-06-01',
          trip_time: '17:00:00',
          origin_lat: SF[0],
          origin_lng: SF[1],
          origin_address: 'San Francisco, CA',
          dest_lat: DAVIS[0],
          dest_lng: DAVIS[1],
          dest_address: 'Davis, CA',
          route_origin_geo: { coordinates: [SF[1], SF[0]] },
          route_destination_geo: { coordinates: [DAVIS[1], DAVIS[0]] },
          route_polyline: encodePolyline([SF, BERKELEY, DAVIS]),
          available_seats: 1,
          created_at: '2026-05-21T12:00:00Z',
        },
      ],
      posters: [
        {
          id: 'rider-2',
          full_name: 'Returning Rider',
          avatar_url: null,
          rating_avg: 5.0,
          rating_count: 5,
          is_driver: false,
          stripe_customer_id: 'cus_y',
          default_payment_method_id: 'pm_y',
          wallet_balance: 0,
          has_accessibility_needs: false,
          accessibility_profile: null,
        },
      ],
    })

    // Driver's San Jose→Davis route (mirror of scenario 1)
    mockFetchDrivingRoute.mockResolvedValueOnce({
      polyline: POLYLINE_SAN_JOSE_TO_DAVIS,
      durationMin: 120,
      distanceKm: 200,
    })

    mockComputeTransitPickup.mockResolvedValueOnce({
      suggestions: [
        {
          station_name: 'MacArthur BART',
          station_lat: MACARTHUR_BART[0],
          station_lng: MACARTHUR_BART[1],
          station_place_id: 'macarthur-bart',
          station_address: 'Oakland, CA',
          transit_options: [
            { type: 'SUBWAY', icon: 'Metro', line_name: 'BART Yellow', walk_minutes: 5, total_minutes: 30 },
          ],
          ride_with_driver_minutes: 90,
          ride_distance_km: 130,
          walk_to_station_minutes: 5,
          driver_detour_minutes: 0,
          transit_to_dest_minutes: 30,
          total_rider_minutes: 125,
          rider_progress_pct: 75,
          transit_polyline: null,
        },
      ],
      polyline: POLYLINE_SAN_JOSE_TO_DAVIS,
    })

    const res = await request(app)
      .post('/api/schedule/board/search')
      .set('Authorization', VALID_JWT)
      .send({
        origin_lat: SAN_JOSE[0],
        origin_lng: SAN_JOSE[1],
        destination_lat: DAVIS[0],
        destination_lng: DAVIS[1],
        trip_date: '2026-06-01',
        mode: 'rider',
      })

    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].match_type).toBe('reverse_transit_handoff')
    expect(res.body.results[0].transit_handoff.direction).toBe('reverse')
    expect(res.body.results[0].transit_handoff.station_name).toBe('MacArthur BART')
  })

  // ─────────────────────────────────────────────────────────────────
  // Scenario 3 — Sanity: direct match
  // Davis→SF rider × Davis→SF driver → DIRECT
  // ─────────────────────────────────────────────────────────────────
  it('Scenario 3: same-route rider+driver returns DIRECT match', async () => {
    setupSupabase({
      schedules: [
        {
          id: 'sched-davis-sf-rider',
          user_id: 'rider-3',
          mode: 'rider',
          trip_date: '2026-06-01',
          trip_time: '09:00:00',
          origin_lat: DAVIS[0],
          origin_lng: DAVIS[1],
          origin_address: 'Davis, CA',
          dest_lat: SF[0],
          dest_lng: SF[1],
          dest_address: 'San Francisco, CA',
          route_origin_geo: { coordinates: [DAVIS[1], DAVIS[0]] },
          route_destination_geo: { coordinates: [SF[1], SF[0]] },
          route_polyline: POLYLINE_DAVIS_TO_SF,
          available_seats: 1,
          created_at: '2026-05-21T12:00:00Z',
        },
      ],
      posters: [
        {
          id: 'rider-3',
          full_name: 'Direct Rider',
          avatar_url: null,
          rating_avg: 4.5,
          rating_count: 20,
          is_driver: false,
          stripe_customer_id: null,
          default_payment_method_id: null,
          wallet_balance: 5000,
          has_accessibility_needs: false,
          accessibility_profile: null,
        },
      ],
    })

    mockFetchDrivingRoute.mockResolvedValueOnce({
      polyline: POLYLINE_DAVIS_TO_SF,
      durationMin: 90,
      distanceKm: 130,
    })

    const res = await request(app)
      .post('/api/schedule/board/search')
      .set('Authorization', VALID_JWT)
      .send({
        origin_lat: DAVIS[0],
        origin_lng: DAVIS[1],
        destination_lat: SF[0],
        destination_lng: SF[1],
        trip_date: '2026-06-01',
        mode: 'rider',
      })

    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].match_type).toBe('direct')
    // Direct match base score is +20 minimum
    expect(res.body.results[0].relevance_score).toBeGreaterThanOrEqual(20)
    // Neither handoff engine should have fired
    expect(mockComputeTransitDropoff).not.toHaveBeenCalled()
    expect(mockComputeTransitPickup).not.toHaveBeenCalled()
  })

  // ─────────────────────────────────────────────────────────────────
  // Scenario 4 — Rejection: destination far outside transit range
  // Davis→LA rider × Davis→SF driver → no match (LA way past SF)
  // ─────────────────────────────────────────────────────────────────
  it('Scenario 4: Davis→LA rider × Davis→SF driver returns no match (LA too far)', async () => {
    setupSupabase({
      schedules: [
        {
          id: 'sched-la-rider',
          user_id: 'rider-4',
          mode: 'rider',
          trip_date: '2026-06-01',
          trip_time: '08:00:00',
          origin_lat: DAVIS[0],
          origin_lng: DAVIS[1],
          origin_address: 'Davis, CA',
          dest_lat: LA[0],
          dest_lng: LA[1],
          dest_address: 'Los Angeles, CA',
          route_origin_geo: { coordinates: [DAVIS[1], DAVIS[0]] },
          route_destination_geo: { coordinates: [LA[1], LA[0]] },
          route_polyline: encodePolyline([DAVIS, LA]),
          available_seats: 1,
          created_at: '2026-05-21T12:00:00Z',
        },
      ],
      posters: [
        {
          id: 'rider-4',
          full_name: 'LA Bound Rider',
          avatar_url: null,
          rating_avg: 4.0,
          rating_count: 1,
          is_driver: false,
          stripe_customer_id: null,
          default_payment_method_id: null,
          wallet_balance: 0,
          has_accessibility_needs: false,
          accessibility_profile: null,
        },
      ],
    })

    // Driver's Davis→SF polyline doesn't pass near LA
    mockFetchDrivingRoute.mockResolvedValueOnce({
      polyline: POLYLINE_DAVIS_TO_SF,
      durationMin: 90,
      distanceKm: 130,
    })

    const res = await request(app)
      .post('/api/schedule/board/search')
      .set('Authorization', VALID_JWT)
      .send({
        origin_lat: DAVIS[0],
        origin_lng: DAVIS[1],
        destination_lat: SF[0],
        destination_lng: SF[1],
        trip_date: '2026-06-01',
        mode: 'rider',
      })

    expect(res.status).toBe(200)
    // LA is ~600 km from SF — way past the 75 km handoff cap.
    // Both forward (pickup-side mismatch) and reverse (would be
    // valid origin-on-route + dest-massively-off) are rejected.
    // Pickup IS on route (Davis at start), drop is 600+ km off →
    // forward-handoff pre-check fails the cap.
    expect(res.body.results).toHaveLength(0)
    // Neither handoff engine should have been invoked
    expect(mockComputeTransitDropoff).not.toHaveBeenCalled()
    expect(mockComputeTransitPickup).not.toHaveBeenCalled()
  })

  // ─────────────────────────────────────────────────────────────────
  // Scenario 5 — Forward handoff
  // Davis→Marin rider × Davis→SF driver → driver drops at SF, rider
  // takes ferry. Tests the forward-handoff path stays correct after
  // S2.1 reverse additions.
  // ─────────────────────────────────────────────────────────────────
  it('Scenario 5: rider goes past driver dest → FORWARD handoff (regression check)', async () => {
    setupSupabase({
      schedules: [
        {
          id: 'sched-marin-rider',
          user_id: 'rider-5',
          mode: 'rider',
          trip_date: '2026-06-01',
          trip_time: '10:00:00',
          origin_lat: DAVIS[0],
          origin_lng: DAVIS[1],
          origin_address: 'Davis, CA',
          dest_lat: MARIN[0],
          dest_lng: MARIN[1],
          dest_address: 'Marin, CA',
          route_origin_geo: { coordinates: [DAVIS[1], DAVIS[0]] },
          route_destination_geo: { coordinates: [MARIN[1], MARIN[0]] },
          route_polyline: POLYLINE_DAVIS_TO_MARIN,
          available_seats: 1,
          created_at: '2026-05-21T12:00:00Z',
        },
      ],
      posters: [
        {
          id: 'rider-5',
          full_name: 'Marin Bound',
          avatar_url: null,
          rating_avg: 4.7,
          rating_count: 12,
          is_driver: false,
          stripe_customer_id: 'cus_z',
          default_payment_method_id: 'pm_z',
          wallet_balance: 0,
          has_accessibility_needs: false,
          accessibility_profile: null,
        },
      ],
    })

    // Driver's Davis→SF polyline — rider's Marin dest is past SF
    // (not on the polyline) but within 75 km handoff cap.
    mockFetchDrivingRoute.mockResolvedValueOnce({
      polyline: POLYLINE_DAVIS_TO_SF,
      durationMin: 90,
      distanceKm: 130,
    })

    // Forward handoff resolves at SF Ferry Building → Marin Ferry
    mockComputeTransitDropoff.mockResolvedValueOnce({
      suggestions: [
        {
          station_name: 'San Francisco Ferry Building',
          station_lat: 37.7956,
          station_lng: -122.3933,
          station_place_id: 'sf-ferry',
          station_address: 'San Francisco, CA',
          transit_options: [
            { type: 'FERRY', icon: 'Ferry', line_name: 'Larkspur Ferry', walk_minutes: 5, total_minutes: 40 },
          ],
          ride_with_driver_minutes: 90,
          ride_distance_km: 130,
          walk_to_station_minutes: 5,
          driver_detour_minutes: 0,
          transit_to_dest_minutes: 40,
          total_rider_minutes: 135,
          rider_progress_pct: 80,
          transit_polyline: null,
        },
      ],
      polyline: POLYLINE_DAVIS_TO_SF,
    })

    const res = await request(app)
      .post('/api/schedule/board/search')
      .set('Authorization', VALID_JWT)
      .send({
        origin_lat: DAVIS[0],
        origin_lng: DAVIS[1],
        destination_lat: SF[0],
        destination_lng: SF[1],
        trip_date: '2026-06-01',
        mode: 'rider',
      })

    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].match_type).toBe('transit_handoff')
    expect(res.body.results[0].transit_handoff.direction).toBe('forward')
    expect(res.body.results[0].transit_handoff.station_name).toBe('San Francisco Ferry Building')
    expect(mockComputeTransitDropoff).toHaveBeenCalledTimes(1)
    expect(mockComputeTransitPickup).not.toHaveBeenCalled()
  })

  // ─────────────────────────────────────────────────────────────────
  // Scenario 6 — Time-window rejection
  // Same as Scenario 1 but trip_time differs by 3+ hours → rejected
  // ─────────────────────────────────────────────────────────────────
  it('Scenario 6: trip_time off by 3h → no match (time window enforced)', async () => {
    setupSupabase({
      schedules: [
        {
          id: 'sched-time-off',
          user_id: 'rider-6',
          mode: 'rider',
          trip_date: '2026-06-01',
          trip_time: '08:00:00',  // rider wants 8 AM
          origin_lat: DAVIS[0],
          origin_lng: DAVIS[1],
          origin_address: 'Davis, CA',
          dest_lat: SF[0],
          dest_lng: SF[1],
          dest_address: 'San Francisco, CA',
          route_origin_geo: { coordinates: [DAVIS[1], DAVIS[0]] },
          route_destination_geo: { coordinates: [SF[1], SF[0]] },
          route_polyline: POLYLINE_DAVIS_TO_SF,
          available_seats: 1,
          created_at: '2026-05-21T12:00:00Z',
        },
      ],
      posters: [
        {
          id: 'rider-6',
          full_name: 'Morning Rider',
          avatar_url: null,
          rating_avg: 4.0,
          rating_count: 1,
          is_driver: false,
          stripe_customer_id: 'cus_t',
          default_payment_method_id: 'pm_t',
          wallet_balance: 0,
          has_accessibility_needs: false,
          accessibility_profile: null,
        },
      ],
    })

    mockFetchDrivingRoute.mockResolvedValueOnce({
      polyline: POLYLINE_DAVIS_TO_SF,
      durationMin: 90,
      distanceKm: 130,
    })

    const res = await request(app)
      .post('/api/schedule/board/search')
      .set('Authorization', VALID_JWT)
      .send({
        origin_lat: DAVIS[0],
        origin_lng: DAVIS[1],
        destination_lat: SF[0],
        destination_lng: SF[1],
        trip_date: '2026-06-01',
        trip_time: '14:00:00',  // driver wants 2 PM → 6h diff → > 120 min cap
        mode: 'rider',
      })

    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(0)
  })
})
