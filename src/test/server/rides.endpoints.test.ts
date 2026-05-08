// @vitest-environment node
/**
 * Integration tests for core ride endpoints:
 *  - POST  /api/rides/request
 *  - PATCH /api/rides/:id/cancel
 *  - PATCH /api/rides/:id/accept
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAuth, mockFrom, mockRpc, mockSendFcmPush, mockStripeListPm } = vi.hoisted(() => {
  const mockAuth = { getUser: vi.fn() }
  const mockFrom = vi.fn()
  const mockRpc = vi.fn()
  const mockSendFcmPush = vi.fn()
  // Default to "rider has one valid card matching pm_123" — individual tests
  // can override via mockStripeListPm.mockResolvedValueOnce({ data: [] }).
  const mockStripeListPm = vi.fn().mockResolvedValue({
    data: [{ id: 'pm_123', customer: 'cus_123', card: { fingerprint: 'fp_x' }, created: 1 }],
  })
  return { mockAuth, mockFrom, mockRpc, mockSendFcmPush, mockStripeListPm }
})

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: {
    auth: mockAuth,
    from: mockFrom,
    rpc: mockRpc,
  },
}))

vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcmPush,
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

// rides.ts now self-heals the rider's default PM via Stripe (was inline
// column-only check). Mock paymentMethods.list so the helper can resolve.
vi.mock('stripe', () => {
  const StripeCtor = vi.fn().mockImplementation(() => ({
    paymentMethods: { list: mockStripeListPm },
  }))
  return { default: StripeCtor }
})

import { app } from '../../../server/app.ts'

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_JWT = 'Bearer valid.jwt.token'
const RIDER_ID = 'user-rider-001'
const DRIVER_ID = 'user-driver-001'
const RIDE_ID = 'ride-001'

const DRIVER_ID_2 = 'user-driver-002'

const VALID_ORIGIN = { type: 'Point', coordinates: [-121.77, 38.54] }

const RIDE_REQUESTED = {
  id: RIDE_ID,
  rider_id: RIDER_ID,
  driver_id: null,
  status: 'requested',
}

// Ride already accepted by DRIVER_ID_2 — used to test DRIVER_ID joining as standby
const RIDE_ACCEPTED = {
  id: RIDE_ID,
  rider_id: RIDER_ID,
  driver_id: DRIVER_ID_2,
  status: 'accepted',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authAs(userId: string) {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

/**
 * Returns a fluent chain stub that is itself a thenable resolving to { data, error }.
 * Any method call (select, eq, in, etc.) returns the same chain, so deeply-chained
 * Supabase queries can be mocked with a single call to chainOk().
 */
function chainOk(data: unknown = null, error: unknown = null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = new Proxy({} as Record<string, unknown>, {
    get(_target, key: string) {
      // Expose .then so `await chain` resolves to { data, error }
      if (key === 'then') return (resolve: (v: unknown) => void) => resolve({ data, error })
      if (key === 'catch' || key === 'finally') return undefined
      // All other method calls return chain (supports arbitrary chaining depth)
      return (..._args: unknown[]) => chain
    },
  })
  return chain
}

// ── POST /api/rides/request ───────────────────────────────────────────────────

describe('POST /api/rides/request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFcmPush.mockResolvedValue(0)
    mockRpc.mockResolvedValue({ data: [], error: null })
  })

  it('returns 401 without auth header', async () => {
    const res = await request(app)
      .post('/api/rides/request')
      .send({ origin: VALID_ORIGIN })
    expect(res.status).toBe(401)
  })

  it('returns 400 when origin is missing', async () => {
    authAs(RIDER_ID)
    const res = await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ destination_name: 'Library' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('returns 409 when rider already has an active ride (BUG-036)', async () => {
    authAs(RIDER_ID)
    // 1) users query for card precondition — rider has a valid card
    mockFrom.mockReturnValueOnce(chainOk({
      stripe_customer_id: 'cus_123',
      default_payment_method_id: 'pm_123',
    }))
    // 2) from('rides') active-ride guard returns an array of candidate rides;
    //    one without schedule_id (an on-demand ride) flips the in-JS blocker.
    mockFrom.mockReturnValueOnce(chainOk([{ id: 'existing-ride', schedule_id: null, trip_date: null }]))

    const res = await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ origin: VALID_ORIGIN })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ACTIVE_RIDE_EXISTS')
  })

  it('returns 400 NO_PAYMENT_METHOD when rider has no card on file', async () => {
    authAs(RIDER_ID)
    mockFrom.mockReturnValueOnce(chainOk({
      stripe_customer_id: null,
      default_payment_method_id: null,
    }))

    const res = await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ origin: VALID_ORIGIN })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('NO_PAYMENT_METHOD')
  })

  it('returns 201 with ride_id on success', async () => {
    authAs(RIDER_ID)

    // Track sequential calls per table
    let ridesCallN = 0
    let usersCallN = 0

    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') {
        ridesCallN++
        if (ridesCallN === 1) {
          // Active-ride guard → no existing ride
          return chainOk(null)
        }
        // Insert new ride
        return { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: RIDE_ID }, error: null }) }) }) }
      }
      if (table === 'driver_locations') {
        // Stage-1 fallback: no online drivers
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      }
      if (table === 'users') {
        usersCallN++
        if (usersCallN === 1) {
          // B1 card precondition → rider has a card
          return chainOk({ stripe_customer_id: 'cus_123', default_payment_method_id: 'pm_123' })
        }
        if (usersCallN === 2) {
          // All drivers query (Stage-1 fallback) → no drivers → driverIds = []
          return { select: () => ({ eq: () => ({ neq: () => Promise.resolve({ data: [], error: null }) }) }) }
        }
        // Rider name for notifications / broadcasts
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { full_name: 'Test Rider' }, error: null }) }) }) }
      }
      if (table === 'push_tokens') {
        return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }
      }
      // Notifications insert — driverIds is empty so this branch is skipped,
      // but guard here in case
      return { insert: () => Promise.resolve({ error: null }) }
    })

    const res = await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ origin: VALID_ORIGIN, destination_name: 'Library' })

    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('ride_id', RIDE_ID)
  })
})

