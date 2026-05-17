// @vitest-environment node
/**
 * Slice 1.7c — stuck-step audience resolution for /admin/campaigns.
 *
 * Verifies the four new audience types (stuck_after_*) correctly
 * pull users whose funnel max-step matches the requested stuck point.
 *
 * Owns its own mocks (rather than extending adminCampaigns.test.ts)
 * because the stuck path goes through computeFunnelData → users +
 * auth.admin.listUsers + vehicles + rides, which the existing
 * campaigns test setup doesn't mock.
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
// No-op the FCM + Resend wrappers — preview is read-only.
vi.mock('../../../server/lib/fcm.ts', () => ({ sendFcmPush: vi.fn() }))
vi.mock('../../../server/lib/resend.ts', () => ({
  sendEmailToMany: vi.fn(),
  isAllowedFromAddress: () => true,
  FROM_ADDRESS_ALLOWLIST: [],
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const ADMIN_UID = '00000000-0000-4000-8000-000000000aaa'

interface CohortUser {
  id: string
  email: string
  full_name: string | null
  is_driver: boolean
  onboarding_completed: boolean
  default_payment_method_id: string | null
  created_at: string
}

interface StuckSetup {
  cohort: CohortUser[]
  verifiedIds?: string[]
  driverVehicleIds?: string[]
  completedRiderIds?: string[]
  completedDriverIds?: string[]
  suspendedIds?: string[]
  optedOutIds?: string[]
}

function setup(s: StuckSetup) {
  const verified = new Set(s.verifiedIds ?? [])
  const driverVehicles = new Set(s.driverVehicleIds ?? [])
  const completedRider = new Set(s.completedRiderIds ?? [])
  const completedDriver = new Set(s.completedDriverIds ?? [])
  const suspended = new Set(s.suspendedIds ?? [])

  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: ADMIN_UID } },
    error: null,
  })

  // auth.admin.listUsers paginates. Return the cohort users that are
  // verified on page 1, then an empty page to terminate the loop.
  let listCallIdx = 0
  mockAuth.admin.listUsers.mockImplementation(async () => {
    listCallIdx += 1
    if (listCallIdx === 1) {
      return {
        data: {
          users: s.cohort
            .filter((u) => verified.has(u.id))
            .map((u) => ({
              id: u.id,
              email: u.email,
              email_confirmed_at: '2026-05-17T00:00:00Z',
            })),
        },
        error: null,
      }
    }
    return { data: { users: [] }, error: null }
  })

  // The preview endpoint queries users twice for stuck audiences:
  //   1. cohort for computeFunnelData (.select('id, email, full_name,
  //      is_driver, onboarding_completed, default_payment_method_id,
  //      created_at') — no further filters when mode='both'/range='all')
  //   2. suspended-ids drop list (.select('id').not('suspended_at', 'is', null))
  // We disambiguate by the column string the caller passed.
  let suspensedCallCount = 0
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: (cols: string) => {
          if (cols === 'is_admin') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { is_admin: true }, error: null }),
              }),
            }
          }
          // cohort query — no chain methods needed for mode='both' /
          // range='all'. Return the cohort directly.
          if (cols.includes('onboarding_completed')) {
            return Promise.resolve({ data: s.cohort, error: null })
          }
          // suspended lookup uses .select('id').not('suspended_at', 'is', null)
          if (cols === 'id') {
            const chain: Record<string, unknown> = {
              not: () => {
                suspensedCallCount += 1
                return Promise.resolve({
                  data: Array.from(suspended).map((id) => ({ id })),
                  error: null,
                })
              },
            }
            return chain
          }
          // fallback — shouldn't be hit
          throw new Error(`unexpected users select cols: ${cols}`)
        },
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      }
    }
    if (table === 'vehicles') {
      return {
        select: () => ({
          is: () =>
            Promise.resolve({
              data: Array.from(driverVehicles).map((uid) => ({
                user_id: uid,
                deleted_at: null,
              })),
              error: null,
            }),
        }),
      }
    }
    if (table === 'rides') {
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                ...Array.from(completedRider).map((uid) => ({
                  rider_id: uid,
                  driver_id: null,
                  status: 'completed',
                })),
                ...Array.from(completedDriver).map((uid) => ({
                  rider_id: 'rider-other',
                  driver_id: uid,
                  status: 'completed',
                })),
              ],
              error: null,
            }),
        }),
      }
    }
    if (table === 'notification_preferences') {
      // No opt-outs in these tests unless explicitly listed.
      const chain: Record<string, unknown> = {
        in: () => chain,
        eq: () =>
          Promise.resolve({
            data: (s.optedOutIds ?? []).map((id) => ({
              user_id: id,
              push_promos: false,
              email_marketing: false,
            })),
            error: null,
          }),
      }
      return { select: () => chain }
    }
    throw new Error(`unmocked from(${table}) — suspensedCallCount=${suspensedCallCount}`)
  })
}

function mkUser(over: Partial<CohortUser>): CohortUser {
  return {
    id: over.id ?? 'u',
    email: over.email ?? `${over.id ?? 'u'}@davis.edu`,
    full_name: over.full_name ?? 'Test',
    is_driver: over.is_driver ?? false,
    onboarding_completed: over.onboarding_completed ?? false,
    default_payment_method_id: over.default_payment_method_id ?? null,
    created_at: over.created_at ?? '2026-05-10T00:00:00Z',
  }
}

describe('GET /api/admin/campaigns/audience/preview — stuck-step audiences', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stuck_after_signup → signed up but never verified email', async () => {
    setup({
      cohort: [
        mkUser({ id: 'u-stuck' }),                                                // not verified
        mkUser({ id: 'u-progressed', onboarding_completed: true }),               // verified + further
      ],
      verifiedIds: ['u-progressed'],
    })

    const res = await request(app)
      .get('/api/admin/campaigns/audience/preview?type=stuck_after_signup')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)
    expect(res.body.sample_users[0].id).toBe('u-stuck')
  })

  it('stuck_after_verified_email → verified email but did not complete profile', async () => {
    setup({
      cohort: [
        mkUser({ id: 'u-stuck' }),                                          // verified, profile false
        mkUser({ id: 'u-progressed', onboarding_completed: true,
                 default_payment_method_id: 'pm-x' }),                       // verified, profile true, payment ✓
      ],
      verifiedIds: ['u-stuck', 'u-progressed'],
    })

    const res = await request(app)
      .get('/api/admin/campaigns/audience/preview?type=stuck_after_verified_email')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)
    expect(res.body.sample_users[0].id).toBe('u-stuck')
  })

  it('stuck_after_completed_profile → profile done but no payment (rider) / vehicle (driver)', async () => {
    setup({
      cohort: [
        // rider stuck — profile done, no payment
        mkUser({ id: 'u-rider-stuck', is_driver: false, onboarding_completed: true }),
        // rider progressed — has payment
        mkUser({ id: 'u-rider-go', is_driver: false, onboarding_completed: true,
                 default_payment_method_id: 'pm-x' }),
        // driver stuck — profile done, no vehicle
        mkUser({ id: 'u-driver-stuck', is_driver: true, onboarding_completed: true }),
        // driver progressed — has vehicle
        mkUser({ id: 'u-driver-go', is_driver: true, onboarding_completed: true }),
      ],
      verifiedIds: ['u-rider-stuck', 'u-rider-go', 'u-driver-stuck', 'u-driver-go'],
      driverVehicleIds: ['u-driver-go'],
    })

    const res = await request(app)
      .get('/api/admin/campaigns/audience/preview?type=stuck_after_completed_profile')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
    const ids = res.body.sample_users.map((u: { id: string }) => u.id).sort()
    expect(ids).toEqual(['u-driver-stuck', 'u-rider-stuck'])
  })

  it('stuck_after_payment_or_vehicle → set up but no completed first ride', async () => {
    setup({
      cohort: [
        // rider with payment but no completed ride → stuck
        mkUser({ id: 'u-stuck', is_driver: false, onboarding_completed: true,
                 default_payment_method_id: 'pm-x' }),
        // rider with payment AND completed first ride → progressed
        mkUser({ id: 'u-done', is_driver: false, onboarding_completed: true,
                 default_payment_method_id: 'pm-y' }),
      ],
      verifiedIds: ['u-stuck', 'u-done'],
      completedRiderIds: ['u-done'],
    })

    const res = await request(app)
      .get('/api/admin/campaigns/audience/preview?type=stuck_after_payment_or_vehicle')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)
    expect(res.body.sample_users[0].id).toBe('u-stuck')
  })

  it('excludes suspended users from stuck audiences', async () => {
    setup({
      cohort: [
        mkUser({ id: 'u-stuck' }),
        mkUser({ id: 'u-suspended' }),
      ],
      verifiedIds: [],
      suspendedIds: ['u-suspended'],
    })

    const res = await request(app)
      .get('/api/admin/campaigns/audience/preview?type=stuck_after_signup')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)
    expect(res.body.sample_users[0].id).toBe('u-stuck')
  })
})
