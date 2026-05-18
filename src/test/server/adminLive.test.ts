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

interface DriverLocationRow {
  user_id: string
  location: { type: 'Point'; coordinates: [number, number] } | null
  recorded_at: string
  is_online: boolean
  snoozed_until: string | null
}

interface DriverUserRow {
  id: string
  is_driver: boolean
  suspended_at: string | null
  full_name: string | null
  email: string | null
}

interface RecentUserRow {
  id: string
  full_name: string | null
  email: string | null
  is_driver: boolean
  last_known_lat: number | null
  last_known_lng: number | null
  last_known_at: string | null
  suspended_at: string | null
}

interface Fixture {
  activeRides: RideRow[]
  eventsRides: RideRow[]
  users: UserRow[]
  driverLocations?: DriverLocationRow[]
  driverUsers?: DriverUserRow[]
  recentUserRows?: RecentUserRow[]
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
          // Disambiguate by cols string:
          //   - includes 'last_known_lat' → Slice 1.11 recent_users
          //     query (.select().gte().is().order().limit())
          //   - includes 'is_driver' (no last_known) → Slice 1.7d
          //     driver-info lookup (.select().in())
          //   - otherwise the original name lookup (.in())
          if (cols.includes('last_known_lat')) {
            const chain: Record<string, unknown> = {
              gte: () => chain,
              is: () => chain,
              order: () => chain,
              limit: () => Promise.resolve({ data: f.recentUserRows ?? [], error: null }),
            }
            return chain
          }
          if (cols.includes('is_driver')) {
            return {
              in: () => Promise.resolve({ data: f.driverUsers ?? [], error: null }),
            }
          }
          return {
            in: () => Promise.resolve({ data: f.users, error: null }),
          }
        },
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      }
    }
    if (table === 'driver_locations') {
      const thenable: Record<string, unknown> = {
        eq: () => thenable,
        gte: () => thenable,
        order: () => thenable,
        limit: () =>
          Promise.resolve({ data: f.driverLocations ?? [], error: null }),
      }
      return { select: () => thenable }
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

  it('computes stuck_reason=awaiting_driver for requested rides older than 5 min', async () => {
    const ride: RideRow = {
      id: 'r-await',
      status: 'requested',
      rider_id: 'rider-1',
      driver_id: null,
      origin: null, destination: null, pickup_point: null,
      origin_name: null, destination_name: null,
      last_driver_gps_lat: null, last_driver_gps_lng: null,
      last_rider_gps_lat: null, last_rider_gps_lng: null,
      last_driver_ping_at: null, last_rider_ping_at: null,
      fare_cents: null,
      created_at: isoMinusMinutes(7),
      started_at: null,
      ended_at: null,
    }
    setupFixture({
      activeRides: [ride],
      eventsRides: [],
      users: [{ id: 'rider-1', full_name: 'Alex', email: null }],
    })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.active_rides[0].stuck_reason).toBe('awaiting_driver')
    expect(res.body.active_rides[0].stuck_for_ms).toBeGreaterThan(5 * 60 * 1000)
  })

  it('computes stuck_reason=driver_gps_stale for active rides with old driver ping', async () => {
    const ride: RideRow = {
      id: 'r-stale',
      status: 'active',
      rider_id: 'rider-1',
      driver_id: 'driver-1',
      origin: null, destination: null, pickup_point: null,
      origin_name: null, destination_name: null,
      last_driver_gps_lat: 38.5, last_driver_gps_lng: -121.7,
      last_rider_gps_lat: null, last_rider_gps_lng: null,
      last_driver_ping_at: isoMinusMinutes(3),
      last_rider_ping_at: null,
      fare_cents: 600,
      created_at: isoMinusMinutes(10),
      started_at: isoMinusMinutes(5),
      ended_at: null,
    }
    setupFixture({
      activeRides: [ride],
      eventsRides: [],
      users: [
        { id: 'rider-1', full_name: 'Alex', email: null },
        { id: 'driver-1', full_name: 'Dani', email: null },
      ],
    })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)

    expect(res.body.active_rides[0].stuck_reason).toBe('driver_gps_stale')
  })

  it('healthy active ride with recent ping has stuck_reason=null', async () => {
    const ride: RideRow = {
      id: 'r-ok',
      status: 'active',
      rider_id: 'rider-1',
      driver_id: 'driver-1',
      origin: null, destination: null, pickup_point: null,
      origin_name: null, destination_name: null,
      last_driver_gps_lat: 38.5, last_driver_gps_lng: -121.7,
      last_rider_gps_lat: null, last_rider_gps_lng: null,
      last_driver_ping_at: isoMinusMinutes(0),
      last_rider_ping_at: null,
      fare_cents: 600,
      created_at: isoMinusMinutes(2),
      started_at: isoMinusMinutes(1),
      ended_at: null,
    }
    setupFixture({
      activeRides: [ride],
      eventsRides: [],
      users: [
        { id: 'rider-1', full_name: 'Alex', email: null },
        { id: 'driver-1', full_name: 'Dani', email: null },
      ],
    })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)

    expect(res.body.active_rides[0].stuck_reason).toBeNull()
    expect(res.body.active_rides[0].stuck_for_ms).toBeNull()
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

describe('GET /api/admin/live/snapshot — Slice 1.7d online drivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authAsUser()
  })

  it('includes online drivers, excludes snoozed + suspended + non-drivers', async () => {
    const recent = isoMinusMinutes(1) // within 5-min window → not stale
    setupFixture({
      activeRides: [],
      eventsRides: [],
      users: [],
      driverLocations: [
        // valid online driver
        { user_id: 'd-online', location: { type: 'Point', coordinates: [-121.7, 38.5] }, recorded_at: recent, is_online: true, snoozed_until: null },
        // snoozed driver
        { user_id: 'd-snoozed', location: { type: 'Point', coordinates: [-121.7, 38.5] }, recorded_at: recent, is_online: true, snoozed_until: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
        // user with location but is_driver=false should be filtered
        { user_id: 'u-not-driver', location: { type: 'Point', coordinates: [-121.7, 38.5] }, recorded_at: recent, is_online: true, snoozed_until: null },
        // suspended driver
        { user_id: 'd-suspended', location: { type: 'Point', coordinates: [-121.7, 38.5] }, recorded_at: recent, is_online: true, snoozed_until: null },
      ],
      driverUsers: [
        { id: 'd-online', is_driver: true, suspended_at: null, full_name: 'Online Olivia', email: 'olivia@davis.edu' },
        { id: 'u-not-driver', is_driver: false, suspended_at: null, full_name: 'Rider', email: 'rider@davis.edu' },
        { id: 'd-suspended', is_driver: true, suspended_at: isoMinusMinutes(60), full_name: 'Banned Bob', email: 'bob@davis.edu' },
      ],
    })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.online_drivers).toHaveLength(1)
    expect(res.body.online_drivers[0].user_id).toBe('d-online')
    expect(res.body.online_drivers[0].name).toBe('Online Olivia')
    expect(res.body.online_drivers[0].on_active_ride).toBe(false)
    expect(res.body.online_drivers[0].ping_stale).toBe(false)
    expect(res.body.available_driver_count).toBe(1)
    expect(res.body.snoozed_driver_count).toBe(1)
  })

  it('keeps drivers in the pool when GPS ping is stale (7-day window, not 5-min)', async () => {
    // Regression for the bug Tarun caught 2026-05-17: testdriver had
    // a 6m45s old ping and was being hidden from /admin/live, even
    // though the matcher Stage 1 fallback would STILL push to them
    // (clearStaleOnlineFlags keeps is_online=true for 7 days).
    const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    setupFixture({
      activeRides: [],
      eventsRides: [],
      users: [],
      driverLocations: [
        { user_id: 'd-stale', location: { type: 'Point', coordinates: [-121.7, 38.5] }, recorded_at: sixMinAgo, is_online: true, snoozed_until: null },
      ],
      driverUsers: [
        { id: 'd-stale', is_driver: true, suspended_at: null, full_name: 'Stale Steve', email: 'steve@davis.edu' },
      ],
    })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.online_drivers).toHaveLength(1)
    expect(res.body.online_drivers[0].ping_stale).toBe(true)
    expect(res.body.online_drivers[0].ping_age_ms).toBeGreaterThan(5 * 60 * 1000)
    expect(res.body.available_driver_count).toBe(1)
  })

  it('marks on_active_ride=true when the online driver is also driving a ride', async () => {
    const recent = isoMinusMinutes(1)
    setupFixture({
      activeRides: [
        {
          id: 'r-busy', status: 'active', rider_id: 'rider-1', driver_id: 'd-busy',
          origin: null, destination: null, pickup_point: null,
          origin_name: null, destination_name: null,
          last_driver_gps_lat: null, last_driver_gps_lng: null,
          last_rider_gps_lat: null, last_rider_gps_lng: null,
          last_driver_ping_at: null, last_rider_ping_at: null,
          fare_cents: 500, created_at: recent, started_at: recent, ended_at: null,
        },
      ],
      eventsRides: [],
      users: [
        { id: 'rider-1', full_name: 'Alex', email: null },
        { id: 'd-busy', full_name: 'Busy Brett', email: null },
      ],
      driverLocations: [
        { user_id: 'd-busy', location: { type: 'Point', coordinates: [-121.7, 38.5] }, recorded_at: recent, is_online: true, snoozed_until: null },
      ],
      driverUsers: [
        { id: 'd-busy', is_driver: true, suspended_at: null, full_name: 'Busy Brett', email: 'brett@davis.edu' },
      ],
    })

    const res = await request(app)
      .get('/api/admin/live/snapshot')
      .set('Authorization', VALID_JWT)

    expect(res.body.online_drivers).toHaveLength(1)
    expect(res.body.online_drivers[0].on_active_ride).toBe(true)
    // available count excludes drivers on rides
    expect(res.body.available_driver_count).toBe(0)
  })
})
