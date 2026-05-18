/**
 * `/api/admin/ride-board/*` — ride-board monitoring + actions.
 *
 * Surfaces the rider-side `ride_schedules` (posts) + `ride_offers`
 * (offers) so the admin can see who's offering whose ride today and
 * historically, drill into a post to see all offers, and force-cancel
 * a pending offer when needed.
 *
 * Permission gate is inherited from the parent `adminRouter`
 * (JWT + adminAuth applied at mount time in `./index.ts`).
 *
 * Endpoints:
 *   GET  /metrics                    → today's snapshot + warning counts
 *   GET  /posts                      → paginated ride_schedules
 *   GET  /posts/:id/offers           → all offers on a single post
 *   GET  /offers                     → paginated ride_offers
 *   POST /offers/:id/force-cancel    → flip pending → cancelled + audit
 *
 * Per-user "Notify" lives under `/users/:id/actions/notify`
 * (added to `./actions.ts`) so it shares the existing /actions/*
 * pattern + audit conventions.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'
import { writeAuditLog } from '../../lib/adminAudit.ts'

export const adminRideBoardRouter = Router()

// ── shared helpers ──────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function adminId(res: Response): string {
  return res.locals['userId'] as string
}

/** Snake_case `created_at` cutoff helpers — UTC ISO strings. */
function isoMinusDays(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

function isoStartOfTodayUTC(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/**
 * City extraction from a full-text address.
 *
 * Google Places addresses come back like:
 *   "Gallagher Hall, University of California - Davis, 530 Alumni Ln,
 *    Davis, CA 95616, United States"
 *
 * The naive "second-to-last segment" heuristic grabs the state+ZIP
 * ("CA 95616") because of the trailing country. So instead we walk
 * the segments from the END backwards, skipping known junk (country,
 * state+ZIP, bare ZIP, bare state code, street-like segments), and
 * return the FIRST segment we hit that isn't junk — that's the city.
 *
 * Examples:
 *   "Gallagher Hall, …, Davis, CA 95616, United States" → "Davis"
 *   "San Francisco Intl Airport, San Francisco, CA 94128, USA" → "San Francisco"
 *   "Davis, CA 95616, USA"                                     → "Davis"
 *   "123 Main St, Springfield, IL 62701"                       → "Springfield"
 *   "Mountain View, CA"                                        → "Mountain View"
 *   "Chautauqua"                                               → "Chautauqua"
 *   "Axis at Davis"                                            → "Axis at Davis"
 *
 * The last one (`"Axis at Davis"`) is technically a building name; we
 * keep it as-is because there's no comma to split on. The analytics
 * will show it as its own bucket — acceptable, since merging building
 * names into city names would require a real geocoding pipeline.
 */
function extractCity(address: string | null): string {
  if (!address) return 'Unknown'
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return 'Unknown'
  if (parts.length === 1) return parts[0] || 'Unknown'

  const COUNTRIES = new Set([
    'us', 'usa', 'u.s.', 'u.s.a.',
    'united states', 'united states of america',
    'canada', 'mexico',
  ])
  const isCountry = (s: string) => COUNTRIES.has(s.toLowerCase())
  // "CA 95616" or "CA 95616-1234"
  const isStateZip = (s: string) => /^[A-Z]{2}\s+\d{5}(-\d{4})?$/i.test(s)
  // Bare ZIP only: "95616" / "95616-1234"
  const isZipOnly = (s: string) => /^\d{5}(-\d{4})?$/.test(s)
  // Bare 2-letter state code: "CA"
  const isStateOnly = (s: string) => /^[A-Z]{2}$/.test(s)
  // Looks like a street: starts with a number OR contains a common
  // street suffix token (Ave, Blvd, St, Rd, Dr, Ln, Way, etc).
  const isStreet = (s: string) =>
    /^\d+\s/.test(s) ||
    /\b(St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Pkwy|Pl|Place|Ct|Court|Hwy|Highway|Cir|Circle)\.?\b/i.test(s)

  // Walk from the end. First non-junk segment is the city.
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (!p) continue
    if (isCountry(p) || isStateZip(p) || isZipOnly(p) || isStateOnly(p)) continue
    if (isStreet(p)) continue
    return p
  }
  return parts[0] || 'Unknown'
}

// ── GET /metrics ────────────────────────────────────────────────────────────
//
// Today's snapshot (UTC-aligned) + two attention counters the page surfaces
// as warning cards: unanswered posts (>7 days, 0 offers) and stale pending
// offers (>2 days). Each metric is a single COUNT(*) so the page mount is
// cheap even on a hot day.

adminRideBoardRouter.get(
  '/metrics',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const todayCutoff = isoStartOfTodayUTC()
      const sevenDaysAgo = isoMinusDays(7)
      const twoDaysAgo = isoMinusDays(2)

      // Run the counts in parallel — they don't depend on each other and
      // Supabase returns each as `count` on the response object.
      const [
        postsTodayRes,
        offersTodayRes,
        acceptsTodayRes,
        pendingTotalRes,
        staleOffersRes,
      ] = await Promise.all([
        supabaseAdmin
          .from('ride_schedules')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', todayCutoff),
        supabaseAdmin
          .from('ride_offers')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', todayCutoff),
        // Actual ride_offers.status values per migrations 018 + 026:
        //   'pending' | 'selected' | 'standby' | 'released'
        // 'selected' is the post-rider-accept state we surface here as
        // "accepts today" in the UI.
        supabaseAdmin
          .from('ride_offers')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', todayCutoff)
          .eq('status', 'selected'),
        supabaseAdmin
          .from('ride_offers')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabaseAdmin
          .from('ride_offers')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .lt('created_at', twoDaysAgo),
      ])

      // "Unanswered posts" needs a left-anti-join semantics that the
      // PostgREST surface doesn't expose directly. We fetch the post IDs
      // older than 7 days that have ZERO offers attached. Capped at 500
      // so a runaway count can't OOM the admin tab.
      const { data: olderPosts, error: olderPostsErr } = await supabaseAdmin
        .from('ride_schedules')
        .select('id')
        .lt('created_at', sevenDaysAgo)
        .limit(500)
      if (olderPostsErr) throw olderPostsErr

      let unansweredCount = 0
      if (olderPosts && olderPosts.length > 0) {
        const ids = olderPosts.map((r) => r.id)
        const { data: withOffers, error: offerLookupErr } = await supabaseAdmin
          .from('ride_offers')
          .select('schedule_id')
          .in('schedule_id', ids)
        if (offerLookupErr) throw offerLookupErr
        const answered = new Set((withOffers ?? []).map((r) => r.schedule_id))
        unansweredCount = ids.filter((id) => !answered.has(id)).length
      }

      res.status(200).json({
        ok: true,
        today: {
          posts: postsTodayRes.count ?? 0,
          offers: offersTodayRes.count ?? 0,
          accepts: acceptsTodayRes.count ?? 0,
        },
        warnings: {
          unanswered_posts_over_7d: unansweredCount,
          pending_offers_over_2d: staleOffersRes.count ?? 0,
          pending_offers_total: pendingTotalRes.count ?? 0,
        },
        as_of: new Date().toISOString(),
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /posts ──────────────────────────────────────────────────────────────
//
// Paginated list of ride_schedules. Filters:
//   - mode      'rider' | 'driver' | (omit for both)
//   - status    'all' (default) — board has no status column today, the
//               admin UI uses this slot to filter by offer state instead
//               (e.g. "show posts with no offers"). Kept for future use.
//   - date_from / date_to  ISO date strings; filters created_at
//
// Pagination is LIMIT/OFFSET. Cursor would be nicer for huge tables but
// the board is currently small enough that offset is fine.

adminRideBoardRouter.get(
  '/posts',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const mode = typeof req.query['mode'] === 'string' ? req.query['mode'] : null
      const dateFrom = typeof req.query['date_from'] === 'string' ? req.query['date_from'] : null
      const dateTo = typeof req.query['date_to'] === 'string' ? req.query['date_to'] : null
      const limit = clampInt(req.query['limit'], 50, 1, 200)
      const offset = clampInt(req.query['offset'], 0, 0, 50_000)

      let query = supabaseAdmin
        .from('ride_schedules')
        .select(
          'id, user_id, origin_address, dest_address, trip_date, trip_time, mode, created_at',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (mode === 'rider' || mode === 'driver') query = query.eq('mode', mode)
      if (dateFrom) query = query.gte('created_at', dateFrom)
      if (dateTo) query = query.lte('created_at', dateTo)

      const { data, error, count } = await query
      if (error) throw error

      // Decorate each row with poster info + offer count. Two follow-up
      // queries keep the response self-contained for the UI (no extra
      // /users/:id hits per row).
      const posterIds = Array.from(new Set((data ?? []).map((r) => r.user_id)))
      const posterById = new Map<string, { full_name: string | null; email: string }>()
      if (posterIds.length > 0) {
        const { data: posterRows, error: posterErr } = await supabaseAdmin
          .from('users')
          .select('id, full_name, email')
          .in('id', posterIds)
        if (posterErr) throw posterErr
        for (const u of posterRows ?? []) {
          posterById.set(u.id, { full_name: u.full_name, email: u.email })
        }
      }

      const scheduleIds = (data ?? []).map((r) => r.id)
      const offerCountByScheduleId = new Map<string, number>()
      if (scheduleIds.length > 0) {
        const { data: offerRows, error: offerErr } = await supabaseAdmin
          .from('ride_offers')
          .select('schedule_id')
          .in('schedule_id', scheduleIds)
        if (offerErr) throw offerErr
        for (const r of offerRows ?? []) {
          if (!r.schedule_id) continue
          offerCountByScheduleId.set(
            r.schedule_id,
            (offerCountByScheduleId.get(r.schedule_id) ?? 0) + 1,
          )
        }
      }

      res.status(200).json({
        ok: true,
        posts: (data ?? []).map((r) => ({
          id: r.id,
          user_id: r.user_id,
          poster_name: posterById.get(r.user_id)?.full_name ?? null,
          poster_email: posterById.get(r.user_id)?.email ?? null,
          origin_address: r.origin_address,
          dest_address: r.dest_address,
          trip_date: r.trip_date,
          trip_time: r.trip_time,
          mode: r.mode,
          offer_count: offerCountByScheduleId.get(r.id) ?? 0,
          created_at: r.created_at,
        })),
        total: count ?? 0,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /posts/:id/offers ────────────────────────────────────────────────────
//
// Drill-down: every offer for a single schedule. Used by the admin UI's
// "view offers" modal.

adminRideBoardRouter.get(
  '/posts/:id/offers',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        res.status(400).json({
          error: { code: 'INVALID_ID', message: 'post id must be a UUID' },
        })
        return
      }

      const { data: offers, error } = await supabaseAdmin
        .from('ride_offers')
        .select('id, driver_id, status, proposed_pickup_name, proposed_dropoff_name, proposed_fare_cents, estimated_fare_cents, proposed_transit_line_name, overlap_pct, created_at')
        .eq('schedule_id', id)
        .order('created_at', { ascending: false })
      if (error) throw error

      // Hydrate driver names so the UI can show "BunHieng (driver)"
      // without firing N extra lookups.
      const driverIds = Array.from(new Set((offers ?? []).map((r) => r.driver_id)))
      const driverById = new Map<string, { full_name: string | null; email: string }>()
      if (driverIds.length > 0) {
        const { data: driverRows, error: driverErr } = await supabaseAdmin
          .from('users')
          .select('id, full_name, email')
          .in('id', driverIds)
        if (driverErr) throw driverErr
        for (const u of driverRows ?? []) {
          driverById.set(u.id, { full_name: u.full_name, email: u.email })
        }
      }

      res.status(200).json({
        ok: true,
        offers: (offers ?? []).map((r) => ({
          id: r.id,
          driver_id: r.driver_id,
          driver_name: driverById.get(r.driver_id)?.full_name ?? null,
          driver_email: driverById.get(r.driver_id)?.email ?? null,
          status: r.status,
          proposed_pickup_name: r.proposed_pickup_name,
          proposed_dropoff_name: r.proposed_dropoff_name,
          proposed_fare_cents: r.proposed_fare_cents,
          estimated_fare_cents: r.estimated_fare_cents,
          proposed_transit_line_name: r.proposed_transit_line_name,
          overlap_pct: r.overlap_pct,
          created_at: r.created_at,
        })),
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /offers ─────────────────────────────────────────────────────────────
//
// Paginated list of ALL ride_offers (across all posts). Filters:
//   - status    'pending' | 'accepted' | 'declined' | 'withdrawn' | 'cancelled'
//   - date_from / date_to  ISO strings on created_at

adminRideBoardRouter.get(
  '/offers',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const VALID_STATUSES = ['pending', 'selected', 'standby', 'released'] as const
      type OfferStatus = typeof VALID_STATUSES[number]
      const statusRaw = typeof req.query['status'] === 'string' ? req.query['status'] : null
      const status: OfferStatus | null =
        statusRaw && (VALID_STATUSES as readonly string[]).includes(statusRaw)
          ? (statusRaw as OfferStatus)
          : null
      const dateFrom = typeof req.query['date_from'] === 'string' ? req.query['date_from'] : null
      const dateTo = typeof req.query['date_to'] === 'string' ? req.query['date_to'] : null
      const limit = clampInt(req.query['limit'], 50, 1, 200)
      const offset = clampInt(req.query['offset'], 0, 0, 50_000)

      let query = supabaseAdmin
        .from('ride_offers')
        .select('id, driver_id, schedule_id, status, proposed_pickup_name, proposed_dropoff_name, proposed_fare_cents, estimated_fare_cents, proposed_transit_line_name, overlap_pct, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (status) query = query.eq('status', status)
      if (dateFrom) query = query.gte('created_at', dateFrom)
      if (dateTo) query = query.lte('created_at', dateTo)

      const { data: offers, error, count } = await query
      if (error) throw error

      // Hydrate driver + the post's poster info so each row reads
      // "BunHieng → Krishna's UC Davis trip" without per-row fetches.
      const driverIds = Array.from(new Set((offers ?? []).map((r) => r.driver_id)))
      const scheduleIds = Array.from(
        new Set((offers ?? []).map((r) => r.schedule_id).filter((s): s is string => !!s)),
      )

      const [driverRowsRes, scheduleRowsRes] = await Promise.all([
        driverIds.length > 0
          ? supabaseAdmin.from('users').select('id, full_name, email').in('id', driverIds)
          : Promise.resolve({ data: [], error: null }),
        scheduleIds.length > 0
          ? supabaseAdmin
              .from('ride_schedules')
              .select('id, user_id, origin_address, dest_address, trip_date, trip_time')
              .in('id', scheduleIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (driverRowsRes.error) throw driverRowsRes.error
      if (scheduleRowsRes.error) throw scheduleRowsRes.error

      const driverById = new Map<string, { full_name: string | null; email: string }>()
      for (const u of driverRowsRes.data ?? []) {
        driverById.set(u.id, { full_name: u.full_name, email: u.email })
      }

      // Hydrate poster info from the schedules + a follow-up users
      // fetch so each offer row can show "→ Krishna" without N+1.
      const posterIds = Array.from(
        new Set((scheduleRowsRes.data ?? []).map((s) => s.user_id)),
      )
      const posterById = new Map<string, { full_name: string | null; email: string }>()
      if (posterIds.length > 0) {
        const { data: posterRows, error: posterErr } = await supabaseAdmin
          .from('users')
          .select('id, full_name, email')
          .in('id', posterIds)
        if (posterErr) throw posterErr
        for (const u of posterRows ?? []) {
          posterById.set(u.id, { full_name: u.full_name, email: u.email })
        }
      }
      const scheduleById = new Map<string, {
        user_id: string
        origin_address: string | null
        dest_address: string | null
        trip_date: string | null
        trip_time: string | null
      }>()
      for (const s of scheduleRowsRes.data ?? []) {
        scheduleById.set(s.id, {
          user_id: s.user_id,
          origin_address: s.origin_address,
          dest_address: s.dest_address,
          trip_date: s.trip_date,
          trip_time: s.trip_time,
        })
      }

      res.status(200).json({
        ok: true,
        offers: (offers ?? []).map((r) => {
          const schedule = r.schedule_id ? scheduleById.get(r.schedule_id) : null
          const poster = schedule ? posterById.get(schedule.user_id) : null
          return {
            id: r.id,
            driver_id: r.driver_id,
            driver_name: driverById.get(r.driver_id)?.full_name ?? null,
            driver_email: driverById.get(r.driver_id)?.email ?? null,
            schedule_id: r.schedule_id,
            poster_id: schedule?.user_id ?? null,
            poster_name: poster?.full_name ?? null,
            poster_email: poster?.email ?? null,
            origin_address: schedule?.origin_address ?? null,
            dest_address: schedule?.dest_address ?? null,
            trip_date: schedule?.trip_date ?? null,
            trip_time: schedule?.trip_time ?? null,
            status: r.status,
            proposed_pickup_name: r.proposed_pickup_name,
            proposed_dropoff_name: r.proposed_dropoff_name,
            proposed_fare_cents: r.proposed_fare_cents,
            estimated_fare_cents: r.estimated_fare_cents,
            proposed_transit_line_name: r.proposed_transit_line_name,
            overlap_pct: r.overlap_pct,
            created_at: r.created_at,
          }
        }),
        total: count ?? 0,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /offers/:id/force-cancel ───────────────────────────────────────────
//
// Admin-only safety valve for stuck pending offers. Only operates on
// `status='pending'` — accepted/declined/withdrawn already represent a
// terminal state that needs a different code path (refund, ride cancel)
// and we deliberately keep that out of this slice to avoid touching
// money flow from the admin panel.

interface ForceCancelBody {
  reason?: unknown
}

adminRideBoardRouter.post(
  '/offers/:id/force-cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        res.status(400).json({
          error: { code: 'INVALID_ID', message: 'offer id must be a UUID' },
        })
        return
      }

      const b = req.body as ForceCancelBody
      const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
      if (reason.length > 500) {
        res.status(400).json({
          error: { code: 'REASON_TOO_LONG', message: 'reason ≤ 500 chars' },
        })
        return
      }

      // Load the offer first so we can:
      //   1. Reject anything that isn't pending (status guard)
      //   2. Snapshot the prior state into the audit row
      const { data: offer, error: lookupErr } = await supabaseAdmin
        .from('ride_offers')
        .select('id, status, driver_id, schedule_id')
        .eq('id', id)
        .maybeSingle()
      if (lookupErr) throw lookupErr
      if (!offer) {
        res.status(404).json({
          error: { code: 'OFFER_NOT_FOUND', message: 'offer does not exist' },
        })
        return
      }
      if (offer.status !== 'pending') {
        res.status(409).json({
          error: {
            code: 'NOT_PENDING',
            message: `cannot force-cancel an offer with status='${offer.status}' — only pending offers are supported by this endpoint`,
          },
        })
        return
      }

      // ride_offers.status CHECK constraint doesn't include 'cancelled' —
      // valid values are pending | selected | standby | released. We use
      // 'released' as the terminal cancel state (same as a driver-side
      // withdrawal). The audit row records this was an admin-driven
      // force-cancel, so we can distinguish from a regular withdrawal
      // when reading admin_audit_log.
      const { error: updateErr } = await supabaseAdmin
        .from('ride_offers')
        .update({ status: 'released' })
        .eq('id', id)
        .eq('status', 'pending') // belt + suspenders against a concurrent flip
      if (updateErr) throw updateErr

      await writeAuditLog({
        adminId: adminId(res),
        targetUserId: offer.driver_id,
        action: 'force_cancel_offer',
        payload: {
          offer_id: id,
          prior_status: offer.status,
          schedule_id: offer.schedule_id ?? null,
          reason: reason || null,
        },
      })

      res.status(200).json({ ok: true, offer_id: id, prior_status: offer.status })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /funnel ─────────────────────────────────────────────────────────────
//
// Posts → at-least-1-offer → at-least-1-selected → completed-ride.
// Computed over the last 30 days (matches the typical "this month"
// dashboard horizon). Two breakdowns are returned:
//   - by_mode:    rider-posts funnel vs driver-posts funnel
//   - by_week:    weekly buckets so the page can chart a 4-week trend

interface FunnelStage {
  stage: 'posted' | 'offered' | 'selected' | 'completed'
  count: number
}

adminRideBoardRouter.get(
  '/funnel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const windowDays = clampInt(req.query['window'], 30, 1, 365)
      const cutoff = isoMinusDays(windowDays)

      // Pull the post IDs in the window first; everything else joins
      // back to them. We need the actual IDs (not just a count) so we
      // can compute "posts that got ≥1 offer" via set membership.
      const { data: postRows, error: postsErr } = await supabaseAdmin
        .from('ride_schedules')
        .select('id, mode, created_at')
        .gte('created_at', cutoff)
      if (postsErr) throw postsErr
      const posts = postRows ?? []
      const postIds = posts.map((p) => p.id)

      let offers: { schedule_id: string | null; status: string; ride_id: string | null }[] = []
      if (postIds.length > 0) {
        const { data: offerRows, error: offersErr } = await supabaseAdmin
          .from('ride_offers')
          .select('schedule_id, status, ride_id')
          .in('schedule_id', postIds)
        if (offersErr) throw offersErr
        offers = offerRows ?? []
      }

      // Bucket offers by schedule_id for fast lookup.
      const offerBySchedule = new Map<string, { hasAny: boolean; hasSelected: boolean; selectedRideId: string | null }>()
      for (const o of offers) {
        if (!o.schedule_id) continue
        const bucket = offerBySchedule.get(o.schedule_id) ?? {
          hasAny: false,
          hasSelected: false,
          selectedRideId: null,
        }
        bucket.hasAny = true
        if (o.status === 'selected') {
          bucket.hasSelected = true
          if (o.ride_id) bucket.selectedRideId = o.ride_id
        }
        offerBySchedule.set(o.schedule_id, bucket)
      }

      // For the "completed" stage we need to look up the rides table
      // for the selected offers' ride_ids and check status='completed'.
      const selectedRideIds = Array.from(
        new Set(
          Array.from(offerBySchedule.values())
            .map((b) => b.selectedRideId)
            .filter((id): id is string => !!id),
        ),
      )
      const completedRideIds = new Set<string>()
      if (selectedRideIds.length > 0) {
        const { data: rideRows, error: rideErr } = await supabaseAdmin
          .from('rides')
          .select('id, status')
          .in('id', selectedRideIds)
          .eq('status', 'completed')
        if (rideErr) throw rideErr
        for (const r of rideRows ?? []) completedRideIds.add(r.id)
      }

      // Roll up per post: did it advance to each stage?
      function rollup(forPosts: typeof posts): FunnelStage[] {
        let offered = 0
        let selected = 0
        let completed = 0
        for (const p of forPosts) {
          const b = offerBySchedule.get(p.id)
          if (!b) continue
          if (b.hasAny) offered++
          if (b.hasSelected) selected++
          if (b.selectedRideId && completedRideIds.has(b.selectedRideId)) completed++
        }
        return [
          { stage: 'posted', count: forPosts.length },
          { stage: 'offered', count: offered },
          { stage: 'selected', count: selected },
          { stage: 'completed', count: completed },
        ]
      }

      const overall = rollup(posts)
      const byMode = {
        rider: rollup(posts.filter((p) => p.mode === 'rider')),
        driver: rollup(posts.filter((p) => p.mode === 'driver')),
      }

      // Weekly buckets — last N/7 weeks, oldest first.
      const weeks: { week_start: string; posted: number; offered: number; selected: number; completed: number }[] = []
      const totalWeeks = Math.max(1, Math.ceil(windowDays / 7))
      for (let i = totalWeeks - 1; i >= 0; i--) {
        const weekStart = new Date()
        weekStart.setUTCDate(weekStart.getUTCDate() - (i + 1) * 7)
        weekStart.setUTCHours(0, 0, 0, 0)
        const weekEnd = new Date(weekStart)
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)
        const inWeek = posts.filter((p) => {
          const t = new Date(p.created_at).getTime()
          return t >= weekStart.getTime() && t < weekEnd.getTime()
        })
        const r = rollup(inWeek)
        weeks.push({
          week_start: weekStart.toISOString().slice(0, 10),
          posted: r[0]?.count ?? 0,
          offered: r[1]?.count ?? 0,
          selected: r[2]?.count ?? 0,
          completed: r[3]?.count ?? 0,
        })
      }

      res.status(200).json({
        ok: true,
        window_days: windowDays,
        overall,
        by_mode: byMode,
        by_week: weeks,
        as_of: new Date().toISOString(),
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /cities ─────────────────────────────────────────────────────────────
//
// Geographic rollup. Three sections:
//   - top_routes:        (origin_city, dest_city, mode) ranked by post count
//   - unmatched_demand:  rider-mode posts with 0 offers, grouped by route
//   - unmatched_supply:  driver-mode posts with 0 offers, grouped by route
//
// All within the configured window (default 30 days).

interface RouteRow {
  origin_city: string
  dest_city: string
  mode: 'rider' | 'driver'
  post_count: number
  matched_count: number // posts that got ≥1 selected offer
  match_rate: number    // 0–1
}

interface UnmatchedRow {
  origin_city: string
  dest_city: string
  post_count: number
}

adminRideBoardRouter.get(
  '/cities',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const windowDays = clampInt(req.query['window'], 30, 1, 365)
      const cutoff = isoMinusDays(windowDays)

      const { data: posts, error: postsErr } = await supabaseAdmin
        .from('ride_schedules')
        .select('id, mode, origin_address, dest_address')
        .gte('created_at', cutoff)
      if (postsErr) throw postsErr

      const postIds = (posts ?? []).map((p) => p.id)
      let offers: { schedule_id: string | null; status: string }[] = []
      if (postIds.length > 0) {
        const { data: offerRows, error: offerErr } = await supabaseAdmin
          .from('ride_offers')
          .select('schedule_id, status')
          .in('schedule_id', postIds)
        if (offerErr) throw offerErr
        offers = offerRows ?? []
      }
      const hadAnyOffer = new Set<string>()
      const hadSelected = new Set<string>()
      for (const o of offers) {
        if (!o.schedule_id) continue
        hadAnyOffer.add(o.schedule_id)
        if (o.status === 'selected') hadSelected.add(o.schedule_id)
      }

      // Roll up per (origin_city, dest_city, mode).
      const routeMap = new Map<string, RouteRow>()
      const unmatchedRider = new Map<string, UnmatchedRow>()
      const unmatchedDriver = new Map<string, UnmatchedRow>()

      for (const p of posts ?? []) {
        const origin = extractCity(p.origin_address)
        const dest = extractCity(p.dest_address)
        const mode = (p.mode === 'rider' || p.mode === 'driver') ? p.mode : null
        if (!mode) continue
        const key = `${origin}|||${dest}|||${mode}`
        const existing = routeMap.get(key) ?? {
          origin_city: origin,
          dest_city: dest,
          mode,
          post_count: 0,
          matched_count: 0,
          match_rate: 0,
        }
        existing.post_count += 1
        if (hadSelected.has(p.id)) existing.matched_count += 1
        existing.match_rate = existing.matched_count / existing.post_count
        routeMap.set(key, existing)

        // Unmatched buckets: posts in the window that received zero offers.
        if (!hadAnyOffer.has(p.id)) {
          const uKey = `${origin}|||${dest}`
          if (mode === 'rider') {
            const e = unmatchedRider.get(uKey) ?? { origin_city: origin, dest_city: dest, post_count: 0 }
            e.post_count += 1
            unmatchedRider.set(uKey, e)
          } else {
            const e = unmatchedDriver.get(uKey) ?? { origin_city: origin, dest_city: dest, post_count: 0 }
            e.post_count += 1
            unmatchedDriver.set(uKey, e)
          }
        }
      }

      const topRoutes = Array.from(routeMap.values())
        .sort((a, b) => b.post_count - a.post_count)
        .slice(0, 25)
      const unmatchedDemand = Array.from(unmatchedRider.values())
        .sort((a, b) => b.post_count - a.post_count)
        .slice(0, 15)
      const unmatchedSupply = Array.from(unmatchedDriver.values())
        .sort((a, b) => b.post_count - a.post_count)
        .slice(0, 15)

      res.status(200).json({
        ok: true,
        window_days: windowDays,
        top_routes: topRoutes,
        unmatched_demand: unmatchedDemand,
        unmatched_supply: unmatchedSupply,
        as_of: new Date().toISOString(),
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /time-patterns ──────────────────────────────────────────────────────
//
// Two payloads:
//   - hour_day_heatmap:  7×24 grid of post counts (Sun-Sat × 0-23)
//   - daily_trend:       per-day post + offer + selected counts for the
//                         last `window` days (default 14)

adminRideBoardRouter.get(
  '/time-patterns',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const windowDays = clampInt(req.query['window'], 14, 1, 90)
      const cutoff = isoMinusDays(windowDays)
      // Heatmap uses a longer window (30d) so weekday patterns are
      // stable even when the trend window is short.
      const heatmapCutoff = isoMinusDays(Math.max(windowDays, 30))

      const [postsRes, heatmapPostsRes, offersRes] = await Promise.all([
        supabaseAdmin
          .from('ride_schedules')
          .select('created_at')
          .gte('created_at', cutoff),
        supabaseAdmin
          .from('ride_schedules')
          .select('created_at')
          .gte('created_at', heatmapCutoff),
        supabaseAdmin
          .from('ride_offers')
          .select('created_at, status')
          .gte('created_at', cutoff),
      ])
      if (postsRes.error) throw postsRes.error
      if (heatmapPostsRes.error) throw heatmapPostsRes.error
      if (offersRes.error) throw offersRes.error

      // Heatmap: 7 days × 24 hours, all zeros initially.
      const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
      for (const row of heatmapPostsRes.data ?? []) {
        const d = new Date(row.created_at)
        const dow = d.getUTCDay() // 0=Sun, 6=Sat
        const hour = d.getUTCHours()
        const dayRow = heatmap[dow]
        if (dayRow) dayRow[hour] = (dayRow[hour] ?? 0) + 1
      }

      // Daily trend: bucket per day.
      const trendByDay = new Map<string, { posts: number; offers: number; selected: number }>()
      for (let i = windowDays - 1; i >= 0; i--) {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - i)
        d.setUTCHours(0, 0, 0, 0)
        trendByDay.set(d.toISOString().slice(0, 10), { posts: 0, offers: 0, selected: 0 })
      }
      for (const row of postsRes.data ?? []) {
        const key = row.created_at.slice(0, 10)
        const bucket = trendByDay.get(key)
        if (bucket) bucket.posts += 1
      }
      for (const row of offersRes.data ?? []) {
        const key = row.created_at.slice(0, 10)
        const bucket = trendByDay.get(key)
        if (!bucket) continue
        bucket.offers += 1
        if (row.status === 'selected') bucket.selected += 1
      }
      const dailyTrend = Array.from(trendByDay.entries()).map(([day, v]) => ({
        day,
        posts: v.posts,
        offers: v.offers,
        selected: v.selected,
      }))

      res.status(200).json({
        ok: true,
        window_days: windowDays,
        hour_day_heatmap: heatmap, // [day][hour]
        daily_trend: dailyTrend,
        as_of: new Date().toISOString(),
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /power-users ────────────────────────────────────────────────────────
//
// Two leaderboards (last `window` days, default 30):
//   - top_posters:  by post count, with match rate (% of their posts
//                    that got ≥1 selected offer)
//   - top_drivers:  by offer count, with accept rate (% of their offers
//                    that ended status='selected')

adminRideBoardRouter.get(
  '/power-users',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const windowDays = clampInt(req.query['window'], 30, 1, 365)
      const cutoff = isoMinusDays(windowDays)

      const [postsRes, offersRes] = await Promise.all([
        supabaseAdmin
          .from('ride_schedules')
          .select('id, user_id, mode')
          .gte('created_at', cutoff),
        supabaseAdmin
          .from('ride_offers')
          .select('driver_id, schedule_id, status')
          .gte('created_at', cutoff),
      ])
      if (postsRes.error) throw postsRes.error
      if (offersRes.error) throw offersRes.error

      // Match rate per poster = posts with ≥1 selected offer / total posts.
      const selectedScheduleIds = new Set<string>()
      for (const o of offersRes.data ?? []) {
        if (o.status === 'selected' && o.schedule_id) {
          selectedScheduleIds.add(o.schedule_id)
        }
      }

      const posterStats = new Map<
        string,
        { user_id: string; posts: number; matched: number }
      >()
      for (const p of postsRes.data ?? []) {
        const stats = posterStats.get(p.user_id) ?? {
          user_id: p.user_id,
          posts: 0,
          matched: 0,
        }
        stats.posts += 1
        if (selectedScheduleIds.has(p.id)) stats.matched += 1
        posterStats.set(p.user_id, stats)
      }

      const driverStats = new Map<
        string,
        { driver_id: string; offers: number; selected: number }
      >()
      for (const o of offersRes.data ?? []) {
        const stats = driverStats.get(o.driver_id) ?? {
          driver_id: o.driver_id,
          offers: 0,
          selected: 0,
        }
        stats.offers += 1
        if (o.status === 'selected') stats.selected += 1
        driverStats.set(o.driver_id, stats)
      }

      const topPosters = Array.from(posterStats.values())
        .sort((a, b) => b.posts - a.posts)
        .slice(0, 20)
      const topDrivers = Array.from(driverStats.values())
        .sort((a, b) => b.offers - a.offers)
        .slice(0, 20)

      // Hydrate user info for both lists in a single batch.
      const ids = Array.from(
        new Set([...topPosters.map((p) => p.user_id), ...topDrivers.map((d) => d.driver_id)]),
      )
      const userById = new Map<string, { full_name: string | null; email: string }>()
      if (ids.length > 0) {
        const { data: userRows, error: usersErr } = await supabaseAdmin
          .from('users')
          .select('id, full_name, email')
          .in('id', ids)
        if (usersErr) throw usersErr
        for (const u of userRows ?? []) {
          userById.set(u.id, { full_name: u.full_name, email: u.email })
        }
      }

      res.status(200).json({
        ok: true,
        window_days: windowDays,
        top_posters: topPosters.map((p) => ({
          user_id: p.user_id,
          full_name: userById.get(p.user_id)?.full_name ?? null,
          email: userById.get(p.user_id)?.email ?? null,
          posts: p.posts,
          matched: p.matched,
          match_rate: p.posts > 0 ? p.matched / p.posts : 0,
        })),
        top_drivers: topDrivers.map((d) => ({
          user_id: d.driver_id,
          full_name: userById.get(d.driver_id)?.full_name ?? null,
          email: userById.get(d.driver_id)?.email ?? null,
          offers: d.offers,
          selected: d.selected,
          accept_rate: d.offers > 0 ? d.selected / d.offers : 0,
        })),
        as_of: new Date().toISOString(),
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /activity ───────────────────────────────────────────────────────────
//
// Last N events (default 50), oldest-first within the same second so a
// realtime feed renders deterministically. Each row is normalized into
// a single shape so the frontend doesn't need to know about
// schedule-vs-offer distinctions.

interface ActivityEvent {
  kind: 'post' | 'offer'
  id: string
  created_at: string
  user_id: string
  user_name: string | null
  user_email: string | null
  // For posts: where they're going. For offers: the post they're on.
  origin_address: string | null
  dest_address: string | null
  // Offers only.
  offer_status?: string | null
}

adminRideBoardRouter.get(
  '/activity',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = clampInt(req.query['limit'], 50, 1, 200)

      // Fetch ~limit of each kind so a flood of posts doesn't crowd out
      // offers (and vice versa). After merge we trim to `limit` total.
      const [postsRes, offersRes] = await Promise.all([
        supabaseAdmin
          .from('ride_schedules')
          .select('id, user_id, origin_address, dest_address, created_at')
          .order('created_at', { ascending: false })
          .limit(limit),
        supabaseAdmin
          .from('ride_offers')
          .select('id, driver_id, schedule_id, status, created_at')
          .order('created_at', { ascending: false })
          .limit(limit),
      ])
      if (postsRes.error) throw postsRes.error
      if (offersRes.error) throw offersRes.error

      // Hydrate the schedules that offers reference, so we can render
      // "BunHieng offered on Krishna's Davis→SFO trip" inline.
      const scheduleIds = Array.from(
        new Set(
          (offersRes.data ?? [])
            .map((o) => o.schedule_id)
            .filter((s): s is string => !!s),
        ),
      )
      const scheduleById = new Map<
        string,
        { origin_address: string | null; dest_address: string | null }
      >()
      if (scheduleIds.length > 0) {
        const { data: scheduleRows, error: scheduleErr } = await supabaseAdmin
          .from('ride_schedules')
          .select('id, origin_address, dest_address')
          .in('id', scheduleIds)
        if (scheduleErr) throw scheduleErr
        for (const s of scheduleRows ?? []) {
          scheduleById.set(s.id, {
            origin_address: s.origin_address,
            dest_address: s.dest_address,
          })
        }
      }

      // Hydrate user info for all involved actors.
      const userIds = Array.from(
        new Set([
          ...(postsRes.data ?? []).map((p) => p.user_id),
          ...(offersRes.data ?? []).map((o) => o.driver_id),
        ]),
      )
      const userById = new Map<string, { full_name: string | null; email: string }>()
      if (userIds.length > 0) {
        const { data: userRows, error: usersErr } = await supabaseAdmin
          .from('users')
          .select('id, full_name, email')
          .in('id', userIds)
        if (usersErr) throw usersErr
        for (const u of userRows ?? []) {
          userById.set(u.id, { full_name: u.full_name, email: u.email })
        }
      }

      const events: ActivityEvent[] = []
      for (const p of postsRes.data ?? []) {
        events.push({
          kind: 'post',
          id: p.id,
          created_at: p.created_at,
          user_id: p.user_id,
          user_name: userById.get(p.user_id)?.full_name ?? null,
          user_email: userById.get(p.user_id)?.email ?? null,
          origin_address: p.origin_address,
          dest_address: p.dest_address,
        })
      }
      for (const o of offersRes.data ?? []) {
        const sched = o.schedule_id ? scheduleById.get(o.schedule_id) : null
        events.push({
          kind: 'offer',
          id: o.id,
          created_at: o.created_at,
          user_id: o.driver_id,
          user_name: userById.get(o.driver_id)?.full_name ?? null,
          user_email: userById.get(o.driver_id)?.email ?? null,
          origin_address: sched?.origin_address ?? null,
          dest_address: sched?.dest_address ?? null,
          offer_status: o.status,
        })
      }

      // Merge + trim to the global most-recent `limit` events.
      events.sort((a, b) => b.created_at.localeCompare(a.created_at))
      res.status(200).json({
        ok: true,
        events: events.slice(0, limit),
        as_of: new Date().toISOString(),
      })
    } catch (err) {
      next(err)
    }
  },
)
