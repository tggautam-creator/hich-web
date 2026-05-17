// @vitest-environment node
/**
 * Slice 1.3c — admin action endpoint tests.
 *
 *   POST /api/admin/users/:id/actions/push
 *   POST /api/admin/users/:id/actions/credit
 *   POST /api/admin/users/:id/actions/override-onboarding
 *   GET  /api/admin/users/:id/audit
 *
 * Each action endpoint is gated by JWT + adminAuth (covered upstream
 * in adminAuth.test.ts); these tests focus on body validation,
 * happy-path mutation, and that an audit row is written on success.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom, mockRpc, mockSendFcm } = vi.hoisted(() => ({
  mockAuth: {
    getUser: vi.fn(),
    admin: { listUsers: vi.fn(), getUserById: vi.fn() },
  },
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockSendFcm: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom, rpc: mockRpc },
}))
vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcm,
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const TARGET = '550e8400-e29b-41d4-a716-446655440000'
const ADMIN_UID = 'admin-uid'

/**
 * Records every audit_log insert so a test can assert "one row was
 * written with this payload."
 */
const auditInserts: Array<Record<string, unknown>> = []

interface SetupOpts {
  isAdmin?: boolean
  targetExists?: boolean
  pushTokens?: string[]
  onboardingBefore?: boolean
  fcmSentCount?: number
  rpcResult?: { applied: boolean; balance?: number; error?: string }
  auditRows?: Array<Record<string, unknown>>
  auditCount?: number
  adminEmailsById?: Record<string, string>
}

function setup(opts: SetupOpts = {}): void {
  const isAdmin = opts.isAdmin === undefined ? true : opts.isAdmin
  auditInserts.length = 0

  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: ADMIN_UID } },
    error: null,
  })

  mockSendFcm.mockResolvedValue(opts.fcmSentCount ?? 1)

  if (opts.rpcResult !== undefined) {
    mockRpc.mockResolvedValue({ data: opts.rpcResult, error: null })
  }

  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: (cols: string) => {
          if (cols === 'is_admin') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { is_admin: isAdmin }, error: null }),
              }),
            }
          }
          if (cols === 'id') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: opts.targetExists === false ? null : { id: TARGET },
                    error: null,
                  }),
              }),
            }
          }
          if (cols === 'onboarding_completed') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: opts.targetExists === false
                      ? null
                      : { onboarding_completed: opts.onboardingBefore ?? false },
                    error: null,
                  }),
              }),
            }
          }
          if (cols === 'id, email') {
            return {
              in: () =>
                Promise.resolve({
                  data: Object.entries(opts.adminEmailsById ?? {}).map(
                    ([id, email]) => ({ id, email }),
                  ),
                  error: null,
                }),
            }
          }
          throw new Error(`unexpected users.select(${cols})`)
        },
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      }
    }
    if (table === 'push_tokens') {
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: (opts.pushTokens ?? []).map((token) => ({ token })),
              error: null,
            }),
        }),
      }
    }
    if (table === 'admin_audit_log') {
      return {
        insert: (row: Record<string, unknown>) => {
          auditInserts.push(row)
          return Promise.resolve({ data: null, error: null })
        },
        select: () => {
          const chain: Record<string, unknown> = {
            eq: () => chain,
            order: () => chain,
            range: () =>
              Promise.resolve({
                data: opts.auditRows ?? [],
                count: opts.auditCount ?? (opts.auditRows ?? []).length,
                error: null,
              }),
          }
          return chain
        },
      }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

// ── /actions/push ───────────────────────────────────────────────────────────

describe('POST /api/admin/users/:id/actions/push', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s when title or body is missing', async () => {
    setup()
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/push`)
      .set('Authorization', VALID_JWT)
      .send({ title: 'hi' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('400s when title or body exceeds length cap', async () => {
    setup()
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/push`)
      .set('Authorization', VALID_JWT)
      .send({ title: 'x'.repeat(200), body: 'ok' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('TOO_LONG')
  })

  it('404s when the target user has no push tokens', async () => {
    setup({ pushTokens: [] })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/push`)
      .set('Authorization', VALID_JWT)
      .send({ title: 'Hi', body: 'Test' })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NO_TOKENS')
  })

  it('sends push + writes audit on success', async () => {
    setup({ pushTokens: ['tokA', 'tokB'], fcmSentCount: 2 })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/push`)
      .set('Authorization', VALID_JWT)
      .send({ title: 'Hi', body: 'Test ping', reason: 'manual outreach' })
    expect(res.status).toBe(200)
    expect(res.body.sent).toBe(2)
    expect(mockSendFcm).toHaveBeenCalledOnce()
    expect(auditInserts.length).toBe(1)
    expect(auditInserts[0]).toMatchObject({
      admin_id: ADMIN_UID,
      target_user_id: TARGET,
      action: 'send_push',
    })
    const payload = auditInserts[0]?.['payload'] as Record<string, unknown>
    expect(payload).toMatchObject({
      title: 'Hi',
      body: 'Test ping',
      reason: 'manual outreach',
      tokens_attempted: 2,
      tokens_succeeded: 2,
    })
  })
})

