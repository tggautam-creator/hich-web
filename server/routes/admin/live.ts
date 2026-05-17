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

// Slice 1.7b: include 'requested' rides so ops can see + act on rides
// stuck without a driver (the most common ops question is "why hasn't
// this been picked up?"). Previously the snapshot filtered them out.
const ACTIVE_STATUSES = ['requested', 'accepted', 'coordinating', 'active'] as const
const EVENT_WINDOW_MIN = 60
const MAX_ACTIVE_RIDES = 200
const MAX_EVENTS = 100

// Slice 1.7d / fix 2026-05-17 — "online driver" = will receive a ride
// notification right now. Per Tarun's design (preserved in
// server/lib/scheduledReminders.ts clearStaleOnlineFlags →
// STALE_ONLINE_HOURS = 24 * 7), a driver who toggled is_online=true
// stays online for **7 days** of no pings before the cron flips them
// off. The matcher Stage 1 fallback (rides.ts ~534) fires the visible
// push regardless of GPS ping freshness because iOS delivers alert
// pushes to force-quit apps. So this admin overlay must use the SAME
// 7-day window — not a tight 5-min gate, which previously hid online
// drivers from the admin even though the matcher would still notify
// them. The 5-min threshold lives on as the "stale ping" warning for
// visibility (UI badges drivers whose GPS isn't fresh).
const ONLINE_INCLUSION_WINDOW_HOURS = 24 * 7   // matches clearStaleOnlineFlags
const STALE_PING_THRESHOLD_MIN = 5             // ping older than this → stale flag
const MAX_ONLINE_DRIVERS = 500

// Stuck thresholds — adjust based on ops feedback. Each constant exists
// once so the UI can format "stuck for 3m 24s" against the same number.
export const STUCK_AWAITING_DRIVER_MS = 5 * 60 * 1000
export const STUCK_COORDINATING_MS = 5 * 60 * 1000
export const STUCK_DRIVER_GPS_STALE_MS = 2 * 60 * 1000
export const STUCK_RIDE_LONG_MS = 30 * 60 * 1000

export type StuckReason =
  | 'awaiting_driver'      // requested + no driver_id + created >5m ago
  | 'coordinating_long'    // coordinating >5m
  | 'driver_gps_stale'     // active + last_driver_ping older than 2m
  | 'ride_long'            // active + started_at >30m ago

interface ActiveRide {
  id: string
  status: 'requested' | 'accepted' | 'coordinating' | 'active'
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
  /** Server-computed reason this ride needs ops attention, null if healthy. */
  stuck_reason: StuckReason | null
  /** Milliseconds the ride has been in the stuck state (for "stuck for Xm"). */
  stuck_for_ms: number | null
}

interface LiveEvent {
  ride_id: string
  kind: 'created' | 'accepted' | 'started' | 'completed' | 'cancelled'
  at: string
  rider_name: string | null
  driver_name: string | null
  fare_cents: number | null
}

interface OnlineDriver {
  user_id: string
  name: string | null
  email: string | null
  /** Most recent driver_locations.recorded_at. Driver stays "online"
   * up to 7 days after this even without further pings (matches the
   * matcher's behavior + the clearStaleOnlineFlags cron). */
  last_ping_at: string
  /** Last GPS coords; map renders these as green dots. */
  lat: number
  lng: number
  /** True when this driver is also a `driver_id` on a currently-active
   * ride. Lets the UI render them as "busy" rather than "available"
   * even though they're technically online. */
  on_active_ride: boolean
  /** True when the GPS ping is older than STALE_PING_THRESHOLD_MIN.
   * The matcher will STILL notify them (visible push reaches force-
   * quit apps), but their on-map dot may not reflect their actual
   * current position. UI surfaces this as a warning. */
  ping_stale: boolean
  /** Age of the last ping in milliseconds — UI formats this for the
   * tooltip ("pinged 6 min ago"). */
  ping_age_ms: number
}