// ── PATCH /api/rides/:id/cancel ───────────────────────────────────────────────

describe('PATCH /api/rides/:id/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFcmPush.mockResolvedValue(0)
    mockRpc.mockResolvedValue({ data: [], error: null })
  })

  it('returns 401 without auth header', async () => {
    const res = await request(app).patch(`/api/rides/${RIDE_ID}/cancel`)
    expect(res.status).toBe(401)
  })

  it('returns 404 when ride does not exist', async () => {
    authAs(RIDER_ID)
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
        }),
      }),
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/cancel`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('RIDE_NOT_FOUND')
  })

  it('returns 403 when caller is not a ride participant and has no offer', async () => {
    authAs('stranger-user')
    // Ride fetch returns ride where stranger is neither rider nor driver
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: RIDE_REQUESTED, error: null }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }
      }
      if (table === 'ride_offers') {
        // Path C check: no offer for this driver
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }),
          update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
        }
      }
      return chainOk()
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/cancel`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('returns 409 when ride is in a non-cancellable status (active)', async () => {
    authAs(RIDER_ID)
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({
            data: { ...RIDE_REQUESTED, status: 'active' },
            error: null,
          }),
        }),
      }),
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/cancel`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVALID_STATUS')
  })

  it('returns 200 when rider cancels a requested ride (Path B)', async () => {
    authAs(RIDER_ID)

    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: RIDE_REQUESTED, error: null }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }
      }
      if (table === 'ride_offers') {
        return {
          update: () => ({
            eq: () => ({
              in: () => Promise.resolve({ error: null }),
            }),
          }),
        }
      }
      if (table === 'push_tokens') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      }
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              neq: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }
      }
      if (table === 'notifications') {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                contains: () => Promise.resolve({ error: null }),
              }),
            }),
          }),
        }
      }
      return chainOk()
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/cancel`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ride_id: RIDE_ID, status: 'cancelled' })
  })
})

// ── PATCH /api/rides/:id/accept ───────────────────────────────────────────────

