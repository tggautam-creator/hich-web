/**
 * /api/suggestions/* — read + dismiss surface for the Suggested Rides
 * feature (v1.3). The matching engine in server/lib/suggestionEngine.ts
 * writes rows into ride_suggestions; this router serves them to the
 * web + iOS clients.
 *
 * Endpoints:
 *   GET  /api/suggestions/board   — paginated list for the Suggested tab
 *   GET  /api/suggestions/top     — top 3 for the home-page hero card
 *   POST /api/suggestions/:id/dismiss — hide one suggestion for the viewer
 *
 * Acting on a suggestion (request / offer) goes through the existing
 * /api/schedule/request and /api/schedule/board/offers endpoints — the
 * client uses the schedule_id surfaced here as the payload, no new
 * conversion endpoint is needed.
 *
 * Auth: every endpoint requires a valid JWT; reads are scoped to the
 * viewer's own suggestions via `auth.uid()` equality on either
 * `rider_user_id` or `driver_user_id`. The route layer enforces this
 * directly (uses supabaseAdmin to bypass RLS for join efficiency,
 * then filters in the query).
 */

import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'
import { scanForRoutine } from '../lib/suggestionEngine.ts'

export const suggestionsRouter = Router()

interface SuggestionRow {
  id: string
  rider_user_id: string
  driver_user_id: string
  rider_schedule_id: string | null
  driver_schedule_id: string | null
  rider_routine_id: string | null
  driver_routine_id: string | null
  trip_date: string
  match_type: 'same_day_forward' | 'routine_recurring' | 'reverse_trip'
  relevance_score: number
  match_signals: Record<string, unknown>
  rider_status: 'new' | 'seen' | 'dismissed' | 'acted'
  driver_status: 'new' | 'seen' | 'dismissed' | 'acted'
  created_at: string
  expires_at: string
}

interface UserMini {
  id: string
  full_name: string | null
  avatar_url: string | null
  rating_avg: number | null
}

interface ScheduleMini {
  id: string
  origin_address: string | null
  dest_address: string | null
  trip_time: string | null
  // 2026-05-25 CTO review — iOS posts anytime schedules with
  // trip_time='12:00:00' + time_flexible=true (NOT NULL placeholder).
  // Without surfacing this flag the client can't tell an anytime
  // post from a real noon trip → showed "12:00 PM" on the detail
  // sheet for what the user meant as Anytime.
  time_flexible: boolean | null
}

interface RoutineMini {
  id: string
  route_name: string | null
  day_of_week: number[]
  departure_time: string | null
  arrival_time: string | null
  // Migration 102 — human-readable addresses populated by the client
  // at insert time. Nullable for legacy routines pre-backfill.
  origin_address: string | null
  dest_address: string | null
  // PostGIS GEOMETRY(Point, 4326) columns come back as GeoJSON Point
  // objects — `{ type: 'Point', coordinates: [lng, lat] }`. iOS uses
  // these as the CLGeocoder fallback when address columns are null.
  origin: { type: string; coordinates: [number, number] } | null
  destination: { type: string; coordinates: [number, number] } | null
}

interface SuggestionPayload {
  id: string
  trip_date: string
  match_type: string
  relevance_score: number
  match_signals: Record<string, unknown>
  side: 'rider' | 'driver'              // which side the viewer is on
  status: string                         // viewer-side status
  notified_at: string | null
  other_user: UserMini | null
  rider_source: { schedule?: ScheduleMini; routine?: RoutineMini } | null
  driver_source: { schedule?: ScheduleMini; routine?: RoutineMini } | null
  created_at: string
}

/**
 * Common enrichment — pull the "other side"'s user info, the source
 * schedule/routine details on both sides, and pack into a stable
 * payload shape the clients can render.
 */
