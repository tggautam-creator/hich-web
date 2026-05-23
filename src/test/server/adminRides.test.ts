// @vitest-environment node
/**
 * 2026-05-23 — admin ride visibility endpoints
 *
 *   GET /api/admin/rides       (paginated inbox)
 *   GET /api/admin/rides/:id   (fat detail)
 *
 * Locks the response shape so a regression doesn't silently drop
 * messages, payment events, or report links from the admin detail
 * payload (the whole point of the page is to surface those).
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
const ADMIN_UID = 'admin-uid-aaaa-bbbb-cccc-dddddddddddd'
const RIDE_ID = '11111111-1111-1111-1111-111111111111'
const RIDER_ID = '22222222-2222-2222-2222-222222222222'
const DRIVER_ID = '33333333-3333-3333-3333-333333333333'

function authAsAdmin() {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: ADMIN_UID } },
    error: null,
  })
}

interface DetailOpts {
  ride?: Record<string, unknown> | null
  rider?: Record<string, unknown> | null
  driver?: Record<string, unknown> | null
  vehicle?: Record<string, unknown> | null
  schedule?: Record<string, unknown> | null
  messages?: unknown[]
  payment?: unknown[]
  reports?: unknown[]
  auditLog?: unknown[]
  ratings?: unknown[]
}

function setupDetailMocks(opts: DetailOpts) {
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
          return {
            eq: (_col: string, id: string) => ({
              maybeSingle: () => {
                if (id === RIDER_ID) return Promise.resolve({ data: opts.rider ?? null, error: null })
                if (id === DRIVER_ID) return Promise.resolve({ data: opts.driver ?? null, error: null })
                return Promise.resolve({ data: null, error: null })
              },
            }),
          }
        },
      }
    }
    if (table === 'rides') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: opts.ride ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'vehicles') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: opts.vehicle ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'ride_schedules') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: opts.schedule ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'messages') {
      return {
        select: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({ data: opts.messages ?? [], error: null }),
          }),
        }),
      }
    }
    if (table === 'wallet_transactions') {
      return {
        select: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({ data: opts.payment ?? [], error: null }),
          }),
        }),
      }
    }
    if (table === 'reports') {
      return {
        select: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({ data: opts.reports ?? [], error: null }),
          }),
        }),
      }
    }
    if (table === 'ride_audit_log') {
      return {
        select: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({ data: opts.auditLog ?? [], error: null }),
          }),
        }),
      }
    }
    if (table === 'ride_ratings') {
      return {
        select: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({ data: opts.ratings ?? [], error: null }),
          }),
        }),
      }
    }
    if (table === 'admin_audit_log') {
      return {
        insert: () => Promise.resolve({ data: null, error: null }),
      }
    }
    return {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }
  })
}

interface InboxOpts {
  rides?: Array<Record<string, unknown>>
  rideCount?: number
  users?: Array<{ id: string; full_name: string | null; email: string | null }>
  reportRideIds?: string[]
}

function setupInboxMocks(opts: InboxOpts) {
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
          // users `in()` lookup for inbox enrichment
          return {
            in: () => Promise.resolve({ data: opts.users ?? [], error: null }),
          }
        },
      }
    }
    if (table === 'rides') {
      // Chain shape: select(cols, opts).order().range()
      const result = {
        data: opts.rides ?? [],
        count: opts.rideCount ?? opts.rides?.length ?? 0,
        error: null,
      }
      const chain: Record<string, unknown> = {
        eq: () => chain,
        gte: () => chain,
        lt: () => chain,
        order: () => chain,
        range: () => Promise.resolve(result),
      }
      return {
        select: () => chain,
      }
    }
    if (table === 'reports') {
      // .select('ride_id').in('ride_id', ...).not('ride_id', 'is', null)
      const chain: Record<string, unknown> = {
        not: () => Promise.resolve({
          data: (opts.reportRideIds ?? []).map((id) => ({ ride_id: id })),
          error: null,
        }),
      }
      const inChain: Record<string, unknown> = {
        in: () => chain,
      }
      return { select: () => inChain }
    }
    return {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/rides', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/admin/rides')
    expect(res.status).toBe(401)
  })

  it('returns an empty list when no rides match', async () => {
    authAsAdmin()
    setupInboxMocks({ rides: [], rideCount: 0 })
    const res = await request(app).get('/api/admin/rides').set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.rides).toEqual([])
    expect(res.body.total).toBe(0)
  })

  it('enriches rides with rider + driver names and flags has_report', async () => {
    authAsAdmin()
    setupInboxMocks({
      rides: [
        {
          id: RIDE_ID,
          status: 'completed',
          rider_id: RIDER_ID,
          driver_id: DRIVER_ID,
          origin_name: 'UC Davis',
          destination_name: 'Sacramento',
          fare_cents: 1250,
          payment_status: 'paid',
          created_at: '2026-05-23T10:00:00.000Z',
          started_at: '2026-05-23T10:10:00.000Z',
          ended_at: '2026-05-23T11:00:00.000Z',
        },
      ],
      rideCount: 1,
      users: [
        { id: RIDER_ID, full_name: 'Maya Rider', email: 'maya@ucdavis.edu' },
        { id: DRIVER_ID, full_name: 'Alex Driver', email: 'alex@ucdavis.edu' },
      ],
      reportRideIds: [RIDE_ID],
    })

    const res = await request(app).get('/api/admin/rides').set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.rides).toHaveLength(1)
    const row = res.body.rides[0]
    expect(row.id).toBe(RIDE_ID)
    expect(row.rider_name).toBe('Maya Rider')
    expect(row.driver_name).toBe('Alex Driver')
    expect(row.has_report).toBe(true)
    expect(row.fare_cents).toBe(1250)
  })
})

describe('GET /api/admin/rides/:id', () => {
  it('returns 400 on a non-UUID id', async () => {
    authAsAdmin()
    const res = await request(app)
      .get('/api/admin/rides/not-a-uuid')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_ID')
  })

  it('returns 404 when the ride does not exist', async () => {
    authAsAdmin()
    setupDetailMocks({ ride: null })
    const res = await request(app)
      .get(`/api/admin/rides/${RIDE_ID}`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('returns the full detail blob with messages, payment, and reports', async () => {
    authAsAdmin()
    setupDetailMocks({
      ride: {
        id: RIDE_ID,
        rider_id: RIDER_ID,
        driver_id: DRIVER_ID,
        vehicle_id: null,
        schedule_id: null,
        status: 'completed',
        origin_name: 'UC Davis',
        destination_name: 'Sacramento',
        fare_cents: 1250,
        payment_status: 'paid',
        pickup_confirmed: true,
        dropoff_confirmed: true,
        created_at: '2026-05-23T10:00:00.000Z',
      },
      rider: { id: RIDER_ID, email: 'maya@ucdavis.edu', full_name: 'Maya', avatar_url: null, is_driver: false, suspended_at: null },
      driver: { id: DRIVER_ID, email: 'alex@ucdavis.edu', full_name: 'Alex', avatar_url: null, is_driver: true, suspended_at: null },
      messages: [
        { id: 'msg-1', ride_id: RIDE_ID, sender_id: RIDER_ID, content: 'Hi', type: 'text', meta: null, created_at: '2026-05-23T10:01:00.000Z' },
        { id: 'msg-2', ride_id: RIDE_ID, sender_id: DRIVER_ID, content: 'On my way', type: 'text', meta: null, created_at: '2026-05-23T10:02:00.000Z' },
      ],
      payment: [
        { id: 'pay-1', user_id: RIDER_ID, kind: 'ride_fare', amount_cents: -1250, payment_source: 'card', created_at: '2026-05-23T11:00:00.000Z', meta: null },
      ],
      reports: [
        { id: 'rep-1', reporter_id: RIDER_ID, severity: 'normal', status: 'open', title: 'Driver was late', created_at: '2026-05-23T11:05:00.000Z' },
      ],
    })

    const res = await request(app)
      .get(`/api/admin/rides/${RIDE_ID}`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.ride.id).toBe(RIDE_ID)
    expect(res.body.rider.full_name).toBe('Maya')
    expect(res.body.driver.full_name).toBe('Alex')
    expect(res.body.messages).toHaveLength(2)
    expect(res.body.payment).toHaveLength(1)
    expect(res.body.reports).toHaveLength(1)
    expect(res.body.audit_log).toEqual([])
  })

  it('returns audit_log rows when ride_audit_log has entries', async () => {
    authAsAdmin()
    setupDetailMocks({
      ride: {
        id: RIDE_ID,
        rider_id: RIDER_ID,
        driver_id: DRIVER_ID,
        status: 'completed',
        created_at: '2026-05-23T10:00:00.000Z',
      },
      rider: { id: RIDER_ID, email: 'r@x.com', full_name: 'R', avatar_url: null, is_driver: false, suspended_at: null },
      driver: { id: DRIVER_ID, email: 'd@x.com', full_name: 'D', avatar_url: null, is_driver: true, suspended_at: null },
      auditLog: [
        { id: 'a-1', field: 'status', old_value: 'requested', new_value: 'accepted', changed_by: DRIVER_ID, created_at: '2026-05-23T10:01:00.000Z' },
        { id: 'a-2', field: 'pickup_confirmed', old_value: 'false', new_value: 'true', changed_by: null, created_at: '2026-05-23T10:05:00.000Z' },
      ],
    })
    const res = await request(app)
      .get(`/api/admin/rides/${RIDE_ID}`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.audit_log).toHaveLength(2)
    expect(res.body.audit_log[0].field).toBe('status')
    expect(res.body.audit_log[1].changed_by).toBeNull()
  })
})
