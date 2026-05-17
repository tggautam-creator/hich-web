// @vitest-environment node
/**
 * Slice 1.7f — admin ride reassign endpoint tests.
 *
 *   POST /api/admin/rides/:rideId/reassign
 *
 * Validates the ops escape-hatch path for manually assigning a ride
 * to a specific driver. Covers permission, body validation, ride
 * status gate, new-driver sanity checks (existence / is_driver /
 * suspended / busy), and the happy-path side-effects
 * (rides flip + notifications + audit count).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom, mockSendFcm } = vi.hoisted(() => ({
  mockAuth: { getUser: vi.fn() },
  mockFrom: vi.fn(),
  mockSendFcm: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom },
}))
vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcm,
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const RIDE_ID = '11111111-2222-4333-8444-555555555555'
const ADMIN_UID = '00000000-0000-4000-8000-000000000aaa'
const RIDER_ID = '00000000-0000-4000-8000-000000000bbb'
const PREV_DRIVER_ID = '00000000-0000-4000-8000-000000000ccc'
const NEW_DRIVER_ID = '00000000-0000-4000-8000-000000000ddd'

interface Ride {
  id: string
  status: string
  rider_id: string
  driver_id: string | null
}

interface DriverUser {
  id: string
  is_driver: boolean
  suspended_at: string | null
  full_name: string | null
  email: string | null
}

interface SetupOpts {
  isAdmin?: boolean
  ride?: Ride | null
  newDriver?: DriverUser | null
  busyRides?: Array<{ id: string; status: string }>
  tokens?: Record<string, string[]>
}

const notificationInserts: Array<Array<Record<string, unknown>>> = []
const rideUpdates: Array<Record<string, unknown>> = []
const auditInserts: Array<Record<string, unknown>> = []

function setup(opts: SetupOpts = {}) {
  const isAdmin = opts.isAdmin === undefined ? true : opts.isAdmin
  notificationInserts.length = 0
  rideUpdates.length = 0
  auditInserts.length = 0

  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: ADMIN_UID } },
    error: null,
  })
  mockSendFcm.mockResolvedValue(1)

  // The endpoint queries:
  //   1. users.is_admin (adminAuth gate)
  //   2. rides.select.eq.maybeSingle  → load ride
  //   3. users.select.eq.maybeSingle  → load new driver
  //   4. rides.select.eq.in.limit     → busy-driver check
  //   5. rides.update.eq              → flip row
  //   6. notifications.insert         → inbox rows
  //   7. push_tokens.select.eq (per recipient)
  //   8. admin_audit_log.insert (per role)
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
          // new-driver lookup
          if (cols.includes('is_driver')) {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: opts.newDriver === undefined ? defaultDriver() : opts.newDriver,
                    error: null,
                  }),
              }),
            }
          }
          throw new Error(`unexpected users select cols: ${cols}`)
        },
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      }
    }
    if (table === 'rides') {
      return {
        select: (cols: string) => {
          // Load-ride path: '.select(cols).eq().maybeSingle()'
          if (cols.includes('rider_id')) {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: opts.ride === undefined ? defaultRide() : opts.ride,
                    error: null,
                  }),
              }),
            }
          }
          // Busy-driver check: '.select('id, status').eq('driver_id',...).in(...).limit(1)'
          const chain: Record<string, unknown> = {
            eq: () => chain,
            in: () => chain,
            limit: () => Promise.resolve({ data: opts.busyRides ?? [], error: null }),
          }
          return chain
        },
        update: (patch: Record<string, unknown>) => ({
          eq: () => {
            rideUpdates.push(patch)
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
    }
    if (table === 'notifications') {
      return {
        insert: (rows: Array<Record<string, unknown>>) => {
          notificationInserts.push(rows)
          return Promise.resolve({ data: null, error: null })
        },
      }
    }
    if (table === 'push_tokens') {
      return {
        select: () => ({
          eq: (_col: string, uid: string) =>
            Promise.resolve({
              data: ((opts.tokens ?? {})[uid] ?? []).map((t) => ({ token: t })),
              error: null,
            }),
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

function defaultRide(): Ride {
  return { id: RIDE_ID, status: 'requested', rider_id: RIDER_ID, driver_id: null }
}

function defaultDriver(): DriverUser {
  return {
    id: NEW_DRIVER_ID,
    is_driver: true,
    suspended_at: null,
    full_name: 'New Driver',
    email: 'new@davis.edu',
  }
}

describe('POST /api/admin/rides/:rideId/reassign — permission + body validation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('401 without a token', async () => {
    const res = await request(app).post(`/api/admin/rides/${RIDE_ID}/reassign`).send({})
    expect(res.status).toBe(401)
  })

  it('400 INVALID_RIDE_ID for non-UUID', async () => {
    setup()
    const res = await request(app)
      .post('/api/admin/rides/garbage/reassign')
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: NEW_DRIVER_ID, reason: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_RIDE_ID')
  })

  it('400 INVALID_NEW_DRIVER_ID for non-UUID', async () => {
    setup()
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/reassign`)
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: 'not-a-uuid', reason: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_NEW_DRIVER_ID')
  })

  it('400 INVALID_BODY when reason missing', async () => {
    setup()
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/reassign`)
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: NEW_DRIVER_ID })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })
})

describe('POST /api/admin/rides/:rideId/reassign — gate checks', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('404 when ride does not exist', async () => {
    setup({ ride: null })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/reassign`)
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: NEW_DRIVER_ID, reason: 'ops escape' })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('RIDE_NOT_FOUND')
  })

  it('409 when ride is mid-flight (active)', async () => {
    setup({
      ride: { id: RIDE_ID, status: 'active', rider_id: RIDER_ID, driver_id: PREV_DRIVER_ID },
    })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/reassign`)
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: NEW_DRIVER_ID, reason: 'too late' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('RIDE_NOT_REASSIGNABLE')
  })

  it('409 ALREADY_ASSIGNED when ride already has that driver', async () => {
    setup({
      ride: { id: RIDE_ID, status: 'accepted', rider_id: RIDER_ID, driver_id: NEW_DRIVER_ID },
    })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/reassign`)
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: NEW_DRIVER_ID, reason: 'no-op' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ALREADY_ASSIGNED')
  })

  it('404 DRIVER_NOT_FOUND when new_driver_id does not exist', async () => {
    setup({ newDriver: null })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/reassign`)
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: NEW_DRIVER_ID, reason: 'x' })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('DRIVER_NOT_FOUND')
  })

  it('409 NOT_A_DRIVER when target user is_driver=false', async () => {
    setup({
      newDriver: {
        id: NEW_DRIVER_ID, is_driver: false, suspended_at: null,
        full_name: 'Rider', email: 'r@x.edu',
      },
    })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/reassign`)
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: NEW_DRIVER_ID, reason: 'x' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NOT_A_DRIVER')
  })

  it('409 DRIVER_SUSPENDED when target driver is suspended', async () => {
    setup({
      newDriver: {
        id: NEW_DRIVER_ID, is_driver: true,
        suspended_at: '2026-05-10T00:00:00Z',
        full_name: 'Banned', email: 'b@x.edu',
      },
    })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/reassign`)
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: NEW_DRIVER_ID, reason: 'x' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('DRIVER_SUSPENDED')
  })

  it('409 DRIVER_BUSY when target driver is on another in-flight ride', async () => {
    setup({
      busyRides: [{ id: 'other-ride', status: 'active' }],
    })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/reassign`)
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: NEW_DRIVER_ID, reason: 'x' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('DRIVER_BUSY')
  })
})

describe('POST /api/admin/rides/:rideId/reassign — happy path', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('flips status requested→accepted, notifies rider+new driver, audits twice', async () => {
    setup({
      ride: { id: RIDE_ID, status: 'requested', rider_id: RIDER_ID, driver_id: null },
      tokens: {
        [RIDER_ID]: ['r-tok'],
        [NEW_DRIVER_ID]: ['nd-tok'],
      },
    })

    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/reassign`)
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: NEW_DRIVER_ID, reason: 'driver Y was nearer' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.previous_status).toBe('requested')
    expect(res.body.next_status).toBe('accepted')
    expect(res.body.previous_driver_id).toBeNull()
    expect(res.body.new_driver_id).toBe(NEW_DRIVER_ID)
    expect(res.body.notifications_written).toBe(2) // no previous driver
    // Audit hit twice (rider + new driver)
    expect(auditInserts).toHaveLength(2)
    // Update applied
    expect(rideUpdates[0]?.['driver_id']).toBe(NEW_DRIVER_ID)
    expect(rideUpdates[0]?.['status']).toBe('accepted')
  })

  it('writes 3 notifications + 3 audit rows when there was a previous driver', async () => {
    setup({
      ride: { id: RIDE_ID, status: 'accepted', rider_id: RIDER_ID, driver_id: PREV_DRIVER_ID },
      tokens: {
        [RIDER_ID]: ['r-tok'],
        [PREV_DRIVER_ID]: ['p-tok'],
        [NEW_DRIVER_ID]: ['n-tok'],
      },
    })

    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/reassign`)
      .set('Authorization', VALID_JWT)
      .send({ new_driver_id: NEW_DRIVER_ID, reason: 'previous driver no-show' })

    expect(res.status).toBe(200)
    expect(res.body.previous_driver_id).toBe(PREV_DRIVER_ID)
    expect(res.body.notifications_written).toBe(3)
    expect(auditInserts).toHaveLength(3)
    const roles = auditInserts
      .map((row) => ((row['payload'] as Record<string, unknown>)?.['role']))
      .sort()
    expect(roles).toEqual(['new_driver', 'previous_driver', 'rider'])
  })
})
