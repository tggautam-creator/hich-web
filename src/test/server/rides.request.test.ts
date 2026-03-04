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

// Import app after mocks are registered
import { app } from '../../../server/app.ts'

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_ORIGIN = { type: 'Point', coordinates: [-121.74, 38.54] }
const VALID_JWT = 'Bearer valid.jwt.token'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Stage 2 happy path: nearby drivers found, no fallback needed. */
function setupStage2() {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: 'rider-123' } },
    error: null,
  })

  // Stage 2 RPC returns 2 nearby drivers
  mockRpc.mockResolvedValue({
    data: [{ user_id: 'driver-1' }, { user_id: 'driver-2' }],
    error: null,
  })

  // rides insert chain
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'ride-abc' }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })

  // push_tokens select chain
  const mockIn = vi.fn().mockResolvedValue({
    data: [{ token: 'fcm-token-abc' }],
    error: null,
  })
  const mockSelectTokens = vi.fn().mockReturnValue({ in: mockIn })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'rides') return { insert: mockInsert }
    if (table === 'push_tokens') return { select: mockSelectTokens }
    return {}
  })

  mockSendFcmPush.mockResolvedValue(2)

  return { mockInsert, mockIn }
}

/** Stage 1 fallback: Stage 2 returns empty, falls back to all drivers. */
function setupFallback() {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: 'rider-123' } },
    error: null,
  })

  // Stage 2 RPC returns empty → triggers fallback
  mockRpc.mockResolvedValue({ data: [], error: null })

  // rides insert chain
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'ride-abc' }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })

  // Stage 1: all drivers
  const mockEq = vi.fn().mockResolvedValue({
    data: [{ id: 'driver-1' }],
    error: null,
  })
  const mockSelectUsers = vi.fn().mockReturnValue({ eq: mockEq })

  // push_tokens select chain
  const mockIn = vi.fn().mockResolvedValue({
    data: [{ token: 'fcm-token-abc' }],
    error: null,
  })
  const mockSelectTokens = vi.fn().mockReturnValue({ in: mockIn })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'rides') return { insert: mockInsert }
    if (table === 'users') return { select: mockSelectUsers }
    if (table === 'push_tokens') return { select: mockSelectTokens }
    return {}
  })

  mockSendFcmPush.mockResolvedValue(1)

  return { mockInsert, mockEq }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/rides/request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Happy path (Stage 2) ────────────────────────────────────────────────────

  it('returns 201 and ride_id on valid request', async () => {
    setupStage2()

    const res = await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ origin: VALID_ORIGIN })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ride_id: 'ride-abc' })
  })

  it('inserts a ride record with status=requested and the rider_id', async () => {
    const { mockInsert } = setupStage2()

    await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ origin: VALID_ORIGIN, destination_bearing: 45 })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        rider_id: 'rider-123',
        status: 'requested',
        destination_bearing: 45,
      }),
    )
  })

  it('calls nearby_active_drivers RPC with origin coordinates', async () => {
    setupStage2()

    await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ origin: VALID_ORIGIN })

    expect(mockRpc).toHaveBeenCalledWith('nearby_active_drivers', {
      origin_lng: -121.74,
      origin_lat: 38.54,
    })
  })

  it('uses Stage 2 driver IDs (not all drivers) when nearby results exist', async () => {
    const { mockIn } = setupStage2()

    await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ origin: VALID_ORIGIN })

    // push_tokens queried with Stage 2 driver IDs
    expect(mockIn).toHaveBeenCalledWith('user_id', ['driver-1', 'driver-2'])
  })

  it('sends FCM push to drivers who have tokens', async () => {
    setupStage2()

    await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ origin: VALID_ORIGIN })

    expect(mockSendFcmPush).toHaveBeenCalledWith(
      ['fcm-token-abc'],
      expect.objectContaining({ data: expect.objectContaining({ type: 'ride_request' }) }),
    )
  })

  // ── Stage 1 fallback ────────────────────────────────────────────────────────

  it('falls back to Stage 1 and queries all drivers when Stage 2 returns empty', async () => {
    const { mockEq } = setupFallback()

    await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ origin: VALID_ORIGIN })

    expect(mockEq).toHaveBeenCalledWith('is_driver', true)
  })

  it('logs fallback_triggered:true when Stage 2 returns no nearby drivers', async () => {
    setupFallback()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ origin: VALID_ORIGIN })

    const logged = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>
    expect(logged['stage']).toBe(1)
    expect(logged['fallback_triggered']).toBe(true)

    spy.mockRestore()
  })

  it('does NOT log fallback_triggered when Stage 2 finds drivers', async () => {
    setupStage2()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({ origin: VALID_ORIGIN })

    const logged = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>
    expect(logged['stage']).toBe(2)
    expect(logged['fallback_triggered']).toBeUndefined()

    spy.mockRestore()
  })

  // ── Auth / validation ───────────────────────────────────────────────────────

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .post('/api/rides/request')
      .send({ origin: VALID_ORIGIN })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('MISSING_TOKEN')
  })

  it('returns 401 when JWT is invalid', async () => {
    mockAuth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    })

    const res = await request(app)
      .post('/api/rides/request')
      .set('Authorization', 'Bearer bad.token')
      .send({ origin: VALID_ORIGIN })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })

  it('returns 400 when origin is missing', async () => {
    mockAuth.getUser.mockResolvedValue({
      data: { user: { id: 'rider-123' } },
      error: null,
    })

    const res = await request(app)
      .post('/api/rides/request')
      .set('Authorization', VALID_JWT)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })
})
