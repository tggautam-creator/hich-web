// @vitest-environment node
/**
 * 2026-05-20 — admin per-user board + routines endpoints.
 *
 *   GET /api/admin/users/:id/schedules
 *   GET /api/admin/users/:id/routines
 *
 * The list query terminates on .range(); the two count queries
 * (upcoming/past, active/inactive) terminate via `await` on the bare
 * filter chain (Supabase head:true). The shared mock chain therefore
 * exposes BOTH `.range()` and a `.then` thenable so either form
 * resolves to a fixture.
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
 * Builds a chainable mock that resolves to `payload` either via
 * `.range()` (list query) or `await chain` (head:true count query).
 * Filter calls (.eq, .gte, .lt, .in, .order) are passthroughs.
 */
function makeChain(payload: { data?: unknown[]; count?: number }) {
  const resolution = { data: payload.data ?? null, count: payload.count ?? 0, error: null }
  const chain: Record<string, unknown> & PromiseLike<typeof resolution> = {
    eq: () => chain,
    gte: () => chain,
    lt: () => chain,
    in: () => chain,
    order: () => chain,
    range: () => Promise.resolve(resolution),
    then: <T1, T2 = never>(
      onFulfilled?: ((v: typeof resolution) => T1 | PromiseLike<T1>) | null,
      onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ) => Promise.resolve(resolution).then(onFulfilled, onRejected),
  }
  return chain
}

interface SchedulesMockOpts {
  isAdmin?: boolean
  /** Page-of-data response for the list query (.range()). */
  list?: { data: unknown[]; count: number }
  /** Count returned for the upcoming-bucket (head:true). */
  upcomingCount?: number
  /** Count returned for the past-bucket (head:true). */
  pastCount?: number
  /** Rows returned by the offer-aggregation pass on ride_offers. */
  offers?: unknown[]
}

function mockSchedules(opts: SchedulesMockOpts): void {
  const isAdmin = opts.isAdmin === undefined ? true : opts.isAdmin
  let scheduleSelectCall = 0
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { is_admin: isAdmin }, error: null }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      }
    }
    if (table === 'ride_schedules') {
      return {
        select: () => {
          // Order matters: the route fires list, upcoming-count, past-count
          // in that order via Promise.all (but starts list first).
          const call = scheduleSelectCall++
          if (call === 0) return makeChain(opts.list ?? { data: [], count: 0 })
          if (call === 1) return makeChain({ count: opts.upcomingCount ?? 0 })
          return makeChain({ count: opts.pastCount ?? 0 })
        },
      }
    }
    if (table === 'ride_offers') {
      return { select: () => makeChain({ data: opts.offers ?? [] }) }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

describe('GET /api/admin/users/:id/schedules', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 on non-UUID id', async () => {
    authAsAdmin()
    mockSchedules({})
    const res = await request(app)
      .get('/api/admin/users/notauuid/schedules')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_USER_ID')
  })

  it('returns 401 without a token', async () => {
    const res = await request(app).get(
      `/api/admin/users/${VALID_UUID}/schedules`,
    )
    expect(res.status).toBe(401)
  })

  it('returns schedules with offer counts and bucket totals', async () => {
    authAsAdmin()
    mockSchedules({
      list: {
        data: [
          {
            id: 's1',
            mode: 'rider',
            route_name: 'Dorm → Airport',
            origin_address: 'Tercero',
            dest_address: 'SMF',
            direction_type: 'one_way',
            trip_date: '2026-06-01',
            trip_time: '08:30:00',
            time_type: 'departure',
            created_at: '2026-05-19T10:00:00Z',
          },
          {
            id: 's2',
            mode: 'driver',
            route_name: 'Davis → SF',
            origin_address: 'UC Davis',
            dest_address: 'Mission St',
            direction_type: 'roundtrip',
            trip_date: '2026-04-01',
            trip_time: '17:00:00',
            time_type: 'departure',
            created_at: '2026-03-30T10:00:00Z',
          },
        ],
        count: 2,
      },
      upcomingCount: 1,
      pastCount: 1,
      offers: [
        { schedule_id: 's1' },
        { schedule_id: 's1' },
        { schedule_id: 's1' }, // 3 pending offers on the rider request
      ],
    })
    const res = await request(app)
      .get(`/api/admin/users/${VALID_UUID}/schedules`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.upcoming_count).toBe(1)
    expect(res.body.past_count).toBe(1)
    expect(res.body.schedules[0]).toMatchObject({
      id: 's1',
      mode: 'rider',
      pending_offers_count: 3,
    })
    // Driver-mode post has no rider-offer concept → 0
    expect(res.body.schedules[1]).toMatchObject({
      id: 's2',
      mode: 'driver',
      pending_offers_count: 0,
    })
  })

  it('returns empty schedules list cleanly (no offers query crash)', async () => {
    authAsAdmin()
    mockSchedules({
      list: { data: [], count: 0 },
      upcomingCount: 0,
      pastCount: 0,
    })
    const res = await request(app)
      .get(`/api/admin/users/${VALID_UUID}/schedules?status=upcoming`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.schedules).toEqual([])
    expect(res.body.upcoming_count).toBe(0)
  })
})

