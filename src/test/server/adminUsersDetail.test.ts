// @vitest-environment node
/**
 * Slice 1.3a — admin user search + profile detail endpoint tests.
 *
 *   GET /api/admin/users/search?q=&limit=&offset=
 *   GET /api/admin/users/:id
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom } = vi.hoisted(() => ({
  mockAuth: {
    getUser: vi.fn(),
    admin: {
      listUsers: vi.fn(),
      getUserById: vi.fn(),
    },
  },
  mockFrom: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom },
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'

function authAsAdmin(userId = 'admin-uid') {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

/**
 * Helper: build a from() mock that returns the supplied rows for any
 * select chain ending in `await`, `.range()`, or `.maybeSingle()`.
 * Also routes the adminAuth `is_admin` lookup to return true.
 */
function setupBaseMocks(opts: {
  isAdmin?: boolean
  usersFor?: {
    data: unknown
    count?: number
    error?: { message: string } | null
  }
  userSingle?: { data: unknown; error?: { message: string } | null }
  vehicles?: { data: unknown; error?: { message: string } | null }
  scheduleCount?: number
  rides?: { data: unknown; error?: { message: string } | null }
  authUser?: { id: string; email_confirmed_at: string | null } | null
}): void {
  const isAdmin = opts.isAdmin === undefined ? true : opts.isAdmin

  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: (cols: string, options?: { count?: string; head?: boolean }) => {
          // adminAuth path
          if (cols === 'is_admin') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { is_admin: isAdmin }, error: null }),
              }),
            }
          }
          // GET /:id full-profile single select
          if (cols === '*') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve(opts.userSingle ?? { data: null, error: null }),
              }),
            }
          }
          // GET /search list select
          // Build a chainable thenable that ignores filters and
          // resolves with whatever the fixture set up.
          const result = opts.usersFor ?? { data: [], count: 0, error: null }
          const chain: Record<string, unknown> = {
            eq: () => chain,
            or: () => chain,
            order: () => chain,
            range: () =>
              Promise.resolve({
                data: result.data ?? [],
                count: result.count ?? null,
                error: result.error ?? null,
              }),
            then: (resolve: (v: unknown) => void) =>
              resolve({
                data: result.data ?? [],
                count: result.count ?? null,
                error: result.error ?? null,
              }),
          }
          void options
          return chain
        },
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      }
    }
    if (table === 'vehicles') {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              limit: () =>
                Promise.resolve(opts.vehicles ?? { data: [], error: null }),
            }),
          }),
        }),
      }
    }
    if (table === 'ride_schedules') {
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: null,
              count: opts.scheduleCount ?? 0,
              error: null,
            }),
        }),
      }
    }
    if (table === 'rides') {
      return {
        select: () =>
          Promise.resolve(opts.rides ?? { data: [], error: null }),
      }
    }
    throw new Error(`unmocked from(${table})`)
  })

  mockAuth.admin.getUserById.mockResolvedValue({
    data: opts.authUser ? { user: opts.authUser } : { user: null },
    error: null,
  })
}

// ── /search ────────────────────────────────────────────────────────────────

describe('GET /api/admin/users/search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/admin/users/search')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('MISSING_TOKEN')
  })

  it('returns 403 NOT_AN_ADMIN when is_admin=false', async () => {
    authAsAdmin()
    setupBaseMocks({ isAdmin: false })
    const res = await request(app)
      .get('/api/admin/users/search')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_AN_ADMIN')
  })

  it('returns newest signups for an empty query', async () => {
    authAsAdmin()
    setupBaseMocks({
      usersFor: {
        data: [
          { id: 'u1', email: 'a@x.edu', full_name: 'A', is_driver: false, created_at: '2026-05-17T00:00:00Z', last_active_at: null },
          { id: 'u2', email: 'b@x.edu', full_name: 'B', is_driver: true, created_at: '2026-05-16T00:00:00Z', last_active_at: null },
        ],
        count: 2,
      },
    })

    const res = await request(app)
      .get('/api/admin/users/search')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.q).toBe('')
    expect(res.body.total).toBe(2)
    expect(res.body.users.map((u: { id: string }) => u.id)).toEqual(['u1', 'u2'])
  })

  it('matches a text query via .or() ILIKE', async () => {
    authAsAdmin()
    setupBaseMocks({
      usersFor: {
        data: [
          { id: 'u1', email: 'tarun@x.edu', full_name: 'Tarun', is_driver: false, created_at: '2026-05-17T00:00:00Z', last_active_at: null },
        ],
        count: 1,
      },
    })

    const res = await request(app)
      .get('/api/admin/users/search?q=tarun')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.q).toBe('tarun')
    expect(res.body.users.length).toBe(1)
    expect(res.body.users[0].email).toBe('tarun@x.edu')
  })

  it('exact-id lookup when q is a full UUID', async () => {
    authAsAdmin()
    setupBaseMocks({
      usersFor: {
        data: [
          { id: '550e8400-e29b-41d4-a716-446655440000', email: 'x@x.edu', full_name: 'X', is_driver: false, created_at: '2026-05-17T00:00:00Z', last_active_at: null },
        ],
      },
    })

    const res = await request(app)
      .get('/api/admin/users/search?q=550e8400-e29b-41d4-a716-446655440000')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.users.length).toBe(1)
    expect(res.body.users[0].id).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('caps limit at 100 and clamps to ≥1', async () => {
    authAsAdmin()
    setupBaseMocks({ usersFor: { data: [], count: 0 } })

    const tooBig = await request(app)
      .get('/api/admin/users/search?limit=500')
      .set('Authorization', VALID_JWT)
    expect(tooBig.body.limit).toBe(100)

    const zero = await request(app)
      .get('/api/admin/users/search?limit=0')
      .set('Authorization', VALID_JWT)
    expect(zero.body.limit).toBe(25)
  })
})

