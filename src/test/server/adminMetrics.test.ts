// @vitest-environment node
/**
 * Slice 1.1 — admin Overview metrics endpoint tests.
 *
 * Verifies `GET /api/admin/metrics/overview`:
 *   - inherits the same JWT + adminAuth gate as every /api/admin/* route
 *   - computes each KPI correctly from a known fixture
 *   - returns the documented response shape (so the React Query hook
 *     + AdminHomePage can rely on it without a TypeScript guard)
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

interface UserRow {
  id: string
  email: string
  is_driver: boolean
  last_active_at: string | null
  created_at: string
}
interface RideRow {
  id: string
  status: string
  rider_id: string
  driver_id: string | null
  fare_cents: number | null
  ended_at: string | null
}
interface TokenRow { user_id: string; platform: 'ios' | 'android' | 'web' | null }
interface RatingRow { ride_id: string; rated_id: string; stars: number }

interface Fixture {
  users: UserRow[]
  rides: RideRow[]
  tokens: TokenRow[]
  ratings: RatingRow[]
  // adminAuth result for the calling user. Defaults to admin=true.
  isAdmin?: boolean | null
}

/**
 * Sets up `mockFrom` to dispatch per table name + per called method.
 *   - users  + select() → returns fixture users
 *   - users  + update().eq() → no-op for the last_active_at bump
 *   - users  + select('is_admin').eq().maybeSingle() → admin lookup
 *   - rides / push_tokens / ride_ratings + select() → fixture rows
 */
function setupFixture(f: Fixture): void {
  const isAdminVal = f.isAdmin === undefined ? true : f.isAdmin
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        // adminAuth path: .select('is_admin').eq('id', x).maybeSingle()
        select: (cols: string) => {
          if (cols === 'is_admin') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve(
                    isAdminVal === null
                      ? { data: null, error: null }
                      : { data: { is_admin: isAdminVal }, error: null },
                  ),
              }),
            }
          }
          // metrics path: .select('id, email, is_driver, last_active_at, created_at')
          return Promise.resolve({ data: f.users, error: null })
        },
        // validateJwt bump path: .update({...}).eq('id', x)
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      }
    }
    if (table === 'rides') {
      return { select: () => Promise.resolve({ data: f.rides, error: null }) }
    }
    if (table === 'push_tokens') {
      return { select: () => Promise.resolve({ data: f.tokens, error: null }) }
    }
    if (table === 'ride_ratings') {
      return { select: () => Promise.resolve({ data: f.ratings, error: null }) }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

function authAsUser(userId = 'admin-uid') {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

describe('GET /api/admin/metrics/overview — permission gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without a token (inherits validateJwt)', async () => {
    const res = await request(app).get('/api/admin/metrics/overview')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('MISSING_TOKEN')
  })

  it('returns 403 NOT_AN_ADMIN when user is_admin=false', async () => {
    authAsUser('non-admin')
    setupFixture({ users: [], rides: [], tokens: [], ratings: [], isAdmin: false })

    const res = await request(app)
      .get('/api/admin/metrics/overview')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_AN_ADMIN')
  })
})

