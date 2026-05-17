// @vitest-environment node
/**
 * Slice 1.7 — admin Live ops snapshot endpoint tests.
 *
 * Verifies `GET /api/admin/live/snapshot`:
 *   - inherits the JWT + adminAuth gate
 *   - shapes active rides + events from a known rides fixture
 *   - synthesizes created / started / completed / cancelled events from
 *     each row's timestamp triple
 *   - looks up user display names from the users table
 *   - truncation flags fire when caps are hit
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

interface RideRow {
  id: string
  status: string
  rider_id: string
  driver_id: string | null
  origin: { type: 'Point'; coordinates: [number, number] } | null
  destination: { type: 'Point'; coordinates: [number, number] } | null
  pickup_point: { type: 'Point'; coordinates: [number, number] } | null
  origin_name: string | null
  destination_name: string | null
  last_driver_gps_lat: number | null
  last_driver_gps_lng: number | null
  last_rider_gps_lat: number | null
  last_rider_gps_lng: number | null
  last_driver_ping_at: string | null
  last_rider_ping_at: string | null
  fare_cents: number | null
  created_at: string
  started_at: string | null
  ended_at: string | null
}

interface UserRow {
  id: string
  full_name: string | null
  email: string | null
}

interface Fixture {
  activeRides: RideRow[]
  eventsRides: RideRow[]
  users: UserRow[]
  isAdmin?: boolean
}

/**
 * Sets up mockFrom to dispatch:
 *  - users: adminAuth lookup (.select('is_admin').eq().maybeSingle()) +
 *           name lookup (.select('id, full_name, email').in())
 *  - rides: first call (active rides) returns fixture.activeRides
 *           second call (events query) returns fixture.eventsRides
 *           additional calls return []
 */
function setupFixture(f: Fixture) {
  const isAdminVal = f.isAdmin === undefined ? true : f.isAdmin

  let ridesCallIdx = 0

  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: (cols: string) => {
          if (cols === 'is_admin') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { is_admin: isAdminVal }, error: null }),
              }),
            }
          }
          // name lookup: .select('id, full_name, email').in('id', [...])
          return {
            in: () => Promise.resolve({ data: f.users, error: null }),
          }
        },
        // validateJwt last_active_at bump path
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      }
    }
    if (table === 'rides') {
      // Active rides query uses .in().order().limit()
      // Events query uses .or().order().limit()
      // We disambiguate by call order: first = active, second = events.
      const callIdx = ridesCallIdx++
      const data = callIdx === 0 ? f.activeRides : callIdx === 1 ? f.eventsRides : []
      const thenable = {
        in: () => thenable,
        or: () => thenable,
        order: () => thenable,
        limit: () => Promise.resolve({ data, error: null }),
      }
      return { select: () => thenable }
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

function isoMinusMinutes(min: number): string {
  return new Date(Date.now() - min * 60 * 1000).toISOString()
}

describe('GET /api/admin/live/snapshot — permission gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/admin/live/snapshot')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('MISSING_TOKEN')
  })

  it('returns 403 NOT_AN_ADMIN when user is_admin=false', async () => {
    authAsUser('non-admin')
    setupFixture({ activeRides: [], eventsRides: [], users: [], isAdmin: false })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_AN_ADMIN')
  })
})

