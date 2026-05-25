/**
 * /api/rider-routines/* — CRUD for the v1.3 rider_routines table.
 *
 * Riders save recurring trip patterns (e.g. "Mon-Wed-Fri 9am, dorm →
 * campus") so the Suggested Rides engine can match them against driver
 * routines + posts beyond their one-off ride_schedules.
 *
 * Mirrors the driver_routines surface that lives inside schedule.ts.
 * Owned-by-self via RLS on the table (defined in migration 099); this
 * route uses supabaseAdmin and enforces ownership explicitly.
 *
 * Triggers the suggestion engine on insert/update so newly-saved
 * routines start producing suggestions within the same request cycle
 * (fire-and-forget; failures logged but don't fail the user's save).
 */

import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'
import { scanForRoutine } from '../lib/suggestionEngine.ts'

export const riderRoutinesRouter = Router()

interface RoutineRow {
  id: string
  user_id: string
  route_name: string
  day_of_week: number[]
  departure_time: string | null
  arrival_time: string | null
  is_active: boolean
  end_date: string | null
  route_polyline: string | null
  note: string | null
  created_at: string
  // PostGIS columns come back as GeoJSON Points.
  origin: { type: string; coordinates: [number, number] } | null
  destination: { type: string; coordinates: [number, number] } | null
}

interface CreateBody {
  route_name: string
  origin_lat: number
  origin_lng: number
  origin_address?: string | null
  dest_lat: number
  dest_lng: number
  dest_address?: string | null
  destination_bearing: number
  day_of_week: number[]
  departure_time?: string | null
  arrival_time?: string | null
  direction_type?: 'one_way' | 'roundtrip'
  end_date?: string | null
  route_polyline?: string | null
  note?: string | null
}

interface UpdateBody {
  route_name?: string
  day_of_week?: number[]
  departure_time?: string | null
  arrival_time?: string | null
  is_active?: boolean
  end_date?: string | null
  route_polyline?: string | null
  note?: string | null
}

/**
 * GET /api/rider-routines — list the caller's own routines.
 */
riderRoutinesRouter.get(
  '/',
  validateJwt,
  async (_req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const { data, error } = await supabaseAdmin
      .from('rider_routines')
      .select('id, user_id, route_name, day_of_week, departure_time, arrival_time, is_active, end_date, route_polyline, note, origin, destination, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) { next(error); return }
    res.status(200).json({ routines: data ?? [] })
  },
)

/**
 * POST /api/rider-routines — create a new routine and fire a
 * suggestion scan in the background. Caller-supplied lat/lng are
 * converted to PostGIS POINTs via WKT.
 */
riderRoutinesRouter.post(
  '/',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const body = req.body as CreateBody

    if (!body.route_name
        || body.origin_lat == null || body.origin_lng == null
        || body.dest_lat == null || body.dest_lng == null
        || body.destination_bearing == null
        || !Array.isArray(body.day_of_week) || body.day_of_week.length === 0) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'route_name, origin/dest lat-lng, destination_bearing, day_of_week required' },
      })
      return
    }

    const originWkt = `POINT(${body.origin_lng} ${body.origin_lat})`
    const destWkt = `POINT(${body.dest_lng} ${body.dest_lat})`

    const { data, error } = await supabaseAdmin
      .from('rider_routines')
      .insert({
        user_id: userId,
        route_name: body.route_name,
        origin: originWkt,
        destination: destWkt,
        origin_address: body.origin_address ?? null,
        dest_address: body.dest_address ?? null,
        destination_bearing: body.destination_bearing,
        direction_type: body.direction_type ?? 'one_way',
        day_of_week: body.day_of_week,
        departure_time: body.departure_time ?? null,
        arrival_time: body.arrival_time ?? null,
        end_date: body.end_date ?? null,
        route_polyline: body.route_polyline ?? null,
        note: body.note ?? null,
      } as never)
      .select('id')
      .single()

    if (error) { next(error); return }

    const created = data as unknown as { id: string }

    // Fire-and-forget — don't make the user wait on matching.
    void scanForRoutine(created.id, 'rider').catch((err: unknown) => {
      console.error('[riderRoutines] scanForRoutine failed:', err)
    })

    res.status(201).json({ id: created.id })
  },
)

/**
 * PUT /api/rider-routines/:id — update a routine. Re-scans afterwards
 * so a changed time/day produces fresh suggestions and stale ones
 * eventually expire.
 */
riderRoutinesRouter.put(
  '/:id',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const id = req.params['id']
    if (!id) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: 'id required' } })
      return
    }
    const body = req.body as UpdateBody

    // Ownership check — supabaseAdmin bypasses RLS.
    const { data: existing, error: lookupErr } = await supabaseAdmin
      .from('rider_routines')
      .select('user_id')
      .eq('id', id)
      .maybeSingle()
    if (lookupErr) { next(lookupErr); return }
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'routine not found' } })
      return
    }
    if ((existing as unknown as { user_id: string }).user_id !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'not your routine' } })
      return
    }

    const updates: Record<string, unknown> = {}
    if (body.route_name !== undefined) updates['route_name'] = body.route_name
    if (body.day_of_week !== undefined) updates['day_of_week'] = body.day_of_week
    if (body.departure_time !== undefined) updates['departure_time'] = body.departure_time
    if (body.arrival_time !== undefined) updates['arrival_time'] = body.arrival_time
    if (body.is_active !== undefined) updates['is_active'] = body.is_active
    if (body.end_date !== undefined) updates['end_date'] = body.end_date
    if (body.route_polyline !== undefined) updates['route_polyline'] = body.route_polyline
    if (body.note !== undefined) updates['note'] = body.note

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: 'no fields to update' } })
      return
    }

    const { error: updateErr } = await supabaseAdmin
      .from('rider_routines')
      .update(updates as never)
      .eq('id', id)

    if (updateErr) { next(updateErr); return }

    // Fire-and-forget re-scan.
    void scanForRoutine(String(id), 'rider').catch((err: unknown) => {
      console.error('[riderRoutines] scanForRoutine (PUT) failed:', err)
    })

    res.status(200).json({ ok: true })
  },
)

/**
 * DELETE /api/rider-routines/:id — delete a routine. ON DELETE CASCADE
 * on ride_suggestions.rider_routine_id cleans up dependent suggestions.
 */
riderRoutinesRouter.delete(
  '/:id',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const id = req.params['id']
    if (!id) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: 'id required' } })
      return
    }

    const { data: existing, error: lookupErr } = await supabaseAdmin
      .from('rider_routines')
      .select('user_id')
      .eq('id', id)
      .maybeSingle()
    if (lookupErr) { next(lookupErr); return }
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'routine not found' } })
      return
    }
    if ((existing as unknown as { user_id: string }).user_id !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'not your routine' } })
      return
    }

    const { error: deleteErr } = await supabaseAdmin
      .from('rider_routines')
      .delete()
      .eq('id', id)

    if (deleteErr) { next(deleteErr); return }
    res.status(200).json({ ok: true })
  },
)

// Avoid unused-type warnings when RoutineRow isn't referenced after edits.
export type { RoutineRow }
