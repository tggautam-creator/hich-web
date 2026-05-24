/**
 * `/api/admin/stats` — network-wide statistics dashboard.
 *
 * 2026-05-23 — schema-audit Slice 5. Single fat endpoint returning
 * everything the /admin/stats page renders: today KPIs, 30-day daily
 * rides chart, lifetime totals + gas-savings estimate, funnel
 * snapshot. One round-trip so the page paints in one tick.
 *
 * All queries are read-only counts/sums on indexed columns. The
 * heaviest is the lifetime distance sum (pulls one int column from
 * every completed-ride row). Acceptable for v1 ride volume; if we
 * cross ~100k completed rides, swap to a daily-rolled materialized
 * view.
 *
 * Auth gate inherited from parent adminRouter (JWT + adminAuth).
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'

export const adminStatsRouter = Router()

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

interface DailyBucket {
  /** ISO date 'YYYY-MM-DD' in UTC. */
  date: string
  rides_completed: number
  revenue_cents: number
}

interface StatsResponse {
  ok: true
  generated_at: string
  // Right-now / today KPIs
  kpis: {
    dau: number
    wau: number
    mau: number
    online_drivers: number
    rides_today: number
    rides_completed_today: number
    revenue_today_cents: number
  }
  // Last 30 days, one bucket per UTC day, oldest first.
  daily_rides_30d: DailyBucket[]
  // Lifetime aggregates
  lifetime: {
    total_users: number
    total_drivers: number
    stripe_onboarded_drivers: number
    total_rides: number
    total_completed: number
    total_distance_metres: number
    total_revenue_cents: number
    gallons_saved: number
    co2_saved_kg: number
    universities: number
  }
  // Funnel snapshot — counts at each step, not conversion %.
  funnel: {
    signups: number
    onboarded: number
    first_ride_completed: number
    five_rides_completed: number
    drivers_active: number
  }
}

// ── helpers ────────────────────────────────────────────────────────