// ── /actions/credit ─────────────────────────────────────────────────────────

describe('POST /api/admin/users/:id/actions/credit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s when amount_cents is missing or zero', async () => {
    setup()
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/credit`)
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 0, reason: 'test' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_AMOUNT')
  })

  it('400s when reason is missing', async () => {
    setup()
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/credit`)
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 500 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('REASON_REQUIRED')
  })

  it('400s when amount exceeds the safety cap', async () => {
    setup()
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/credit`)
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 999_999_999, reason: 'lol' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('AMOUNT_TOO_LARGE')
  })

  it('credits + audit-logs on success (positive amount → admin_credit)', async () => {
    setup({ rpcResult: { applied: true, balance: 1500 } })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/credit`)
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 500, reason: 'goodwill gesture for refund delay' })
    expect(res.status).toBe(200)
    expect(res.body.balance_after_cents).toBe(1500)
    expect(mockRpc).toHaveBeenCalledWith(
      'wallet_apply_delta',
      expect.objectContaining({
        p_user_id: TARGET,
        p_delta_cents: 500,
        p_type: 'admin_credit',
        p_description: 'goodwill gesture for refund delay',
      }),
    )
    expect(auditInserts.length).toBe(1)
    expect(auditInserts[0]).toMatchObject({
      action: 'grant_wallet_credit',
      target_user_id: TARGET,
    })
  })

  it('debits when amount_cents is negative (action type flips to admin_debit)', async () => {
    setup({ rpcResult: { applied: true, balance: 100 } })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/credit`)
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: -200, reason: 'reversing a duplicate credit' })
    expect(res.status).toBe(200)
    expect(mockRpc).toHaveBeenCalledWith(
      'wallet_apply_delta',
      expect.objectContaining({ p_delta_cents: -200, p_type: 'admin_debit' }),
    )
  })
})

// ── /actions/override-onboarding ────────────────────────────────────────────

describe('POST /api/admin/users/:id/actions/override-onboarding', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s when onboarding_completed is not a boolean', async () => {
    setup()
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/override-onboarding`)
      .set('Authorization', VALID_JWT)
      .send({ onboarding_completed: 'true', reason: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('400s when reason is missing', async () => {
    setup()
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/override-onboarding`)
      .set('Authorization', VALID_JWT)
      .send({ onboarding_completed: true })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('REASON_REQUIRED')
  })

  it('returns changed=false (no-op) when current value matches', async () => {
    setup({ onboardingBefore: true })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/override-onboarding`)
      .set('Authorization', VALID_JWT)
      .send({ onboarding_completed: true, reason: 'idempotent set' })
    expect(res.status).toBe(200)
    expect(res.body.changed).toBe(false)
    expect(auditInserts.length).toBe(0)
  })

  it('flips the column + audit-logs on a real change', async () => {
    setup({ onboardingBefore: false })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/override-onboarding`)
      .set('Authorization', VALID_JWT)
      .send({ onboarding_completed: true, reason: 'user stuck at CreateProfile' })
    expect(res.status).toBe(200)
    expect(res.body.changed).toBe(true)
    expect(res.body.onboarding_completed).toBe(true)
    expect(auditInserts.length).toBe(1)
    expect(auditInserts[0]).toMatchObject({
      action: 'override_onboarding',
    })
    const payload = auditInserts[0]?.['payload'] as Record<string, unknown>
    expect(payload).toMatchObject({ from: false, to: true, reason: 'user stuck at CreateProfile' })
  })
})

// ── /audit (GET) ────────────────────────────────────────────────────────────

describe('GET /api/admin/users/:id/audit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns paginated audit rows + hydrated admin emails', async () => {
    setup({
      auditRows: [
        {
          id: 'a1',
          admin_id: ADMIN_UID,
          action: 'send_push',
          payload: { title: 'Hi', body: 'Test' },
          created_at: '2026-05-17T10:00:00Z',
        },
        {
          id: 'a2',
          admin_id: 'other-admin-uid',
          action: 'grant_wallet_credit',
          payload: { amount_cents: 500, reason: 'goodwill' },
          created_at: '2026-05-17T09:00:00Z',
        },
      ],
      auditCount: 2,
      adminEmailsById: {
        [ADMIN_UID]: 'admin@tagorides.com',
        'other-admin-uid': 'other@tagorides.com',
      },
    })

    const res = await request(app)
      .get(`/api/admin/users/${TARGET}/audit`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.audit[0]).toMatchObject({
      id: 'a1',
      action: 'send_push',
      admin_email: 'admin@tagorides.com',
    })
    expect(res.body.audit[1]).toMatchObject({
      id: 'a2',
      action: 'grant_wallet_credit',
      admin_email: 'other@tagorides.com',
    })
  })

  it('returns empty array when user has no audit history', async () => {
    setup({ auditRows: [], auditCount: 0 })
    const res = await request(app)
      .get(`/api/admin/users/${TARGET}/audit`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.audit).toEqual([])
    expect(res.body.total).toBe(0)
  })
})
