/**
 * `/api/admin/live/*` — operations console feed.
 *
 * Slice 1.7: a single snapshot endpoint the admin "Live" page polls
 * every 10 s. Returns the ride set ops needs at-a-glance:
 *   - every in-progress ride (status in accepted | coordinating | active)
 *     with the GPS data the map needs
 *   - the last 60 minutes of ride lifecycle events (created / cancelled /
 *     completed) for the right-hand event feed
 *
 * The client polls — no Supabase Realtime subscription on the admin
 * surface in Phase 1. A 10s tick on a single endpoint is far easier to
 * reason about than maintaining a multi-table channel subscription,
 * and ops latency is fine at that resolution. We can layer Realtime
 * on top later (Slice 1.10 or Phase 2) without changing the data
 * shape here.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'

export const adminLiveRouter = Router()

const ACTIVE_STATUSES = ['accepted', 'coordinating', 'active'] as const
const EVENT_WINDOW_MIN = 60
const MAX_ACTIVE_RIDES = 200
const MAX_EVENTS = 100

interface ActiveRide {
  id: string
  status: 'accepted' | 'coordinating' | 'active'
  rider_id: string
  driver_id: string | null
  origin: { lat: number; lng: number } | null
  destination: { lat: number; lng: number } | null
  pickup_point: { lat: number; lng: number } | null
  last_driver_gps: { lat: number; lng: number } | null
  last_rider_gps: { lat: number; lng: number } | null
  last_driver_ping_at: string | null
  last_rider_ping_at: string | null
  origin_name: string | null
  destination_name: string | null
  fare_cents: number | null
  created_at: string
  started_at: string | null
  rider_name: string | null
  driver_name: string | null
}

interface LiveEvent {
  ride_id: string
  kind: 'created' | 'accepted' | 'started' | 'completed' | 'cancelled'
  at: string
  rider_name: string | null
  driver_name: string | null
  fare_cents: number | null
}

interface LiveSnapshotResponse {
  ok: true
  active_rides: ActiveRide[]
  events: LiveEvent[]
  /** Inclusive ISO timestamp the events window started at. */
  events_since: string
  generated_at: string
  active_truncated: boolean
  events_truncated: boolean
}

interface GeoPointMaybe {
  type?: string
  coordinates?: [number, number] // [lng, lat]
}

