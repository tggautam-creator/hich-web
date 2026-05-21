/**
 * `/api/admin/users/*` — user lookup + per-user admin surfaces.
 *
 * Sits behind the same JWT + adminAuth gate as the rest of the admin
 * router (mounted in `./index.ts`).
 *
 * Current endpoints:
 *   GET /stuck?step=&range=&mode=&limit=&offset=   (Slice 1.2)
 *     → list of users stuck at a given funnel step
 *   GET /search?q=&limit=&offset=                  (Slice 1.3a)
 *     → search users by email / full_name / phone / exact user_id
 *   GET /:id                                       (Slice 1.3a)
 *     → full profile + Overview-tab derived data
 *       (vehicle, routines count, ratings, email_verified, university)
 *
 * Per-tab read endpoints (Slice 1.3b+):
 *   GET /:id/rides         → Rides tab
 *   GET /:id/wallet        → Wallet tab
 *   GET /:id/notifications → Notifications tab
 *   GET /:id/devices       → Devices tab
 *   GET /:id/schedules     → Board posts tab (ride_schedules, 2026-05-20)
 *   GET /:id/routines      → Routines tab (driver_routines, 2026-05-20)
 *   POST /:id/actions/*    → Admin Actions tab (audit-logged)
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { handleStuckUsers } from './funnel.ts'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'

export const adminUsersRouter = Router()

// ── /stuck (from Slice 1.2) ──────────────────────────────────────────────────
adminUsersRouter.get('/stuck', handleStuckUsers)

// ── shared types (mirror these in src/hooks/useAdminUsers.ts) ────────────────

interface SearchHit {
  id: string
  email: string
  full_name: string | null
  is_driver: boolean
  created_at: string
  last_active_at: string | null
}

interface SearchResponse {
  ok: true
  q: string
  total: number // approximate; we cap at the queried page
  users: SearchHit[]
  limit: number
  offset: number
}

interface UserOverviewResponse {
  ok: true
  user: {
    id: string
    email: string
    phone: string | null
    full_name: string | null
    avatar_url: string | null
    is_driver: boolean
    onboarding_completed: boolean
    is_admin: boolean
    wallet_balance: number
    default_payment_method_id: string | null
    stripe_account_id: string | null
    stripe_onboarding_complete: boolean
    rating_avg: number | null
    rating_count: number
    date_of_birth: string | null
    last_active_at: string | null
    suspended_at: string | null
    suspended_reason: string | null
    created_at: string
  }
  email_verified: boolean
  university: string
  vehicle: {
    id: string
    make: string
    model: string
    year: number
    color: string
    plate: string
  } | null
  routines_count: number
  rides_count: number
  rides_completed_count: number
}

// ── helpers ──────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Returns true when `s` is a complete v4-ish UUID (matches the shape Supabase uses). */
function isFullUuid(s: string): boolean {
  return UUID_RE.test(s)
}

/**
 * Derives a human-readable university name from an email. Curated map
 * for the schools we already see in Tago, with a graceful fallback to
 * the raw domain. Lives here (not in src/lib) so the server returns
 * a stable string the client can render without computing it.
 *
 * To add a school: drop a line in the switch. Lowercase the key.
 */
function universityFromEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return ''
  const domain = email.slice(at + 1).toLowerCase()
  switch (domain) {
    case 'davis.edu':
    case 'ucdavis.edu':
      return 'UC Davis'
    case 'berkeley.edu':
    case 'ucla.edu':
    case 'ucsd.edu':
    case 'ucsc.edu':
    case 'uci.edu':
    case 'ucsb.edu':
    case 'ucr.edu':
    case 'ucmerced.edu':
      return `UC ${domain.replace('.edu', '').replace(/^uc/, '').toUpperCase()}`
    case 'stanford.edu': return 'Stanford'
    case 'mit.edu': return 'MIT'
    case 'harvard.edu': return 'Harvard'
    case 'tagorides.com': return 'Tago (admin)'
    default: return domain
  }
}

// ── GET /search ─────────────────────────────────────────────────────────────