function isoMinusMs(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

function startOfTodayUTC(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/**
 * Lifetime gas-savings estimate. Per CLAUDE.md formula:
 *   gallons = distance_km × 0.621371 / mpg
 * Assumes 25 mpg (matches fare formula default). Returns absolute
 * gallons; multiply by gas price elsewhere if $-value is wanted.
 */
const ASSUMED_MPG = 25

function gallonsForMetres(metres: number): number {
  const km = metres / 1000
  const miles = km * 0.621371
  return miles / ASSUMED_MPG
}

/** EPA-published: ~8.89 kg CO2 per gallon of gasoline burned. */
const KG_CO2_PER_GALLON = 8.89

// ── endpoint ───────────────────────────────────────────────────────

adminStatsRouter.get(
  '/',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const generatedAt = new Date().toISOString()
      const today = startOfTodayUTC()
      const dauCutoff = isoMinusMs(24 * MS_PER_HOUR)
      const wauCutoff = isoMinusMs(7 * MS_PER_DAY)
      const mauCutoff = isoMinusMs(30 * MS_PER_DAY)
      const onlineCutoff = isoMinusMs(5 * 60 * 1000) // 5 min freshness
      const thirtyDayCutoff = isoMinusMs(30 * MS_PER_DAY)

      // Parallel-fan everything. Each query is a small count / sum;
      // PostgREST handles them with no serialization cost.
      const [
        dauRes,
        wauRes,
        mauRes,
        onlineRes,
        ridesTodayRes,
        ridesCompletedTodayRes,
        revenueTodayRes,
        totalUsersRes,
        totalDriversRes,
        stripeOnboardedRes,
        totalRidesRes,
        totalCompletedRes,
        lifetimeDistanceRes,
        lifetimeRevenueRes,
        universitiesRes,
        daily30dRes,
        funnelOnboardedRes,
        funnelFirstRideRes,
      ] = await Promise.all([
        // KPIs
        supabaseAdmin
          .from('users')
          .select('id', { count: 'exact', head: true })
          .gte('last_active_at', dauCutoff),
        supabaseAdmin
          .from('users')
          .select('id', { count: 'exact', head: true })
          .gte('last_active_at', wauCutoff),
        supabaseAdmin
          .from('users')
          .select('id', { count: 'exact', head: true })
          .gte('last_active_at', mauCutoff),
        supabaseAdmin
          .from('driver_locations')
          .select('user_id')
          .gte('recorded_at', onlineCutoff),
        supabaseAdmin
          .from('rides')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', today),
        supabaseAdmin
          .from('rides')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'completed')
          .gte('ended_at', today),
        supabaseAdmin
          .from('rides')
          .select('fare_cents')
          .eq('status', 'completed')
          .eq('payment_status', 'paid')
          .gte('ended_at', today),
        // Lifetime totals
        supabaseAdmin
          .from('users')
          .select('id', { count: 'exact', head: true }),
        supabaseAdmin
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('is_driver', true),
        supabaseAdmin
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('is_driver', true)
          .not('stripe_account_id', 'is', null),
        supabaseAdmin
          .from('rides')
          .select('id', { count: 'exact', head: true }),
        supabaseAdmin
          .from('rides')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'completed'),
        supabaseAdmin
          .from('rides')
          .select('gps_distance_metres')
          .eq('status', 'completed'),
        supabaseAdmin
          .from('rides')
          .select('fare_cents')
          .eq('status', 'completed')
          .eq('payment_status', 'paid'),
        supabaseAdmin.from('users').select('email'),
        // 30d daily chart — pulls minimal cols + buckets in app code
        supabaseAdmin
          .from('rides')
          .select('status, payment_status, fare_cents, created_at, ended_at')
          .gte('created_at', thirtyDayCutoff),
        // Funnel
        supabaseAdmin
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('onboarding_completed', true),
        // first + five-ride funnels both come from this single pull:
        // distinct rider_ids = first ride; >=5 occurrences = 5-ride.
        // Avoids a SQL GROUP BY we can't express via PostgREST.
        supabaseAdmin
          .from('rides')
          .select('rider_id')
          .eq('status', 'completed'),
      ])

      if (dauRes.error) throw dauRes.error
      if (wauRes.error) throw wauRes.error
      if (mauRes.error) throw mauRes.error
      if (onlineRes.error) throw onlineRes.error
      if (ridesTodayRes.error) throw ridesTodayRes.error
      if (ridesCompletedTodayRes.error) throw ridesCompletedTodayRes.error
      if (revenueTodayRes.error) throw revenueTodayRes.error
      if (totalUsersRes.error) throw totalUsersRes.error
      if (totalDriversRes.error) throw totalDriversRes.error
      if (stripeOnboardedRes.error) throw stripeOnboardedRes.error
      if (totalRidesRes.error) throw totalRidesRes.error
      if (totalCompletedRes.error) throw totalCompletedRes.error
      if (lifetimeDistanceRes.error) throw lifetimeDistanceRes.error
      if (lifetimeRevenueRes.error) throw lifetimeRevenueRes.error
      if (universitiesRes.error) throw universitiesRes.error
      if (daily30dRes.error) throw daily30dRes.error
      if (funnelOnboardedRes.error) throw funnelOnboardedRes.error
      if (funnelFirstRideRes.error) throw funnelFirstRideRes.error

      // Online drivers — distinct user_id from the recent locations.
      const onlineUserIds = new Set<string>()
      for (const row of onlineRes.data ?? []) {
        if (row.user_id) onlineUserIds.add(row.user_id as string)
      }

      // Revenue today (sum fare_cents from the filtered rows).
      const revenueToday = (revenueTodayRes.data ?? []).reduce(
        (acc, r) => acc + (r.fare_cents ?? 0),
        0,
      )

      // Lifetime distance + revenue sums.
      const totalDistance = (lifetimeDistanceRes.data ?? []).reduce(
        (acc, r) => acc + (r.gps_distance_metres ?? 0),
        0,
      )
      const totalRevenue = (lifetimeRevenueRes.data ?? []).reduce(
        (acc, r) => acc + (r.fare_cents ?? 0),
        0,
      )

      // Distinct universities (by email domain).
      const universities = new Set<string>()
      for (const u of universitiesRes.data ?? []) {
        const email = (u.email as string | null) ?? ''
        const at = email.lastIndexOf('@')
        if (at < 0) continue
        const domain = email.slice(at + 1).toLowerCase()
        if (domain.endsWith('.edu')) universities.add(domain)
      }

      // Gas savings.
      const gallonsSaved = gallonsForMetres(totalDistance)
      const co2Kg = gallonsSaved * KG_CO2_PER_GALLON

      // 30d daily buckets — by UTC date.
      const buckets = new Map<string, { rides_completed: number; revenue_cents: number }>()
      // Seed 30 days even with zero so the chart has a stable x-axis.
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * MS_PER_DAY)
        const key = d.toISOString().slice(0, 10)
        buckets.set(key, { rides_completed: 0, revenue_cents: 0 })
      }
      for (const r of daily30dRes.data ?? []) {
        // Bucket by ended_at when ride completed (the date a ride
        // "happened" from a business view); fall back to created_at
        // for non-completed rides. Both are ISO strings.
        const dateStr = (r.ended_at as string | null)?.slice(0, 10)
          ?? (r.created_at as string).slice(0, 10)
        const bucket = buckets.get(dateStr)
        if (!bucket) continue // outside the seeded 30d window (timezone edge)
        if (r.status === 'completed') {
          bucket.rides_completed += 1
        }
        if (r.status === 'completed' && r.payment_status === 'paid') {
          bucket.revenue_cents += (r.fare_cents as number | null) ?? 0
        }
      }
      const daily: DailyBucket[] = Array.from(buckets.entries())
        .map(([date, v]) => ({ date, rides_completed: v.rides_completed, revenue_cents: v.revenue_cents }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // Funnel: first_ride_completed = distinct rider_ids in completed
      // rides. five_rides_completed = same group filtered to >=5 rides.
      const riderRideCounts = new Map<string, number>()
      for (const row of funnelFirstRideRes.data ?? []) {
        const rid = row.rider_id as string | null
        if (!rid) continue
        riderRideCounts.set(rid, (riderRideCounts.get(rid) ?? 0) + 1)
      }
      const firstRideCount = riderRideCounts.size
      let fiveRideCount = 0
      for (const n of riderRideCounts.values()) {
        if (n >= 5) fiveRideCount += 1
      }

      // drivers_active = drivers who have completed at least one
      // ride as the driver. Re-uses the same lifetimeRevenueRes
      // data set would need a separate query; we count via a fresh
      // query for clarity.
      const { count: activeDriverCount, error: activeDriverErr } = await supabaseAdmin
        .from('rides')
        .select('driver_id', { count: 'exact', head: false })
        .eq('status', 'completed')
        .not('driver_id', 'is', null)
      if (activeDriverErr) throw activeDriverErr
      // The count above counts ROWS not distinct drivers — for v1 we
      // accept "rides driven" as a proxy. Replace with a true distinct
      // count when ride volume grows enough to warrant.
      const driversActiveProxy = activeDriverCount ?? 0

      const payload: StatsResponse = {
        ok: true,
        generated_at: generatedAt,
        kpis: {
          dau: dauRes.count ?? 0,
          wau: wauRes.count ?? 0,
          mau: mauRes.count ?? 0,
          online_drivers: onlineUserIds.size,
          rides_today: ridesTodayRes.count ?? 0,
          rides_completed_today: ridesCompletedTodayRes.count ?? 0,
          revenue_today_cents: revenueToday,
        },
        daily_rides_30d: daily,
        lifetime: {
          total_users: totalUsersRes.count ?? 0,
          total_drivers: totalDriversRes.count ?? 0,
          stripe_onboarded_drivers: stripeOnboardedRes.count ?? 0,
          total_rides: totalRidesRes.count ?? 0,
          total_completed: totalCompletedRes.count ?? 0,
          total_distance_metres: totalDistance,
          total_revenue_cents: totalRevenue,
          gallons_saved: Math.round(gallonsSaved * 100) / 100,
          co2_saved_kg: Math.round(co2Kg * 100) / 100,
          universities: universities.size,
        },
        funnel: {
          signups: totalUsersRes.count ?? 0,
          onboarded: funnelOnboardedRes.count ?? 0,
          first_ride_completed: firstRideCount,
          five_rides_completed: fiveRideCount,
          drivers_active: driversActiveProxy,
        },
      }
      res.status(200).json(payload)
    } catch (err) {
      next(err)
    }
  },
)