async function enrichSuggestionRows(
  rows: SuggestionRow[],
  viewerId: string,
): Promise<SuggestionPayload[]> {
  if (rows.length === 0) return []

  // Collect every user_id we need (the "other side" for each row).
  // v1.3 Session A — single routines table; both rider_routine_id +
  // driver_routine_id columns reference driver_routines (unified).
  const otherUserIds = new Set<string>()
  const scheduleIds = new Set<string>()
  const routineIds = new Set<string>()
  for (const r of rows) {
    otherUserIds.add(r.rider_user_id === viewerId ? r.driver_user_id : r.rider_user_id)
    if (r.rider_schedule_id) scheduleIds.add(r.rider_schedule_id)
    if (r.driver_schedule_id) scheduleIds.add(r.driver_schedule_id)
    if (r.rider_routine_id) routineIds.add(r.rider_routine_id)
    if (r.driver_routine_id) routineIds.add(r.driver_routine_id)
  }

  // Batch-fetch the joins.
  const [usersResult, schedulesResult, routinesResult] = await Promise.all([
    otherUserIds.size === 0 ? Promise.resolve({ data: [] }) : supabaseAdmin
      .from('users')
      .select('id, full_name, avatar_url, rating_avg')
      .in('id', Array.from(otherUserIds)),
    scheduleIds.size === 0 ? Promise.resolve({ data: [] }) : supabaseAdmin
      .from('ride_schedules')
      .select('id, origin_address, dest_address, trip_time, time_flexible')
      .in('id', Array.from(scheduleIds)),
    routineIds.size === 0 ? Promise.resolve({ data: [] }) : supabaseAdmin
      .from('driver_routines')
      .select('id, route_name, day_of_week, departure_time, arrival_time, origin_address, dest_address, origin, destination')
      .in('id', Array.from(routineIds)),
  ])

  const usersById = new Map<string, UserMini>(
    ((usersResult.data ?? []) as UserMini[]).map((u) => [u.id, u]),
  )
  const schedulesById = new Map<string, ScheduleMini>(
    ((schedulesResult.data ?? []) as ScheduleMini[]).map((s) => [s.id, s]),
  )
  const routinesById = new Map<string, RoutineMini>(
    ((routinesResult.data ?? []) as RoutineMini[]).map((r) => [r.id, r]),
  )

  return rows.map((r): SuggestionPayload => {
    const isRider = r.rider_user_id === viewerId
    const otherId = isRider ? r.driver_user_id : r.rider_user_id

    const riderSchedule = r.rider_schedule_id ? schedulesById.get(r.rider_schedule_id) : undefined
    const driverSchedule = r.driver_schedule_id ? schedulesById.get(r.driver_schedule_id) : undefined
    const riderRoutine = r.rider_routine_id ? routinesById.get(r.rider_routine_id) : undefined
    const driverRoutine = r.driver_routine_id ? routinesById.get(r.driver_routine_id) : undefined

    return {
      id: r.id,
      trip_date: r.trip_date,
      match_type: r.match_type,
      relevance_score: r.relevance_score,
      match_signals: r.match_signals,
      side: isRider ? 'rider' : 'driver',
      status: isRider ? r.rider_status : r.driver_status,
      notified_at: null,                            // not exposed to client
      other_user: usersById.get(otherId) ?? null,
      rider_source: (riderSchedule || riderRoutine) ? {
        schedule: riderSchedule,
        routine: riderRoutine,
      } : null,
      driver_source: (driverSchedule || driverRoutine) ? {
        schedule: driverSchedule,
        routine: driverRoutine,
      } : null,
      created_at: r.created_at,
    }
  })
}

/**
 * GET /api/suggestions/board?limit=20
 *
 * List for the Suggested tab on the ride board. Hides dismissed-by-
 * viewer rows. Sorted by trip_date ASC (today first), then relevance
 * DESC, then created_at DESC (newest tiebreak). Returns up to `limit`
 * items — no cursor pagination in Phase A (volume too low to justify
 * the composite-cursor complexity given the 3-axis sort).
 */
