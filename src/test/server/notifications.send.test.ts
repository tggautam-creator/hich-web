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
  supabaseAdmin: { auth: mockAuth, from: mockFrom, rpc: vi.fn() },
}))

vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcmPush,
}))

// Import app after mocks are registered
import { app } from '../../../server/app.ts'

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_JWT = 'Bearer valid.jwt.token'

const VALID_BODY = {
  user_id: 'user-target-001',
  title: 'New Ride Request',
  body: 'A rider needs a lift!',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authOk() {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: 'sender-123' } },
    error: null,
  })
}

function tokensFound(tokens: string[]) {
  const mockEq = vi.fn().mockResolvedValue({
    data: tokens.map((t) => ({ token: t })),
    error: null,
  })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ select: mockSelect })
  return { mockEq }
}

function tokensEmpty() {
  const mockEq = vi.fn().mockResolvedValue({ data: [], error: null })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ select: mockSelect })
}

function tokensDbError() {
  const mockEq = vi.fn().mockResolvedValue({
    data: null,
    error: { message: 'db error' },
  })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ select: mockSelect })
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/notifications/send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns 200 with sent count on valid request', async () => {
    authOk()
    tokensFound(['tok-a', 'tok-b'])
    mockSendFcmPush.mockResolvedValue(2)

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sent: 2, total_tokens: 2 })
  })

  it('calls sendFcmPush with tokens and notification payload', async () => {
    authOk()
    tokensFound(['tok-a'])
    mockSendFcmPush.mockResolvedValue(1)

    await request(app)
      .post('/api/notifications/send')
      .set('Authorization', VALID_JWT)
      .send({ ...VALID_BODY, data: { type: 'test' } })

    expect(mockSendFcmPush).toHaveBeenCalledWith(
      ['tok-a'],
      {
        title: 'New Ride Request',
        body: 'A rider needs a lift!',
        data: { type: 'test' },
      },
    )
  })

  it('passes empty data object when data field is omitted', async () => {
    authOk()
    tokensFound(['tok-a'])
    mockSendFcmPush.mockResolvedValue(1)

    await request(app)
      .post('/api/notifications/send')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    expect(mockSendFcmPush).toHaveBeenCalledWith(
      ['tok-a'],
      expect.objectContaining({ data: {} }),
    )
  })

  it('queries push_tokens for the target user_id', async () => {
    authOk()
    const { mockEq } = tokensFound(['tok-a'])
    mockSendFcmPush.mockResolvedValue(1)

    await request(app)
      .post('/api/notifications/send')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    expect(mockFrom).toHaveBeenCalledWith('push_tokens')
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-target-001')
  })

  // ── No tokens ───────────────────────────────────────────────────────────────

  it('returns 404 with NO_TOKENS when user has no push tokens', async () => {
    authOk()
    tokensEmpty()

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NO_TOKENS')
    expect(mockSendFcmPush).not.toHaveBeenCalled()
  })

  // ── Validation ──────────────────────────────────────────────────────────────

  it('returns 400 when user_id is missing', async () => {
    authOk()

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', VALID_JWT)
      .send({ title: 'T', body: 'B' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('returns 400 when title is missing', async () => {
    authOk()

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', VALID_JWT)
      .send({ user_id: 'u1', body: 'B' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('returns 400 when body is missing', async () => {
    authOk()

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', VALID_JWT)
      .send({ user_id: 'u1', title: 'T' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .post('/api/notifications/send')
      .send(VALID_BODY)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('MISSING_TOKEN')
  })

  it('returns 401 when JWT is invalid', async () => {
    mockAuth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    })

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', 'Bearer bad.token')
      .send(VALID_BODY)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })

  // ── DB error ────────────────────────────────────────────────────────────────

  it('passes DB errors to the error handler', async () => {
    authOk()
    tokensDbError()

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Authorization', VALID_JWT)
      .send(VALID_BODY)

    expect(res.status).toBe(500)
  })
})
