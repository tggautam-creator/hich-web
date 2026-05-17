// @vitest-environment node
/**
 * Slice 1.7b — admin force-cancel ride endpoint tests.
 *
 *   POST /api/admin/rides/:rideId/cancel
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
const DRIVER_ID = '00000000-0000-4000-8000-000000000ccc'

interface Ride {
  id: string
  status: string
  rider_id: string
  driver_id: string | null
}

interface SetupOpts {
  isAdmin?: boolean
  ride?: Ride | null
  /** Map of user_id → tokens to return from push_tokens lookup. */
  tokens?: Record<string, string[]>
  fcmReturn?: number
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

  mockSendFcm.mockResolvedValue(opts.fcmReturn ?? 1)

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
          return { in: () => Promise.resolve({ data: [], error: null }) }
        },
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      }
    }
    if (table === 'rides') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.ride === undefined ? defaultRide() : opts.ride,
                error: null,
              }),
          }),
        }),
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
          eq: (_col: string, userId: string) => {
            const tokens = (opts.tokens ?? {})[userId] ?? []
            return Promise.resolve({
              data: tokens.map((t) => ({ token: t })),
              error: null,
            })
          },
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
  return {
    id: RIDE_ID,
    status: 'accepted',
    rider_id: RIDER_ID,
    driver_id: DRIVER_ID,
  }
}

describe('POST /api/admin/rides/:rideId/cancel — permission + validation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 without a token', async () => {
    const res = await request(app).post(`/api/admin/rides/${RIDE_ID}/cancel`).send({ reason: 'x' })
    expect(res.status).toBe(401)
  })

  it('returns 400 INVALID_RIDE_ID for non-UUID', async () => {
    setup()
    const res = await request(app)
      .post('/api/admin/rides/not-a-uuid/cancel')
      .set('Authorization', VALID_JWT)
      .send({ reason: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_RIDE_ID')
  })

  it('returns 400 INVALID_BODY when reason missing', async () => {
    setup()
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/cancel`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('returns 404 when ride does not exist', async () => {
    setup({ ride: null })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/cancel`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'driver vanished' })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('RIDE_NOT_FOUND')
  })

  it('returns 409 RIDE_NOT_CANCELLABLE when ride already terminal', async () => {
    setup({
      ride: { id: RIDE_ID, status: 'completed', rider_id: RIDER_ID, driver_id: DRIVER_ID },
    })
    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/cancel`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'too late' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('RIDE_NOT_CANCELLABLE')
  })
})

describe('POST /api/admin/rides/:rideId/cancel — happy path', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('flips ride to cancelled, writes notifications for both parties, audits twice', async () => {
    setup({
      tokens: {
        [RIDER_ID]: ['rider-token-1'],
        [DRIVER_ID]: ['driver-token-1', 'driver-token-2'],
      },
      fcmReturn: 1,
    })

    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/cancel`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'rider unreachable' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.previous_status).toBe('accepted')
    expect(res.body.notifications_written).toBe(2)
    expect(res.body.push_sent).toBe(2) // 1 per party (mock returns 1 each)

    // Ride was flipped
    expect(rideUpdates).toHaveLength(1)
    expect(rideUpdates[0]?.['status']).toBe('cancelled')
    expect(typeof rideUpdates[0]?.['ended_at']).toBe('string')

    // 2 notifications inserted (rider + driver)
    expect(notificationInserts).toHaveLength(1)
    expect(notificationInserts[0]).toHaveLength(2)

    // Audit log was hit twice (rider + driver)
    expect(auditInserts).toHaveLength(2)
    const roles = auditInserts
      .map((row) => ((row['payload'] as Record<string, unknown>)?.['role']))
      .sort()
    expect(roles).toEqual(['driver', 'rider'])
  })

  it('handles missing driver gracefully (rider-only audit + notification)', async () => {
    setup({
      ride: { id: RIDE_ID, status: 'requested', rider_id: RIDER_ID, driver_id: null },
      tokens: { [RIDER_ID]: ['rider-token'] },
      fcmReturn: 1,
    })

    const res = await request(app)
      .post(`/api/admin/rides/${RIDE_ID}/cancel`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'no match found' })

    expect(res.status).toBe(200)
    expect(res.body.notifications_written).toBe(1)
    expect(auditInserts).toHaveLength(1) // only rider
  })
})
