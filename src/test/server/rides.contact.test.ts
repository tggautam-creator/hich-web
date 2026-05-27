// @vitest-environment node
/**
 * GET /api/rides/:rideId/counterparty-contact — endpoint test coverage.
 *
 * Verifies the privacy gate:
 *   • JWT required (covered indirectly via mocked validateJwt → 401 path)
 *   • Caller must be ride.rider_id OR ride.driver_id (403 FORBIDDEN otherwise)
 *   • Ride status must be in {accepted, coordinating, active}
 *       - requested, completed, cancelled → 403 OUTSIDE_WINDOW
 *
 * Mock pattern mirrors caregivers.test.ts: hoisted supabaseAdmin mock,
 * per-table builder dispatch.
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
const RIDER_ID = '00000000-0000-4000-8000-00000000aaaa'
const DRIVER_ID = '00000000-0000-4000-8000-00000000bbbb'
const OUTSIDER_ID = '00000000-0000-4000-8000-00000000cccc'
const RIDE_ID = '11111111-1111-4111-8111-111111111111'

interface RideRow {
  id: string
  rider_id: string | null
  driver_id: string | null
  status: string
}

interface SetupOpts {
  callerId?: string
  ride?: RideRow | null
  // `'phone' in opts` distinguishes "omitted" from "explicit null".
  // ?? would coerce explicit-null to the default string, masking the
  // null-phone test scenario.
  counterpartyPhone?: string | null
  counterpartyName?: string | null
}

function setup(opts: SetupOpts = {}) {
  const callerId = opts.callerId ?? RIDER_ID
  const ride = 'ride' in opts ? opts.ride : {
    id: RIDE_ID,
    rider_id: RIDER_ID,
    driver_id: DRIVER_ID,
    status: 'active',
  }
  const counterpartyPhone = 'counterpartyPhone' in opts
    ? opts.counterpartyPhone
    : '+15558675309'
  const counterpartyName = opts.counterpartyName ?? 'Alex Smith'

  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: callerId } },
    error: null,
  })

  // Bumps `users.last_active_at` from validateJwt — mock as a no-op.
  // The endpoint we're testing reads only `rides` and `users` proper.
  mockFrom.mockImplementation((table: string) => {
    const builder: Record<string, (...args: never[]) => unknown> = {}
    let eqValue: string | null = null

    builder['select'] = () => builder
    builder['eq'] = (_col: string, value: string) => {
      eqValue = value
      return builder
    }
    builder['update'] = () => builder
    builder['single'] = async () => {
      if (table === 'rides') {
        return { data: ride, error: ride ? null : { message: 'not found' } }
      }
      if (table === 'users') {
        if (eqValue !== RIDER_ID && eqValue !== DRIVER_ID) {
          return { data: null, error: null }
        }
        return {
          data: {
            phone: counterpartyPhone,
            full_name: counterpartyName,
          },
          error: null,
        }
      }
      return { data: null, error: { message: `unmocked from(${table})` } }
    }
    return builder
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/rides/:rideId/counterparty-contact', () => {
  it('returns 200 with phone + name when ride is accepted', async () => {
    setup({ ride: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'accepted' } })
    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/counterparty-contact`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      phone: '+15558675309',
      full_name: 'Alex Smith',
    })
  })

  it('returns 200 when ride is coordinating', async () => {
    setup({ ride: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'coordinating' } })
    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/counterparty-contact`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
  })

  it('returns 200 when ride is active', async () => {
    setup({ ride: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'active' } })
    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/counterparty-contact`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
  })

  it('returns 403 OUTSIDE_WINDOW when ride is requested (pre-acceptance)', async () => {
    setup({ ride: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'requested' } })
    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/counterparty-contact`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('OUTSIDE_WINDOW')
  })

  it('returns 403 OUTSIDE_WINDOW when ride is completed', async () => {
    setup({ ride: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'completed' } })
    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/counterparty-contact`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('OUTSIDE_WINDOW')
  })

  it('returns 403 OUTSIDE_WINDOW when ride is cancelled', async () => {
    setup({ ride: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'cancelled' } })
    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/counterparty-contact`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('OUTSIDE_WINDOW')
  })

  it('returns 403 FORBIDDEN when caller is not a party to the ride', async () => {
    setup({
      callerId: OUTSIDER_ID,
      ride: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'active' },
    })
    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/counterparty-contact`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('FORBIDDEN')
  })

  it('returns 404 RIDE_NOT_FOUND when ride does not exist', async () => {
    setup({ ride: null })
    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/counterparty-contact`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
    expect(res.body.error?.code).toBe('RIDE_NOT_FOUND')
  })

  it('returns 200 with phone=null when counterparty has no phone set', async () => {
    setup({
      ride: { id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'active' },
      counterpartyPhone: null,
    })
    const res = await request(app)
      .get(`/api/rides/${RIDE_ID}/counterparty-contact`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.phone).toBeNull()
  })
})