function asLatLng(p: GeoPointMaybe | null | undefined): { lat: number; lng: number } | null {
  if (!p || !Array.isArray(p.coordinates) || p.coordinates.length < 2) return null
  const [lng, lat] = p.coordinates
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function gpsCoord(lat: number | null, lng: number | null): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/**
 * GET /api/admin/live/snapshot
 *
 * Returns the live ops snapshot. The client polls this every 10 s while
 * the Live tab is in the foreground.
 */
adminLiveRouter.get('/snapshot', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date()
    const since = new Date(now.getTime() - EVENT_WINDOW_MIN * 60 * 1000)
    const sinceIso = since.toISOString()

    // ── Active rides ─────────────────────────────────────────────────────
    // Pulled with a single .in() filter; client filters further by status.
    // Limit caps the worst-case payload (a runaway query won't OOM the
    // admin browser). If the cap is hit the response flags it.
    const activeQuery = await supabaseAdmin
      .from('rides')
      .select(
        [
          'id',
          'status',
          'rider_id',
          'driver_id',
          'origin',
          'destination',
          'pickup_point',
          'origin_name',
          'destination_name',
          'last_driver_gps_lat',
          'last_driver_gps_lng',
          'last_rider_gps_lat',
          'last_rider_gps_lng',
          'last_driver_ping_at',
          'last_rider_ping_at',
          'fare_cents',
          'created_at',
          'started_at',
        ].join(','),
      )
      .in('status', ACTIVE_STATUSES as unknown as readonly never[])
      .order('created_at', { ascending: false })
      .limit(MAX_ACTIVE_RIDES + 1)

    if (activeQuery.error) throw activeQuery.error

    type ActiveRow = {
      id: string
      status: 'accepted' | 'coordinating' | 'active'
      rider_id: string
      driver_id: string | null
      origin: GeoPointMaybe | null
      destination: GeoPointMaybe | null
      pickup_point: GeoPointMaybe | null
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
    }

    const activeRowsRaw = (activeQuery.data ?? []) as unknown as ActiveRow[]
    const activeTruncated = activeRowsRaw.length > MAX_ACTIVE_RIDES
    const activeRows = activeTruncated
      ? activeRowsRaw.slice(0, MAX_ACTIVE_RIDES)
      : activeRowsRaw

    // ── Recent events ────────────────────────────────────────────────────
    // Pulled separately so we can OR over multiple timestamp columns.
    // Each ride contributes up to two events in the window (e.g. created
    // + started). We synthesize them per row then sort.
    const eventsQuery = await supabaseAdmin
      .from('rides')
      .select(
        [
          'id',
          'rider_id',
          'driver_id',
          'fare_cents',
          'status',
          'created_at',
          'started_at',
          'ended_at',
        ].join(','),
      )
      .or(
        `created_at.gte.${sinceIso},started_at.gte.${sinceIso},ended_at.gte.${sinceIso}`,
      )
      .order('created_at', { ascending: false })
      .limit(MAX_EVENTS * 2)

    if (eventsQuery.error) throw eventsQuery.error

    type EventRow = {
      id: string
      rider_id: string
      driver_id: string | null
      fare_cents: number | null
      status: string
      created_at: string
      started_at: string | null
      ended_at: string | null
    }

    const eventRows = (eventsQuery.data ?? []) as unknown as EventRow[]

    // ── User name lookup ─────────────────────────────────────────────────
    // One round trip for every distinct rider/driver across both lists.
    const userIds = new Set<string>()
    for (const r of activeRows) {
      userIds.add(r.rider_id)
      if (r.driver_id) userIds.add(r.driver_id)
    }
    for (const r of eventRows) {
      userIds.add(r.rider_id)
      if (r.driver_id) userIds.add(r.driver_id)
    }

    const nameById = new Map<string, string>()
    if (userIds.size > 0) {
      const usersQuery = await supabaseAdmin
        .from('users')
        .select('id, full_name, email')
        .in('id', Array.from(userIds))
      if (usersQuery.error) throw usersQuery.error
      type UserRow = { id: string; full_name: string | null; email: string | null }
      const rows = (usersQuery.data ?? []) as unknown as UserRow[]
      for (const u of rows) {
        const label = u.full_name?.trim() || (u.email ? u.email.split('@')[0] : null) || u.id.slice(0, 8)
        nameById.set(u.id, label ?? u.id.slice(0, 8))
      }
    }

    const nameOrNull = (id: string | null): string | null =>
      id ? (nameById.get(id) ?? null) : null

    // ── Shape active rides ───────────────────────────────────────────────
    const activeRides: ActiveRide[] = activeRows.map((r) => ({
      id: r.id,
      status: r.status,
      rider_id: r.rider_id,
      driver_id: r.driver_id,
      origin: asLatLng(r.origin),
      destination: asLatLng(r.destination),
      pickup_point: asLatLng(r.pickup_point),
      origin_name: r.origin_name,
      destination_name: r.destination_name,
      last_driver_gps: gpsCoord(r.last_driver_gps_lat, r.last_driver_gps_lng),
      last_rider_gps: gpsCoord(r.last_rider_gps_lat, r.last_rider_gps_lng),
      last_driver_ping_at: r.last_driver_ping_at,
      last_rider_ping_at: r.last_rider_ping_at,
      fare_cents: r.fare_cents,
      created_at: r.created_at,
      started_at: r.started_at,
      rider_name: nameOrNull(r.rider_id),
      driver_name: nameOrNull(r.driver_id),
    }))

    // ── Shape events ─────────────────────────────────────────────────────
    const events: LiveEvent[] = []
    for (const r of eventRows) {
      const rider = nameOrNull(r.rider_id)
      const driver = nameOrNull(r.driver_id)
      if (r.created_at >= sinceIso) {
        events.push({
          ride_id: r.id,
          kind: 'created',
          at: r.created_at,
          rider_name: rider,
          driver_name: driver,
          fare_cents: r.fare_cents,
        })
      }
      if (r.started_at && r.started_at >= sinceIso) {
        events.push({
          ride_id: r.id,
          kind: 'started',
          at: r.started_at,
          rider_name: rider,
          driver_name: driver,
          fare_cents: r.fare_cents,
        })
      }
      if (r.ended_at && r.ended_at >= sinceIso) {
        events.push({
          ride_id: r.id,
          kind: r.status === 'cancelled' ? 'cancelled' : 'completed',
          at: r.ended_at,
          rider_name: rider,
          driver_name: driver,
          fare_cents: r.fare_cents,
        })
      }
    }
    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    const eventsTruncated = events.length > MAX_EVENTS
    const trimmedEvents = eventsTruncated ? events.slice(0, MAX_EVENTS) : events

    const body: LiveSnapshotResponse = {
      ok: true,
      active_rides: activeRides,
      events: trimmedEvents,
      events_since: sinceIso,
      generated_at: now.toISOString(),
      active_truncated: activeTruncated,
      events_truncated: eventsTruncated,
    }

    res.status(200).json(body)
  } catch (err) {
    next(err)
  }
})
