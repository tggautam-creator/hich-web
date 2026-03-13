// @vitest-environment node
/**
 * Tests for wallet endpoints:
 *  - POST /api/wallet/topup        — create PaymentIntent
 *  - GET  /api/wallet/transactions — fetch transaction history
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAuth, mockFrom } = vi.hoisted(() => {
  const mockAuth = { getUser: vi.fn() }
  const mockFrom = vi.fn()
  return { mockAuth, mockFrom }
})

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: {
    auth: mockAuth,
    from: mockFrom,
  },
}))

vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: vi.fn(),
}))

vi.mock('../../../server/lib/qrToken.ts', () => ({
  generateQrToken: vi.fn(),
  validateQrToken: vi.fn(),
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

// Mock Stripe
const mockPaymentIntentCreate = vi.fn()
const mockCustomerCreate = vi.fn()

vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      customers: { create: mockCustomerCreate },
      paymentIntents: { create: mockPaymentIntentCreate },
      webhooks: { constructEvent: vi.fn() },
    })),
  }
})

import { app } from '../../../server/app.ts'

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_JWT = 'Bearer valid.jwt.token'
const USER_ID = 'user-wallet-001'

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockAuthSuccess() {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  })
}

function mockUserQuery(user: Record<string, unknown> | null, error: unknown = null) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: user, error }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }
    }
    if (table === 'transactions') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }
    }
    return {}
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/wallet/topup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    mockPaymentIntentCreate.mockResolvedValue({
      client_secret: 'pi_test_secret_123',
    })
    mockCustomerCreate.mockResolvedValue({
      id: 'cus_test_123',
    })
  })

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/wallet/topup')
      .send({ amount_cents: 2000 })

    expect(res.status).toBe(401)
  })

  it('returns 400 for non-integer amount', async () => {
    const res = await request(app)
      .post('/api/wallet/topup')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 20.5 })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_AMOUNT')
  })

  it('returns 400 for amount below $5', async () => {
    const res = await request(app)
      .post('/api/wallet/topup')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 400 })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('AMOUNT_OUT_OF_RANGE')
  })

  it('returns 400 for amount above $200', async () => {
    const res = await request(app)
      .post('/api/wallet/topup')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 25000 })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('AMOUNT_OUT_OF_RANGE')
  })

  it('creates PaymentIntent for valid amount with existing customer', async () => {
    mockUserQuery({ stripe_customer_id: 'cus_existing', email: 'test@edu.com' })

    const res = await request(app)
      .post('/api/wallet/topup')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 2000 })

    expect(res.status).toBe(200)
    expect(res.body.clientSecret).toBe('pi_test_secret_123')
    expect(mockPaymentIntentCreate).toHaveBeenCalledWith({
      amount: 2000,
      currency: 'usd',
      customer: 'cus_existing',
      metadata: { user_id: USER_ID },
    })
  })

  it('creates Stripe customer if none exists', async () => {
    mockUserQuery({ stripe_customer_id: null, email: 'test@edu.com' })

    const res = await request(app)
      .post('/api/wallet/topup')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 1000 })

    expect(res.status).toBe(200)
    expect(mockCustomerCreate).toHaveBeenCalledWith({
      email: 'test@edu.com',
      metadata: { user_id: USER_ID },
    })
  })

  it('returns 404 when user not found', async () => {
    mockUserQuery(null, { message: 'not found' })

    const res = await request(app)
      .post('/api/wallet/topup')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 2000 })

    expect(res.status).toBe(404)
  })
})

describe('GET /api/wallet/transactions', () => {
  const mockTxns = [
    { id: 'tx-1', type: 'topup', amount_cents: 2000, created_at: '2026-03-01T10:00:00Z' },
    { id: 'tx-2', type: 'fare_debit', amount_cents: -850, created_at: '2026-03-02T14:30:00Z' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/wallet/transactions')
    expect(res.status).toBe(401)
  })

  it('returns transaction list', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'transactions') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: mockTxns, error: null }),
              }),
            }),
          }),
        }
      }
      return {}
    })

    const res = await request(app)
      .get('/api/wallet/transactions')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.transactions).toHaveLength(2)
    expect(res.body.transactions[0].id).toBe('tx-1')
  })

  it('returns empty array when no transactions', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'transactions') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }
      }
      return {}
    })

    const res = await request(app)
      .get('/api/wallet/transactions')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.transactions).toHaveLength(0)
  })
})
