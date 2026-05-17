// @vitest-environment node
/**
 * Slice 1.3e — admin ride refund endpoint tests.
 *
 *   POST /api/admin/rides/:rideId/refund
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom, mockRpc } = vi.hoisted(() => ({
  mockAuth: {
    getUser: vi.fn(),
    admin: { listUsers: vi.fn(), getUserById: vi.fn(), generateLink: vi.fn() },
  },
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom, rpc: mockRpc },
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const RIDE_ID = '11111111-2222-4333-8444-555555555555'
const ADMIN_UID = '00000000-0000-4000-8000-000000000aaa'
const RIDER_ID = '00000000-0000-4000-8000-000000000bbb'
const DRIVER_ID = '00000000-0000-4000-8000-000000000ccc'

const auditInserts: Array<Record<string, unknown>> = []

interface SetupOpts {
  isAdmin?: boolean
  ride?: {
    id: string
    rider_id: string
    driver_id: string | null
    fare_cents: number | null
    status: string
    payment_status: string | null
  } | null
  driverBalance?: number
  riderApplyResult?: { applied: boolean; balance?: number; error?: string }
  driverApplyResult?: { applied: boolean; balance?: number; error?: string }
  driverApplyErrors?: boolean
}

function setup(opts: SetupOpts = {}): void {
  const isAdmin = opts.isAdmin === undefined ? true : opts.isAdmin
  auditInserts.length = 0

  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: ADMIN_UID } },
    error: null,
  })

  // Default RPC results: rider credit 200, driver debit 200.
  let rpcCallCount = 0
  mockRpc.mockImplementation(async () => {
    rpcCallCount += 1
    if (rpcCallCount === 1) {
      return {
        data: opts.riderApplyResult ?? { applied: true, balance: 1500 },
        error: null,
      }
    }
    // Driver debit
    if (opts.driverApplyErrors) {
      return { data: null, error: { message: 'rpc died' } }
    }
    return {
      data: opts.driverApplyResult ?? { applied: true, balance: 500 },
      error: null,
    }
  })

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
          if (cols === 'wallet_balance') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: opts.driverBalance !== undefined
                      ? { wallet_balance: opts.driverBalance }
                      : { wallet_balance: 1000 },
                    error: null,
                  }),
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
    if (table === 'rides') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.ride === undefined
                  ? {
                      id: RIDE_ID,
                      rider_id: RIDER_ID,
                      driver_id: DRIVER_ID,
                      fare_cents: 500,
                      status: 'completed',
                      payment_status: 'paid',
                    }
                  : opts.ride,
                error: null,
              }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      }
    }
    if (table === 'admin_audit_log') {
      return {
        insert: (row: Record<string, unknown>) => {
          auditInserts.push(row)
          return Promise.resolve({ data: null, error: null })
        },
      }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

describe('POST /api/admin/rides/:rideId/refund — validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/refund`)
      .send({})
    expect(res.status).toBe(401)
  })

  it('400s on a non-UUID ride id', async () => {
    setup()
    const res = await request(app)
      .post('/api/admin/rides/notauuid/refund')
      .set('Authorization', VALID_JWT)
      .send({ reason: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_RIDE_ID')
  })

  it('400s REASON_REQUIRED when reason is missing', async () => {
    setup()
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/refund`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('REASON_REQUIRED')
  })

  it('404 when the ride does not exist', async () => {
    setup({ ride: null })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/refund`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'support refund' })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('RIDE_NOT_FOUND')
  })

  it('400 RIDE_NOT_COMPLETED when ride.status is not completed', async () => {
    setup({
      ride: {
        id: RIDE_ID,
        rider_id: RIDER_ID,
        driver_id: DRIVER_ID,
        fare_cents: 500,
        status: 'active',
        payment_status: 'paid',
      },
    })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/refund`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'too early' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('RIDE_NOT_COMPLETED')
  })

  it('400 RIDE_NOT_PAID when payment_status is not paid', async () => {
    setup({
      ride: {
        id: RIDE_ID,
        rider_id: RIDER_ID,
        driver_id: DRIVER_ID,
        fare_cents: 500,
        status: 'completed',
        payment_status: 'failed',
      },
    })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/refund`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'no money to refund' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('RIDE_NOT_PAID')
  })
})

describe('POST /api/admin/rides/:rideId/refund — overdraft policy', () => {
  beforeEach(() => vi.clearAllMocks())

  it('409 DRIVER_WOULD_OVERDRAFT when driver balance < fare and override flag not set', async () => {
    setup({ driverBalance: 200 }) // fare is 500
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/refund`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'driver was at fault' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('DRIVER_WOULD_OVERDRAFT')
    expect(res.body.driver_balance_cents).toBe(200)
    expect(res.body.fare_cents).toBe(500)
    expect(res.body.gap_cents).toBe(300)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(auditInserts.length).toBe(0)
  })

  it('proceeds when allow_driver_overdraft=true even with low driver balance', async () => {
    setup({
      driverBalance: 200,
      driverApplyResult: { applied: true, balance: -300 },
    })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/refund`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'eating the loss', allow_driver_overdraft: true })
    expect(res.status).toBe(200)
    expect(res.body.driver_balance_after_cents).toBe(-300)
    expect(mockRpc).toHaveBeenCalledTimes(2)
    expect(auditInserts.length).toBe(2)
  })
})

describe('POST /api/admin/rides/:rideId/refund — happy path', () => {
  beforeEach(() => vi.clearAllMocks())

  it('credits rider, debits driver, writes 2 audit rows, returns balances', async () => {
    setup({
      driverBalance: 5000,
      riderApplyResult: { applied: true, balance: 1500 },
      driverApplyResult: { applied: true, balance: 4500 },
    })

    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/refund`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'rider reported unsafe driving' })

    expect(res.status).toBe(200)
    expect(res.body.fare_cents).toBe(500)
    expect(res.body.rider_balance_after_cents).toBe(1500)
    expect(res.body.driver_balance_after_cents).toBe(4500)

    // Rider credit was first call: +500
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'wallet_apply_delta', expect.objectContaining({
      p_user_id: RIDER_ID,
      p_delta_cents: 500,
      p_type: 'admin_refund',
    }))
    // Driver debit was second call: -500
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'wallet_apply_delta', expect.objectContaining({
      p_user_id: DRIVER_ID,
      p_delta_cents: -500,
      p_type: 'admin_refund',
    }))

    // 2 audit rows — one per party
    expect(auditInserts.length).toBe(2)
    const riderAudit = auditInserts.find((a) => a['target_user_id'] === RIDER_ID)
    const driverAudit = auditInserts.find((a) => a['target_user_id'] === DRIVER_ID)
    expect(riderAudit).toBeDefined()
    expect(driverAudit).toBeDefined()
    const riderPayload = riderAudit?.['payload'] as Record<string, unknown>
    expect(riderPayload).toMatchObject({ role: 'rider', amount_cents: 500 })
    const driverPayload = driverAudit?.['payload'] as Record<string, unknown>
    expect(driverPayload).toMatchObject({ role: 'driver', amount_cents: -500 })
  })

  it('500s with partial-refund warning when driver debit fails after rider credit', async () => {
    setup({
      driverBalance: 5000,
      driverApplyErrors: true,
    })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/refund`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'should partial-refund' })
    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('DRIVER_DEBIT_FAILED')
    // Rider was already credited; admin needs to know
    expect(res.body.rider_balance_after_cents).toBeDefined()
  })
})
