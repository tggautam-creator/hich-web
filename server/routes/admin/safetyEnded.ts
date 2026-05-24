/**
 * `/api/admin/safety-ended/*` — admin review queue for rides ended
 * via the v1.2 Phase 3 safety net.
 *
 * 2026-05-24 — closes the Phase 3 ops loop: the divergence cron and
 * the /safety-end endpoint can both fire `safety_ended`, but until
 * now those rides just piled up in the DB with no review surface.
 *
 * Endpoint:
 *   GET /api/admin/safety-ended?reason=auto_divergence|auto_idle|user_button|manual|all
 *                              &limit=&offset=
 *
 * Auth gate inherited from the parent adminRouter (JWT + adminAuth).
 *
 * Returned rows mirror the columns migration 096 adds plus enrichment
 * (rider/driver name + email, ride origin/destination, GPS-at-end).
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'

export const adminSafetyEndedRouter = Router()

type ReasonFilter =
  | 'auto_divergence'
  | 'auto_idle'
  | 'user_button'  // synthetic — covers rider_safety_button + driver_safety_button
  | 'manual'       // covers manual_end
  | 'all'

interface SafetyEndedRow {
  id: string
  rider_id: string | null
  driver_id: string | null
  started_at: string | null
  ended_at: string | null
  fare_cents: number | null
  payment_status: string | null
  end_reason: string | null
  divergence_state: string | null
  divergence_first_seen_at: string | null
  warning_fired_at: string | null
  warning_push_count: number | null
  warning_responded_by: string | null
  warning_responded_at: string | null
  warning_responded_role: string | null
  help_sms_sent_at: string | null
  gps_distance_metres: number | null
  last_driver_gps_lat: number | null
  last_driver_gps_lng: number | null
  last_rider_gps_lat: number | null
  last_rider_gps_lng: number | null
  rider_name: string | null
  rider_email: string | null
  driver_name: string | null
  driver_email: string | null
  origin_name: string | null
  destination_name: string | null
}

interface SafetyEndedResponse {
  ok: true
  rows: SafetyEndedRow[]
  total: number
  counts: {
    auto_divergence: number
    auto_idle: number
    user_button: number
    manual: number
  }
  limit: number
  offset: number
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/**
 * Map a `reason` filter token to the set of `end_reason` values it
 * covers. `user_button` is a synthetic UI bucket combining both
 * role-specific safety-button reasons.
 */
function endReasonsForFilter(reason: ReasonFilter): string[] | null {
  switch (reason) {
    case 'auto_divergence': return ['auto_divergence']
    case 'auto_idle':       return ['auto_idle']
    case 'user_button':     return ['rider_safety_button', 'driver_safety_button']
    case 'manual':          return ['manual_end']
    case 'all':             return null
  }
}

adminSafetyEndedRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = clampInt(req.query['limit'], 25, 1, 100)
      const offset = clampInt(req.query['offset'], 0, 0, 100_000)
      const reasonRaw = (req.query['reason'] as string | undefined)?.trim() ?? 'all'
      const reason: ReasonFilter =
        reasonRaw === 'auto_divergence'
          || reasonRaw === 'auto_idle'
          || reasonRaw === 'user_button'
          || reasonRaw === 'manual'
          ? reasonRaw
          : 'all'

      // 1. Page of safety-ended rides + total for the filter.
      // Filter is "divergence_state = 'safety_ended'" — that's how
      // `endRideForSafety` stamps every ride it processes, regardless
      // of whether the trigger was cron / user-button / manual. The
      // `end_reason` column distinguishes them.
      let query = supabaseAdmin
        .from('rides')
        .select(
          'id, rider_id, driver_id, started_at, ended_at, fare_cents, payment_status, '
          + 'end_reason, divergence_state, divergence_first_seen_at, '
          + 'warning_fired_at, warning_push_count, warning_responded_by, '
          + 'warning_responded_at, warning_responded_role, help_sms_sent_at, '
          + 'gps_distance_metres, last_driver_gps_lat, last_driver_gps_lng, '
          + 'last_rider_gps_lat, last_rider_gps_lng, origin_name, destination_name',
          { count: 'exact' },
        )
        .eq('divergence_state', 'safety_ended')
        .order('ended_at', { ascending: false, nullsFirst: false })

      const reasonList = endReasonsForFilter(reason)
      if (reasonList) {
        query = query.in('end_reason', reasonList)
      }
      query = query.range(offset, offset + limit - 1)

      const { data: rides, error: ridesErr, count } = await query
      if (ridesErr) throw ridesErr
      type RideRow = Omit<SafetyEndedRow, 'rider_name' | 'rider_email' | 'driver_name' | 'driver_email'>
      const rideRows = (rides ?? []) as unknown as RideRow[]

      // 2. KPI counts — separate cheap queries (head:true so we don't
      // pull rows). Lets the dashboard show a 4-tile breakdown of the
      // safety-ended queue by reason.
      const [autoDivCountRes, autoIdleCountRes, userBtnCountRes, manualCountRes] =
        await Promise.all([
          supabaseAdmin
            .from('rides')
            .select('id', { count: 'exact', head: true })
            .eq('divergence_state', 'safety_ended')
            .eq('end_reason', 'auto_divergence'),
          supabaseAdmin
            .from('rides')
            .select('id', { count: 'exact', head: true })
            .eq('divergence_state', 'safety_ended')
            .eq('end_reason', 'auto_idle'),
          supabaseAdmin
            .from('rides')
            .select('id', { count: 'exact', head: true })
            .eq('divergence_state', 'safety_ended')
            .in('end_reason', ['rider_safety_button', 'driver_safety_button']),
          supabaseAdmin
            .from('rides')
            .select('id', { count: 'exact', head: true })
            .eq('divergence_state', 'safety_ended')
            .eq('end_reason', 'manual_end'),
        ])
      if (autoDivCountRes.error) throw autoDivCountRes.error
      if (autoIdleCountRes.error) throw autoIdleCountRes.error
      if (userBtnCountRes.error) throw userBtnCountRes.error
      if (manualCountRes.error) throw manualCountRes.error

      // 3. Enrich with rider + driver names + emails. Single batched
      // lookup, no per-row N+1.
      const userIds = new Set<string>()
      for (const r of rideRows) {
        if (r.rider_id) userIds.add(r.rider_id)
        if (r.driver_id) userIds.add(r.driver_id)
      }
      const userIdList = Array.from(userIds)

      const usersRes = userIdList.length > 0
        ? await supabaseAdmin
            .from('users')
            .select('id, full_name, email')
            .in('id', userIdList)
        : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }>, error: null }
      if (usersRes.error) throw usersRes.error

      const userMap = new Map<string, { full_name: string | null; email: string | null }>()
      for (const u of usersRes.data ?? []) {
        userMap.set(u.id, { full_name: u.full_name, email: u.email })
      }

      const enriched: SafetyEndedRow[] = rideRows.map((r) => {
        const rider = r.rider_id ? userMap.get(r.rider_id) : null
        const driver = r.driver_id ? userMap.get(r.driver_id) : null
        return {
          ...r,
          rider_name: rider?.full_name ?? null,
          rider_email: rider?.email ?? null,
          driver_name: driver?.full_name ?? null,
          driver_email: driver?.email ?? null,
        }
      })

      const payload: SafetyEndedResponse = {
        ok: true,
        rows: enriched,
        total: count ?? enriched.length,
        counts: {
          auto_divergence: autoDivCountRes.count ?? 0,
          auto_idle: autoIdleCountRes.count ?? 0,
          user_button: userBtnCountRes.count ?? 0,
          manual: manualCountRes.count ?? 0,
        },
        limit,
        offset,
      }
      res.status(200).json(payload)
    } catch (err) {
      next(err)
    }
  },
)
