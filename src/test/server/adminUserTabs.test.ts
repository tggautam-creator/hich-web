// @vitest-environment node
/**
 * Slice 1.3b — admin per-user tab endpoints.
 *
 *   GET /api/admin/users/:id/rides
 *   GET /api/admin/users/:id/wallet
 *   GET /api/admin/users/:id/notifications
 *   GET /api/admin/users/:id/devices
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom } = vi.hoisted(() => ({
  mockAuth: {
    getUser: vi.fn(),
    admin: { listUsers: vi.fn(), getUserById: vi.fn() },
  },
  mockFrom: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom },
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

function authAsAdmin() {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: 'admin-uid' } },
    error: null,
  })
}

/**
 * Per-test mock dispatch — pass which table → which fixture rows.
 * Chainable to ignore filter calls and resolve on .range() or
 * .maybeSingle() or `await` (the bare `then`).
 */
function setupTabMocks(opts: {
  isAdmin?: boolean
  ridesData?: { data: unknown[]; count: number }
  walletUserExists?: boolean
  walletBalance?: number
  transactionsData?: { data: unknown[]; count: number }
  notificationsData?: { data: unknown[]; count: number }
  devicesData?: unknown[]
}): void {
  const isAdmin = opts.isAdmin === undefined ? true : opts.isAdmin

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
                    data: opts.walletUserExists === false
                      ? null
                      : { wallet_balance: opts.walletBalance ?? 0 },
                    error: null,
                  }),
              }),
            }
          }
          throw new Error(`unexpected users select(${cols})`)
        },
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      }
    }
    if (table === 'rides') {
      const rideResult = opts.ridesData ?? { data: [], count: 0 }
      const chain: Record<string, unknown> = {
        or: () => chain,
        order: () => chain,
        range: () =>
          Promise.resolve({
            data: rideResult.data,
            count: rideResult.count,
            error: null,
          }),
      }
      return { select: () => chain }
    }
    if (table === 'transactions') {
      const txResult = opts.transactionsData ?? { data: [], count: 0 }
      const chain: Record<string, unknown> = {
        eq: () => chain,
        order: () => chain,
        range: () =>
          Promise.resolve({
            data: txResult.data,
            count: txResult.count,
            error: null,
          }),
      }
      return { select: () => chain }
    }
    if (table === 'notifications') {
      const nResult = opts.notificationsData ?? { data: [], count: 0 }
      const chain: Record<string, unknown> = {
        eq: () => chain,
        order: () => chain,
        range: () =>
          Promise.resolve({
            data: nResult.data,
            count: nResult.count,
            error: null,
          }),
      }
      return { select: () => chain }
    }
    if (table === 'push_tokens') {
      const dResult = opts.devicesData ?? []
      const chain: Record<string, unknown> = {
        eq: () => chain,
        order: () =>
          Promise.resolve({ data: dResult, error: null }),
      }
      return { select: () => chain }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

describe('GET /api/admin/users/:id/rides', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 on non-UUID id', async () => {
    authAsAdmin()
    setupTabMocks({})
    const res = await request(app)
      .get('/api/admin/users/notauuid/rides')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_USER_ID')
  })

  it('returns rides with role derived from rider_id vs driver_id', async () => {
    authAsAdmin()
    setupTabMocks({
      ridesData: {
        data: [
          {
            id: 'r1', status: 'completed',
            rider_id: VALID_UUID, driver_id: 'other-driver',
            origin_name: 'A', destination_name: 'B',
            fare_cents: 500,
            created_at: '2026-05-17T10:00:00Z', ended_at: '2026-05-17T10:30:00Z',
          },
          {
            id: 'r2', status: 'active',
            rider_id: 'some-rider', driver_id: VALID_UUID,
            origin_name: null, destination_name: null,
            fare_cents: null,
            created_at: '2026-05-16T10:00:00Z', ended_at: null,
          },
        ],
        count: 2,
      },
    })
    const res = await request(app)
      .get(`/api/admin/users/${VALID_UUID}/rides`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.rides[0]).toMatchObject({
      id: 'r1', role: 'rider', other_party_id: 'other-driver',
    })
    expect(res.body.rides[1]).toMatchObject({
      id: 'r2', role: 'driver', other_party_id: 'some-rider',
    })
  })
})

describe('GET /api/admin/users/:id/wallet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s when user does not exist', async () => {
    authAsAdmin()
    setupTabMocks({ walletUserExists: false })
    const res = await request(app)
      .get(`/api/admin/users/${VALID_UUID}/wallet`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('returns balance + transactions', async () => {
    authAsAdmin()
    setupTabMocks({
      walletUserExists: true,
      walletBalance: 1234,
      transactionsData: {
        data: [
          {
            id: 't1', type: 'topup', amount_cents: 1000, balance_after_cents: 1000,
            description: 'Apple Pay top-up', pm_brand: 'visa', pm_last4: '4242', pm_wallet: 'apple_pay',
            ride_id: null, created_at: '2026-05-17T10:00:00Z',
            transfer_id: null, transfer_paid_at: null,
          },
          {
            id: 't2', type: 'ride_charge', amount_cents: -500, balance_after_cents: 500,
            description: 'Ride from A to B', pm_brand: null, pm_last4: null, pm_wallet: null,
            ride_id: 'ride-1', created_at: '2026-05-17T11:00:00Z',
            transfer_id: null, transfer_paid_at: null,
          },
        ],
        count: 2,
      },
    })
    const res = await request(app)
      .get(`/api/admin/users/${VALID_UUID}/wallet`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.wallet_balance_cents).toBe(1234)
    expect(res.body.total).toBe(2)
    expect(res.body.transactions[0].type).toBe('topup')
  })
})

describe('GET /api/admin/users/:id/notifications', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns paginated notifications', async () => {
    authAsAdmin()
    setupTabMocks({
      notificationsData: {
        data: [
          {
            id: 'n1', type: 'ride_request', title: 'New ride',
            body: 'Someone wants to ride', is_read: false,
            created_at: '2026-05-17T10:00:00Z',
          },
        ],
        count: 1,
      },
    })
    const res = await request(app)
      .get(`/api/admin/users/${VALID_UUID}/notifications`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.notifications[0].type).toBe('ride_request')
  })
})

describe('GET /api/admin/users/:id/devices', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns devices with token_suffix only (never the full token)', async () => {
    authAsAdmin()
    setupTabMocks({
      devicesData: [
        {
          id: 'd1',
          // 32 chars; last 8 = 'NSUFFIX1'
          token: 'abcdef1234567890longtokeNSUFFIX1',
          platform: 'ios',
          created_at: '2026-05-17T10:00:00Z',
        },
      ],
    })
    const res = await request(app)
      .get(`/api/admin/users/${VALID_UUID}/devices`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.devices[0]).toMatchObject({
      id: 'd1',
      token_suffix: 'NSUFFIX1',
      platform: 'ios',
    })
    expect(res.body.devices[0].token).toBeUndefined()
  })

  it('returns 401 without a token (inherits gate)', async () => {
    const res = await request(app).get(`/api/admin/users/${VALID_UUID}/devices`)
    expect(res.status).toBe(401)
  })
})
