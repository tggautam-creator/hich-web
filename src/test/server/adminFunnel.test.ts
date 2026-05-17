// @vitest-environment node
/**
 * Slice 1.2 — admin funnel + stuck-users endpoint tests.
 *
 * Verifies `GET /api/admin/metrics/funnel` and `GET /api/admin/users/stuck`:
 *   - inherit the JWT + adminAuth gate
 *   - compute per-step counts correctly across all mode + range combos
 *   - return the right user list for the drill-down
 *   - paginate and reject unknown `step` values cleanly
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom } = vi.hoisted(() => ({
  mockAuth: {
    getUser: vi.fn(),
    admin: { listUsers: vi.fn() },
  },
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
  full_name: string | null
  is_driver: boolean
  onboarding_completed: boolean
  default_payment_method_id: string | null
  created_at: string
}
interface VehicleRow { user_id: string; deleted_at: string | null }
interface RideRow { rider_id: string; driver_id: string | null; status: string }
interface AuthUserRow { id: string; email_confirmed_at: string | null }

interface Fixture {
  users: UserRow[]
  vehicles: VehicleRow[]
  rides: RideRow[]
  authUsers: AuthUserRow[]
  isAdmin?: boolean | null
}

/**
 * Dispatches mockFrom + mockAuth for the funnel test surface.
 *
 *   from('users')
 *     .select('is_admin')          → adminAuth lookup
 *     .select('id, email, ...')    → funnel cohort fetch (chainable
 *                                    with .gte / .eq filters)
 *     .update().eq()               → no-op for last_active_at bump
 *   from('vehicles').select().is() → cohort vehicle fetch
 *   from('rides').select().eq()    → completed ride fetch
 *   auth.admin.listUsers()         → email_confirmed_at lookup
 */
function setupFixture(f: Fixture): void {
  const isAdminVal = f.isAdmin === undefined ? true : f.isAdmin

  mockAuth.admin.listUsers.mockImplementation(({ page = 1 } = {}) => {
    if (page === 1) {
      return Promise.resolve({ data: { users: f.authUsers }, error: null })
    }
    return Promise.resolve({ data: { users: [] }, error: null })
  })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
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
          // funnel cohort select. Build a thenable that ignores filters
          // and resolves with the full fixture (test fixtures are tiny
          // so we don't need real filter logic).
          const thenable: Record<string, unknown> = {
            gte: () => thenable,
            eq: () => thenable,
            then: (
              resolve: (v: { data: UserRow[]; error: null }) => void,
            ) => resolve({ data: f.users, error: null }),
          }
          return thenable
        },
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      }
    }
    if (table === 'vehicles') {
      return {
        select: () => ({
          is: () => Promise.resolve({ data: f.vehicles, error: null }),
        }),
      }
    }
    if (table === 'rides') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: f.rides, error: null }),
        }),
      }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

