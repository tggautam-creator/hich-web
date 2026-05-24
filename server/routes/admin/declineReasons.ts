/**
 * `/api/admin/decline-reasons` — supply-side analytics.
 *
 * 2026-05-23 — schema-audit Slice 4. Surfaces the
 * `driver_decline_reasons` table that had zero admin visibility.
 * Every time a driver declines an instant ride request OR a board
 * post, the server writes a row here with the free-text reason +
 * optional snooze duration. This endpoint aggregates that into a
 * histogram the admin can read at a glance.
 *
 * Why this matters: "what reasons dominate?" tells ops where the
 * matching algorithm is leaking. "Too far" → distance gate too
 * loose. "Wrong route" → board fit issue. "Wrong direction" →
 * bearing match missing context. Without this surface, none of
 * that signal is visible.
 *
 * Auth gate inherited from parent adminRouter (JWT + adminAuth).
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'

export const adminDeclineReasonsRouter = Router()

type Window = '24h' | '7d' | '30d' | 'all'

const WINDOW_LOOKUP: Record<Window, number | null> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  all: null,
}

interface ReasonHistogramRow {
  /** Normalized reason string (trimmed). Empty / null reasons rolled into '(no reason)'. */
  reason: string
  /** Total occurrences in the window. */
  count: number
  /** Subset: occurrences where the driver also chose to snooze. */
  snooze_count: number
  /** Subset: occurrences with snooze_minutes >= 60 (likely "I'm done for now"). */
  snooze_long_count: number
}

/**
 * 2026-05-23 — per-event detail. The aggregate histogram tells admin
 * "what reasons dominate" but the user wants the activity log too:
 * which ride, which rider, which driver, when, with what reason.
 * Capped at MAX_EVENTS (200) — anything bigger and the admin needs
 * to filter by window. Newest first.
 */
interface DeclineEvent {
  id: string
  reason: string
  snooze_minutes: number | null
  created_at: string
  driver_id: string
  driver_name: string | null
  driver_email: string | null
  ride_id: string | null
  rider_id: string | null
  rider_name: string | null
  rider_email: string | null
  ride_origin_name: string | null
  ride_destination_name: string | null
  ride_fare_cents: number | null
  ride_status: string | null
}

interface DeclineReasonsResponse {
  ok: true
  window: Window
  total_declines: number
  total_snoozes: number
  rows: ReasonHistogramRow[]
  events: DeclineEvent[]
  events_truncated: boolean
}

const MAX_EVENTS = 200

adminDeclineReasonsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const windowRaw = (req.query['window'] as string | undefined)?.trim() ?? '7d'
      const windowKey: Window = (['24h', '7d', '30d', 'all'] as const).includes(
        windowRaw as Window,
      )
        ? (windowRaw as Window)
        : '7d'
      const windowMs = WINDOW_LOOKUP[windowKey]
      const cutoffIso = windowMs != null
        ? new Date(Date.now() - windowMs).toISOString()
        : null

      // Pull rows in the window. We aggregate in app code because
      // PostgREST doesn't expose SQL GROUP BY directly, and the
      // table is small enough that even an all-time query is fine
      // (decline rows are O(daily ride request count) — measured in
      // thousands per week max).
      // Pull the full rows we need for both the histogram + the
      // per-event detail table. ride_id may be null (instant-ride
      // declines that never created a row) and driver_id is always
      // set.
      let query = supabaseAdmin
        .from('driver_decline_reasons')
        .select('id, reason, snooze_minutes, created_at, driver_id, ride_id')
        .order('created_at', { ascending: false })
      if (cutoffIso) {
        query = query.gte('created_at', cutoffIso)
      }
      const { data: rows, error } = await query
      if (error) throw error
      const declineRows = rows ?? []

      const histogram = new Map<
        string,
        { count: number; snooze_count: number; snooze_long_count: number }
      >()
      let totalSnoozes = 0
      for (const r of declineRows) {
        const raw = (r.reason as string | null)?.trim()
        const reason = raw && raw.length > 0 ? raw : '(no reason)'
        const snooze = r.snooze_minutes as number | null
        const isSnooze = snooze != null && snooze > 0
        const isLong = snooze != null && snooze >= 60
        if (isSnooze) totalSnoozes += 1
        const entry = histogram.get(reason) ?? {
          count: 0,
          snooze_count: 0,
          snooze_long_count: 0,
        }
        entry.count += 1
        if (isSnooze) entry.snooze_count += 1
        if (isLong) entry.snooze_long_count += 1
        histogram.set(reason, entry)
      }

      const aggregated: ReasonHistogramRow[] = Array.from(histogram.entries())
        .map(([reason, v]) => ({
          reason,
          count: v.count,
          snooze_count: v.snooze_count,
          snooze_long_count: v.snooze_long_count,
        }))
        .sort((a, b) => b.count - a.count)

      // ── Per-event enrichment ─────────────────────────────────────
      // Cap at MAX_EVENTS (200) — anything larger needs window
      // narrowing. Batched .in() lookups so no per-row N+1.
      const eventsSlice = declineRows.slice(0, MAX_EVENTS)
      const driverIds = new Set<string>()
      const rideIds = new Set<string>()
      for (const r of eventsSlice) {
        if (r.driver_id) driverIds.add(r.driver_id)
        if (r.ride_id) rideIds.add(r.ride_id)
      }
      const driverIdList = Array.from(driverIds)
      const rideIdList = Array.from(rideIds)

      const [driversRes, ridesRes] = await Promise.all([
        driverIdList.length > 0
          ? supabaseAdmin
              .from('users')
              .select('id, full_name, email')
              .in('id', driverIdList)
          : Promise.resolve({ data: [], error: null }),
        rideIdList.length > 0
          ? supabaseAdmin
              .from('rides')
              .select('id, rider_id, origin_name, destination_name, fare_cents, status')
              .in('id', rideIdList)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (driversRes.error) throw driversRes.error
      if (ridesRes.error) throw ridesRes.error

      const driverMap = new Map<string, { full_name: string | null; email: string | null }>()
      for (const d of driversRes.data ?? []) {
        driverMap.set(d.id, { full_name: d.full_name, email: d.email })
      }
      const rideMap = new Map<
        string,
        {
          rider_id: string
          origin_name: string | null
          destination_name: string | null
          fare_cents: number | null
          status: string | null
        }
      >()
      for (const ride of ridesRes.data ?? []) {
        rideMap.set(ride.id, {
          rider_id: ride.rider_id,
          origin_name: ride.origin_name,
          destination_name: ride.destination_name,
          fare_cents: ride.fare_cents,
          status: ride.status,
        })
      }

      // Second hop: rider users (only for declined rides that
      // actually have a ride row). Same batched pattern.
      const riderIds = new Set<string>()
      for (const ride of rideMap.values()) {
        if (ride.rider_id) riderIds.add(ride.rider_id)
      }
      const riderIdList = Array.from(riderIds)
      const ridersRes = riderIdList.length > 0
        ? await supabaseAdmin
            .from('users')
            .select('id, full_name, email')
            .in('id', riderIdList)
        : { data: [], error: null }
      if (ridersRes.error) throw ridersRes.error
      const riderMap = new Map<string, { full_name: string | null; email: string | null }>()
      for (const u of ridersRes.data ?? []) {
        riderMap.set(u.id, { full_name: u.full_name, email: u.email })
      }

      const events: DeclineEvent[] = eventsSlice.map((r) => {
        const driver = driverMap.get(r.driver_id as string)
        const ride = r.ride_id ? rideMap.get(r.ride_id as string) : null
        const rider = ride?.rider_id ? riderMap.get(ride.rider_id) : null
        return {
          id: r.id as string,
          reason: ((r.reason as string | null)?.trim() || '(no reason)'),
          snooze_minutes: (r.snooze_minutes as number | null) ?? null,
          created_at: r.created_at as string,
          driver_id: r.driver_id as string,
          driver_name: driver?.full_name ?? null,
          driver_email: driver?.email ?? null,
          ride_id: (r.ride_id as string | null) ?? null,
          rider_id: ride?.rider_id ?? null,
          rider_name: rider?.full_name ?? null,
          rider_email: rider?.email ?? null,
          ride_origin_name: ride?.origin_name ?? null,
          ride_destination_name: ride?.destination_name ?? null,
          ride_fare_cents: ride?.fare_cents ?? null,
          ride_status: ride?.status ?? null,
        }
      })

      const payload: DeclineReasonsResponse = {
        ok: true,
        window: windowKey,
        total_declines: declineRows.length,
        total_snoozes: totalSnoozes,
        rows: aggregated,
        events,
        events_truncated: declineRows.length > MAX_EVENTS,
      }
      res.status(200).json(payload)
    } catch (err) {
      next(err)
    }
  },
)
