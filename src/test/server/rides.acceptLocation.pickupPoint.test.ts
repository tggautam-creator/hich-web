// @vitest-environment node
/**
 * Regression coverage for the 2026-06-02 pickup_point=null incident.
 *
 * The invariant: once any pickup_suggestion message exists for a ride,
 * `rides.pickup_point` MUST be populated. Two server code paths used
 * to flip `rides.pickup_confirmed = true` without ever writing
 * `pickup_point`, stranding the rider on the Walk-to-Pickup screen
 * showing "Waiting for driver to set pickup point" forever.
 *
 * These tests pin the three layers of defense:
 *  - A) auto-pickup-suggestion at /accept-location (dropoff branch)
 *       writes pickup_point = ride.origin alongside the chat message.
 *  - B) /accept-location (pickup branch) backfills pickup_point from
 *       the latest pickup_suggestion meta when the column is still null.
 *  - The backfill is gated so it does NOT clobber an already-set value
 *       and is a graceful no-op when no suggestion exists.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockAuth, mockFrom, mockRpc, mockSendFcmPush,
  mockRealtime, mockRealtimeMany, mockStripeListPm,
} = vi.hoisted(() => ({
  mockAuth: { getUser: vi.fn() },
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockSendFcmPush: vi.fn(),
  mockRealtime: vi.fn(),
  mockRealtimeMany: vi.fn(),
  mockStripeListPm: vi.fn().mockResolvedValue({ data: [] }),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom, rpc: mockRpc },
}))

vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcmPush,
  sendSilentFcmPush: vi.fn(),
}))

vi.mock('../../../server/lib/realtimeBroadcast.ts', () => ({
  realtimeBroadcast: mockRealtime,
  realtimeBroadcastMany: mockRealtimeMany,
}))

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

vi.mock('stripe', () => {
  const StripeCtor = vi.fn().mockImplementation(() => ({
    paymentMethods: { list: mockStripeListPm },
  }))
  return { default: StripeCtor }
})

import { app } from '../../../server/app.ts'

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_JWT = 'Bearer valid.jwt.token'
const RIDER_ID = 'user-rider-pp-001'
const DRIVER_ID = 'user-driver-pp-001'
const RIDE_ID = 'ride-pp-001'

const RIDER_ORIGIN_GEO = { type: 'Point', coordinates: [-121.77, 38.54] }

// ── Helpers ──────────────────────────────────────────────────────────────────

function authAs(userId: string) {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

/**
 * Fluent proxy that resolves to { data, error } and records every
 * `.update(payload)` call against `target` table into `updateLog`,
 * along with the most recently piped `.eq()` filters so tests can
 * assert "this update targeted the rides row by id and only when
 * pickup_point was null."
 */
function spyChain(
  target: string,
  updateLog: Array<{ table: string; payload: unknown; eqs: Array<[string, unknown]>; isFilters: Array<[string, unknown]> }>,
  data: unknown = null,
  error: unknown = null,
) {
  let pendingUpdatePayload: unknown = undefined
  const eqs: Array<[string, unknown]> = []
  const isFilters: Array<[string, unknown]> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = new Proxy({} as Record<string, unknown>, {
    get(_t, key: string) {
      if (key === 'then') {
        return (resolve: (v: unknown) => void) => {
          if (pendingUpdatePayload !== undefined) {
            updateLog.push({ table: target, payload: pendingUpdatePayload, eqs: [...eqs], isFilters: [...isFilters] })
            pendingUpdatePayload = undefined
          }
          resolve({ data, error })
        }
      }
      if (key === 'catch' || key === 'finally') return undefined
      if (key === 'update') {
        return (payload: unknown) => {
          pendingUpdatePayload = payload
          return chain
        }
      }
      if (key === 'eq') {
        return (col: string, val: unknown) => {
          eqs.push([col, val])
          return chain
        }
      }
      if (key === 'is') {
        return (col: string, val: unknown) => {
          isFilters.push([col, val])
          return chain
        }
      }
      return (..._args: unknown[]) => chain
    },
  })
  return chain
}

function plainChain(data: unknown = null, error: unknown = null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = new Proxy({} as Record<string, unknown>, {
    get(_t, key: string) {
      if (key === 'then') return (resolve: (v: unknown) => void) => resolve({ data, error })
      if (key === 'catch' || key === 'finally') return undefined
      return (..._args: unknown[]) => chain
    },
  })
  return chain
}

type RideRow = {
  id: string
  rider_id: string | null
  driver_id: string | null
  status: string
  pickup_confirmed: boolean
  dropoff_confirmed: boolean
  schedule_id: string | null
  pickup_point: unknown
  dropoff_point: unknown
  destination: unknown
  destination_name: string | null
  origin: unknown
  origin_name: string | null
  caregiver_fare_cents: number | null
}