function authAsAdmin(userId = 'admin-uid') {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

// ── shared fixture builder ───────────────────────────────────────────────────

function buildUsers(): {
  users: UserRow[]
  vehicles: VehicleRow[]
  rides: RideRow[]
  authUsers: AuthUserRow[]
} {
  const nowIso = new Date().toISOString()
  // Riders
  // u1 — stuck at verified_email (never confirmed)
  // u2 — stuck at completed_profile (verified but not onboarded)
  // u3 — stuck at payment_or_vehicle (onboarded but no payment method)
  // u4 — stuck at completed_first_ride (paid but no completed ride)
  // u5 — fully through (completed a ride as rider)
  // Drivers
  // u6 — stuck at payment_or_vehicle (no vehicle)
  // u7 — fully through (completed a ride as driver)
  const users: UserRow[] = [
    { id: 'u1', email: 'r1@x.edu', full_name: 'R1', is_driver: false, onboarding_completed: false, default_payment_method_id: null, created_at: nowIso },
    { id: 'u2', email: 'r2@x.edu', full_name: 'R2', is_driver: false, onboarding_completed: false, default_payment_method_id: null, created_at: nowIso },
    { id: 'u3', email: 'r3@x.edu', full_name: 'R3', is_driver: false, onboarding_completed: true,  default_payment_method_id: null, created_at: nowIso },
    { id: 'u4', email: 'r4@x.edu', full_name: 'R4', is_driver: false, onboarding_completed: true,  default_payment_method_id: 'pm_4', created_at: nowIso },
    { id: 'u5', email: 'r5@x.edu', full_name: 'R5', is_driver: false, onboarding_completed: true,  default_payment_method_id: 'pm_5', created_at: nowIso },
    { id: 'u6', email: 'd6@x.edu', full_name: 'D6', is_driver: true,  onboarding_completed: true,  default_payment_method_id: null, created_at: nowIso },
    { id: 'u7', email: 'd7@x.edu', full_name: 'D7', is_driver: true,  onboarding_completed: true,  default_payment_method_id: null, created_at: nowIso },
  ]
  const authUsers: AuthUserRow[] = [
    { id: 'u1', email_confirmed_at: null },  // not verified
    { id: 'u2', email_confirmed_at: nowIso },
    { id: 'u3', email_confirmed_at: nowIso },
    { id: 'u4', email_confirmed_at: nowIso },
    { id: 'u5', email_confirmed_at: nowIso },
    { id: 'u6', email_confirmed_at: nowIso },
    { id: 'u7', email_confirmed_at: nowIso },
  ]
  const vehicles: VehicleRow[] = [
    { user_id: 'u7', deleted_at: null },
  ]
  const rides: RideRow[] = [
    { rider_id: 'u5', driver_id: 'u7', status: 'completed' },
  ]
  return { users, vehicles, rides, authUsers }
}

describe('GET /api/admin/metrics/funnel — permission gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/admin/metrics/funnel')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('MISSING_TOKEN')
  })

  it('returns 403 NOT_AN_ADMIN when is_admin=false', async () => {
    authAsAdmin('non-admin')
    setupFixture({ ...buildUsers(), isAdmin: false })

    const res = await request(app)
      .get('/api/admin/metrics/funnel')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_AN_ADMIN')
  })
})

describe('GET /api/admin/metrics/funnel — step math', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authAsAdmin()
  })

  it('counts mode=both correctly across the 5 steps', async () => {
    setupFixture(buildUsers())

    const res = await request(app)
      .get('/api/admin/metrics/funnel?mode=both&range=all')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    const counts = res.body.steps.map((s: { count: number }) => s.count)
    // signed_up: all 7
    // verified_email: 6 (u1 not verified)
    // completed_profile: 5 (u1, u2 not onboarded)
    // payment_or_vehicle: 3 (u4, u5 have payment; u7 has vehicle; u3 + u6 stuck)
    // completed_first_ride: 2 (u5 rider, u7 driver)
    expect(counts).toEqual([7, 6, 5, 3, 2])
    expect(res.body.total_in_cohort).toBe(7)
    expect(res.body.mode).toBe('both')
    expect(res.body.range).toBe('all')
  })

  it('mode=rider filters cohort to riders only', async () => {
    setupFixture({
      ...buildUsers(),
      users: buildUsers().users.filter((u) => !u.is_driver), // 5 riders
    })

    const res = await request(app)
      .get('/api/admin/metrics/funnel?mode=rider&range=all')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    // 5 riders: signed_up=5, verified=4, profile=3, payment=2, completed=1
    expect(res.body.steps.map((s: { count: number }) => s.count)).toEqual([5, 4, 3, 2, 1])
  })

  it('mode=driver filters cohort to drivers only', async () => {
    setupFixture({
      ...buildUsers(),
      users: buildUsers().users.filter((u) => u.is_driver), // 2 drivers
    })

    const res = await request(app)
      .get('/api/admin/metrics/funnel?mode=driver&range=all')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    // 2 drivers: all verified + onboarded; only u7 has vehicle; only u7 completed ride as driver
    expect(res.body.steps.map((s: { count: number }) => s.count)).toEqual([2, 2, 2, 1, 1])
  })

  it('drop-off percentages computed against previous step + top of funnel', async () => {
    setupFixture(buildUsers())

    const res = await request(app)
      .get('/api/admin/metrics/funnel?mode=both&range=all')
      .set('Authorization', VALID_JWT)

    // step 0 (signed_up) has no prior — drop_off_from_previous_pct = null
    expect(res.body.steps[0].drop_off_from_previous_pct).toBeNull()
    expect(res.body.steps[0].drop_off_from_top_pct).toBeNull()
    // step 1 (verified): 7 → 6 = 14.28% drop from prev, same from top
    expect(res.body.steps[1].drop_off_from_previous_pct).toBeCloseTo((1 / 7) * 100, 3)
    expect(res.body.steps[1].drop_off_from_top_pct).toBeCloseTo((1 / 7) * 100, 3)
    // step 4 (completed): 3 → 2 from previous = 33.33%; from top 5/7 = 71.43%
    expect(res.body.steps[4].drop_off_from_previous_pct).toBeCloseTo((1 / 3) * 100, 3)
    expect(res.body.steps[4].drop_off_from_top_pct).toBeCloseTo((5 / 7) * 100, 3)
  })

  it('returns zeros for an empty cohort', async () => {
    setupFixture({
      users: [],
      vehicles: [],
      rides: [],
      authUsers: [],
    })

    const res = await request(app)
      .get('/api/admin/metrics/funnel?mode=both&range=7d')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.total_in_cohort).toBe(0)
    expect(res.body.steps.every((s: { count: number }) => s.count === 0)).toBe(true)
  })
})

