// @vitest-environment node
/**
 * Tests for ride QR endpoints:
 *  - GET  /api/rides/:id/qr      — generate HMAC-signed QR token
 *  - POST /api/rides/:id/start   — rider scans QR to start ride
 *  - POST /api/rides/:id/end     — rider scans QR to end ride
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAuth, mockFrom, mockSendFcmPush, mockGenerateQrToken, mockValidateQrToken } = vi.hoisted(() => {
  const mockAuth = { getUser: vi.fn() }
  const mockFrom = vi.fn()
  const mockSendFcmPush = vi.fn()
  const mockGenerateQrToken = vi.fn()
  const mockValidateQrToken = vi.fn()
  return { mockAuth, mockFrom, mockSendFcmPush, mockGenerateQrToken, mockValidateQrToken }
})

vi.mock('../../../server/lib/supabaseAdmin.ts', () => {
  const mockChannelObj = {
    subscribe: vi.fn((cb: (status: string) => void) => {
      // Immediately call the callback to unblock the broadcast await
      setTimeout(() => cb('SUBSCRIBED'), 0)
      return mockChannelObj
    }),
    send: vi.fn().mockResolvedValue(undefined),
  }
  return {
    supabaseAdmin: {
      auth: mockAuth,
      from: mockFrom,
      channel: () => mockChannelObj,
      removeChannel: vi.fn(),
    },
  }
})

vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcmPush,
}))

vi.mock('../../../server/lib/qrToken.ts', () => ({
  generateQrToken: mockGenerateQrToken,
  validateQrToken: mockValidateQrToken,
}))

import { app } from '../../../server/app.ts'

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_JWT = 'Bearer valid.jwt.token'
const RIDE_ID = 'ride-qr-001'
const RIDER_ID = 'user-rider-001'
const DRIVER_ID = 'user-driver-001'
const VALID_TOKEN = `${DRIVER_ID}:${RIDE_ID}:${Date.now()}:signature`

// ── Helpers ───────────────────────────────────────────────────────────────────

function authAsUser(userId = RIDER_ID) {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function mockRideQuery(ride: Record<string, unknown> | null, error: unknown = null) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: ride, error }),
      }),
    }),
    update: () => ({
      eq: () => Promise.resolve({ error: null }),
    }),
  })
}

const RIDE_COORDINATING = {
  id: RIDE_ID,
  rider_id: RIDER_ID,
  driver_id: DRIVER_ID,
  status: 'coordinating',
  fare_cents: 1500,
}

const RIDE_ACTIVE = {
  ...RIDE_COORDINATING,
  status: 'active',
  started_at: new Date().toISOString(),
}

// ── GET /api/rides/:id/qr ─────────────────────────────────────────────────────

describe('GET /api/rides/:id/qr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFcmPush.mockResolvedValue(undefined)
  })

  it('returns 401 without auth', async () => {
    const res = await request(app).get(`/api/rides/${RIDE_ID}/qr`)
    expect(res.status).toBe(401)
  })

  it('returns 403 if not the driver', async () => {
    authAsUser(RIDER_ID)
    mockRideQuery({ ...RIDE_COORDINATING })
    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/qr`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
  })

  it('returns 409 if ride is not coordinating or active', async () => {
    authAsUser(DRIVER_ID)
    mockRideQuery({ ...RIDE_COORDINATING, status: 'requested' })
    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/qr`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(409)
  })

  it('returns a token for the driver of a coordinating ride', async () => {
    authAsUser(DRIVER_ID)
    mockRideQuery(RIDE_COORDINATING)
    mockGenerateQrToken.mockReturnValue(VALID_TOKEN)

    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/qr`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ token: VALID_TOKEN })
    expect(mockGenerateQrToken).toHaveBeenCalledWith(DRIVER_ID, RIDE_ID)
  })
})

// ── POST /api/rides/:id/start ─────────────────────────────────────────────────

describe('POST /api/rides/:id/start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFcmPush.mockResolvedValue(undefined)
  })

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/start`)
      .send({ token: VALID_TOKEN })
    expect(res.status).toBe(401)
  })

  it('returns 400 without token', async () => {
    authAsUser(RIDER_ID)
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/start`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 401 with invalid HMAC token', async () => {
    authAsUser(RIDER_ID)
    mockValidateQrToken.mockReturnValue(null)

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/start`)
      .set('Authorization', VALID_JWT)
      .send({ token: 'bad-token' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })

  it('returns 400 if token rideId does not match URL', async () => {
    authAsUser(RIDER_ID)
    mockValidateQrToken.mockReturnValue({
      driverId: DRIVER_ID,
      rideId: 'different-ride',
      timestamp: Date.now(),
    })

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/start`)
      .set('Authorization', VALID_JWT)
      .send({ token: VALID_TOKEN })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('TOKEN_MISMATCH')
  })

  it('returns 403 if not the rider', async () => {
    authAsUser(DRIVER_ID)
    mockValidateQrToken.mockReturnValue({
      driverId: DRIVER_ID,
      rideId: RIDE_ID,
      timestamp: Date.now(),
    })
    mockRideQuery(RIDE_COORDINATING)

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/start`)
      .set('Authorization', VALID_JWT)
      .send({ token: VALID_TOKEN })

    expect(res.status).toBe(403)
  })

  it('starts the ride with a valid token', async () => {
    authAsUser(RIDER_ID)
    mockValidateQrToken.mockReturnValue({
      driverId: DRIVER_ID,
      rideId: RIDE_ID,
      timestamp: Date.now(),
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: RIDE_COORDINATING, error: null }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }
      }
      if (table === 'push_tokens') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        }
      }
      return {}
    })

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/start`)
      .set('Authorization', VALID_JWT)
      .send({ token: VALID_TOKEN })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('active')
    expect(mockValidateQrToken).toHaveBeenCalledWith(VALID_TOKEN)
  })
})

// ── POST /api/rides/:id/end ───────────────────────────────────────────────────

describe('POST /api/rides/:id/end', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFcmPush.mockResolvedValue(undefined)
  })

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/end`)
      .send({ token: VALID_TOKEN })
    expect(res.status).toBe(401)
  })

  it('returns 400 without token', async () => {
    authAsUser(RIDER_ID)
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/end`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 401 with invalid HMAC token', async () => {
    authAsUser(RIDER_ID)
    mockValidateQrToken.mockReturnValue(null)

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/end`)
      .set('Authorization', VALID_JWT)
      .send({ token: 'bad-token' })

    expect(res.status).toBe(401)
  })

  it('returns 409 if ride is not active', async () => {
    authAsUser(RIDER_ID)
    mockValidateQrToken.mockReturnValue({
      driverId: DRIVER_ID,
      rideId: RIDE_ID,
      timestamp: Date.now(),
    })
    mockRideQuery({ ...RIDE_COORDINATING })

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/end`)
      .set('Authorization', VALID_JWT)
      .send({ token: VALID_TOKEN })

    expect(res.status).toBe(409)
  })

  it('returns 403 if not the rider', async () => {
    authAsUser(DRIVER_ID)
    mockValidateQrToken.mockReturnValue({
      driverId: DRIVER_ID,
      rideId: RIDE_ID,
      timestamp: Date.now(),
    })
    mockRideQuery(RIDE_ACTIVE)

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/end`)
      .set('Authorization', VALID_JWT)
      .send({ token: VALID_TOKEN })

    expect(res.status).toBe(403)
  })
})
