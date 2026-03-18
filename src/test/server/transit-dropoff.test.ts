// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAuth, mockFrom, mockSendFcmPush } = vi.hoisted(() => {
  const mockAuth = { getUser: vi.fn() }
  const mockFrom = vi.fn()
  const mockSendFcmPush = vi.fn()
  return { mockAuth, mockFrom, mockSendFcmPush }
})

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom },
}))

vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcmPush,
}))

import { app } from '../../../server/app.ts'

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_JWT = 'Bearer valid.jwt.token'
const RIDE_ID = 'ride-transit-001'
const RIDER_ID = 'user-rider-001'
const DRIVER_ID = 'user-driver-001'

// ── Helpers ───────────────────────────────────────────────────────────────────

function authAsUser(userId = RIDER_ID) {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

// ── GET /api/transit/options ──────────────────────────────────────────────────

describe('GET /api/transit/options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn()
  })

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .get('/api/transit/options?dropoff_lat=38.55&dropoff_lng=-121.78&dest_lat=38.56&dest_lng=-121.79')

    expect(res.status).toBe(401)
  })

  it('returns 400 when query params are missing', async () => {
    authAsUser()
    const res = await request(app)
      .get('/api/transit/options')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_PARAMS')
  })

  it('returns 400 when params are non-numeric', async () => {
    authAsUser()
    const res = await request(app)
      .get('/api/transit/options?dropoff_lat=abc&dropoff_lng=-121.78&dest_lat=38.56&dest_lng=-121.79')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(400)
  })

  it('returns transit options on success', async () => {
    authAsUser()
    const googleResponse = {
      status: 'OK',
      routes: [{
        legs: [{
          duration: { value: 1200 },
          steps: [
            { travel_mode: 'WALKING', duration: { value: 180 } },
            {
              travel_mode: 'TRANSIT',
              duration: { value: 600 },
              transit_details: {
                line: {
                  short_name: '42',
                  name: 'Route 42',
                  vehicle: { type: 'BUS' },
                },
              },
            },
            { travel_mode: 'WALKING', duration: { value: 120 } },
          ],
        }],
      }],
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(googleResponse),
    })

    // Set a test API key
    process.env['GOOGLE_MAPS_KEY'] = 'test-key'

    const res = await request(app)
      .get('/api/transit/options?dropoff_lat=38.55&dropoff_lng=-121.78&dest_lat=38.56&dest_lng=-121.79')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.options).toHaveLength(1)
    expect(res.body.options[0]).toMatchObject({
      type: 'BUS',
      icon: '🚌',
      line_name: '42',
      total_minutes: 20,
    })

    delete process.env['GOOGLE_MAPS_KEY']
  })

  it('returns empty options when Google returns no routes', async () => {
    authAsUser()
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: 'ZERO_RESULTS', routes: [] }),
    })

    process.env['GOOGLE_MAPS_KEY'] = 'test-key'

    // Use unique coordinates to avoid cache hits
    const res = await request(app)
      .get('/api/transit/options?dropoff_lat=39.00&dropoff_lng=-120.50&dest_lat=39.10&dest_lng=-120.60')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.options).toHaveLength(0)

    delete process.env['GOOGLE_MAPS_KEY']
  })

  it('returns 500 when no Google API key is configured', async () => {
    authAsUser()
    // Ensure no API key env vars
    delete process.env['GOOGLE_DIRECTIONS_KEY']
    delete process.env['GOOGLE_MAPS_KEY']

    // Use unique coordinates to avoid cache hit from previous test
    const res = await request(app)
      .get('/api/transit/options?dropoff_lat=40.00&dropoff_lng=-120.00&dest_lat=41.00&dest_lng=-119.00')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('CONFIG_ERROR')
  })
})

// ── PATCH /api/rides/:id/confirm-dropoff ──────────────────────────────────────

describe('PATCH /api/rides/:id/confirm-dropoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/confirm-dropoff`)

    expect(res.status).toBe(401)
  })

  it('returns 404 when ride not found', async () => {
    authAsUser()
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: new Error('not found') }),
        }),
      }),
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/confirm-dropoff`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(404)
  })

  it('returns 403 when user is not the rider', async () => {
    authAsUser(DRIVER_ID)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'accepted' },
            error: null,
          }),
        }),
      }),
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/confirm-dropoff`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('returns 409 when ride is not in accepted status', async () => {
    authAsUser()
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'requested' },
            error: null,
          }),
        }),
      }),
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/confirm-dropoff`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INVALID_STATUS')
  })

  it('sets status to coordinating and notifies driver', async () => {
    authAsUser()

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const mockTokenSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        data: [{ token: 'fcm-driver-token' }],
        error: null,
      }),
    })

    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides' && callCount === 0) {
        callCount++
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'accepted' },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'rides') {
        return { update: mockUpdate }
      }
      if (table === 'push_tokens') {
        return { select: mockTokenSelect }
      }
      return { select: vi.fn() }
    })

    mockSendFcmPush.mockResolvedValue(1)

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/confirm-dropoff`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('coordinating')
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'coordinating' })
    expect(mockSendFcmPush).toHaveBeenCalledWith(
      ['fcm-driver-token'],
      expect.objectContaining({ title: 'Drop-off confirmed' }),
    )
  })
})

// ── PATCH /api/rides/:id/decline-dropoff ──────────────────────────────────────

describe('PATCH /api/rides/:id/decline-dropoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/decline-dropoff`)

    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not the rider', async () => {
    authAsUser(DRIVER_ID)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'accepted', origin: { type: 'Point', coordinates: [-121.76, 38.54] } },
            error: null,
          }),
        }),
      }),
    })

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/decline-dropoff`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(403)
  })

  it('resets status to requested and re-notifies drivers', async () => {
    authAsUser()

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const mockTokenIn = vi.fn().mockResolvedValue({
      data: [{ token: 'fcm-other-driver' }],
      error: null,
    })
    const mockTokenSelect = vi.fn().mockReturnValue({
      in: mockTokenIn,
    })

    let rideCallCount = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides' && rideCallCount === 0) {
        rideCallCount++
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: RIDE_ID,
                  rider_id: RIDER_ID,
                  driver_id: DRIVER_ID,
                  status: 'accepted',
                  origin: { type: 'Point', coordinates: [-121.76, 38.54] },
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'rides') {
        return { update: mockUpdate }
      }
      if (table === 'driver_locations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ user_id: 'other-driver-1' }, { user_id: 'other-driver-2' }],
              error: null,
            }),
          }),
        }
      }
      if (table === 'users') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'other-driver-1' }, { id: 'other-driver-2' }],
              error: null,
            }),
          }),
        }
      }
      if (table === 'push_tokens') {
        return { select: mockTokenSelect }
      }
      return { select: vi.fn() }
    })

    mockSendFcmPush.mockResolvedValue(1)

    const res = await request(app)
      .patch(`/api/rides/${RIDE_ID}/decline-dropoff`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('requested')
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'requested', driver_id: null })
    expect(mockSendFcmPush).toHaveBeenCalledWith(
      ['fcm-other-driver'],
      expect.objectContaining({ title: 'New ride request nearby' }),
    )
  })
})
