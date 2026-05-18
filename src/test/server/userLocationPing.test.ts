// @vitest-environment node
/**
 * Slice 1.11 — POST /api/users/me/location tests.
 *
 * Per-user GPS ping endpoint. Validates body shape, coord range,
 * and that the users row update fires with the right fields.
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
const USER_ID = '00000000-0000-4000-8000-000000000aaa'

const userUpdates: Array<Record<string, unknown>> = []
const driverLocationUpdates: Array<Record<string, unknown>> = []

interface SetupOpts {
  isDriver?: boolean
  hasDriverLocationsRow?: boolean
}

function setup(opts: SetupOpts = {}) {
  userUpdates.length = 0
  driverLocationUpdates.length = 0
  const isDriver = opts.isDriver ?? false
  const hasDriverRow = opts.hasDriverLocationsRow ?? false

  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  })
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            select: () => ({
              maybeSingle: () => {
                userUpdates.push(patch)
                return Promise.resolve({
                  data: { is_driver: isDriver },
                  error: null,
                })
              },
            }),
          }),
        }),
      }
    }
    if (table === 'driver_locations') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: hasDriverRow ? { is_online: true } : null,
                error: null,
              }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => {
            driverLocationUpdates.push(patch)
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

describe('POST /api/users/me/location', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('401 without a token', async () => {
    const res = await request(app).post('/api/users/me/location').send({ lat: 38.5, lng: -121.7 })
    expect(res.status).toBe(401)
  })

  it('400 INVALID_COORDS when lat/lng missing or non-numeric', async () => {
    setup()
    const res = await request(app)
      .post('/api/users/me/location')
      .set('Authorization', VALID_JWT)
      .send({ lat: 'not-a-number' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_COORDS')
  })

  it('400 COORDS_OUT_OF_RANGE for lat > 90', async () => {
    setup()
    const res = await request(app)
      .post('/api/users/me/location')
      .set('Authorization', VALID_JWT)
      .send({ lat: 95, lng: 0 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('COORDS_OUT_OF_RANGE')
  })

  it('204 happy path: updates users row with lat/lng/last_known_at', async () => {
    setup()
    const res = await request(app)
      .post('/api/users/me/location')
      .set('Authorization', VALID_JWT)
      .send({ lat: 38.5449, lng: -121.7405 })

    expect(res.status).toBe(204)
    expect(userUpdates).toHaveLength(1)
    const patch = userUpdates[0] as Record<string, unknown>
    expect(patch['last_known_lat']).toBe(38.5449)
    expect(patch['last_known_lng']).toBe(-121.7405)
    expect(typeof patch['last_known_at']).toBe('string')
  })

  // Slice 1.11 mirror behavior — when the calling user is_driver=true
  // AND has an existing driver_locations row, the ping mirrors GPS
  // into driver_locations so the matcher's freshness gate stays
  // current even when the driver is browsing tabs other than
  // DriverHomePage.
  it('mirrors GPS into driver_locations when user.is_driver=true AND row exists', async () => {
    setup({ isDriver: true, hasDriverLocationsRow: true })
    const res = await request(app)
      .post('/api/users/me/location')
      .set('Authorization', VALID_JWT)
      .send({ lat: 38.5449, lng: -121.7405 })

    expect(res.status).toBe(204)
    expect(driverLocationUpdates).toHaveLength(1)
    const patch = driverLocationUpdates[0] as Record<string, unknown>
    // Location should be GeoJSON Point with [lng, lat] order (matches
    // the iOS DriverHomePage GeoJSONPoint upsert shape).
    expect(patch['location']).toEqual({
      type: 'Point',
      coordinates: [-121.7405, 38.5449],
    })
    expect(typeof patch['recorded_at']).toBe('string')
    // is_online is NOT touched — driver's offline toggle wins.
    expect('is_online' in patch).toBe(false)
  })

  it('does NOT mirror when user.is_driver=true but no driver_locations row yet', async () => {
    // Driver who's never toggled online — leave them absent from
    // the matcher pool until they explicitly go online.
    setup({ isDriver: true, hasDriverLocationsRow: false })
    const res = await request(app)
      .post('/api/users/me/location')
      .set('Authorization', VALID_JWT)
      .send({ lat: 38.5, lng: -121.7 })

    expect(res.status).toBe(204)
    expect(driverLocationUpdates).toHaveLength(0)
  })

  it('does NOT touch driver_locations when user.is_driver=false (riders)', async () => {
    setup({ isDriver: false, hasDriverLocationsRow: false })
    const res = await request(app)
      .post('/api/users/me/location')
      .set('Authorization', VALID_JWT)
      .send({ lat: 38.5, lng: -121.7 })

    expect(res.status).toBe(204)
    expect(driverLocationUpdates).toHaveLength(0)
  })
})