/**
 * 2026-05-19 — filterable search.
 *
 * Query params (all optional, AND-composed):
 *   q              free text — email/name/phone substring or full UUID
 *   role           'rider' | 'driver' | 'both' (matches is_driver / both
 *                                                 stays unconstrained)
 *   active         '1h' | '24h' | '7d' | 'dormant' (filters last_active_at)
 *   has_push       'yes' | 'no' (filters by presence of push_tokens row)
 *   platform       'ios' | 'web' | 'android' (filters by push_tokens.platform)
 *   university     email-domain substring (e.g. 'davis.edu')
 *   sort           'newest' (default) | 'oldest' | 'last_active' | 'name'
 *   limit, offset  pagination
 */
adminUsersRouter.get(
  '/search',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const qRaw = typeof req.query['q'] === 'string' ? req.query['q'].trim() : ''
      const limit = Math.min(
        Math.max(parseInt(String(req.query['limit'] ?? '25'), 10) || 25, 1),
        100,
      )
      const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0)

      const role = typeof req.query['role'] === 'string' ? req.query['role'] : null
      const activeWindow = typeof req.query['active'] === 'string' ? req.query['active'] : null
      const hasPush = typeof req.query['has_push'] === 'string' ? req.query['has_push'] : null
      const platform = typeof req.query['platform'] === 'string' ? req.query['platform'] : null
      const university = typeof req.query['university'] === 'string'
        ? req.query['university'].trim().toLowerCase()
        : null
      const sortRaw = typeof req.query['sort'] === 'string' ? req.query['sort'] : 'newest'

      // Full UUID short-circuits all other filters.
      if (qRaw.length > 0 && isFullUuid(qRaw)) {
        const { data, error } = await supabaseAdmin
          .from('users')
          .select('id, email, full_name, is_driver, created_at, last_active_at')
          .eq('id', qRaw)
        if (error) throw error
        const response: SearchResponse = {
          ok: true,
          q: qRaw,
          total: data?.length ?? 0,
          users: (data ?? []) as SearchHit[],
          limit,
          offset,
        }
        res.status(200).json(response)
        return
      }

      // Resolve push-token-derived filters into a user_id allow/deny
      // list before the main query (PostgREST doesn't expose EXISTS).
      let userIdAllowlist: string[] | null = null
      let userIdDenylist: string[] | null = null
      if (hasPush === 'yes' || hasPush === 'no' || platform) {
        let tokenQuery = supabaseAdmin.from('push_tokens').select('user_id, platform')
        if (platform === 'ios' || platform === 'web' || platform === 'android') {
          tokenQuery = tokenQuery.eq('platform', platform)
        }
        const { data: tokenRows, error: tokenErr } = await tokenQuery
        if (tokenErr) throw tokenErr
        const idsWithMatchingTokens = Array.from(
          new Set((tokenRows ?? []).map((r) => r.user_id).filter((id): id is string => !!id)),
        )
        if (hasPush === 'no') {
          userIdDenylist = idsWithMatchingTokens
        } else {
          userIdAllowlist = idsWithMatchingTokens
        }
      }

      let query = supabaseAdmin
        .from('users')
        .select(
          'id, email, full_name, is_driver, created_at, last_active_at',
          { count: 'exact' },
        )

      // Text search across email/name/phone (skipped when q is empty
      // — empty query = browse all users).
      if (qRaw.length > 0) {
        const safe = qRaw.replace(/[,()]/g, '')
        const pattern = `%${safe}%`
        query = query.or(
          `email.ilike.${pattern},full_name.ilike.${pattern},phone.ilike.${pattern}`,
        )
      }

      // Role filter
      if (role === 'driver') {
        query = query.eq('is_driver', true)
      } else if (role === 'rider') {
        query = query.eq('is_driver', false)
      }

      // Active window filter
      if (activeWindow === '1h') {
        query = query.gte('last_active_at', isoMinusHours(1))
      } else if (activeWindow === '24h') {
        query = query.gte('last_active_at', isoMinusHours(24))
      } else if (activeWindow === '7d') {
        query = query.gte('last_active_at', isoMinusDays(7))
      } else if (activeWindow === 'dormant') {
        query = query.lt('last_active_at', isoMinusDays(30))
      }

      // University filter (email domain substring)
      if (university) {
        query = query.ilike('email', `%@${university}%`)
      }

      // Push / platform allow / deny
      if (userIdAllowlist) {
        if (userIdAllowlist.length === 0) {
          // No matching tokens → zero users qualify. Return empty.
          res.status(200).json({
            ok: true,
            q: qRaw,
            total: 0,
            users: [],
            limit,
            offset,
          })
          return
        }
        query = query.in('id', userIdAllowlist)
      }
      if (userIdDenylist && userIdDenylist.length > 0) {
        // PostgREST `not.in.(...)` is the deny path.
        query = query.not('id', 'in', `(${userIdDenylist.join(',')})`)
      }

      // Sort
      const sort = (() => {
        switch (sortRaw) {
          case 'oldest':
            return { column: 'created_at' as const, ascending: true }
          case 'last_active':
            return { column: 'last_active_at' as const, ascending: false }
          case 'name':
            return { column: 'full_name' as const, ascending: true }
          case 'newest':
          default:
            return { column: 'created_at' as const, ascending: false }
        }
      })()
      query = query
        .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
        .range(offset, offset + limit - 1)

      const { data, count, error } = await query
      if (error) throw error

      const response: SearchResponse = {
        ok: true,
        q: qRaw,
        total: count ?? data?.length ?? 0,
        users: (data ?? []) as SearchHit[],
        limit,
        offset,
      }
      res.status(200).json(response)
    } catch (err) {
      next(err)
    }
  },
)

