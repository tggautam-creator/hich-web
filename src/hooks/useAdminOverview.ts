import { useQuery } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

/**
 * Response shape mirrors `OverviewResponse` in
 * server/routes/admin/metrics.ts. Keep in sync — server change without
 * client update will make TypeScript complain at the call site, which
 * is the early-warning we want.
 */
export interface AdminOverview {
  ok: true
  kpis: {
    total_users: number
    new_signups_today: number
    active_users: { dau: number; wau: number; mau: number }
    active_rides_now: number
    rides_completed_today: number
    revenue_this_week_cents: number
    ios_install_rate: number | null
    driver_activation_rate: number | null
    rider_activation_rate: number | null
    retention_7d: number | null
    avg_ride_fare_cents: number | null
    avg_driver_rating: number | null
  }
  charts: {
    signups_14d: Array<{ date: string; count: number }>
    completed_rides_14d: Array<{ date: string; count: number }>
    top_email_domains: Array<{ domain: string; count: number }>
  }
  generated_at: string
  data_through: string
}

const FIVE_MIN_MS = 5 * 60 * 1000

/**
 * Loads the admin Overview dashboard payload.
 * Cached 5 min — matches the server-side spec from ADMIN_PLAN.md.
 * Re-fetches automatically on window focus so a returning admin sees
 * fresh numbers without a manual refresh.
 */
export function useAdminOverview() {
  return useQuery<AdminOverview>({
    queryKey: ['admin', 'overview'],
    queryFn: () => adminGet<AdminOverview>('/metrics/overview'),
    staleTime: FIVE_MIN_MS,
    gcTime: FIVE_MIN_MS * 2,
  })
}
