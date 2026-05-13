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

const VALID_JWT = 'Bearer valid.jwt.token'

const VALID_BODY = {
  origin_place_id: 'place-001',
  dest_place_id:   'place-002',
  trip_date:       '2026-04-01',
  trip_time:       '08:30:00',
  time_type:       'departure' as const,
  mode:            'rider' as const,
  origin_lat:      38.54,
  origin_lng:      -121.76,
  dest_lat:        37.77,
  dest_lng:        -122.42,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authAsUser(userId = 'user-123') {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

/**
 * Stage 3 + Stage 2: routines exist AND nearby drivers exist.
 * Routine driver matches bearing (within 60°) and time (within 30 min).
 * Stage 2 returns additional drivers.
 */
function setupStage3WithStage2Fallback() {
  authAsUser()

  // rider bearing from (38.54, -121.76) to (37.77, -122.42) ≈ 220°
  // routine bearing 200° → diff ≈ 20° → within 60° → MATCH
  const mockSelectRoutines = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        // Server now appends `.or('end_date.is.null,end_date.gte.<today>')`
        // to filter out expired routines (audit B3, migration 068).
        or: vi.fn().mockResolvedValue({
          data: [
            {
              user_id: 'driver-routine-1',
              destination_bearing: 200,
              departure_time: '08:15:00',
              arrival_time: null,
            },
            {
              user_id: 'driver-routine-2',
              destination_bearing: 200,
              departure_time: '10:00:00', // 90 min diff → outside 30 min → NO MATCH
              arrival_time: null,
            },
          ],
          error: null,
        }),
      }),
    }),
  })

  // Stage 2: nearby drivers
  mockRpc.mockResolvedValue({
    data: [{ user_id: 'driver-nearby-1' }],
    error: null,
  })

  // push_tokens
  const mockIn = vi.fn().mockResolvedValue({
    data: [{ token: 'fcm-1' }, { token: 'fcm-2' }],
    error: null,
  })
  const mockSelectTokens = vi.fn().mockReturnValue({ in: mockIn })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'driver_routines') return { select: mockSelectRoutines }
    if (table === 'push_tokens') return { select: mockSelectTokens }
    return {}
  })

  mockSendFcmPush.mockResolvedValue(2)

  return { mockIn, mockSelectRoutines }
}

/**
 * Stage 3 only: has matching routines, no coordinates for Stage 2.
 */
function setupStage3Only() {
  authAsUser()

  const mockSelectRoutines = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        or: vi.fn().mockResolvedValue({
          data: [
            {
              user_id: 'driver-routine-1',
              destination_bearing: 200,
              departure_time: '08:20:00',
              arrival_time: null,
            },
          ],
          error: null,
        }),
      }),
    }),
  })

  const mockIn = vi.fn().mockResolvedValue({
    data: [{ token: 'fcm-1' }],
    error: null,
  })
  const mockSelectTokens = vi.fn().mockReturnValue({ in: mockIn })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'driver_routines') return { select: mockSelectRoutines }
    if (table === 'push_tokens') return { select: mockSelectTokens }
    return {}
  })

  mockSendFcmPush.mockResolvedValue(1)

  return { mockIn }
}

/**
 * Stage 2 fallback only: no matching routines, but nearby drivers exist.
 */
function setupStage2FallbackOnly() {
  authAsUser()

  // No routines match (empty or bearing too far off)
  const mockSelectRoutines = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        or: vi.fn().mockResolvedValue({
          data: [
            {
              user_id: 'driver-routine-x',
              destination_bearing: 10, // ~210° diff → outside 60° threshold
              departure_time: '08:30:00',
              arrival_time: null,
            },
          ],
          error: null,
        }),
      }),
    }),
  })

  // Stage 2: nearby drivers
  mockRpc.mockResolvedValue({
    data: [{ user_id: 'driver-nearby-1' }],
    error: null,
  })

  const mockIn = vi.fn().mockResolvedValue({
    data: [{ token: 'fcm-near' }],
    error: null,
  })
  const mockSelectTokens = vi.fn().mockReturnValue({ in: mockIn })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'driver_routines') return { select: mockSelectRoutines }
    if (table === 'push_tokens') return { select: mockSelectTokens }
    return {}
  })

  mockSendFcmPush.mockResolvedValue(1)

  return { mockIn }
}

/**
 * No matches at all: no matching routines, no nearby drivers.
 */