function isoMinusHours(hours: number): string {
  const d = new Date()
  d.setUTCHours(d.getUTCHours() - hours)
  return d.toISOString()
}

function isoMinusDays(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

// ── GET /:id ────────────────────────────────────────────────────────────────

adminUsersRouter.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idRaw = req.params['id']
      const id = typeof idRaw === 'string' ? idRaw : ''
      if (!id || !isFullUuid(id)) {
        res.status(400).json({
          error: { code: 'INVALID_USER_ID', message: 'user id must be a UUID' },
        })
        return
      }

      // Parallel fetch — the Overview tab needs all of these on first paint.
      const [userRes, vehiclesRes, routinesRes, ridesRes, authRes] =
        await Promise.all([
          supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', id)
            .maybeSingle(),
          supabaseAdmin
            .from('vehicles')
            .select('id, make, model, year, color, plate, deleted_at')
            .eq('user_id', id)
            .is('deleted_at', null)
            .limit(1),
          supabaseAdmin
            .from('ride_schedules')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', id),
          supabaseAdmin
            .from('rides')
            .select('id, status, rider_id, driver_id'),
          supabaseAdmin.auth.admin.getUserById(id),
        ])

      if (userRes.error) throw userRes.error
      if (!userRes.data) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'user not found' },
        })
        return
      }
      if (vehiclesRes.error) throw vehiclesRes.error
      if (routinesRes.error) throw routinesRes.error
      if (ridesRes.error) throw ridesRes.error
      // authRes.error is silently swallowed — a missing auth row
      // shouldn't 500 the whole profile (e.g. dev test users created
      // via SQL without an auth shadow). email_verified just reads false.

      const u = userRes.data as UserOverviewResponse['user']
      const vehicleRow = vehiclesRes.data?.[0] ?? null
      const routinesCount = routinesRes.count ?? 0
      const rides = (ridesRes.data ?? []) as Array<{
        id: string
        status: string
        rider_id: string
        driver_id: string | null
      }>
      const ridesCount = rides.filter(
        (r) => r.rider_id === id || r.driver_id === id,
      ).length
      const ridesCompletedCount = rides.filter(
        (r) =>
          r.status === 'completed' &&
          (r.rider_id === id || r.driver_id === id),
      ).length

      const emailVerified = !!authRes?.data?.user?.email_confirmed_at

      const response: UserOverviewResponse = {
        ok: true,
        user: u,
        email_verified: emailVerified,
        university: universityFromEmail(u.email),
        vehicle: vehicleRow
          ? {
              id: vehicleRow.id,
              make: vehicleRow.make,
              model: vehicleRow.model,
              year: vehicleRow.year,
              color: vehicleRow.color,
              plate: vehicleRow.plate,
            }
          : null,
        routines_count: routinesCount,
        rides_count: ridesCount,
        rides_completed_count: ridesCompletedCount,
      }
      res.status(200).json(response)
    } catch (err) {
      next(err)
    }
  },
)

