import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'

/**
 * `/api/admin/metrics/*` — read-only analytics for the admin dashboards.
 *
 * Mounted under `adminRouter` (so JWT + admin check already enforced).
 */
export const adminMetricsRouter = Router()

// ── shared types for the response ────────────────────────────────────────────

interface ActiveUsers {
  dau: number
  wau: number
  mau: number
}

interface OverviewKpis {
  total_users: number
  new_signups_today: number
  active_users: ActiveUsers
  active_rides_now: number
  rides_completed_today: number
  revenue_this_week_cents: number
  ios_install_rate: number | null // 0..1, null when no users have a known platform yet
  driver_activation_rate: number | null
  rider_activation_rate: number | null
  retention_7d: number | null
  avg_ride_fare_cents: number | null
  avg_driver_rating: number | null
}

interface DailyPoint {
  date: string // YYYY-MM-DD
  count: number
}

interface DomainPoint {
  domain: string
  count: number
}

interface OverviewCharts {
  signups_14d: DailyPoint[]
  completed_rides_14d: DailyPoint[]
  top_email_domains: DomainPoint[]
}

interface OverviewResponse {
  ok: true
  kpis: OverviewKpis
  charts: OverviewCharts
  generated_at: string
  data_through: string // tells the client what "now" was server-side
}

// ── helpers ──────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDayUTC(d: Date): Date {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  return x
}

function daysAgoUTC(now: Date, n: number): Date {
  return new Date(startOfDayUTC(now).getTime() - n * DAY_MS)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function safeRate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return numerator / denominator
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return ''
  return email.slice(at + 1).toLowerCase()
}

/**
 * GET /api/admin/metrics/overview
 *
 * Returns every KPI + chart series the Overview dashboard needs in
 * one round trip so the client can stamp the dashboard atomically (no
 * staggered loading-skeleton flicker as 12 cards resolve independently).
 *
 * Strategy: fetch the minimum columns we need from `users`, `rides`,
 * `push_tokens`, `ride_ratings`, and compute every aggregate in TS.
 * Cheap while the dataset is small (Tago has ~hundreds of users today).
 * When the row counts cross ~50k we'll swap to a Postgres `get_admin_overview()`
 * RPC; until then in-memory keeps this endpoint a single file with
 * zero schema dependency on stored procedures.
 *
 * Response shape lives in `OverviewResponse` above — keep the client
 * `useAdminOverview` hook + AdminHomePage in sync when it changes.
 */
