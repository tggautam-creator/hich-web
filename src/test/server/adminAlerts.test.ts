// @vitest-environment node
/**
 * Slice 1.9 — operational alerts endpoint tests.
 *
 *   GET /api/admin/alerts
 *
 * Five categories, each with count + truncated flag + items.
 * Mocks every supabase.from(...) call the endpoint makes:
 *   1. rides .select() .in('status', ACTIVE_STATUSES) — stuck candidates
 *   2. rides .select() .eq('payment_status', 'failed') — failed payments
 *   3. rides .select() with completed + payment_status NOT IN — unpaid
 *   4. users .select() .lt('wallet_balance', 0) — negative wallets
 *   5. users .select() .gte('suspended_at', ...) — recent suspensions
 *   6. users .select('id, full_name, email') .in('id', [...]) — names
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom } = vi.hoisted(() => ({
  mockAuth: { getUser: vi.fn() },
  mockFrom: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom },
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const ADMIN_UID = '00000000-0000-4000-8000-000000000aaa'

interface RideRow {
  id: string
  status: string
  rider_id: string
  driver_id: string | null
  fare_cents: number | null
  created_at: string
  started_at: string | null
  ended_at: string | null
  last_driver_ping_at: string | null
  payment_status: string | null
}

interface UserRow {
  id: string
  full_name: string | null
  email: string | null
  wallet_balance: number
  is_driver: boolean
  suspended_at: string | null
  suspended_reason: string | null
}

interface Fixture {
  isAdmin?: boolean
  stuckCandidates?: RideRow[]
  failedRides?: RideRow[]
  unpaidRides?: RideRow[]
  negativeUsers?: UserRow[]
  suspendedUsers?: UserRow[]
  nameLookup?: Array<{ id: string; full_name: string | null; email: string | null }>
}

function setup(f: Fixture) {
  const isAdmin = f.isAdmin === undefined ? true : f.isAdmin
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: ADMIN_UID } },
    error: null,
  })

  // The endpoint calls rides 3 times in order (stuck / failed / unpaid)
  // and users twice (negative / suspended) before a final users name
  // lookup. Disambiguate by call order.
  let ridesIdx = 0
  let usersDataIdx = 0

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
          // The data-bearing users queries:
          //   negative_wallets : .select('id, full_name, email, wallet_balance, is_driver').lt().order().limit()
          //   suspensions      : .select('id, full_name, email, suspended_at, suspended_reason').gte().order().limit()
          //   name hydration   : .select('id, full_name, email').in()
          if (cols.includes('wallet_balance')) {
            // negative_wallets path
            const chain: Record<string, unknown> = {
              lt: () => chain,
              order: () => chain,
              limit: () =>
                Promise.resolve({ data: f.negativeUsers ?? [], error: null }),
            }
            return chain
          }
          if (cols.includes('suspended_at')) {
            const chain: Record<string, unknown> = {
              gte: () => chain,
              order: () => chain,
              limit: () =>
                Promise.resolve({ data: f.suspendedUsers ?? [], error: null }),
            }
            return chain
          }
          if (cols === 'id, full_name, email') {
            return {
              in: () =>
                Promise.resolve({ data: f.nameLookup ?? [], error: null }),
            }
          }
          // bump idx so order isn't unstable across surprises
          usersDataIdx += 1
          throw new Error(`unexpected users select cols: ${cols} (call #${usersDataIdx})`)
        },
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      }
    }
    if (table === 'rides') {
      const callIdx = ridesIdx++
      // call 0 = stuck (.in().limit()), call 1 = failed (.eq().order().limit()),
      // call 2 = unpaid (.eq().gte().lt().not().order().limit())
      const data =
        callIdx === 0 ? (f.stuckCandidates ?? []) :
        callIdx === 1 ? (f.failedRides ?? []) :
        callIdx === 2 ? (f.unpaidRides ?? []) :
        []
      const chain: Record<string, unknown> = {
        in: () => chain,
        eq: () => chain,
        gte: () => chain,
        lt: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data, error: null }),
      }
      return { select: () => chain }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

function mkRide(over: Partial<RideRow>): RideRow {
  return {
    id: over.id ?? 'r-1',
    status: over.status ?? 'active',
    rider_id: over.rider_id ?? 'rider-1',
    driver_id: over.driver_id === undefined ? 'driver-1' : over.driver_id,
    fare_cents: over.fare_cents ?? 500,
    created_at: over.created_at ?? new Date().toISOString(),
    started_at: over.started_at ?? null,
    ended_at: over.ended_at ?? null,
    last_driver_ping_at: over.last_driver_ping_at ?? null,
    payment_status: over.payment_status ?? null,
  }
}

function mkUser(over: Partial<UserRow>): UserRow {
  return {
    id: over.id ?? 'u-1',
    full_name: over.full_name ?? 'User',
    email: over.email ?? 'u@x.edu',
    wallet_balance: over.wallet_balance ?? 0,
    is_driver: over.is_driver ?? false,
    suspended_at: over.suspended_at ?? null,
    suspended_reason: over.suspended_reason ?? null,
  }
}

function isoMinusMin(min: number): string {
  return new Date(Date.now() - min * 60 * 1000).toISOString()
}

describe('GET /api/admin/alerts — permission gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/admin/alerts')
    expect(res.status).toBe(401)
  })

  it('returns 403 NOT_AN_ADMIN when is_admin=false', async () => {
    setup({ isAdmin: false })
    const res = await request(app)
      .get('/api/admin/alerts')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/admin/alerts — empty state', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok with all categories at 0 when nothing matches', async () => {
    setup({})
    const res = await request(app)
      .get('/api/admin/alerts')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.total_count).toBe(0)
    expect(res.body.stuck_rides.count).toBe(0)
    expect(res.body.failed_payments.count).toBe(0)
    expect(res.body.unpaid_completed.count).toBe(0)
    expect(res.body.negative_wallets.count).toBe(0)
    expect(res.body.recent_suspensions.count).toBe(0)
  })
})

describe('GET /api/admin/alerts — stuck-ride classification', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters out healthy candidates and surfaces awaiting_driver', async () => {
    setup({
      stuckCandidates: [
        mkRide({ id: 'r-await', status: 'requested', driver_id: null, created_at: isoMinusMin(10) }),
        mkRide({ id: 'r-healthy', status: 'requested', driver_id: null, created_at: isoMinusMin(2) }),
      ],
      nameLookup: [{ id: 'rider-1', full_name: 'Alex', email: null }],
    })

    const res = await request(app)
      .get('/api/admin/alerts')
      .set('Authorization', VALID_JWT)

    expect(res.body.stuck_rides.count).toBe(1)
    expect(res.body.stuck_rides.items[0].ride_id).toBe('r-await')
    expect(res.body.stuck_rides.items[0].stuck_reason).toBe('awaiting_driver')
    expect(res.body.stuck_rides.items[0].rider_name).toBe('Alex')
  })

  it('detects driver_gps_stale on active rides', async () => {
    setup({
      stuckCandidates: [
        mkRide({
          id: 'r-stale',
          status: 'active',
          started_at: isoMinusMin(5),
          last_driver_ping_at: isoMinusMin(3),
        }),
      ],
      nameLookup: [],
    })

    const res = await request(app)
      .get('/api/admin/alerts')
      .set('Authorization', VALID_JWT)

    expect(res.body.stuck_rides.count).toBe(1)
    expect(res.body.stuck_rides.items[0].stuck_reason).toBe('driver_gps_stale')
  })

  it('sorts stuck rides worst-first (longest stuck_for_ms)', async () => {
    setup({
      stuckCandidates: [
        mkRide({ id: 'r-old', status: 'requested', driver_id: null, created_at: isoMinusMin(20) }),
        mkRide({ id: 'r-newer', status: 'requested', driver_id: null, created_at: isoMinusMin(8) }),
      ],
      nameLookup: [],
    })

    const res = await request(app)
      .get('/api/admin/alerts')
      .set('Authorization', VALID_JWT)

    expect(res.body.stuck_rides.items.map((r: { ride_id: string }) => r.ride_id))
      .toEqual(['r-old', 'r-newer'])
  })
})

describe('GET /api/admin/alerts — payment categories', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns failed payments hydrated with names', async () => {
    setup({
      failedRides: [
        mkRide({
          id: 'r-fail', status: 'completed', payment_status: 'failed',
          ended_at: isoMinusMin(2),
        }),
      ],
      nameLookup: [
        { id: 'rider-1', full_name: 'Alex', email: null },
        { id: 'driver-1', full_name: null, email: 'dani@davis.edu' },
      ],
    })

    const res = await request(app)
      .get('/api/admin/alerts')
      .set('Authorization', VALID_JWT)

    expect(res.body.failed_payments.count).toBe(1)
    expect(res.body.failed_payments.items[0].rider_name).toBe('Alex')
    expect(res.body.failed_payments.items[0].driver_name).toBe('dani')
    expect(res.body.failed_payments.items[0].payment_status).toBe('failed')
  })

  it('exposes unpaid completed rides separately from failed', async () => {
    setup({
      unpaidRides: [
        mkRide({
          id: 'r-unpaid', status: 'completed', payment_status: 'pending',
          ended_at: isoMinusMin(30),
        }),
      ],
      nameLookup: [],
    })

    const res = await request(app)
      .get('/api/admin/alerts')
      .set('Authorization', VALID_JWT)

    expect(res.body.unpaid_completed.count).toBe(1)
    expect(res.body.unpaid_completed.items[0].ride_id).toBe('r-unpaid')
    expect(res.body.failed_payments.count).toBe(0)
  })
})

describe('GET /api/admin/alerts — negative wallets + suspensions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('surfaces negative wallet balances', async () => {
    setup({
      negativeUsers: [
        mkUser({ id: 'u-neg', wallet_balance: -750, is_driver: true, full_name: 'Driver Drew' }),
      ],
    })

    const res = await request(app)
      .get('/api/admin/alerts')
      .set('Authorization', VALID_JWT)

    expect(res.body.negative_wallets.count).toBe(1)
    expect(res.body.negative_wallets.items[0].wallet_balance_cents).toBe(-750)
  })

  it('surfaces recent suspensions with reason', async () => {
    setup({
      suspendedUsers: [
        mkUser({
          id: 'u-sus',
          suspended_at: isoMinusMin(60),
          suspended_reason: 'abusive language',
        }),
      ],
    })

    const res = await request(app)
      .get('/api/admin/alerts')
      .set('Authorization', VALID_JWT)

    expect(res.body.recent_suspensions.count).toBe(1)
    expect(res.body.recent_suspensions.items[0].suspended_reason).toBe('abusive language')
  })

  it('total_count sums all categories', async () => {
    setup({
      stuckCandidates: [
        mkRide({ id: 'r-await', status: 'requested', driver_id: null, created_at: isoMinusMin(10) }),
      ],
      failedRides: [mkRide({ id: 'r-f', payment_status: 'failed', ended_at: isoMinusMin(1) })],
      unpaidRides: [mkRide({ id: 'r-u', payment_status: 'pending', ended_at: isoMinusMin(30) })],
      negativeUsers: [mkUser({ id: 'u-neg', wallet_balance: -100 })],
      suspendedUsers: [mkUser({ id: 'u-sus', suspended_at: isoMinusMin(5) })],
      nameLookup: [],
    })

    const res = await request(app)
      .get('/api/admin/alerts')
      .set('Authorization', VALID_JWT)

    expect(res.body.total_count).toBe(5)
  })
})
