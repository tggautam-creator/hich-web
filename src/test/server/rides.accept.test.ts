// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockAuth, mockFrom, mockRpc, mockSendFcmPush } = vi.hoisted(() => {
  const mockAuth = { getUser: vi.fn() }
  const mockFrom = vi.fn()
  const mockRpc = vi.fn()
  const mockSendFcmPush = vi.fn()
  return { mockAuth, mockFrom, mockRpc, mockSendFcmPush }
})

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom, rpc: mockRpc },
}))

vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcmPush,
}))

import { app } from '../../../server/app.ts'

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_JWT = 'Bearer valid.jwt.token'

// ── Helpers ───────────────────────────────────────────────────────────────────

function authAs(userId: string) {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function rideExists(ride: { id: string; rider_id: string; status: string }) {
  const mockSingle = vi.fn().mockResolvedValue({ data: ride, error: null })
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })

  // Update chain
  const mockUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq })

  // Push tokens chain
  const mockTokenEq = vi.fn().mockResolvedValue({
    data: [{ token: 'rider-fcm-token' }],
    error: null,
  })
  const mockTokenSelect = vi.fn().mockReturnValue({ eq: mockTokenEq })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'rides') return { select: mockSelect, update: mockUpdate }
    if (table === 'push_tokens') return { select: mockTokenSelect }
    return {}
  })

  return { mockUpdate, mockUpdateEq, mockTokenEq }
}

function rideNotFound() {
  const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })

  mockFrom.mockReturnValue({ select: mockSelect })
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('PATCH /api/rides/:id/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns 200 and accepts the ride', async () => {
    authAs('driver-001')
    rideExists({ id: 'ride-abc', rider_id: 'rider-001', status: 'requested' })
    mockSendFcmPush.mockResolvedValue(1)

    const res = await request(app)
      .patch('/api/rides/ride-abc/accept')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ride_id: 'ride-abc', status: 'accepted' })
  })

  it('updates ride status to accepted with driver_id', async () => {
    authAs('driver-001')
    const { mockUpdate } = rideExists({
      id: 'ride-abc',
      rider_id: 'rider-001',
      status: 'requested',
    })
    mockSendFcmPush.mockResolvedValue(1)

    await request(app)
      .patch('/api/rides/ride-abc/accept')
      .set('Authorization', VALID_JWT)

    expect(mockUpdate).toHaveBeenCalledWith({
      status: 'accepted',
      driver_id: 'driver-001',
    })
  })

  it('sends push notification to the rider', async () => {
    authAs('driver-001')
    rideExists({ id: 'ride-abc', rider_id: 'rider-001', status: 'requested' })
    mockSendFcmPush.mockResolvedValue(1)

    await request(app)
      .patch('/api/rides/ride-abc/accept')
      .set('Authorization', VALID_JWT)

    expect(mockSendFcmPush).toHaveBeenCalledWith(
      ['rider-fcm-token'],
      expect.objectContaining({
        data: expect.objectContaining({ type: 'ride_accepted', ride_id: 'ride-abc' }),
      }),
    )
  })

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it('returns 404 when ride does not exist', async () => {
    authAs('driver-001')
    rideNotFound()

    const res = await request(app)
      .patch('/api/rides/nonexistent/accept')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('RIDE_NOT_FOUND')
  })

  it('returns 409 when ride is already accepted', async () => {
    authAs('driver-001')
    rideExists({ id: 'ride-abc', rider_id: 'rider-001', status: 'accepted' })

    const res = await request(app)
      .patch('/api/rides/ride-abc/accept')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('RIDE_NOT_AVAILABLE')
  })

  it('returns 409 when ride is cancelled', async () => {
    authAs('driver-001')
    rideExists({ id: 'ride-abc', rider_id: 'rider-001', status: 'cancelled' })

    const res = await request(app)
      .patch('/api/rides/ride-abc/accept')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('RIDE_NOT_AVAILABLE')
  })

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .patch('/api/rides/ride-abc/accept')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('MISSING_TOKEN')
  })

  it('returns 401 when JWT is invalid', async () => {
    mockAuth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    })

    const res = await request(app)
      .patch('/api/rides/ride-abc/accept')
      .set('Authorization', 'Bearer bad.token')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })
})