function setupNoMatches() {
  authAsUser()

  const mockSelectRoutines = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        or: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  })

  mockRpc.mockResolvedValue({ data: [], error: null })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'driver_routines') return { select: mockSelectRoutines }
    return {}
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/schedule/notify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Stage 3 matching ────────────────────────────────────────────────────

  it('returns 200 and notifies Stage 3 matched drivers', async () => {
    setupStage3WithStage2Fallback()

    const res = await request(app)
      .post('/api/schedule/notify')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    expect(res.status).toBe(200)
    expect(res.body.stage3_count).toBe(1) // only 1 routine matches
    expect(res.body.notified).toBe(2)
  })

  it('applies 60-degree bearing filter on driver_routines', async () => {
    const { mockIn } = setupStage3WithStage2Fallback()

    await request(app)
      .post('/api/schedule/notify')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    // driver-routine-1 matches (bearing 200 ≈ 20° diff from rider ~220°)
    // driver-routine-2 has matching bearing but time diff > 30 min → excluded
    // driver-nearby-1 from Stage 2 included
    expect(mockIn).toHaveBeenCalledWith(
      'user_id',
      expect.arrayContaining(['driver-routine-1', 'driver-nearby-1']),
    )
  })

  it('applies 30-minute time window filter', async () => {
    setupStage3WithStage2Fallback()

    const res = await request(app)
      .post('/api/schedule/notify')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    // driver-routine-2 has time 10:00 vs trip 08:30 → 90 min diff → excluded
    expect(res.body.stage3_count).toBe(1)
  })

  it('sends FCM push to matched drivers', async () => {
    setupStage3WithStage2Fallback()

    await request(app)
      .post('/api/schedule/notify')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    expect(mockSendFcmPush).toHaveBeenCalledWith(
      ['fcm-1', 'fcm-2'],
      expect.objectContaining({
        data: expect.objectContaining({ type: 'schedule_match' }),
      }),
    )
  })

  // ── Stage 2 fallback ────────────────────────────────────────────────────

  it('falls back to Stage 2 (nearby drivers) when no routines match', async () => {
    const { mockIn } = setupStage2FallbackOnly()

    const res = await request(app)
      .post('/api/schedule/notify')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    expect(res.status).toBe(200)
    expect(res.body.stage3_count).toBe(0)
    expect(res.body.stage2_count).toBe(1)
    expect(mockIn).toHaveBeenCalledWith('user_id', ['driver-nearby-1'])
  })

  it('calls nearby_active_drivers RPC with origin coordinates', async () => {
    setupStage2FallbackOnly()

    await request(app)
      .post('/api/schedule/notify')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    expect(mockRpc).toHaveBeenCalledWith('nearby_active_drivers', {
      origin_lng: -121.76,
      origin_lat: 38.54,
    })
  })

  // ── Stage 3 without coordinates (no Stage 2 possible) ──────────────────

  it('works with Stage 3 only when no coordinates are provided', async () => {
    setupStage3Only()

    const bodyNoCoords = {
      origin_place_id: 'place-001',
      dest_place_id:   'place-002',
      trip_date:       '2026-04-01',
      trip_time:       '08:30:00',
      time_type:       'departure',
      mode:            'rider',
      // No lat/lng — Stage 2 skipped, Stage 3 bearing check also skipped
    }

    const res = await request(app)
      .post('/api/schedule/notify')
      .set('Authorization', VALID_JWT)
      .send(bodyNoCoords)

    expect(res.status).toBe(200)
    expect(res.body.stage3_count).toBe(1)
    expect(res.body.stage2_count).toBe(0)
    expect(mockRpc).not.toHaveBeenCalled() // no coords → no Stage 2
  })

  // ── No matches ──────────────────────────────────────────────────────────

  it('returns 200 with notified=0 when no drivers match', async () => {
    setupNoMatches()

    const res = await request(app)
      .post('/api/schedule/notify')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    expect(res.status).toBe(200)
    expect(res.body.notified).toBe(0)
    expect(res.body.stage3_count).toBe(0)
    expect(res.body.stage2_count).toBe(0)
    expect(mockSendFcmPush).not.toHaveBeenCalled()
  })

  // ── Validation / Auth ───────────────────────────────────────────────────

  it('returns 401 when no Authorization header', async () => {
    const res = await request(app)
      .post('/api/schedule/notify')
      .send(VALID_BODY)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('MISSING_TOKEN')
  })

  it('returns 401 when JWT is invalid', async () => {
    mockAuth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid' },
    })

    const res = await request(app)
      .post('/api/schedule/notify')
      .set('Authorization', 'Bearer bad.token')
      .send(VALID_BODY)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })

  it('returns 400 when required fields are missing', async () => {
    authAsUser()

    const res = await request(app)
      .post('/api/schedule/notify')
      .set('Authorization', VALID_JWT)
      .send({ origin_place_id: 'place-001' }) // missing other required fields

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  // ── Observability ──────────────────────────────────────────────────────

  it('logs stage3_count and stage2_count', async () => {
    setupStage3WithStage2Fallback()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await request(app)
      .post('/api/schedule/notify')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    const logged = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>
    expect(logged['type']).toBe('schedule_notify')
    expect(logged['stage3_count']).toBe(1)
    expect(logged['stage2_count']).toBe(1)

    spy.mockRestore()
  })
})