suggestionsRouter.get(
  '/board',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const viewerId = res.locals['userId'] as string
    const limit = Math.min(50, Math.max(1, Number(req.query['limit'] ?? 20)))

    // Fetch more than `limit` so app-side dismissed filtering has
    // headroom; only return `limit` after filtering.
    const { data, error } = await supabaseAdmin
      .from('ride_suggestions')
      .select('*')
      .or(`rider_user_id.eq.${viewerId},driver_user_id.eq.${viewerId}`)
      .order('trip_date', { ascending: true })
      .order('relevance_score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit * 2)

    if (error) { next(error); return }

    const rows = (data ?? []) as unknown as SuggestionRow[]
    // Hide dismissed-by-viewer rows in app code (filtering in SQL would
    // need two queries — one per side — for the OR on dismissed status).
    const visible = rows.filter((r) => {
      const isRider = r.rider_user_id === viewerId
      const status = isRider ? r.rider_status : r.driver_status
      return status !== 'dismissed'
    }).slice(0, limit)

    const payload = await enrichSuggestionRows(visible, viewerId)
    res.status(200).json({ results: payload })
  },
)

/**
 * GET /api/suggestions/top
 *
 * Top 3 highest-relevance suggestions for the home-page hero card.
 * Same filters as /board but capped at 3, sorted relevance-first.
 */
suggestionsRouter.get(
  '/top',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const viewerId = res.locals['userId'] as string
    // Optional ?side=rider|driver — when set, only return suggestions
    // where the viewer is on that side. Powers the per-mode home hero
    // (rider home shows where viewer is rider, driver home shows
    // where viewer is driver). Omitting it returns both sides
    // (preserves the legacy /top contract for any older client).
    const sideRaw = String(req.query['side'] ?? '').toLowerCase()
    const side: 'rider' | 'driver' | null =
      sideRaw === 'rider' ? 'rider' : sideRaw === 'driver' ? 'driver' : null

    let query = supabaseAdmin
      .from('ride_suggestions')
      .select('*')
      .order('relevance_score', { ascending: false })
      .order('trip_date', { ascending: true })
      .limit(20)

    if (side === 'rider') {
      query = query.eq('rider_user_id', viewerId)
    } else if (side === 'driver') {
      query = query.eq('driver_user_id', viewerId)
    } else {
      query = query.or(`rider_user_id.eq.${viewerId},driver_user_id.eq.${viewerId}`)
    }

    const { data, error } = await query
    if (error) { next(error); return }

    const rows = (data ?? []) as unknown as SuggestionRow[]
    const visible = rows.filter((r) => {
      const isRider = r.rider_user_id === viewerId
      const status = isRider ? r.rider_status : r.driver_status
      return status !== 'dismissed' && status !== 'acted'
    }).slice(0, 3)

    const payload = await enrichSuggestionRows(visible, viewerId)
    res.status(200).json({ results: payload })
  },
)

/**
 * POST /api/suggestions/:id/dismiss
 *
 * Flips the viewer-side status to 'dismissed'. Independent of the
 * other side — they still see the suggestion in their list. Idempotent.
 */
suggestionsRouter.post(
  '/:id/dismiss',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const viewerId = res.locals['userId'] as string
    const suggestionId = req.params['id']
    if (!suggestionId) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: 'suggestion id required' } })
      return
    }

    const { data: row, error: fetchErr } = await supabaseAdmin
      .from('ride_suggestions')
      .select('rider_user_id, driver_user_id')
      .eq('id', suggestionId)
      .maybeSingle()

    if (fetchErr) { next(fetchErr); return }
    if (!row) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'suggestion not found' } })
      return
    }

    const r = row as unknown as { rider_user_id: string; driver_user_id: string }
    if (r.rider_user_id !== viewerId && r.driver_user_id !== viewerId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'not your suggestion' } })
      return
    }

    const updateCol = r.rider_user_id === viewerId ? 'rider_status' : 'driver_status'
    const { error: updateErr } = await supabaseAdmin
      .from('ride_suggestions')
      .update({ [updateCol]: 'dismissed' } as never)
      .eq('id', suggestionId)

    if (updateErr) { next(updateErr); return }
    res.status(200).json({ ok: true })
  },
)