interface LiveSnapshotResponse {
  ok: true
  active_rides: ActiveRide[]
  events: LiveEvent[]
  online_drivers: OnlineDriver[]
  /** Online drivers who currently have NO active ride — supply count. */
  available_driver_count: number
  /** Drivers willing-but-snoozed; surfaced as a counter for ops awareness. */
  snoozed_driver_count: number
  /** Inclusive ISO timestamp the events window started at. */
  events_since: string
  generated_at: string
  active_truncated: boolean
  events_truncated: boolean
  online_drivers_truncated: boolean
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

interface StuckEvalInput {
  driver_id: string | null
  created_at: string
  started_at: string | null
  last_driver_ping_at: string | null
}

/**
 * Returns the most-severe stuck reason for the ride, or null if healthy.
 * Order of checks favours the reason ops cares about most for that
 * status. A ride can only have one reason at a time — surfaced in the
 * map + table chip + drawer header.
 */
function computeStuck(
  status: ActiveRide['status'],
  r: StuckEvalInput,
  nowMs: number,
): { reason: StuckReason; forMs: number } | null {
  if (status === 'requested') {
    if (r.driver_id) return null // unusual but harmless
    const age = nowMs - new Date(r.created_at).getTime()
    if (age > STUCK_AWAITING_DRIVER_MS) {
      return { reason: 'awaiting_driver', forMs: age }
    }
    return null
  }
  if (status === 'coordinating') {
    const age = nowMs - new Date(r.created_at).getTime()
    if (age > STUCK_COORDINATING_MS) {
      return { reason: 'coordinating_long', forMs: age }
    }
    return null
  }
  if (status === 'active') {
    // Prefer the most actionable signal: GPS gone stale beats just-long.
    if (r.last_driver_ping_at) {
      const sinceLastPing = nowMs - new Date(r.last_driver_ping_at).getTime()
      if (sinceLastPing > STUCK_DRIVER_GPS_STALE_MS) {
        return { reason: 'driver_gps_stale', forMs: sinceLastPing }
      }
    }
    if (r.started_at) {
      const sinceStart = nowMs - new Date(r.started_at).getTime()
      if (sinceStart > STUCK_RIDE_LONG_MS) {
        return { reason: 'ride_long', forMs: sinceStart }
      }
    }
  }
  return null
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
    const nowMs = now.getTime()
    const activeRides: ActiveRide[] = activeRows.map((r) => {
      const status = r.status as ActiveRide['status']
      const stuck = computeStuck(status, r, nowMs)
      return {
        id: r.id,
        status,
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
        stuck_reason: stuck?.reason ?? null,
        stuck_for_ms: stuck?.forMs ?? null,
      }
    })

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

    // ── Online drivers (Slice 1.7d) ─────────────────────────────────────
    // Same gate the matcher RPC (migrations 025 + 064) applies:
    // driver_locations.is_online + recent ping + not snoozed + user is
    // a non-suspended driver. The matcher also requires a push token,
    // but we surface every "willing" driver here — the on-map dot tells
    // ops the driver's app is open; whether the push token registered
    // is a separate concern + would double the round trips.
    // Use the 7-day window — anything inside this matches what the
    // clearStaleOnlineFlags cron leaves alone, which is the matcher's
    // effective pool. The 5-min freshness is applied later as the
    // `ping_stale` flag for UI awareness, not as a filter.
    const onlineInclusionCutoff = new Date(
      nowMs - ONLINE_INCLUSION_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString()
    const staleAfterMs = STALE_PING_THRESHOLD_MIN * 60 * 1000

    const driverLocQ = await supabaseAdmin
      .from('driver_locations')
      .select('user_id, location, recorded_at, is_online, snoozed_until')
      .eq('is_online', true)
      .gte('recorded_at', onlineInclusionCutoff)
      .order('recorded_at', { ascending: false })
      .limit(MAX_ONLINE_DRIVERS + 1)
    if (driverLocQ.error) throw driverLocQ.error

    type DriverLocRow = {
      user_id: string
      location: GeoPointMaybe | null
      recorded_at: string
      is_online: boolean
      snoozed_until: string | null
    }
    const driverLocRows = (driverLocQ.data ?? []) as unknown as DriverLocRow[]

    // De-dupe per user (most recent ping wins thanks to the order above),
    // drop snoozed users, drop those without parseable coords.
    const seenDriverIds = new Set<string>()
    const onlineCandidates: Array<{
      user_id: string
      lat: number
      lng: number
      recorded_at: string
      snoozed: boolean
    }> = []
    let snoozedCount = 0
    for (const r of driverLocRows) {
      if (seenDriverIds.has(r.user_id)) continue
      seenDriverIds.add(r.user_id)
      const snoozed = r.snoozed_until !== null && new Date(r.snoozed_until).getTime() > nowMs
      if (snoozed) {
        snoozedCount += 1
        continue
      }
      const coord = asLatLng(r.location)
      if (!coord) continue
      onlineCandidates.push({
        user_id: r.user_id,
        lat: coord.lat,
        lng: coord.lng,
        recorded_at: r.recorded_at,
        snoozed: false,
      })
    }
    const onlineDriversTruncated = onlineCandidates.length > MAX_ONLINE_DRIVERS
    const trimmedOnlineCandidates = onlineDriversTruncated
      ? onlineCandidates.slice(0, MAX_ONLINE_DRIVERS)
      : onlineCandidates

    // Filter by is_driver + suspension. We already have suspended users
    // loaded via the cohort lookup? No — that's a Slice 1.2 concept.
    // Look them up directly here.
    const onlineIds = trimmedOnlineCandidates.map((d) => d.user_id)
    type DriverUserRow = {
      id: string
      is_driver: boolean
      suspended_at: string | null
      full_name: string | null
      email: string | null
    }
    let driverInfo: DriverUserRow[] = []
    if (onlineIds.length > 0) {
      const driverInfoQ = await supabaseAdmin
        .from('users')
        .select('id, is_driver, suspended_at, full_name, email')
        .in('id', onlineIds)
      if (driverInfoQ.error) throw driverInfoQ.error
      driverInfo = (driverInfoQ.data ?? []) as unknown as DriverUserRow[]
    }
    const driverInfoById = new Map(driverInfo.map((u) => [u.id, u]))

    // Drivers who are also on an in-flight ride are still online but
    // unavailable. Cross-reference active rides we already pulled above.
    const busyDriverIds = new Set<string>()
    for (const r of activeRides) {
      if (r.driver_id) busyDriverIds.add(r.driver_id)
    }

    const onlineDrivers: OnlineDriver[] = []
    for (const c of trimmedOnlineCandidates) {
      const info = driverInfoById.get(c.user_id)
      if (!info) continue
      if (!info.is_driver) continue
      if (info.suspended_at) continue
      const pingAgeMs = nowMs - new Date(c.recorded_at).getTime()
      onlineDrivers.push({
        user_id: c.user_id,
        name: info.full_name,
        email: info.email,
        last_ping_at: c.recorded_at,
        lat: c.lat,
        lng: c.lng,
        on_active_ride: busyDriverIds.has(c.user_id),
        ping_stale: pingAgeMs > staleAfterMs,
        ping_age_ms: pingAgeMs,
      })
    }

    const availableDriverCount = onlineDrivers.filter((d) => !d.on_active_ride).length

    const body: LiveSnapshotResponse = {
      ok: true,
      active_rides: activeRides,
      events: trimmedEvents,
      online_drivers: onlineDrivers,
      available_driver_count: availableDriverCount,
      snoozed_driver_count: snoozedCount,
      events_since: sinceIso,
      generated_at: now.toISOString(),
      active_truncated: activeTruncated,
      events_truncated: eventsTruncated,
      online_drivers_truncated: onlineDriversTruncated,
    }

    res.status(200).json(body)
  } catch (err) {
    next(err)
  }
})