// ──────────────────────────────────────────────────────────────────────────────
// Slice 1.3b — per-user read-only tab endpoints (rides / wallet /
// notifications / devices). All paginated except /devices (one row
// per user post-migration 009, so pagination is pointless).
//
// Permissions: inherited from adminRouter — JWT + adminAuth gate.
// All endpoints return 400 INVALID_USER_ID for non-UUID :id values.
// ──────────────────────────────────────────────────────────────────────────────

function parsePaging(req: Request, defaultLimit = 25): { limit: number; offset: number } {
  const limit = Math.min(
    Math.max(parseInt(String(req.query['limit'] ?? defaultLimit), 10) || defaultLimit, 1),
    100,
  )
  const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0)
  return { limit, offset }
}

function parseUserIdParam(req: Request, res: Response): string | null {
  const raw = req.params['id']
  const id = typeof raw === 'string' ? raw : ''
  if (!id || !isFullUuid(id)) {
    res.status(400).json({
      error: { code: 'INVALID_USER_ID', message: 'user id must be a UUID' },
    })
    return null
  }
  return id
}

// ── GET /:id/rides ──────────────────────────────────────────────────────────

interface UserRideRow {
  id: string
  status: string
  payment_status: string | null
  role: 'rider' | 'driver'
  other_party_id: string | null
  origin_name: string | null
  destination_name: string | null
  fare_cents: number | null
  created_at: string
  ended_at: string | null
}

