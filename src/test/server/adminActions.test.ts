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
import express from 'express'

const { mockAuth, mockFrom, mockRpc, mockSendFcm, mockStripeBalance } = vi.hoisted(() => ({
  mockAuth: {
    getUser: vi.fn(),
    admin: { listUsers: vi.fn(), getUserById: vi.fn(), generateLink: vi.fn() },
  },
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockSendFcm: vi.fn(),
  mockStripeBalance: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom, rpc: mockRpc },
}))
vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcm,
}))
vi.mock('../../../server/routes/admin/stripe.ts', () => ({
  adminStripeRouter: express.Router(),
  getAvailableStripeBalanceCents: mockStripeBalance,
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const TARGET = '550e8400-e29b-41d4-a716-446655440000'
// Must be a valid UUID so the self-suspend check (which goes through
// targetUserId's UUID validator) can actually reach the self-check
// branch when this string is passed as :id.
const ADMIN_UID = '00000000-0000-4000-8000-000000000aaa'

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
  /** Defaults to a generous balance so positive credits sail through unless a test wants to block. */
  stripeAvailableCents?: number
  /** Set true to make the Stripe balance call throw (simulates Stripe outage). */
  stripeBalanceFails?: boolean
  /** Suspend endpoint: shape of the target's existing row when looked up. */
  suspendTarget?: { is_admin: boolean; suspended_at: string | null }
  /** Reset-password endpoint: target user's email (null = NOT_FOUND). */
  resetTargetEmail?: string | null
  /** Reset-password endpoint: set true to make generateLink fail. */
  generateLinkFails?: boolean
  /** /actions/push endpoint: the target's (full_name, email) lookup result. */
  targetProfile?: { full_name: string | null; email: string | null } | null
}

function setup(opts: SetupOpts = {}): void {
  const isAdmin = opts.isAdmin === undefined ? true : opts.isAdmin
  auditInserts.length = 0

  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: ADMIN_UID } },
    error: null,
  })

  mockSendFcm.mockResolvedValue(opts.fcmSentCount ?? 1)

  if (opts.stripeBalanceFails) {
    mockStripeBalance.mockRejectedValue(new Error('stripe is down'))
  } else {
    mockStripeBalance.mockResolvedValue({
      available_cents: opts.stripeAvailableCents ?? 100_000_00, // $100k default
      pending_cents: 0,
      currency: 'usd',
    })
  }

  if (opts.rpcResult !== undefined) {
    mockRpc.mockResolvedValue({ data: opts.rpcResult, error: null })
  }

  if (opts.generateLinkFails) {
    mockAuth.admin.generateLink.mockResolvedValue({ data: null, error: { message: 'auth API down' } })
  } else {
    mockAuth.admin.generateLink.mockResolvedValue({ data: { properties: {} }, error: null })
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
          if (cols === 'is_admin, suspended_at') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: opts.suspendTarget ?? null,
                    error: null,
                  }),
              }),
            }
          }
          if (cols === 'email') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data:
                      opts.resetTargetEmail === null
                        ? null
                        : opts.resetTargetEmail !== undefined
                          ? { email: opts.resetTargetEmail }
                          : null,
                    error: null,
                  }),
              }),
            }
          }
          if (cols === 'full_name, email') {
            // Admin /actions/push fetches the recipient's name + email
            // to resolve {{first_name}} / {{name}} substitutions before
            // sending. Returning a fixed test profile here keeps the
            // happy-path tests deterministic; opts.targetProfile lets
            // a specific test override.
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: opts.targetProfile ?? {
                      full_name: 'Test User',
                      email: 'test@university.edu',
                    },
                    error: null,
                  }),
              }),
            }
          }
          if (cols === 'suspended_at, suspended_reason, is_admin') {
            // validateJwt status cache lookup — return active + admin
            // so the request sails through (existing tests don't care
            // about this cache; suspension is tested directly).
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { suspended_at: null, suspended_reason: null, is_admin: isAdmin },
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

  it('substitutes {{first_name}} / {{name}} from the recipient profile', async () => {
    setup({
      pushTokens: ['tokA'],
      fcmSentCount: 1,
      targetProfile: { full_name: 'Aanya Singh', email: 'aanya@ucdavis.edu' },
    })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/push`)
      .set('Authorization', VALID_JWT)
      .send({ title: 'Hi {{first_name}}', body: 'Welcome aboard, {{name}}!' })
    expect(res.status).toBe(200)
    expect(mockSendFcm).toHaveBeenCalledOnce()
    const fcmCall = mockSendFcm.mock.calls[0]
    expect(fcmCall?.[1]).toMatchObject({
      title: 'Hi Aanya',
      body: 'Welcome aboard, Aanya Singh!',
    })
  })

  it('falls back to email username when full_name is missing', async () => {
    setup({
      pushTokens: ['tokA'],
      fcmSentCount: 1,
      targetProfile: { full_name: null, email: 'rohan@stanford.edu' },
    })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/push`)
      .set('Authorization', VALID_JWT)
      .send({ title: 'Hey {{first_name}}', body: 'ok' })
    expect(res.status).toBe(200)
    const fcmCall = mockSendFcm.mock.calls[0]
    expect(fcmCall?.[1]).toMatchObject({ title: 'Hey rohan' })
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

  it('skips the Stripe balance check on debits (negative amounts)', async () => {
    setup({
      stripeAvailableCents: 0, // would block any positive credit
      rpcResult: { applied: true, balance: -100 },
    })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/credit`)
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: -50, reason: 'debit test' })
    expect(res.status).toBe(200)
    expect(mockStripeBalance).not.toHaveBeenCalled()
  })

  it('409s INSUFFICIENT_STRIPE_BALANCE when grant exceeds Stripe available', async () => {
    setup({ stripeAvailableCents: 100 }) // $1 available
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/credit`)
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 500, reason: 'tries to grant more than balance' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('INSUFFICIENT_STRIPE_BALANCE')
    expect(res.body.available_cents).toBe(100)
    expect(res.body.requested_cents).toBe(500)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(auditInserts.length).toBe(0)
  })

  it('503s STRIPE_BALANCE_UNAVAILABLE when the Stripe call fails (errs on the safe side)', async () => {
    setup({ stripeBalanceFails: true })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/credit`)
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 500, reason: 'stripe outage path' })
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('STRIPE_BALANCE_UNAVAILABLE')
    expect(mockRpc).not.toHaveBeenCalled()
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

// ── /actions/suspend ────────────────────────────────────────────────────────

describe('POST /api/admin/users/:id/actions/suspend', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s CANNOT_SUSPEND_SELF when admin tries to suspend their own uid', async () => {
    setup({ suspendTarget: { is_admin: true, suspended_at: null } })
    const res = await request(app)
      .post(`/api/admin/users/${ADMIN_UID}/actions/suspend`)
      .set('Authorization', VALID_JWT)
      .send({ suspended: true, reason: 'oops' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('CANNOT_SUSPEND_SELF')
  })

  it('400s INVALID_BODY when `suspended` is not a boolean', async () => {
    setup({ suspendTarget: { is_admin: false, suspended_at: null } })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/suspend`)
      .set('Authorization', VALID_JWT)
      .send({ suspended: 'yes', reason: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('400s REASON_REQUIRED when suspending without a reason', async () => {
    setup({ suspendTarget: { is_admin: false, suspended_at: null } })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/suspend`)
      .set('Authorization', VALID_JWT)
      .send({ suspended: true })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('REASON_REQUIRED')
  })

  it('400s CANNOT_SUSPEND_ADMIN when target is_admin=true', async () => {
    setup({ suspendTarget: { is_admin: true, suspended_at: null } })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/suspend`)
      .set('Authorization', VALID_JWT)
      .send({ suspended: true, reason: 'tried to suspend an admin' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('CANNOT_SUSPEND_ADMIN')
  })

  it('404s when target user does not exist', async () => {
    setup({ suspendTarget: undefined }) // no row
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/suspend`)
      .set('Authorization', VALID_JWT)
      .send({ suspended: true, reason: 'ghost' })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('TARGET_NOT_FOUND')
  })

  it('returns changed=false when state already matches desired', async () => {
    setup({ suspendTarget: { is_admin: false, suspended_at: '2026-05-17T10:00:00Z' } })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/suspend`)
      .set('Authorization', VALID_JWT)
      .send({ suspended: true, reason: 'idempotent' })
    expect(res.status).toBe(200)
    expect(res.body.changed).toBe(false)
    expect(auditInserts.length).toBe(0)
  })

  it('suspends + audit-logs when flipping NULL → set', async () => {
    setup({ suspendTarget: { is_admin: false, suspended_at: null } })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/suspend`)
      .set('Authorization', VALID_JWT)
      .send({ suspended: true, reason: 'fraud investigation pending' })
    expect(res.status).toBe(200)
    expect(res.body.changed).toBe(true)
    expect(res.body.suspended).toBe(true)
    expect(auditInserts.length).toBe(1)
    expect(auditInserts[0]).toMatchObject({ action: 'suspend_user', target_user_id: TARGET })
    const payload = auditInserts[0]?.['payload'] as Record<string, unknown>
    expect(payload).toMatchObject({ reason: 'fraud investigation pending' })
  })

  it('unsuspends + audit-logs (reason optional) when flipping set → NULL', async () => {
    setup({ suspendTarget: { is_admin: false, suspended_at: '2026-05-17T10:00:00Z' } })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/suspend`)
      .set('Authorization', VALID_JWT)
      .send({ suspended: false })
    expect(res.status).toBe(200)
    expect(res.body.changed).toBe(true)
    expect(res.body.suspended).toBe(false)
    expect(auditInserts.length).toBe(1)
    expect(auditInserts[0]).toMatchObject({ action: 'unsuspend_user' })
  })
})

// ── /actions/reset-password ─────────────────────────────────────────────────

describe('POST /api/admin/users/:id/actions/reset-password', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s when target user does not exist', async () => {
    setup({ resetTargetEmail: null })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/reset-password`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('TARGET_NOT_FOUND')
  })

  it('502s AUTH_LINK_FAILED when Supabase generateLink errors', async () => {
    setup({ resetTargetEmail: 'rider@x.edu', generateLinkFails: true })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/reset-password`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('AUTH_LINK_FAILED')
    expect(auditInserts.length).toBe(0)
  })

  it('triggers Supabase recovery + audit-logs on success', async () => {
    setup({ resetTargetEmail: 'rider@x.edu' })
    const res = await request(app)
      .post(`/api/admin/users/${TARGET}/actions/reset-password`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'user reports they cannot reset themselves' })
    expect(res.status).toBe(200)
    expect(res.body.email).toBe('rider@x.edu')
    expect(mockAuth.admin.generateLink).toHaveBeenCalledWith({
      type: 'recovery',
      email: 'rider@x.edu',
    })
    expect(auditInserts.length).toBe(1)
    expect(auditInserts[0]).toMatchObject({ action: 'force_reset_password', target_user_id: TARGET })
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