adminMetricsRouter.get(
  '/overview',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const now = new Date()
      const startToday = startOfDayUTC(now).toISOString()
      const start7d = daysAgoUTC(now, 7).toISOString()
      const _start14d = daysAgoUTC(now, 14).toISOString()
      void _start14d // currently unused — kept for upcoming 14-day KPI
      const start30d = daysAgoUTC(now, 30).toISOString()
      const start1d = new Date(now.getTime() - 1 * DAY_MS).toISOString()
      const cutoff7dAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString()

      // Parallel fetch. Each select projects only the columns the KPI
      // logic actually reads — keeps the wire payload small.
      const [usersRes, ridesRes, tokensRes, ratingsRes] = await Promise.all([
        supabaseAdmin
          .from('users')
          .select('id, email, is_driver, last_active_at, created_at'),
        supabaseAdmin
          .from('rides')
          .select('id, status, rider_id, driver_id, fare_cents, ended_at'),
        supabaseAdmin
          .from('push_tokens')
          .select('user_id, platform'),
        supabaseAdmin
          .from('ride_ratings')
          .select('ride_id, rated_id, stars'),
      ])

      if (usersRes.error) throw usersRes.error
      if (ridesRes.error) throw ridesRes.error
      if (tokensRes.error) throw tokensRes.error
      if (ratingsRes.error) throw ratingsRes.error

      const users = usersRes.data ?? []
      const rides = ridesRes.data ?? []
      const tokens = tokensRes.data ?? []
      const ratings = ratingsRes.data ?? []

      // ── KPI 1: total users ─────────────────────────────────────────────
      const totalUsers = users.length

      // ── KPI 2: new signups today ───────────────────────────────────────
      const newSignupsToday = users.filter(
        (u) => u.created_at >= startToday,
      ).length

      // ── KPI 3: DAU / WAU / MAU ─────────────────────────────────────────
      let dau = 0
      let wau = 0
      let mau = 0
      for (const u of users) {
        const la = u.last_active_at
        if (!la) continue
        if (la >= start1d) dau += 1
        if (la >= start7d) wau += 1
        if (la >= start30d) mau += 1
      }

      // ── KPI 4: active rides now ────────────────────────────────────────
      const activeStatuses = new Set(['requested', 'accepted', 'coordinating', 'active'])
      const activeRidesNow = rides.filter((r) => activeStatuses.has(r.status)).length

      // ── KPI 5: rides completed today ───────────────────────────────────
      const completedToday = rides.filter(
        (r) => r.status === 'completed' && r.ended_at !== null && r.ended_at >= startToday,
      ).length

      // ── KPI 6: revenue this week (cents) ───────────────────────────────
      let revenueThisWeekCents = 0
      for (const r of rides) {
        if (r.status !== 'completed') continue
        if (!r.ended_at || r.ended_at < start7d) continue
        revenueThisWeekCents += r.fare_cents ?? 0
      }

      // ── KPI 7: iOS install rate ────────────────────────────────────────
      // Numerator: distinct users with platform='ios'
      // Denominator: distinct users with ANY known (non-null) platform
      // Tokens table has UNIQUE(user_id) so we can read each row as
      // "that user's platform" without de-duping further.
      let iosCount = 0
      let knownPlatformCount = 0
      for (const t of tokens) {
        if (t.platform === null) continue
        knownPlatformCount += 1
        if (t.platform === 'ios') iosCount += 1
      }
      const iosInstallRate = safeRate(iosCount, knownPlatformCount)

      // ── KPI 8 & 9: driver / rider activation rates ─────────────────────
      // Activation = has at least one completed ride in that role.
      const driverIdsWithCompleted = new Set<string>()
      const riderIdsWithCompleted = new Set<string>()
      for (const r of rides) {
        if (r.status !== 'completed') continue
        if (r.driver_id) driverIdsWithCompleted.add(r.driver_id)
        if (r.rider_id) riderIdsWithCompleted.add(r.rider_id)
      }
      const driverPool = users.filter((u) => u.is_driver).length
      const driverActivationRate = safeRate(driverIdsWithCompleted.size, driverPool)
      // Rider pool = every user (we don't gate riding behind a flag).
      const riderActivationRate = safeRate(riderIdsWithCompleted.size, totalUsers)

      // ── KPI 10: 7-day retention ────────────────────────────────────────
      // Of users who signed up ≥7 days ago, what fraction had any
      // recorded activity within the past 7 days? `last_active_at`
      // backfills naturally as users hit the API, so this number will
      // climb in the first week post-migration even with no behavior
      // change — flag in the UI tooltip if needed.
      const cohort = users.filter((u) => u.created_at <= cutoff7dAgo)
      const retained = cohort.filter(
        (u) => u.last_active_at !== null && u.last_active_at >= start7d,
      ).length
      const retention7d = safeRate(retained, cohort.length)

      // ── KPI 11: avg ride fare (cents) ──────────────────────────────────
      const fares = rides
        .filter((r) => r.status === 'completed' && typeof r.fare_cents === 'number')
        .map((r) => r.fare_cents as number)
      const avgRideFareCents =
        fares.length === 0 ? null : Math.round(fares.reduce((a, b) => a + b, 0) / fares.length)

      // ── KPI 12: avg driver rating ──────────────────────────────────────
      // A rating row is "for a driver" when the rated user matches the
      // ride's driver_id (the other rating per ride is rider-facing).
      const driverIdByRideId = new Map<string, string | null>()
      for (const r of rides) driverIdByRideId.set(r.id, r.driver_id)
      const driverStars: number[] = []
      for (const rating of ratings) {
        const driverId = driverIdByRideId.get(rating.ride_id)
        if (driverId && rating.rated_id === driverId) driverStars.push(rating.stars)
      }
      const avgDriverRating =
        driverStars.length === 0
          ? null
          : driverStars.reduce((a, b) => a + b, 0) / driverStars.length

      // ── Chart 1: daily signups (last 14 days) ──────────────────────────
      const signupsByDay = buildDailySeries(now, 14, (d) =>
        users.filter((u) => u.created_at >= d && u.created_at < addDay(d)).length,
      )

      // ── Chart 2: daily completed rides (last 14 days) ──────────────────
      const completedByDay = buildDailySeries(now, 14, (d) => {
        const dEnd = addDay(d)
        return rides.filter(
          (r) =>
            r.status === 'completed' &&
            r.ended_at !== null &&
            r.ended_at >= d &&
            r.ended_at < dEnd,
        ).length
      })

      // ── Chart 3: top 10 email domains ──────────────────────────────────
      const domainCounts = new Map<string, number>()
      for (const u of users) {
        const dom = emailDomain(u.email)
        if (!dom) continue
        domainCounts.set(dom, (domainCounts.get(dom) ?? 0) + 1)
      }
      const topEmailDomains: DomainPoint[] = Array.from(domainCounts.entries())
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      const response: OverviewResponse = {
        ok: true,
        kpis: {
          total_users: totalUsers,
          new_signups_today: newSignupsToday,
          active_users: { dau, wau, mau },
          active_rides_now: activeRidesNow,
          rides_completed_today: completedToday,
          revenue_this_week_cents: revenueThisWeekCents,
          ios_install_rate: iosInstallRate,
          driver_activation_rate: driverActivationRate,
          rider_activation_rate: riderActivationRate,
          retention_7d: retention7d,
          avg_ride_fare_cents: avgRideFareCents,
          avg_driver_rating: avgDriverRating,
        },
        charts: {
          signups_14d: signupsByDay,
          completed_rides_14d: completedByDay,
          top_email_domains: topEmailDomains,
        },
        generated_at: new Date().toISOString(),
        data_through: now.toISOString(),
      }

      res.status(200).json(response)
    } catch (err) {
      next(err)
    }
  },
)

// ── time-series helper ───────────────────────────────────────────────────────

function addDay(isoDay: string): string {
  return isoDate(new Date(new Date(isoDay).getTime() + DAY_MS))
}

function buildDailySeries(
  now: Date,
  days: number,
  countForDay: (isoDay: string) => number,
): DailyPoint[] {
  const out: DailyPoint[] = []
  const today = startOfDayUTC(now)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS)
    const iso = isoDate(d)
    out.push({ date: iso, count: countForDay(iso) })
  }
  return out
}