/**
 * POST /api/suggestions/scan-routine/:id
 *
 * v1.3 Session C+ — instant-scan trigger for a freshly-inserted
 * routine. iOS calls this fire-and-forget after a Supabase insert
 * to driver_routines so the matching engine runs immediately
 * instead of waiting up to 5 min for the backstop cron tick.
 *
 * Mirrors the pattern used by /api/schedule/:id/compute-route
 * which triggers scanForPost on schedule insert.
 *
 * Auth: JWT-validated; ownership-checked against the routine's
 * user_id so a caller can only trigger scans on their own routines.
 */
/**
 * POST /api/suggestions/purge-routine/:id
 *
 * v1.3 CTO review (2026-05-25) — instant cleanup hook. When the user
 * deletes OR deactivates a routine on iOS, this endpoint immediately
 * deletes any pending `ride_suggestions` rows for that routine so the
 * hero / Suggested tab stop surfacing matches the user no longer
 * cares about. Before this, the 5-min `expireStaleSuggestions` cron
 * was the only cleanup path → up to 5 minutes of stale UI.
 *
 * Hard deletes are technically handled by the FK CASCADE in
 * migration 103, so calling this after a hard delete is a no-op
 * (returns 0). Pause (is_active=false) is where it really matters —
 * the routine row stays but its suggestions should not.
 *
 * Auth: JWT-validated; ownership-checked against the routine's
 * user_id so a caller can only purge their own routine's suggestions.
 * Idempotent — repeated calls return the same count (0 after first).
 */
suggestionsRouter.post(
  '/purge-routine/:id',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const viewerId = res.locals['userId'] as string
    const routineID = String(req.params['id'] ?? '')
    if (routineID.length === 0) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: 'routine id required' } })
      return
    }

    // Ownership check. Note: if the routine was already hard-deleted
    // (CASCADE already fired), the lookup returns null and we just
    // return 0 — keeps the call idempotent for either case.
    const { data: row, error: fetchErr } = await supabaseAdmin
      .from('driver_routines')
      .select('user_id')
      .eq('id', routineID)
      .maybeSingle()

    if (fetchErr) { next(fetchErr); return }
    if (row) {
      const r = row as unknown as { user_id: string }
      if (r.user_id !== viewerId) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'not your routine' } })
        return
      }
    }

    // Two separate deletes because the routine could be on either
    // side of any given suggestion. supabase-js can't OR across
    // columns in a single .delete() without RPC.
    const [riderHit, driverHit] = await Promise.all([
      supabaseAdmin
        .from('ride_suggestions')
        .delete()
        .eq('rider_routine_id', routineID)
        .select('id'),
      supabaseAdmin
        .from('ride_suggestions')
        .delete()
        .eq('driver_routine_id', routineID)
        .select('id'),
    ])
    const deleted = (riderHit.data?.length ?? 0) + (driverHit.data?.length ?? 0)
    res.status(200).json({ ok: true, deleted })
  },
)

suggestionsRouter.post(
  '/scan-routine/:id',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const viewerId = res.locals['userId'] as string
    const routineID = String(req.params['id'] ?? '')
    if (routineID.length === 0) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: 'routine id required' } })
      return
    }

    // Ownership + mode lookup in one query.
    const { data: row, error: fetchErr } = await supabaseAdmin
      .from('driver_routines')
      .select('user_id, mode')
      .eq('id', routineID)
      .maybeSingle()

    if (fetchErr) { next(fetchErr); return }
    if (!row) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'routine not found' } })
      return
    }

    const r = row as unknown as { user_id: string; mode: string }
    if (r.user_id !== viewerId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'not your routine' } })
      return
    }

    // Fire scan synchronously so the response carries the count.
    // The scan itself can take a few seconds (Google API roundtrip
    // for transit handoffs) but caller can fire-and-forget on iOS.
    const role: 'driver' | 'rider' = r.mode === 'rider' ? 'rider' : 'driver'
    const result = await scanForRoutine(routineID, role)
    res.status(200).json({ ok: true, inserted: result.inserted, skipped: result.skipped })
  },
)