describe('GET /api/admin/metrics/overview — KPI math', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authAsUser()
  })

  it('returns documented response shape with an empty dataset', async () => {
    setupFixture({ users: [], rides: [], tokens: [], ratings: [] })

    const res = await request(app)
      .get('/api/admin/metrics/overview')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.kpis).toMatchObject({
      total_users: 0,
      new_signups_today: 0,
      active_users: { dau: 0, wau: 0, mau: 0 },
      active_rides_now: 0,
      rides_completed_today: 0,
      revenue_this_week_cents: 0,
      ios_install_rate: null,
      driver_activation_rate: null,
      rider_activation_rate: null,
      retention_7d: null,
      avg_ride_fare_cents: null,
      avg_driver_rating: null,
    })
    expect(Array.isArray(res.body.charts.signups_14d)).toBe(true)
    expect(res.body.charts.signups_14d.length).toBe(14)
    expect(res.body.charts.completed_rides_14d.length).toBe(14)
    expect(res.body.charts.top_email_domains).toEqual([])
    expect(typeof res.body.generated_at).toBe('string')
  })

  it('counts users + DAU/WAU/MAU + new signups today from last_active_at and created_at', async () => {
    const now = new Date()
    const isoMinusHours = (h: number) =>
      new Date(now.getTime() - h * 60 * 60 * 1000).toISOString()
    const isoMinusDays = (d: number) =>
      new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString()

    setupFixture({
      users: [
        // active in last hour → DAU + WAU + MAU
        { id: 'u1', email: 'a@davis.edu', is_driver: false, last_active_at: isoMinusHours(1), created_at: isoMinusDays(60) },
        // active 3 days ago → WAU + MAU but not DAU
        { id: 'u2', email: 'b@davis.edu', is_driver: false, last_active_at: isoMinusDays(3), created_at: isoMinusDays(60) },
        // active 20 days ago → MAU only
        { id: 'u3', email: 'c@davis.edu', is_driver: true, last_active_at: isoMinusDays(20), created_at: isoMinusDays(60) },
        // never active → none of D/W/M
        { id: 'u4', email: 'd@davis.edu', is_driver: false, last_active_at: null, created_at: isoMinusDays(60) },
        // signed up an hour ago → counts as new today
        { id: 'u5', email: 'e@davis.edu', is_driver: false, last_active_at: null, created_at: isoMinusHours(1) },
      ],
      rides: [],
      tokens: [],
      ratings: [],
    })

    const res = await request(app)
      .get('/api/admin/metrics/overview')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.kpis.total_users).toBe(5)
    expect(res.body.kpis.new_signups_today).toBe(1)
    expect(res.body.kpis.active_users).toEqual({ dau: 1, wau: 2, mau: 3 })
  })

  it('computes ride KPIs: active-now, completed-today, revenue-this-week, avg fare', async () => {
    const now = new Date()
    const isoMinusHours = (h: number) =>
      new Date(now.getTime() - h * 60 * 60 * 1000).toISOString()
    const isoMinusDays = (d: number) =>
      new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString()

    setupFixture({
      users: [],
      rides: [
        // active right now (3 of them in different live statuses)
        { id: 'r1', status: 'requested', rider_id: 'u1', driver_id: null, fare_cents: null, ended_at: null },
        { id: 'r2', status: 'accepted',  rider_id: 'u1', driver_id: 'd1', fare_cents: null, ended_at: null },
        { id: 'r3', status: 'active',    rider_id: 'u2', driver_id: 'd1', fare_cents: null, ended_at: null },
        // completed today
        { id: 'r4', status: 'completed', rider_id: 'u3', driver_id: 'd1', fare_cents: 1200, ended_at: isoMinusHours(2) },
        { id: 'r5', status: 'completed', rider_id: 'u4', driver_id: 'd2', fare_cents:  800, ended_at: isoMinusHours(4) },
        // completed 3 days ago (this week)
        { id: 'r6', status: 'completed', rider_id: 'u5', driver_id: 'd2', fare_cents: 1500, ended_at: isoMinusDays(3) },
        // completed 30 days ago (NOT in this week)
        { id: 'r7', status: 'completed', rider_id: 'u6', driver_id: 'd3', fare_cents:  500, ended_at: isoMinusDays(30) },
        // cancelled, ignored
        { id: 'r8', status: 'cancelled', rider_id: 'u7', driver_id: 'd3', fare_cents: null, ended_at: null },
      ],
      tokens: [],
      ratings: [],
    })

    const res = await request(app)
      .get('/api/admin/metrics/overview')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.kpis.active_rides_now).toBe(3)
    expect(res.body.kpis.rides_completed_today).toBe(2)
    // revenue this week = r4+r5+r6 = 1200+800+1500 = 3500 cents
    expect(res.body.kpis.revenue_this_week_cents).toBe(3500)
    // avg fare over r4+r5+r6+r7 = (1200+800+1500+500)/4 = 1000
    expect(res.body.kpis.avg_ride_fare_cents).toBe(1000)
  })

  it('computes iOS install rate, excluding NULL-platform tokens from both numerator and denominator', async () => {
    setupFixture({
      users: [],
      rides: [],
      tokens: [
        { user_id: 'u1', platform: 'ios' },
        { user_id: 'u2', platform: 'ios' },
        { user_id: 'u3', platform: 'web' },
        { user_id: 'u4', platform: null }, // unknown — should not affect rate
        { user_id: 'u5', platform: null },
      ],
      ratings: [],
    })

    const res = await request(app)
      .get('/api/admin/metrics/overview')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    // 2 iOS / 3 known platform = 0.6666…
    expect(res.body.kpis.ios_install_rate).toBeCloseTo(2 / 3, 5)
  })

  it('computes driver / rider activation rates from completed rides', async () => {
    const isoYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    setupFixture({
      users: [
        { id: 'u1', email: 'a@x.edu', is_driver: true,  last_active_at: null, created_at: '2024-01-01' },
        { id: 'u2', email: 'b@x.edu', is_driver: true,  last_active_at: null, created_at: '2024-01-01' },
        { id: 'u3', email: 'c@x.edu', is_driver: false, last_active_at: null, created_at: '2024-01-01' },
        { id: 'u4', email: 'd@x.edu', is_driver: false, last_active_at: null, created_at: '2024-01-01' },
      ],
      rides: [
        // u1 drove a completed ride; u2 never drove a completed one
        { id: 'r1', status: 'completed', rider_id: 'u3', driver_id: 'u1', fare_cents: 500, ended_at: isoYesterday },
        // u3 rode a completed ride; u4 never did
        { id: 'r2', status: 'completed', rider_id: 'u3', driver_id: 'u1', fare_cents: 500, ended_at: isoYesterday },
      ],
      tokens: [],
      ratings: [],
    })

    const res = await request(app)
      .get('/api/admin/metrics/overview')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    // 1 of 2 drivers has a completed ride
    expect(res.body.kpis.driver_activation_rate).toBe(0.5)
    // 1 of 4 total users rode a completed ride
    expect(res.body.kpis.rider_activation_rate).toBe(0.25)
  })

  it('avg driver rating only counts ratings whose rated_id is the ride driver', async () => {
    setupFixture({
      users: [],
      rides: [
        { id: 'r1', status: 'completed', rider_id: 'rider1', driver_id: 'driver1', fare_cents: 500, ended_at: '2026-04-01' },
        { id: 'r2', status: 'completed', rider_id: 'rider2', driver_id: 'driver2', fare_cents: 500, ended_at: '2026-04-02' },
      ],
      tokens: [],
      ratings: [
        // driver-facing ratings (rated user IS the driver)
        { ride_id: 'r1', rated_id: 'driver1', stars: 5 },
        { ride_id: 'r2', rated_id: 'driver2', stars: 3 },
        // rider-facing ratings (rated user is the rider — must NOT count)
        { ride_id: 'r1', rated_id: 'rider1', stars: 1 },
        { ride_id: 'r2', rated_id: 'rider2', stars: 1 },
      ],
    })

    const res = await request(app)
      .get('/api/admin/metrics/overview')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    // Only the 5 and 3 count → avg = 4
    expect(res.body.kpis.avg_driver_rating).toBe(4)
  })

  it('returns top-10 email domains sorted desc', async () => {
    const u = (id: string, email: string): UserRow => ({
      id, email, is_driver: false, last_active_at: null, created_at: '2024-01-01',
    })
    setupFixture({
      users: [
        u('1', 'a@davis.edu'),
        u('2', 'b@davis.edu'),
        u('3', 'c@davis.edu'),
        u('4', 'd@stanford.edu'),
        u('5', 'e@stanford.edu'),
        u('6', 'f@berkeley.edu'),
      ],
      rides: [],
      tokens: [],
      ratings: [],
    })

    const res = await request(app)
      .get('/api/admin/metrics/overview')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.charts.top_email_domains).toEqual([
      { domain: 'davis.edu', count: 3 },
      { domain: 'stanford.edu', count: 2 },
      { domain: 'berkeley.edu', count: 1 },
    ])
  })
})