describe('GET /api/admin/live/snapshot — shape', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authAsUser()
  })

  it('returns documented shape with an empty dataset', async () => {
    setupFixture({ activeRides: [], eventsRides: [], users: [] })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.active_rides).toEqual([])
    expect(res.body.events).toEqual([])
    expect(res.body.active_truncated).toBe(false)
    expect(res.body.events_truncated).toBe(false)
    expect(typeof res.body.generated_at).toBe('string')
    expect(typeof res.body.events_since).toBe('string')
  })

  it('shapes an active ride: GeoPoint → {lat,lng}, GPS columns → last_driver_gps, name lookup', async () => {
    const activeRide: RideRow = {
      id: 'ride-1',
      status: 'active',
      rider_id: 'rider-1',
      driver_id: 'driver-1',
      origin: { type: 'Point', coordinates: [-121.74, 38.54] },
      destination: { type: 'Point', coordinates: [-121.70, 38.55] },
      pickup_point: { type: 'Point', coordinates: [-121.745, 38.541] },
      origin_name: 'Tercero',
      destination_name: 'Memorial Union',
      last_driver_gps_lat: 38.543,
      last_driver_gps_lng: -121.741,
      last_rider_gps_lat: 38.541,
      last_rider_gps_lng: -121.745,
      last_driver_ping_at: isoMinusMinutes(1),
      last_rider_ping_at: isoMinusMinutes(2),
      fare_cents: 500,
      created_at: isoMinusMinutes(10),
      started_at: isoMinusMinutes(3),
      ended_at: null,
    }
    setupFixture({
      activeRides: [activeRide],
      eventsRides: [],
      users: [
        { id: 'rider-1', full_name: 'Alex Rider', email: 'alex@davis.edu' },
        { id: 'driver-1', full_name: null, email: 'dani@davis.edu' },
      ],
    })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.active_rides).toHaveLength(1)
    const ride = res.body.active_rides[0]
    expect(ride.id).toBe('ride-1')
    expect(ride.status).toBe('active')
    expect(ride.origin).toEqual({ lat: 38.54, lng: -121.74 })
    expect(ride.pickup_point).toEqual({ lat: 38.541, lng: -121.745 })
    expect(ride.last_driver_gps).toEqual({ lat: 38.543, lng: -121.741 })
    expect(ride.last_rider_gps).toEqual({ lat: 38.541, lng: -121.745 })
    expect(ride.rider_name).toBe('Alex Rider')
    // driver has no full_name → falls back to email local part
    expect(ride.driver_name).toBe('dani')
  })

  it('synthesizes created + started events from one ride row', async () => {
    const ride: RideRow = {
      id: 'r1',
      status: 'active',
      rider_id: 'rider-1',
      driver_id: 'driver-1',
      origin: null,
      destination: null,
      pickup_point: null,
      origin_name: null,
      destination_name: null,
      last_driver_gps_lat: null,
      last_driver_gps_lng: null,
      last_rider_gps_lat: null,
      last_rider_gps_lng: null,
      last_driver_ping_at: null,
      last_rider_ping_at: null,
      fare_cents: 500,
      created_at: isoMinusMinutes(20),
      started_at: isoMinusMinutes(5),
      ended_at: null,
    }
    setupFixture({
      activeRides: [],
      eventsRides: [ride],
      users: [
        { id: 'rider-1', full_name: 'Alex', email: 'alex@davis.edu' },
        { id: 'driver-1', full_name: 'Dani', email: 'dani@davis.edu' },
      ],
    })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    const kinds = res.body.events.map((e: { kind: string }) => e.kind).sort()
    expect(kinds).toEqual(['created', 'started'])
    // Events sorted newest first → started came after created
    expect(res.body.events[0].kind).toBe('started')
    expect(res.body.events[1].kind).toBe('created')
  })

  it('maps cancelled ride status to a cancelled event (not completed)', async () => {
    const ride: RideRow = {
      id: 'r-cancel',
      status: 'cancelled',
      rider_id: 'rider-1',
      driver_id: null,
      origin: null, destination: null, pickup_point: null,
      origin_name: null, destination_name: null,
      last_driver_gps_lat: null, last_driver_gps_lng: null,
      last_rider_gps_lat: null, last_rider_gps_lng: null,
      last_driver_ping_at: null, last_rider_ping_at: null,
      fare_cents: null,
      created_at: isoMinusMinutes(30),
      started_at: null,
      ended_at: isoMinusMinutes(2),
    }
    setupFixture({
      activeRides: [],
      eventsRides: [ride],
      users: [{ id: 'rider-1', full_name: 'Alex', email: null }],
    })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)

    const ended = res.body.events.find((e: { kind: string }) => e.kind === 'cancelled')
    expect(ended).toBeDefined()
    expect(res.body.events.find((e: { kind: string }) => e.kind === 'completed')).toBeUndefined()
  })

  it('flags active_truncated when more than MAX_ACTIVE_RIDES (200) rows returned', async () => {
    // Server requests limit(MAX+1); when we return that count it should flag truncated.
    const many: RideRow[] = []
    for (let i = 0; i < 201; i++) {
      many.push({
        id: `r${i}`,
        status: 'active',
        rider_id: 'rider-1',
        driver_id: 'driver-1',
        origin: null, destination: null, pickup_point: null,
        origin_name: null, destination_name: null,
        last_driver_gps_lat: null, last_driver_gps_lng: null,
        last_rider_gps_lat: null, last_rider_gps_lng: null,
        last_driver_ping_at: null, last_rider_ping_at: null,
        fare_cents: 500,
        created_at: isoMinusMinutes(1),
        started_at: null,
        ended_at: null,
      })
    }
    setupFixture({
      activeRides: many,
      eventsRides: [],
      users: [
        { id: 'rider-1', full_name: 'Alex', email: null },
        { id: 'driver-1', full_name: 'Dani', email: null },
      ],
    })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)

    expect(res.body.active_truncated).toBe(true)
    expect(res.body.active_rides).toHaveLength(200)
  })
})