function buildRide(overrides: Partial<RideRow> = {}): RideRow {
  return {
    id: RIDE_ID,
    rider_id: RIDER_ID,
    driver_id: DRIVER_ID,
    status: 'accepted',
    pickup_confirmed: false,
    dropoff_confirmed: false,
    schedule_id: null,
    pickup_point: null,
    dropoff_point: null,
    destination: { type: 'Point', coordinates: [-121.74, 38.55] },
    destination_name: 'Davis',
    origin: RIDER_ORIGIN_GEO,
    origin_name: '123 Origin St',
    caregiver_fare_cents: null,
    ...overrides,
  }
}

// ── A) auto-pickup-suggestion writes pickup_point = ride.origin ──────────────

describe('POST /api/rides/:id/accept-location — Hotfix A (auto-pickup writes pickup_point)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFcmPush.mockResolvedValue(0)
    mockRealtime.mockReturnValue(undefined)
    mockRealtimeMany.mockResolvedValue(undefined)
  })

  it('writes rides.pickup_point = ride.origin when dropoff accepted on a rider-origin pickup ride', async () => {
    // Setup: ride with origin set, no pickup_point, pickup not confirmed.
    // Rider clicks "Accept Dropoff" → auto-pickup-suggestion branch fires.
    authAs(RIDER_ID)
    const ride = buildRide({ pickup_confirmed: false, dropoff_confirmed: false })
    const updateLog: Array<{ table: string; payload: unknown; eqs: Array<[string, unknown]>; isFilters: Array<[string, unknown]> }> = []
    const ridesQueue = [
      plainChain(ride),                                  // initial SELECT (line 3348)
      spyChain('rides', updateLog, { id: RIDE_ID }),     // CAS flip dropoff_confirmed=true
      spyChain('rides', updateLog),                      // [A] auto-pickup pickup_point UPDATE
      plainChain(),                                      // status flip → coordinating (conditional)
    ]
    const messagesQueue = [
      plainChain({ id: 'msg-pickup', ride_id: RIDE_ID, sender_id: RIDER_ID, content: 'Pickup at origin', type: 'pickup_suggestion', meta: {}, created_at: '2026-06-02T00:00:00Z' }), // INSERT pickup_suggestion
      plainChain({ id: 'msg-accept', ride_id: RIDE_ID, sender_id: RIDER_ID, content: 'accepted', type: 'location_accepted', meta: {}, created_at: '2026-06-02T00:00:01Z' }),         // INSERT location_accepted
    ]
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') return ridesQueue.shift() ?? plainChain()
      if (table === 'messages') return messagesQueue.shift() ?? plainChain()
      return plainChain()
    })

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/accept-location`)
      .set('Authorization', VALID_JWT)
      .send({ location_type: 'dropoff' })

    expect(res.status).toBe(200)
    // Find the auto-pickup column write (NOT the CAS flag flip)
    const pickupPointWrite = updateLog.find(
      (u) => u.table === 'rides' && typeof u.payload === 'object' && u.payload !== null && 'pickup_point' in u.payload,
    )
    expect(pickupPointWrite).toBeTruthy()
    expect(pickupPointWrite!.payload).toEqual({ pickup_point: RIDER_ORIGIN_GEO })
    // Guarded by `.is('pickup_point', null)` so we never clobber an
    // existing driver-set pin.
    expect(pickupPointWrite!.isFilters).toContainEqual(['pickup_point', null])
    // Guarded by `.eq('id', RIDE_ID)` so we only touch this ride row.
    expect(pickupPointWrite!.eqs).toContainEqual(['id', RIDE_ID])
  })

  it('skips the pickup_point write when the auto-pickup branch does not fire (pickup already confirmed)', async () => {
    // pickup_confirmed=true → auto-pickup branch is gated off entirely.
    authAs(RIDER_ID)
    const ride = buildRide({ pickup_confirmed: true, dropoff_confirmed: false, pickup_point: RIDER_ORIGIN_GEO })
    const updateLog: Array<{ table: string; payload: unknown; eqs: Array<[string, unknown]>; isFilters: Array<[string, unknown]> }> = []
    const ridesQueue = [
      plainChain(ride),
      spyChain('rides', updateLog, { id: RIDE_ID }),
      plainChain(),
    ]
    const messagesQueue = [plainChain({ id: 'msg-accept', meta: {} })]
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') return ridesQueue.shift() ?? plainChain()
      if (table === 'messages') return messagesQueue.shift() ?? plainChain()
      return plainChain()
    })

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/accept-location`)
      .set('Authorization', VALID_JWT)
      .send({ location_type: 'dropoff' })

    expect(res.status).toBe(200)
    const pickupPointWrite = updateLog.find(
      (u) => typeof u.payload === 'object' && u.payload !== null && 'pickup_point' in u.payload,
    )
    // No write to pickup_point in this branch — pickup was already
    // confirmed so the auto-suggestion code didn't fire.
    expect(pickupPointWrite).toBeUndefined()
  })
})

// ── B) /accept-location (pickup branch) backfills pickup_point ──────────────

