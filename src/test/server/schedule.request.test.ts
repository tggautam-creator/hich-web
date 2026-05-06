// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAuth, mockFrom, mockRpc, mockSendFcmPush, mockChannel, mockStripeRetrievePm, mockStripeListPm } = vi.hoisted(() => {
  const mockAuth = { getUser: vi.fn() }
  const mockFrom = vi.fn()
  const mockRpc = vi.fn()
  const mockSendFcmPush = vi.fn()
  const mockSend = vi.fn().mockResolvedValue(undefined)
  const mockSubscribe = vi.fn().mockImplementation((cb?: (status: string) => void) => {
    if (cb) cb('SUBSCRIBED')
    return { send: mockSend }
  })
  const mockChannel = vi.fn().mockReturnValue({ subscribe: mockSubscribe, send: mockSend })
  // Default: payment method exists in Stripe and belongs to the customer the
  // /request endpoint just looked up (see DRIVER_SCHEDULE / RIDER_SCHEDULE
  // flows below). Individual tests override per-call.
  const mockStripeRetrievePm = vi.fn().mockResolvedValue({ id: 'pm_123', customer: 'cus_123' })
  // schedule.ts switched from retrieve+self-heal to the shared resolveAndPersistDefaultPm
  // helper, which paginates via paymentMethods.list. Default the list to one
  // valid pm matching the cached default so the happy path resolves.
  const mockStripeListPm = vi.fn().mockResolvedValue({
    data: [{ id: 'pm_123', customer: 'cus_123', card: { fingerprint: 'fp_x' }, created: 1 }],
  })
  return { mockAuth, mockFrom, mockRpc, mockSendFcmPush, mockChannel, mockStripeRetrievePm, mockStripeListPm }
})

const { mockRemoveChannel } = vi.hoisted(() => ({
  mockRemoveChannel: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom, rpc: mockRpc, channel: mockChannel, removeChannel: mockRemoveChannel },
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
}))

// Stripe is consulted on the rider's payment method to detect a stale
// default_payment_method_id (see schedule.ts card check).
vi.mock('stripe', () => {
  const StripeCtor = vi.fn().mockImplementation(() => ({
    paymentMethods: { retrieve: mockStripeRetrievePm, list: mockStripeListPm },
  }))
  return { default: StripeCtor }
})

import { app } from '../../../server/app.ts'

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_JWT = 'Bearer valid.jwt.token'

const DRIVER_SCHEDULE = {
  id: 'sched-001',
  user_id: 'driver-abc',
  mode: 'driver',
  route_name: 'Davis to SF',
  origin_address: 'Davis, CA',
  dest_address: 'San Francisco, CA',
  trip_date: '2026-04-01',
  trip_time: '08:30:00',
}