describe('PATCH /api/rides/:id/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFcmPush.mockResolvedValue(0)
  })

  it('returns 401 without auth header', async () => {
    const res = await request(app).patch(`/api/rides/${RIDE_ID}/accept`)
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller is not a driver (BUG-038)', async () => {
    authAs(RIDER_ID)
    // Profile check returns is_driver: false
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { is_driver: false }, error: null }),
        }),
      }),
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/accept`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_A_DRIVER')
  })

  it('returns 404 when ride does not exist', async () => {
    authAs(DRIVER_ID)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { is_driver: true }, error: null }) }) }) }
      }
      if (table === 'rides') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'not found' } }) }) }) }
      }
      return chainOk()
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/accept`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('RIDE_NOT_FOUND')
  })

  it('returns 409 on self-accept (rider tries to accept own ride, BUG-038)', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { is_driver: true }, error: null }) }) }) }
      }
      if (table === 'rides') {
        // rider_id === caller (RIDER_ID)
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { ...RIDE_REQUESTED, rider_id: RIDER_ID }, error: null }) }) }) }
      }
      return chainOk()
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/accept`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SELF_ACCEPT')
  })

  it('returns 200 with offer_status "pending" on first driver accept', async () => {
    authAs(DRIVER_ID)

    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: (cols: string) => {
            if (cols.includes('is_driver')) {
              return { eq: () => ({ single: () => Promise.resolve({ data: { is_driver: true }, error: null }) }) }
            }
            // Driver info for broadcast
            return { eq: () => ({ single: () => Promise.resolve({ data: { full_name: 'Test Driver', avatar_url: null, rating_avg: 5, rating_count: 10 }, error: null }) }) }
          },
        }
      }
      if (table === 'rides') {
        return {
          select: (cols: string) => {
            // R.5 guard query: other active rides for this driver
            if (cols.includes('driver_id') === false && cols.includes('schedule_id')) {
              return { eq: () => ({ in: () => ({ neq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }
            }
            return { eq: () => ({ single: () => Promise.resolve({ data: RIDE_REQUESTED, error: null }) }) }
          },
        }
      }
      if (table === 'vehicles') {
        return { select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ single: () => Promise.resolve({ data: { id: 'v-1' }, error: null }) }) }) }) }) }
      }
      if (table === 'ride_offers') {
        return {
          upsert: () => Promise.resolve({ error: null }),
          select: (_cols: string, opts?: Record<string, unknown>) => {
            if (opts?.['count'] === 'exact') {
              // count pending offers
              return { eq: () => ({ eq: () => Promise.resolve({ count: 1, error: null }) }) }
            }
            return chainOk()
          },
          update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
        }
      }
      if (table === 'push_tokens') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      }
      return chainOk()
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/accept`)
      .set('Authorization', VALID_JWT)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ride_id: RIDE_ID, offer_status: 'pending' })
  })

  it('returns 200 with offer_status "standby" when ride is already accepted', async () => {
    authAs(DRIVER_ID)

    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { is_driver: true }, error: null }) }) }) }
      }
      if (table === 'rides') {
        return {
          select: (cols: string) => {
            // R.5 guard query: other active rides for this driver
            if (cols.includes('driver_id') === false && cols.includes('schedule_id')) {
              return { eq: () => ({ in: () => ({ neq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }
            }
            return { eq: () => ({ single: () => Promise.resolve({ data: RIDE_ACCEPTED, error: null }) }) }
          },
        }
      }
      if (table === 'vehicles') {
        return { select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }) }) }
      }
      if (table === 'ride_offers') {
        return {
          // First call: general OFFER_RELEASED guard uses .maybeSingle()
          //   (added 2026-05-07 — covers the case where ride.status reverts
          //    to 'requested' and the standby branch is skipped).
          // Second call: standby-branch guard uses .single().
          // Both return `{ data: null }` here since this fixture has no
          // pre-existing offer for the driver.
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: null, error: null }),
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
          upsert: () => Promise.resolve({ error: null }),
          update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
        }
      }
      return chainOk()
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/accept`)
      .set('Authorization', VALID_JWT)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ride_id: RIDE_ID, offer_status: 'standby' })
  })
})

// ── POST /api/rides/:id/nudge-rider ──────────────────────────────────────────

describe('POST /api/rides/:id/nudge-rider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFcmPush.mockResolvedValue(1)
    authAs(DRIVER_ID)
  })

  function mockRideAndTokens(ride: Record<string, unknown> | null) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: ride, error: ride ? null : { message: 'nf' } }),
            }),
          }),
        }
      }
      if (table === 'push_tokens') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ token: 'fcm-tok-rider' }], error: null }),
          }),
        }
      }
      return {}
    })
  }

  it('returns 401 without auth', async () => {
    const res = await request(app).post(`/api/rides/${RIDE_ID}/nudge-rider`)
    expect(res.status).toBe(401)
  })

  it('returns 404 when ride does not exist', async () => {
    mockRideAndTokens(null)
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/nudge-rider`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('returns 403 when caller is not the ride driver', async () => {
    mockRideAndTokens({
      id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID_2, payment_status: 'pending',
    })
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/nudge-rider`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('returns 400 INVALID_STATE when payment is already paid', async () => {
    mockRideAndTokens({
      id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, payment_status: 'paid',
    })
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/nudge-rider`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_STATE')
  })

  it('sends push on success and rejects second call within 60s cooldown', async () => {
    const rideId = 'ride-nudge-cooldown'
    mockRideAndTokens({
      id: rideId, rider_id: RIDER_ID, driver_id: DRIVER_ID, payment_status: 'pending',
    })

    const first = await request(app)
      .post(`/api/rides/${rideId}/nudge-rider`)
      .set('Authorization', VALID_JWT)
    expect(first.status).toBe(200)
    expect(first.body.nudged).toBe(true)
    expect(mockSendFcmPush).toHaveBeenCalledTimes(1)
    const [tokens, payload] = mockSendFcmPush.mock.calls[0]
    expect(tokens).toEqual(['fcm-tok-rider'])
    expect(payload.data.type).toBe('payment_needed')
    expect(payload.data.ride_id).toBe(rideId)

    const second = await request(app)
      .post(`/api/rides/${rideId}/nudge-rider`)
      .set('Authorization', VALID_JWT)
    expect(second.status).toBe(429)
    expect(second.body.error.code).toBe('COOLDOWN')
    expect(second.body.retry_after_seconds).toBeGreaterThan(0)
    // Push was NOT fired again.
    expect(mockSendFcmPush).toHaveBeenCalledTimes(1)
  })
})