describe('POST /api/rides/:id/accept-location — Hotfix B (backfill pickup_point from suggestion meta)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFcmPush.mockResolvedValue(0)
    mockRealtime.mockReturnValue(undefined)
    mockRealtimeMany.mockResolvedValue(undefined)
  })

  it('backfills rides.pickup_point from latest pickup_suggestion meta when column is null', async () => {
    // Setup: pickup not yet confirmed, pickup_point still null
    // (upstream auto-suggestion forgot to set it). Driver clicks
    // "Accept Pickup" → backfill branch fires.
    authAs(DRIVER_ID)
    const ride = buildRide({
      pickup_confirmed: false,
      dropoff_confirmed: true,
      pickup_point: null,
      status: 'coordinating',
    })
    const updateLog: Array<{ table: string; payload: unknown; eqs: Array<[string, unknown]>; isFilters: Array<[string, unknown]> }> = []
    const ridesQueue = [
      plainChain(ride),                                  // initial SELECT
      spyChain('rides', updateLog, { id: RIDE_ID }),     // CAS flip pickup_confirmed=true
      spyChain('rides', updateLog),                      // [B] backfill UPDATE
      plainChain(),                                      // status flip → coordinating (no-op since already coordinating)
    ]
    const messagesQueue = [
      plainChain({ meta: { lat: 38.54, lng: -121.77, name: 'Origin St' } }), // SELECT latest pickup_suggestion
      plainChain({ id: 'msg-accept', meta: {} }),                            // INSERT location_accepted
    ]
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') return ridesQueue.shift() ?? plainChain()
      if (table === 'messages') return messagesQueue.shift() ?? plainChain()
      return plainChain()
    })

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/accept-location`)
      .set('Authorization', VALID_JWT)
      .send({ location_type: 'pickup' })

    expect(res.status).toBe(200)
    const backfill = updateLog.find(
      (u) => u.table === 'rides' && typeof u.payload === 'object' && u.payload !== null && 'pickup_point' in u.payload,
    )
    expect(backfill).toBeTruthy()
    // Server expects GeoJSON with [lng, lat] order. lng=-121.77, lat=38.54
    expect(backfill!.payload).toEqual({
      pickup_point: { type: 'Point', coordinates: [-121.77, 38.54] },
    })
    expect(backfill!.isFilters).toContainEqual(['pickup_point', null])
    expect(backfill!.eqs).toContainEqual(['id', RIDE_ID])
  })

  it('does NOT backfill when pickup_point is already set (defensive .is(null) guard)', async () => {
    authAs(DRIVER_ID)
    const ride = buildRide({
      pickup_confirmed: false,
      dropoff_confirmed: true,
      pickup_point: { type: 'Point', coordinates: [-121.77, 38.54] },
    })
    const updateLog: Array<{ table: string; payload: unknown; eqs: Array<[string, unknown]>; isFilters: Array<[string, unknown]> }> = []
    const ridesQueue = [
      plainChain(ride),
      spyChain('rides', updateLog, { id: RIDE_ID }),
      plainChain(),
    ]
    const messagesQueue = [plainChain({ id: 'msg-accept', meta: {} })]
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') return ridesQueue.shift() ?? plainChain()
      if (table === 'messages') return messagesQueue.shift() ?? plainChain()
      return plainChain()
    })

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/accept-location`)
      .set('Authorization', VALID_JWT)
      .send({ location_type: 'pickup' })

    expect(res.status).toBe(200)
    // No backfill write — `ride.pickup_point == null` was false so the
    // branch was skipped entirely.
    const backfill = updateLog.find(
      (u) => typeof u.payload === 'object' && u.payload !== null && 'pickup_point' in u.payload,
    )
    expect(backfill).toBeUndefined()
  })

  it('does NOT backfill when no pickup_suggestion exists (graceful no-op)', async () => {
    authAs(DRIVER_ID)
    const ride = buildRide({
      pickup_confirmed: false,
      dropoff_confirmed: true,
      pickup_point: null,
    })
    const updateLog: Array<{ table: string; payload: unknown; eqs: Array<[string, unknown]>; isFilters: Array<[string, unknown]> }> = []
    const ridesQueue = [
      plainChain(ride),
      spyChain('rides', updateLog, { id: RIDE_ID }),
      spyChain('rides', updateLog),  // backfill UPDATE — should NOT be reached
      plainChain(),
    ]
    const messagesQueue = [
      plainChain(null),                              // SELECT pickup_suggestion → no row
      plainChain({ id: 'msg-accept', meta: {} }),    // INSERT location_accepted
    ]
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') return ridesQueue.shift() ?? plainChain()
      if (table === 'messages') return messagesQueue.shift() ?? plainChain()
      return plainChain()
    })

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/accept-location`)
      .set('Authorization', VALID_JWT)
      .send({ location_type: 'pickup' })

    expect(res.status).toBe(200)
    // No pickup_point write — graceful no-op because the latest
    // pickup_suggestion was missing.
    const backfill = updateLog.find(
      (u) => typeof u.payload === 'object' && u.payload !== null && 'pickup_point' in u.payload,
    )
    expect(backfill).toBeUndefined()
  })
})
