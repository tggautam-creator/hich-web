/**
 * `/api/admin/rides/*` — admin-side ride visibility.
 *
 * 2026-05-23 — gives ops a single page to reconstruct what happened
 * on any ride: parties, route, status, full chat thread, payment
 * state, associated reports. Read-only for v1 (no force-cancel /
 * refund here — those live on `/admin/users/:id` already and the
 * detail page links across).
 *
 * Endpoints:
 *   GET /              — paginated inbox with filters
 *   GET /:id           — fat detail (ride + parties + thread + payment + reports)
 *
 * Auth gate is inherited from the parent `adminRouter` (JWT +
 * adminAuth applied at mount time in `./index.ts`). Every detail
 * fetch writes an audit row — admins reading user-to-user private
 * messages MUST be traceable.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'
import { writeAuditLog } from '../../lib/adminAudit.ts'

export const adminRidesRouter = Router()

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function parseIdParam(req: Request, res: Response): string | null {
  const raw = req.params['id']
  const id = typeof raw === 'string' ? raw : ''
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'ride id must be a UUID' } })
    return null
  }
  return id
}

// ── GET / — paginated inbox ──────────────────────────────────────────────────
//
// Filters (all optional, AND-composed):
//   status       'requested' | 'accepted' | 'coordinating' | 'active' | 'completed' | 'cancelled'
//   date_from    ISO date — `created_at >= date_from`
//   date_to      ISO date — `created_at <  date_to + 1d` (inclusive)
//   q            substring match on rider/driver full_name OR email (case-insensitive)
//   has_report   'yes' — include only rides with ≥1 associated report
//
// Sort: newest first by created_at. No KPI block — counts roll up via
// status filter quickly enough that the admin can flip filters to
// see "how many active" / "how many cancelled today".

type RideStatus = 'requested' | 'accepted' | 'coordinating' | 'active' | 'completed' | 'cancelled'

const ALLOWED_STATUSES: ReadonlySet<RideStatus> = new Set([
  'requested',
  'accepted',
  'coordinating',
  'active',
  'completed',
  'cancelled',
])

interface InboxRow {
  id: string
  status: RideStatus
  rider_id: string
  rider_name: string | null
  rider_email: string | null
  driver_id: string | null
  driver_name: string | null
  driver_email: string | null
  origin_name: string | null
  destination_name: string | null
  fare_cents: number | null
  payment_status: string | null
  created_at: string
  started_at: string | null
  ended_at: string | null
  has_report: boolean
}

adminRidesRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = clampInt(req.query['limit'], 25, 1, 100)
      const offset = clampInt(req.query['offset'], 0, 0, 100_000)

      const statusRaw = (req.query['status'] as string | undefined)?.trim()
      const status: RideStatus | null =
        statusRaw && ALLOWED_STATUSES.has(statusRaw as RideStatus)
          ? (statusRaw as RideStatus)
          : null

      const dateFrom = typeof req.query['date_from'] === 'string' ? req.query['date_from'] : ''
      const dateToRaw = typeof req.query['date_to'] === 'string' ? req.query['date_to'] : ''
      const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : ''
      const hasReport = req.query['has_report'] === 'yes'

      // Step 1: query rides with the simple filters. Search by name/email
      // is a second hop because the rider/driver names live on `users`,
      // not on `rides`. We do the name lookup post-filter; for the
      // common case (no `q`) it's a single query.
      // NOTE: Supabase's typed select parser only handles single-line
      // strings — `+` concatenated multi-line selects deserialize to
      // GenericStringError. Keep this on one line.
      let ridesQuery = supabaseAdmin
        .from('rides')
        .select('id, status, rider_id, driver_id, origin_name, destination_name, fare_cents, payment_status, created_at, started_at, ended_at', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (status) {
        ridesQuery = ridesQuery.eq('status', status)
      }
      if (dateFrom) {
        ridesQuery = ridesQuery.gte('created_at', dateFrom)
      }
      if (dateToRaw) {
        // Treat date_to as inclusive end-of-day by bumping +1d.
        const d = new Date(dateToRaw)
        if (!Number.isNaN(d.getTime())) {
          d.setUTCDate(d.getUTCDate() + 1)
          ridesQuery = ridesQuery.lt('created_at', d.toISOString())
        }
      }

      // When `q` is set we pull a wider window (limit + offset
      // post-filter), then trim. Acceptable for v1 — the name index
      // doesn't exist on `rides`, and the admin search is low-rate.
      // When `q` is unset, this paginates server-side normally.
      const fetchLimit = q ? Math.min(500, limit * 6) : limit
      const fetchOffset = q ? 0 : offset
      ridesQuery = ridesQuery.range(fetchOffset, fetchOffset + fetchLimit - 1)

      const { data: rides, error: ridesErr, count } = await ridesQuery
      if (ridesErr) throw ridesErr
      const rideRows = rides ?? []
      if (rideRows.length === 0) {
        res.status(200).json({ ok: true, rides: [], total: count ?? 0, limit, offset })
        return
      }

      // Step 2: enrich with rider + driver basic info.
      const userIds = new Set<string>()
      for (const r of rideRows) {
        userIds.add(r.rider_id)
        if (r.driver_id) userIds.add(r.driver_id)
      }
      const { data: users, error: usersErr } = await supabaseAdmin
        .from('users')
        .select('id, full_name, email')
        .in('id', Array.from(userIds))
      if (usersErr) throw usersErr
      const userMap = new Map<string, { full_name: string | null; email: string | null }>()
      for (const u of users ?? []) {
        userMap.set(u.id, { full_name: u.full_name, email: u.email })
      }

      // Step 3: has_report flag — one query that counts reports per
      // ride. Cheaper than a per-row probe.
      const reportRideIds = new Set<string>()
      const { data: reports } = await supabaseAdmin
        .from('reports')
        .select('ride_id')
        .in('ride_id', rideRows.map((r) => r.id))
        .not('ride_id', 'is', null)
      for (const rep of reports ?? []) {
        if (rep.ride_id) reportRideIds.add(rep.ride_id as string)
      }

      let enriched: InboxRow[] = rideRows.map((r) => {
        const rider = userMap.get(r.rider_id)
        const driver = r.driver_id ? userMap.get(r.driver_id) : null
        return {
          id: r.id,
          status: r.status as RideStatus,
          rider_id: r.rider_id,
          rider_name: rider?.full_name ?? null,
          rider_email: rider?.email ?? null,
          driver_id: r.driver_id ?? null,
          driver_name: driver?.full_name ?? null,
          driver_email: driver?.email ?? null,
          origin_name: r.origin_name ?? null,
          destination_name: r.destination_name ?? null,
          fare_cents: r.fare_cents ?? null,
          payment_status: r.payment_status ?? null,
          created_at: r.created_at,
          started_at: r.started_at ?? null,
          ended_at: r.ended_at ?? null,
          has_report: reportRideIds.has(r.id),
        }
      })

      // Step 4: apply post-filters (search + has_report).
      if (q) {
        const needle = q.toLowerCase()
        enriched = enriched.filter((row) => {
          return (
            (row.rider_name?.toLowerCase() ?? '').includes(needle) ||
            (row.rider_email?.toLowerCase() ?? '').includes(needle) ||
            (row.driver_name?.toLowerCase() ?? '').includes(needle) ||
            (row.driver_email?.toLowerCase() ?? '').includes(needle)
          )
        })
      }
      if (hasReport) {
        enriched = enriched.filter((row) => row.has_report)
      }

      // Step 5: re-paginate post-filter when we widened the window.
      const totalPostFilter = q ? enriched.length : (count ?? enriched.length)
      const paged = q ? enriched.slice(offset, offset + limit) : enriched

      res.status(200).json({
        ok: true,
        rides: paged,
        total: totalPostFilter,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id — fat detail ────────────────────────────────────────────────────
//
// Returns everything a triage admin would want in one shot:
//   - ride                full row
//   - rider / driver      user mini-cards (incl. is_driver, suspended_at)
//   - schedule            if the ride originated from a board post
//   - vehicle             if linked
//   - messages            full thread sorted ASC (includes text +
//                         pickup_suggestion + dropoff_suggestion + etc.)
//   - payment             intent + charges from wallet_transactions
//   - reports             any reports filed against this ride
//
// Writes an audit row tagged `ride_viewed` so admin access is
// traceable. Required because this exposes private user-to-user
// chat content.

adminRidesRouter.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req, res)
      if (!id) return
      const adminId = res.locals['userId'] as string

      const { data: ride, error: rideErr } = await supabaseAdmin
        .from('rides')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (rideErr) throw rideErr
      if (!ride) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ride not found' } })
        return
      }

      const [riderRes, driverRes, vehicleRes, scheduleRes, messagesRes, paymentRes, reportsRes, auditRes, ratingsRes] =
        await Promise.all([
          supabaseAdmin
            .from('users')
            .select('id, email, full_name, avatar_url, is_driver, suspended_at')
            .eq('id', ride.rider_id)
            .maybeSingle(),
          ride.driver_id
            ? supabaseAdmin
                .from('users')
                .select('id, email, full_name, avatar_url, is_driver, suspended_at')
                .eq('id', ride.driver_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          ride.vehicle_id
            ? supabaseAdmin
                .from('vehicles')
                .select('id, make, model, year, color, plate')
                .eq('id', ride.vehicle_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          ride.schedule_id
            ? supabaseAdmin
                .from('ride_schedules')
                .select('id, user_id, mode, trip_date, trip_time, time_type, origin_address, dest_address, available_seats')
                .eq('id', ride.schedule_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          supabaseAdmin
            .from('messages')
            .select('id, ride_id, sender_id, content, type, meta, created_at')
            .eq('ride_id', id)
            .order('created_at', { ascending: true }),
          supabaseAdmin
            .from('wallet_transactions')
            .select('id, user_id, kind, amount_cents, payment_source, created_at, meta')
            .eq('ride_id', id)
            .order('created_at', { ascending: true }),
          supabaseAdmin
            .from('reports')
            .select('id, reporter_id, severity, status, title, created_at')
            .eq('ride_id', id)
            .order('created_at', { ascending: true }),
          // 2026-05-23 — migration 094 ride_audit_log. Returns the
          // chronological list of status / pickup_confirmed /
          // dropoff_confirmed / driver_id / payment_status /
          // fare_cents flips. Client interleaves these into the
          // thread timeline so the admin sees "what happened, in
          // what order" not just "current state."
          supabaseAdmin
            .from('ride_audit_log')
            .select('id, field, old_value, new_value, changed_by, created_at')
            .eq('ride_id', id)
            .order('created_at', { ascending: true }),
          // 2026-05-23 — blind two-sided ratings (migration 014).
          // Returns at most 2 rows (rider→driver + driver→rider).
          // The admin sees both regardless of whether each party
          // submitted — the page renders an "awaiting" stub when
          // only one side rated.
          supabaseAdmin
            .from('ride_ratings')
            .select('id, rater_id, rated_id, stars, tags, comment, created_at')
            .eq('ride_id', id)
            .order('created_at', { ascending: true }),
        ])

      // Audit-trail the view. Non-blocking — if the audit insert fails
      // we still return the data. Target = the rider since the admin
      // is most often investigating an issue THEY reported; secondary
      // info (driver, ride id, status) lives in the payload for later
      // forensics. The writeAuditLog helper swallows its own errors
      // by design (see adminAudit.ts header).
      void writeAuditLog({
        adminId,
        targetUserId: ride.rider_id,
        action: 'ride_viewed',
        payload: {
          ride_id: id,
          driver_id: ride.driver_id ?? null,
          ride_status: ride.status,
        },
      })

      res.status(200).json({
        ok: true,
        ride,
        rider: riderRes.data ?? null,
        driver: driverRes.data ?? null,
        vehicle: vehicleRes.data ?? null,
        schedule: scheduleRes.data ?? null,
        messages: messagesRes.data ?? [],
        payment: paymentRes.data ?? [],
        reports: reportsRes.data ?? [],
        audit_log: auditRes.data ?? [],
        ratings: ratingsRes.data ?? [],
      })
    } catch (err) {
      next(err)
    }
  },
)