// ── /:id ───────────────────────────────────────────────────────────────────

describe('GET /api/admin/users/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 on a non-UUID id', async () => {
    authAsAdmin()
    setupBaseMocks({})
    const res = await request(app)
      .get('/api/admin/users/notauuid')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_USER_ID')
  })

  it('returns 404 when the user does not exist', async () => {
    authAsAdmin()
    setupBaseMocks({ userSingle: { data: null } })
    const res = await request(app)
      .get('/api/admin/users/550e8400-e29b-41d4-a716-446655440000')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('returns full profile + derived data on success', async () => {
    authAsAdmin()
    const userId = '550e8400-e29b-41d4-a716-446655440000'
    setupBaseMocks({
      userSingle: {
        data: {
          id: userId,
          email: 'driver@davis.edu',
          phone: '+15555550100',
          full_name: 'Test Driver',
          avatar_url: null,
          is_driver: true,
          onboarding_completed: true,
          is_admin: false,
          wallet_balance: 1250,
          default_payment_method_id: null,
          stripe_account_id: 'acct_123',
          stripe_onboarding_complete: true,
          rating_avg: 4.8,
          rating_count: 12,
          date_of_birth: '2000-01-01',
          last_active_at: '2026-05-17T00:00:00Z',
          created_at: '2026-04-01T00:00:00Z',
        },
      },
      vehicles: {
        data: [
          { id: 'veh-1', make: 'Honda', model: 'Civic', year: 2020, color: 'Blue', plate: 'ABC123', deleted_at: null },
        ],
      },
      scheduleCount: 3,
      rides: {
        data: [
          { id: 'r1', status: 'completed', rider_id: 'rider-1', driver_id: userId },
          { id: 'r2', status: 'completed', rider_id: 'rider-2', driver_id: userId },
          { id: 'r3', status: 'cancelled', rider_id: 'rider-3', driver_id: userId },
          { id: 'r4', status: 'completed', rider_id: 'other-rider', driver_id: 'other-driver' },
        ],
      },
      authUser: { id: userId, email_confirmed_at: '2026-04-02T00:00:00Z' },
    })

    const res = await request(app)
      .get(`/api/admin/users/${userId}`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe(userId)
    expect(res.body.email_verified).toBe(true)
    expect(res.body.university).toBe('UC Davis')
    expect(res.body.vehicle).toMatchObject({ make: 'Honda', model: 'Civic' })
    expect(res.body.routines_count).toBe(3)
    // rides_count = 3 (this user appears in r1, r2, r3; r4 excluded)
    expect(res.body.rides_count).toBe(3)
    // rides_completed_count = 2 (r1 + r2; r3 cancelled, r4 not this user)
    expect(res.body.rides_completed_count).toBe(2)
  })

  it('returns email_verified=false when auth row is missing', async () => {
    authAsAdmin()
    const userId = '550e8400-e29b-41d4-a716-446655440000'
    setupBaseMocks({
      userSingle: {
        data: {
          id: userId,
          email: 'orphan@tagorides.com',
          phone: null,
          full_name: 'Orphan',
          avatar_url: null,
          is_driver: false,
          onboarding_completed: false,
          is_admin: false,
          wallet_balance: 0,
          default_payment_method_id: null,
          stripe_account_id: null,
          stripe_onboarding_complete: false,
          rating_avg: null,
          rating_count: 0,
          date_of_birth: null,
          last_active_at: null,
          created_at: '2026-05-17T00:00:00Z',
        },
      },
      authUser: null,
    })

    const res = await request(app)
      .get(`/api/admin/users/${userId}`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.email_verified).toBe(false)
    expect(res.body.university).toBe('Tago (admin)')
    expect(res.body.vehicle).toBeNull()
  })
})