adminUsersRouter.get(
  '/:id/rides',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseUserIdParam(req, res)
      if (!id) return
      const { limit, offset } = parsePaging(req)

      const { data, count, error } = await supabaseAdmin
        .from('rides')
        .select(
          'id, status, payment_status, rider_id, driver_id, origin_name, destination_name, fare_cents, created_at, ended_at',
          { count: 'exact' },
        )
        .or(`rider_id.eq.${id},driver_id.eq.${id}`)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (error) throw error

      const rows: UserRideRow[] = (data ?? []).map((r) => ({
        id: r.id,
        status: r.status,
        payment_status: r.payment_status,
        role: r.rider_id === id ? 'rider' : 'driver',
        other_party_id: r.rider_id === id ? r.driver_id : r.rider_id,
        origin_name: r.origin_name,
        destination_name: r.destination_name,
        fare_cents: r.fare_cents,
        created_at: r.created_at,
        ended_at: r.ended_at,
      }))

      res.status(200).json({
        ok: true,
        rides: rows,
        total: count ?? rows.length,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id/wallet ─────────────────────────────────────────────────────────

interface WalletTxnRow {
  id: string
  type: string
  amount_cents: number
  balance_after_cents: number
  description: string | null
  pm_brand: string | null
  pm_last4: string | null
  pm_wallet: string | null
  ride_id: string | null
  created_at: string
  transfer_id: string | null
  transfer_paid_at: string | null
}

adminUsersRouter.get(
  '/:id/wallet',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseUserIdParam(req, res)
      if (!id) return
      const { limit, offset } = parsePaging(req)

      const [userRes, txRes] = await Promise.all([
        supabaseAdmin
          .from('users')
          .select('wallet_balance')
          .eq('id', id)
          .maybeSingle(),
        supabaseAdmin
          .from('transactions')
          .select(
            'id, type, amount_cents, balance_after_cents, description, pm_brand, pm_last4, pm_wallet, ride_id, created_at, transfer_id, transfer_paid_at',
            { count: 'exact' },
          )
          .eq('user_id', id)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1),
      ])
      if (userRes.error) throw userRes.error
      if (!userRes.data) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'user not found' },
        })
        return
      }
      if (txRes.error) throw txRes.error

      res.status(200).json({
        ok: true,
        wallet_balance_cents: userRes.data.wallet_balance,
        transactions: (txRes.data ?? []) as WalletTxnRow[],
        total: txRes.count ?? txRes.data?.length ?? 0,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id/notifications ──────────────────────────────────────────────────

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string
  is_read: boolean
  created_at: string
}

adminUsersRouter.get(
  '/:id/notifications',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseUserIdParam(req, res)
      if (!id) return
      const { limit, offset } = parsePaging(req)

      const { data, count, error } = await supabaseAdmin
        .from('notifications')
        .select('id, type, title, body, is_read, created_at', { count: 'exact' })
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (error) throw error

      res.status(200).json({
        ok: true,
        notifications: (data ?? []) as NotificationRow[],
        total: count ?? data?.length ?? 0,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id/devices ────────────────────────────────────────────────────────

interface DeviceRow {
  id: string
  token_suffix: string // last 8 chars only — full token is enough to send a push
  platform: 'ios' | 'android' | 'web' | null
  created_at: string
}

adminUsersRouter.get(
  '/:id/devices',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseUserIdParam(req, res)
      if (!id) return

      const { data, error } = await supabaseAdmin
        .from('push_tokens')
        .select('id, token, platform, created_at')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
      if (error) throw error

      const rows: DeviceRow[] = (data ?? []).map((d) => ({
        id: d.id,
        token_suffix: d.token.slice(-8),
        platform: d.platform,
        created_at: d.created_at,
      }))
      res.status(200).json({
        ok: true,
        devices: rows,
        total: rows.length,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id/schedules ──────────────────────────────────────────────────────
//
// 2026-05-20 — board posts for a user (ride_schedules rows). The Ride
// Board lives on top of ride_schedules: a rider post (mode='rider') is
// a request open to driver offers (ride_offers with schedule_id set),
// and a driver post (mode='driver') is an upcoming trip the driver is
// advertising. This endpoint returns both, with the count of pending
// driver offers attached for rider-mode posts so ops can see "rider
// has 3 offers waiting" at a glance.
//
// Query params:
//   status: 'upcoming' | 'past' | 'all'   (default 'all')
//   sort:   'date_desc' | 'date_asc'      (default 'date_desc')
//   limit, offset                          (pagination)
//
// `upcoming`/`past` is determined by trip_date >= / < today UTC. Trip
// times are local to the rider's region — using UTC is rough but it's
// the only thing the DB stores; the rare edge case (a 2am-PST post
// looking "upcoming" until 5pm UTC) doesn't matter for an audit view.

interface UserScheduleRow {
  id: string
  mode: 'driver' | 'rider'
  route_name: string
  origin_address: string
  dest_address: string
  direction_type: 'one_way' | 'roundtrip'
  trip_date: string
  trip_time: string
  time_type: 'departure' | 'arrival'
  created_at: string
  /** Count of `ride_offers` rows in 'pending' state attached to this schedule. */
  pending_offers_count: number
}

adminUsersRouter.get(
  '/:id/schedules',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseUserIdParam(req, res)
      if (!id) return
      const { limit, offset } = parsePaging(req)

      const status = typeof req.query['status'] === 'string' ? req.query['status'] : 'all'
      const sort = typeof req.query['sort'] === 'string' ? req.query['sort'] : 'date_desc'
      const ascending = sort === 'date_asc'
      const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC

      // Build the base list query, applying the upcoming/past filter
      // and the sort direction. The two count queries below run in
      // parallel and feed the tab-badge `*_count` fields regardless
      // of which filter is currently active in the UI.
      let listQuery = supabaseAdmin
        .from('ride_schedules')
        .select(
          'id, mode, route_name, origin_address, dest_address, direction_type, trip_date, trip_time, time_type, created_at',
          { count: 'exact' },
        )
        .eq('user_id', id)
      if (status === 'upcoming') listQuery = listQuery.gte('trip_date', today)
      else if (status === 'past') listQuery = listQuery.lt('trip_date', today)

      const [listRes, upcomingCountRes, pastCountRes] = await Promise.all([
        listQuery
          .order('trip_date', { ascending })
          .order('trip_time', { ascending })
          .range(offset, offset + limit - 1),
        supabaseAdmin
          .from('ride_schedules')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', id)
          .gte('trip_date', today),
        supabaseAdmin
          .from('ride_schedules')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', id)
          .lt('trip_date', today),
      ])
      if (listRes.error) throw listRes.error
      if (upcomingCountRes.error) throw upcomingCountRes.error
      if (pastCountRes.error) throw pastCountRes.error

      // Pull pending offer counts for the schedules we're about to
      // return so the table can show "3 offers waiting" on rider
      // posts. Only counts pending — selected/released would be a
      // separate per-offer drilldown.
      const scheduleIds = (listRes.data ?? []).map((s) => s.id)
      const offerCounts = new Map<string, number>()
      if (scheduleIds.length > 0) {
        const { data: offerRows, error: offerErr } = await supabaseAdmin
          .from('ride_offers')
          .select('schedule_id')
          .in('schedule_id', scheduleIds)
          .eq('status', 'pending')
        if (offerErr) throw offerErr
        for (const o of offerRows ?? []) {
          if (!o.schedule_id) continue
          offerCounts.set(o.schedule_id, (offerCounts.get(o.schedule_id) ?? 0) + 1)
        }
      }

      const rows: UserScheduleRow[] = (listRes.data ?? []).map((s) => ({
        id: s.id,
        mode: s.mode,
        route_name: s.route_name,
        origin_address: s.origin_address,
        dest_address: s.dest_address,
        direction_type: s.direction_type,
        trip_date: s.trip_date,
        trip_time: s.trip_time,
        time_type: s.time_type,
        created_at: s.created_at,
        pending_offers_count: offerCounts.get(s.id) ?? 0,
      }))

      res.status(200).json({
        ok: true,
        schedules: rows,
        total: listRes.count ?? rows.length,
        upcoming_count: upcomingCountRes.count ?? 0,
        past_count: pastCountRes.count ?? 0,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id/routines ───────────────────────────────────────────────────────
//
// 2026-05-20 — driver routines (recurring weekly schedules) for a user.
// Distinct from `/schedules` which is one-time posts — this is the
// "every Tue/Thu 8am" recurring driver route. Drivers toggle is_active
// to pause without deleting, so the active/inactive filter mirrors what
// the driver themself sees on Schedule.
//
// Query params:
//   status: 'active' | 'inactive' | 'all'   (default 'all')
//   sort:   'newest' | 'oldest'             (default 'newest')
//   limit, offset                            (pagination)

interface UserRoutineRow {
  id: string
  route_name: string
  direction_type: 'one_way' | 'roundtrip'
  day_of_week: number[]
  departure_time: string | null
  arrival_time: string | null
  is_active: boolean
  created_at: string
}

adminUsersRouter.get(
  '/:id/routines',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseUserIdParam(req, res)
      if (!id) return
      const { limit, offset } = parsePaging(req)

      const status = typeof req.query['status'] === 'string' ? req.query['status'] : 'all'
      const sort = typeof req.query['sort'] === 'string' ? req.query['sort'] : 'newest'
      const ascending = sort === 'oldest'

      let listQuery = supabaseAdmin
        .from('driver_routines')
        .select(
          'id, route_name, direction_type, day_of_week, departure_time, arrival_time, is_active, created_at',
          { count: 'exact' },
        )
        .eq('user_id', id)
      if (status === 'active') listQuery = listQuery.eq('is_active', true)
      else if (status === 'inactive') listQuery = listQuery.eq('is_active', false)

      const [listRes, activeCountRes, inactiveCountRes] = await Promise.all([
        listQuery
          .order('created_at', { ascending })
          .range(offset, offset + limit - 1),
        supabaseAdmin
          .from('driver_routines')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', id)
          .eq('is_active', true),
        supabaseAdmin
          .from('driver_routines')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', id)
          .eq('is_active', false),
      ])
      if (listRes.error) throw listRes.error
      if (activeCountRes.error) throw activeCountRes.error
      if (inactiveCountRes.error) throw inactiveCountRes.error

      const rows: UserRoutineRow[] = (listRes.data ?? []).map((r) => ({
        id: r.id,
        route_name: r.route_name,
        direction_type: r.direction_type,
        day_of_week: r.day_of_week,
        departure_time: r.departure_time,
        arrival_time: r.arrival_time,
        is_active: r.is_active,
        created_at: r.created_at,
      }))

      res.status(200).json({
        ok: true,
        routines: rows,
        total: listRes.count ?? rows.length,
        active_count: activeCountRes.count ?? 0,
        inactive_count: inactiveCountRes.count ?? 0,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)
