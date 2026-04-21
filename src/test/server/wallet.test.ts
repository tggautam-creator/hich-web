// @vitest-environment node
/**
 * Tests for wallet endpoints:
 *  - POST /api/wallet/topup        — create PaymentIntent
 *  - GET  /api/wallet/transactions — fetch transaction history
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAuth, mockFrom, mockRpc } = vi.hoisted(() => {
  const mockAuth = { getUser: vi.fn() }
  const mockFrom = vi.fn()
  const mockRpc = vi.fn()
  return { mockAuth, mockFrom, mockRpc }
})

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: {
    auth: mockAuth,
    from: mockFrom,
    rpc: (...args: unknown[]) => mockRpc(...args),
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
const { mockPaymentIntentCreate, mockCustomerCreate, mockTransferCreate } = vi.hoisted(() => ({
  mockPaymentIntentCreate: vi.fn(),
  mockCustomerCreate: vi.fn(),
  mockTransferCreate: vi.fn(),
}))

vi.mock('stripe', () => {
  class StripeError extends Error {}
  const StripeCtor = vi.fn().mockImplementation(() => ({
    customers: { create: mockCustomerCreate },
    paymentIntents: { create: mockPaymentIntentCreate },
    transfers: { create: mockTransferCreate },
    webhooks: { constructEvent: vi.fn() },
  }))
  return {
    default: Object.assign(StripeCtor, {
      errors: { StripeError },
    }),
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

// ── H1: GET /api/wallet/pending-earnings ─────────────────────────────────────

describe('GET /api/wallet/pending-earnings', () => {
  function mockRidesAndRiders(
    rides: Array<Record<string, unknown>>,
    riders: Array<Record<string, unknown>>,
    ridesError: unknown = null,
  ) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                not: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: rides, error: ridesError }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'users') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: riders, error: null }),
          }),
        }
      }
      return {}
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/wallet/pending-earnings')
    expect(res.status).toBe(401)
  })

  it('returns empty list and total_cents=0 when driver has no pending rides', async () => {
    mockRidesAndRiders([], [])

    const res = await request(app)
      .get('/api/wallet/pending-earnings')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.pending).toEqual([])
    expect(res.body.total_cents).toBe(0)
  })

  it('joins rider names and sums fare_cents across pending + failed rides', async () => {
    mockRidesAndRiders(
      [
        { id: 'ride-1', rider_id: 'rider-A', fare_cents: 1200, ended_at: '2026-04-18T10:00:00Z', destination_name: 'Library', payment_status: 'pending' },
        { id: 'ride-2', rider_id: 'rider-B', fare_cents: 800, ended_at: '2026-04-17T10:00:00Z', destination_name: 'Gym', payment_status: 'failed' },
        { id: 'ride-3', rider_id: 'rider-A', fare_cents: 1500, ended_at: '2026-04-16T10:00:00Z', destination_name: 'Airport', payment_status: 'pending' },
      ],
      [
        { id: 'rider-A', full_name: 'Alice' },
        { id: 'rider-B', full_name: 'Bob' },
      ],
    )

    const res = await request(app)
      .get('/api/wallet/pending-earnings')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.pending).toHaveLength(3)
    expect(res.body.pending[0].rider_name).toBe('Alice')
    expect(res.body.pending[1].rider_name).toBe('Bob')
    expect(res.body.pending[2].rider_name).toBe('Alice')
    expect(res.body.total_cents).toBe(3500)
  })

  it('returns 500 on DB error', async () => {
    mockRidesAndRiders([], [], { message: 'connection reset' })

    const res = await request(app)
      .get('/api/wallet/pending-earnings')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('DB_ERROR')
  })
})

// ── F5: POST /api/wallet/withdraw ─────────────────────────────────────────────

describe('POST /api/wallet/withdraw', () => {
  function mockUserAndIdempotency(
    user: Record<string, unknown> | null,
    cachedIdem: { response_status: number; response_body: unknown } | null = null,
  ) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: user, error: user ? null : { message: 'nf' } }),
            }),
          }),
        }
      }
      if (table === 'request_idempotency') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: cachedIdem, error: null }),
                }),
              }),
            }),
          }),
          insert: () => ({
            then: (cb: (r: { error: null }) => unknown) => {
              cb({ error: null })
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      return {}
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    mockTransferCreate.mockReset()
    mockRpc.mockReset()
  })

  it('returns 401 without auth token', async () => {
    const res = await request(app).post('/api/wallet/withdraw').send({ amount_cents: 1000 })
    expect(res.status).toBe(401)
  })

  it('returns 400 for non-integer amount', async () => {
    mockUserAndIdempotency({
      wallet_balance: 5000,
      stripe_account_id: 'acct_123',
      stripe_onboarding_complete: true,
    })
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 12.5 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_AMOUNT')
  })

  it('returns 400 below minimum withdrawal', async () => {
    mockUserAndIdempotency({
      wallet_balance: 5000,
      stripe_account_id: 'acct_123',
      stripe_onboarding_complete: true,
    })
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 50 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MIN_AMOUNT')
  })

  it('returns 400 BANK_NOT_LINKED when no Connect account', async () => {
    mockUserAndIdempotency({
      wallet_balance: 5000,
      stripe_account_id: null,
      stripe_onboarding_complete: false,
    })
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 2000 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BANK_NOT_LINKED')
  })

  it('returns 400 INSUFFICIENT_BALANCE when amount exceeds balance', async () => {
    mockUserAndIdempotency({
      wallet_balance: 1000,
      stripe_account_id: 'acct_123',
      stripe_onboarding_complete: true,
    })
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 5000 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE')
  })

  it('debits wallet and creates Stripe transfer on success', async () => {
    mockUserAndIdempotency({
      wallet_balance: 5000,
      stripe_account_id: 'acct_123',
      stripe_onboarding_complete: true,
    })
    mockRpc.mockResolvedValue({ data: { applied: true, balance: 3000 }, error: null })
    mockTransferCreate.mockResolvedValue({ id: 'tr_abc' })

    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 2000 })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('transferring')
    expect(res.body.transfer_id).toBe('tr_abc')
    expect(res.body.amount_cents).toBe(2000)

    // Debit RPC called with negative delta and 'withdrawal' type.
    const debitCall = mockRpc.mock.calls.find(
      (c) => (c[1] as { p_type: string }).p_type === 'withdrawal',
    )
    expect(debitCall).toBeDefined()
    expect((debitCall?.[1] as { p_delta_cents: number }).p_delta_cents).toBe(-2000)

    expect(mockTransferCreate).toHaveBeenCalledWith({
      amount: 2000,
      currency: 'usd',
      destination: 'acct_123',
      metadata: { user_id: USER_ID, kind: 'wallet_withdrawal' },
    })
  })

  it('credits back the debit when Stripe transfer fails', async () => {
    mockUserAndIdempotency({
      wallet_balance: 5000,
      stripe_account_id: 'acct_123',
      stripe_onboarding_complete: true,
    })
    mockRpc.mockResolvedValue({ data: { applied: true, balance: 3000 }, error: null })
    mockTransferCreate.mockRejectedValue(new Error('transfer_to_destination_not_allowed'))

    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', VALID_JWT)
      .send({ amount_cents: 2000 })

    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('TRANSFER_FAILED')

    // Verify a credit-back RPC was called with the opposite delta.
    const creditBack = mockRpc.mock.calls.find(
      (c) => (c[1] as { p_type: string }).p_type === 'withdrawal_failed_refund',
    )
    expect(creditBack).toBeDefined()
    expect((creditBack?.[1] as { p_delta_cents: number }).p_delta_cents).toBe(2000)
  })

  it('replays cached response for the same Idempotency-Key', async () => {
    mockUserAndIdempotency(
      {
        wallet_balance: 5000,
        stripe_account_id: 'acct_123',
        stripe_onboarding_complete: true,
      },
      {
        response_status: 200,
        response_body: { status: 'transferring', transfer_id: 'tr_cached', amount_cents: 2000, eta_days: 2 },
      },
    )

    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', VALID_JWT)
      .set('Idempotency-Key', 'client-key-1')
      .send({ amount_cents: 2000 })

    expect(res.status).toBe(200)
    expect(res.body.transfer_id).toBe('tr_cached')
    // Handler must NOT have run.
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockTransferCreate).not.toHaveBeenCalled()
  })
})