interface RoutinesMockOpts {
  isAdmin?: boolean
  list?: { data: unknown[]; count: number }
  activeCount?: number
  inactiveCount?: number
}

function mockRoutines(opts: RoutinesMockOpts): void {
  const isAdmin = opts.isAdmin === undefined ? true : opts.isAdmin
  let routineSelectCall = 0
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { is_admin: isAdmin }, error: null }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      }
    }
    if (table === 'driver_routines') {
      return {
        select: () => {
          const call = routineSelectCall++
          if (call === 0) return makeChain(opts.list ?? { data: [], count: 0 })
          if (call === 1) return makeChain({ count: opts.activeCount ?? 0 })
          return makeChain({ count: opts.inactiveCount ?? 0 })
        },
      }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

describe('GET /api/admin/users/:id/routines', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 on non-UUID id', async () => {
    authAsAdmin()
    mockRoutines({})
    const res = await request(app)
      .get('/api/admin/users/notauuid/routines')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_USER_ID')
  })

  it('returns routines + active/inactive counts', async () => {
    authAsAdmin()
    mockRoutines({
      list: {
        data: [
          {
            id: 'rt1',
            route_name: 'Mon/Wed/Fri commute',
            direction_type: 'one_way',
            day_of_week: [1, 3, 5],
            departure_time: '08:00:00',
            arrival_time: null,
            is_active: true,
            created_at: '2026-05-15T10:00:00Z',
          },
          {
            id: 'rt2',
            route_name: 'Weekend trip',
            direction_type: 'roundtrip',
            day_of_week: [6],
            departure_time: null,
            arrival_time: '20:00:00',
            is_active: false,
            created_at: '2026-04-15T10:00:00Z',
          },
        ],
        count: 2,
      },
      activeCount: 1,
      inactiveCount: 1,
    })
    const res = await request(app)
      .get(`/api/admin/users/${VALID_UUID}/routines`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.active_count).toBe(1)
    expect(res.body.inactive_count).toBe(1)
    expect(res.body.routines[0]).toMatchObject({
      id: 'rt1',
      is_active: true,
      day_of_week: [1, 3, 5],
    })
  })

  it('handles status=active filter without error', async () => {
    authAsAdmin()
    mockRoutines({
      list: { data: [], count: 0 },
      activeCount: 0,
      inactiveCount: 5,
    })
    const res = await request(app)
      .get(`/api/admin/users/${VALID_UUID}/routines?status=active&sort=oldest`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.routines).toEqual([])
    expect(res.body.inactive_count).toBe(5)
  })
})