describe('GET /api/admin/users/stuck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authAsAdmin()
  })

  it('400s on an unknown step', async () => {
    setupFixture(buildUsers())
    const res = await request(app)
      .get('/api/admin/users/stuck?step=bogus')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_STEP')
  })

  it('returns users stuck at verified_email (mode=both)', async () => {
    setupFixture(buildUsers())
    const res = await request(app)
      .get('/api/admin/users/stuck?step=verified_email&mode=both&range=all')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.users.map((u: { id: string }) => u.id)).toEqual(['u1'])
  })

  it('returns users stuck at completed_profile (mode=both)', async () => {
    setupFixture(buildUsers())
    const res = await request(app)
      .get('/api/admin/users/stuck?step=completed_profile&mode=both&range=all')
      .set('Authorization', VALID_JWT)

    // u2 was verified but never onboarded → stuck at completed_profile
    expect(res.status).toBe(200)
    expect(res.body.users.map((u: { id: string }) => u.id)).toEqual(['u2'])
  })

  it('returns users stuck at payment_or_vehicle (mode=both): u3 (rider, no pm) + u6 (driver, no vehicle)', async () => {
    setupFixture(buildUsers())
    const res = await request(app)
      .get('/api/admin/users/stuck?step=payment_or_vehicle&mode=both&range=all')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.users.map((u: { id: string }) => u.id).sort()).toEqual(['u3', 'u6'])
  })

  it('returns users stuck at completed_first_ride (mode=both): u4', async () => {
    setupFixture(buildUsers())
    const res = await request(app)
      .get('/api/admin/users/stuck?step=completed_first_ride&mode=both&range=all')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.users.map((u: { id: string }) => u.id)).toEqual(['u4'])
  })

  it('returns empty list for step=signed_up (nothing prior to be stuck at)', async () => {
    setupFixture(buildUsers())
    const res = await request(app)
      .get('/api/admin/users/stuck?step=signed_up&mode=both&range=all')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.users).toEqual([])
  })

  it('paginates via limit + offset', async () => {
    // Build many users all stuck at verified_email
    const nowIso = new Date().toISOString()
    const users: UserRow[] = []
    const authUsers: AuthUserRow[] = []
    for (let i = 0; i < 10; i++) {
      users.push({
        id: `u${i}`,
        email: `u${i}@x.edu`,
        full_name: null,
        is_driver: false,
        onboarding_completed: false,
        default_payment_method_id: null,
        created_at: nowIso,
      })
      authUsers.push({ id: `u${i}`, email_confirmed_at: null })
    }
    setupFixture({ users, vehicles: [], rides: [], authUsers })

    const res = await request(app)
      .get('/api/admin/users/stuck?step=verified_email&mode=both&range=all&limit=3&offset=2')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(10)
    expect(res.body.users.length).toBe(3)
    expect(res.body.limit).toBe(3)
    expect(res.body.offset).toBe(2)
  })
})
