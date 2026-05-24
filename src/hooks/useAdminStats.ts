/**
 * 2026-05-23 — network-wide stats dashboard hook. Mirrors
 * server/routes/admin/stats.ts; keep both in sync.
 */
import { useQuery } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

const SIXTY_SEC_MS = 60 * 1000

export interface AdminStatsDailyBucket {
  date: string
  rides_completed: number
  revenue_cents: number
}

export interface AdminStatsResponse {
  ok: true
  generated_at: string
  kpis: {
    dau: number
    wau: number
    mau: number
    online_drivers: number
    rides_today: number
    rides_completed_today: number
    revenue_today_cents: number
  }
  daily_rides_30d: AdminStatsDailyBucket[]
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
  funnel: {
    signups: number
    onboarded: number
    first_ride_completed: number
    five_rides_completed: number
    drivers_active: number
  }
}

export function useAdminStats() {
  return useQuery<AdminStatsResponse>({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminGet<AdminStatsResponse>('/stats'),
    staleTime: SIXTY_SEC_MS,
    refetchInterval: SIXTY_SEC_MS,
  })
}