const RIDER_SCHEDULE = {
  id: 'sched-002',
  user_id: 'rider-xyz',
  mode: 'rider',
  route_name: 'Davis to Oakland',
  origin_address: 'Davis, CA',
  dest_address: 'Oakland, CA',
  trip_date: '2026-04-01',
  trip_time: '09:00:00',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authAsUser(userId = 'user-123') {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function setupMocks(schedule: Record<string, unknown>, requesterId: string) {
  authAsUser(requesterId)

  // ride_schedules → .select().eq().single()
  const mockSingle = vi.fn().mockResolvedValue({ data: schedule, error: null })
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelectSchedule = vi.fn().mockReturnValue({ eq: mockEq })

  // rides → .insert().select().single() for creating ride
  const mockRideSingle = vi.fn().mockResolvedValue({
    data: { id: 'ride-new-001' },
    error: null,
  })
  const mockRideSelect = vi.fn().mockReturnValue({ single: mockRideSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockRideSelect })

  // rides → .select().eq().or().not().limit() for duplicate check
  const mockDupLimit = vi.fn().mockResolvedValue({ data: [], error: null })
  const mockDupNot = vi.fn().mockReturnValue({ limit: mockDupLimit })
  const mockDupOr = vi.fn().mockReturnValue({ not: mockDupNot })
  const mockDupEq = vi.fn().mockReturnValue({ or: mockDupOr })
  const mockDupSelect = vi.fn().mockReturnValue({ eq: mockDupEq })

  // push_tokens → .select().eq()
  const mockTokenEq = vi.fn().mockResolvedValue({
    data: [{ token: 'fcm-poster-1' }],
    error: null,
  })
  const mockSelectTokens = vi.fn().mockReturnValue({ eq: mockTokenEq })

  // users (requester name + driver check + B1 card check) → .select().eq().single()
  const mockUserSingle = vi.fn().mockResolvedValue({
    data: {
      full_name: 'Test User',
      is_driver: true,
      stripe_customer_id: 'cus_123',
      default_payment_method_id: 'pm_123',
    },
    error: null,
  })
  const mockUserEq = vi.fn().mockReturnValue({ single: mockUserSingle })
  const mockSelectUser = vi.fn().mockReturnValue({ eq: mockUserEq })

  // notifications → .insert() (fire-and-forget)
  const mockNotifInsert = vi.fn().mockResolvedValue({ data: null, error: null })

  // messages → .insert().select().single() — used by the
  // pre-confirmed pickup hand-off when the rider supplies origin_lat/lng
  // (route now drops a `location_accepted` ack into the chat). Without
  // this mock the route 500s before any test assertion runs.
  const mockMsgSingle = vi.fn().mockResolvedValue({
    data: { id: 'msg-pickup-1' },
    error: null,
  })
  const mockMsgSelect = vi.fn().mockReturnValue({ single: mockMsgSingle })
  const mockMsgInsert = vi.fn().mockReturnValue({ select: mockMsgSelect })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'ride_schedules') return { select: mockSelectSchedule }
    if (table === 'rides') return { insert: mockInsert, select: mockDupSelect }
    if (table === 'push_tokens') return { select: mockSelectTokens }
    if (table === 'users') return { select: mockSelectUser }
    if (table === 'notifications') return { insert: mockNotifInsert }
    if (table === 'messages') return { insert: mockMsgInsert }
    return {}
  })

  mockSendFcmPush.mockResolvedValue(1)

  return { mockInsert, mockSingle }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/schedule/request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Success: rider requests a driver's posted ride ───────────────────────

  it('creates a ride with correct rider/driver when requesting a driver post', async () => {
    const { mockInsert } = setupMocks(DRIVER_SCHEDULE, 'rider-me')

    const res = await request(app)
      .post('/api/schedule/request')
      .set('Authorization', VALID_JWT)
      .send({ schedule_id: 'sched-001', origin_lat: 38.54, origin_lng: -121.76 })

    expect(res.status).toBe(201)
    expect(res.body.ride_id).toBe('ride-new-001')

    // The rider is the requester, driver is the schedule poster
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        rider_id: 'rider-me',
        driver_id: 'driver-abc',
        status: 'requested',
      }),
    )
  })

  // ── Success: driver offers to drive a rider's posted request ─────────────

  it('creates a ride with correct rider/driver when offering to drive a rider post', async () => {
    const { mockInsert } = setupMocks(RIDER_SCHEDULE, 'driver-me')

    const res = await request(app)
      .post('/api/schedule/request')
      .set('Authorization', VALID_JWT)
      .send({ schedule_id: 'sched-002', origin_lat: 38.54, origin_lng: -121.76 })

    expect(res.status).toBe(201)
    expect(res.body.ride_id).toBe('ride-new-001')

    // The rider is the schedule poster, driver is the requester
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        rider_id: 'rider-xyz',
        driver_id: 'driver-me',
        status: 'requested',
      }),
    )
  })

  // ── Sends push notification to poster ────────────────────────────────────

  it('sends FCM push to the poster with requester name', async () => {
    setupMocks(DRIVER_SCHEDULE, 'rider-me')

    await request(app)
      .post('/api/schedule/request')
      .set('Authorization', VALID_JWT)
      .send({ schedule_id: 'sched-001' })

    expect(mockSendFcmPush).toHaveBeenCalledWith(
      ['fcm-poster-1'],
      expect.objectContaining({
        title: 'Ride Board Request',
        body: 'Test User wants to join your ride',
        data: expect.objectContaining({
          type: 'board_request',
          ride_id: 'ride-new-001',
        }),
      }),
    )
  })

  it('sends correct message when driver offers to drive a rider post', async () => {
    setupMocks(RIDER_SCHEDULE, 'driver-me')

    await request(app)
      .post('/api/schedule/request')
      .set('Authorization', VALID_JWT)
      .send({ schedule_id: 'sched-002' })

    expect(mockSendFcmPush).toHaveBeenCalledWith(
      ['fcm-poster-1'],
      expect.objectContaining({
        body: 'Test User offered to drive you',
      }),
    )
  })

  // ── Sets origin GeoPoint from lat/lng ────────────────────────────────────

  it('builds origin GeoPoint from provided lat/lng', async () => {
    const { mockInsert } = setupMocks(DRIVER_SCHEDULE, 'rider-me')

    await request(app)
      .post('/api/schedule/request')
      .set('Authorization', VALID_JWT)
      .send({ schedule_id: 'sched-001', origin_lat: 38.54, origin_lng: -121.76 })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: { type: 'Point', coordinates: [-121.76, 38.54] },
      }),
    )
  })

  it('uses fallback origin when no lat/lng provided', async () => {
    const { mockInsert } = setupMocks(DRIVER_SCHEDULE, 'rider-me')

    await request(app)
      .post('/api/schedule/request')
      .set('Authorization', VALID_JWT)
      .send({ schedule_id: 'sched-001' })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: { type: 'Point', coordinates: [0, 0] },
      }),
    )
  })

  // ── Validation errors ────────────────────────────────────────────────────

  it('returns 400 when schedule_id is missing', async () => {
    authAsUser()

    const res = await request(app)
      .post('/api/schedule/request')
      .set('Authorization', VALID_JWT)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('returns 400 when requesting own posted ride', async () => {
    setupMocks({ ...DRIVER_SCHEDULE, user_id: 'same-user' }, 'same-user')

    const res = await request(app)
      .post('/api/schedule/request')
      .set('Authorization', VALID_JWT)
      .send({ schedule_id: 'sched-001' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('OWN_SCHEDULE')
  })

  it('returns 404 when schedule does not exist', async () => {
    authAsUser()
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ select: mockSelect })

    const res = await request(app)
      .post('/api/schedule/request')
      .set('Authorization', VALID_JWT)
      .send({ schedule_id: 'nonexistent' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('SCHEDULE_NOT_FOUND')
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when no Authorization header', async () => {
    const res = await request(app)
      .post('/api/schedule/request')
      .send({ schedule_id: 'sched-001' })

    expect(res.status).toBe(401)
  })

  // ── B1 — card precondition ────────────────────────────────────────────────
  it('returns 400 NO_PAYMENT_METHOD when rider has no card on file', async () => {
    authAsUser('rider-me')

    // ride_schedules → single returns DRIVER_SCHEDULE
    const mockSchedSingle = vi.fn().mockResolvedValue({ data: DRIVER_SCHEDULE, error: null })
    const mockSchedEq = vi.fn().mockReturnValue({ single: mockSchedSingle })
    const mockSelectSched = vi.fn().mockReturnValue({ eq: mockSchedEq })

    // rides dup check → no existing ride
    const mockDupLimit = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockDupNot = vi.fn().mockReturnValue({ limit: mockDupLimit })
    const mockDupOr = vi.fn().mockReturnValue({ not: mockDupNot })
    const mockDupEq = vi.fn().mockReturnValue({ or: mockDupOr })
    const mockDupSelect = vi.fn().mockReturnValue({ eq: mockDupEq })

    // users (B1 card check) → no card
    const mockUserSingle = vi.fn().mockResolvedValue({
      data: { stripe_customer_id: null, default_payment_method_id: null },
      error: null,
    })
    const mockUserEq = vi.fn().mockReturnValue({ single: mockUserSingle })
    const mockSelectUser = vi.fn().mockReturnValue({ eq: mockUserEq })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'ride_schedules') return { select: mockSelectSched }
      if (table === 'rides') return { select: mockDupSelect }
      if (table === 'users') return { select: mockSelectUser }
      return {}
    })

    const res = await request(app)
      .post('/api/schedule/request')
      .set('Authorization', VALID_JWT)
      .send({ schedule_id: 'sched-001' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('NO_PAYMENT_METHOD')
  })

  it('returns 400 RIDER_NO_PAYMENT_METHOD when poster of rider-post has no card', async () => {
    // Driver responds to a rider-post whose poster has no card. The driver's
    // *own* card is irrelevant; the missing card belongs to the poster, so
    // the server must return a distinct code so the client doesn't redirect
    // the driver to /payment/add.
    authAsUser('driver-me')

    const mockSchedSingle = vi.fn().mockResolvedValue({ data: RIDER_SCHEDULE, error: null })
    const mockSchedEq = vi.fn().mockReturnValue({ single: mockSchedSingle })
    const mockSelectSched = vi.fn().mockReturnValue({ eq: mockSchedEq })

    const mockDupLimit = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockDupNot = vi.fn().mockReturnValue({ limit: mockDupLimit })
    const mockDupOr = vi.fn().mockReturnValue({ not: mockDupNot })
    const mockDupEq = vi.fn().mockReturnValue({ or: mockDupOr })
    const mockDupSelect = vi.fn().mockReturnValue({ eq: mockDupEq })

    // users.select(...).eq(id) — the endpoint queries this table twice for
    // distinct ids: first the driver's is_driver flag, then the rider's card.
    // Switch on the eq() argument so each lookup returns the right shape.
    const mockUsersSelect = vi.fn().mockImplementation(() => ({
      eq: vi.fn().mockImplementation((_col: string, value: string) => ({
        single: vi.fn().mockResolvedValue({
          data: value === 'driver-me'
            ? { is_driver: true }
            : { stripe_customer_id: null, default_payment_method_id: null },
          error: null,
        }),
      })),
    }))

    mockFrom.mockImplementation((table: string) => {
      if (table === 'ride_schedules') return { select: mockSelectSched }
      if (table === 'rides') return { select: mockDupSelect }
      if (table === 'users') return { select: mockUsersSelect }
      return {}
    })

    const res = await request(app)
      .post('/api/schedule/request')
      .set('Authorization', VALID_JWT)
      .send({ schedule_id: 'sched-002' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('RIDER_NO_PAYMENT_METHOD')
  })
})
