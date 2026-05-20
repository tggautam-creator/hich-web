/**
 * 2026-05-20 — fetches every user with a `last_known_at` in the last N
 * days (default 30) for the dashboard map. Distinct from `/admin/live`
 * which uses a tighter 1h / 24h window for real-time ops; this is the
 * longer-tail "where do we have users overall" view.
 */
import { useQuery } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

export interface AdminUserLocation {
  user_id: string
  name: string | null
  email: string | null
  is_driver: boolean
  lat: number
  lng: number
  last_known_at: string
}

export interface AdminUserLocationsResponse {
  ok: true
  window_days: number
  locations: AdminUserLocation[]
  truncated: boolean
  as_of: string
}

const STALE_MS = 5 * 60 * 1000

export function useAdminUserLocations(windowDays: number = 30) {
  return useQuery<AdminUserLocationsResponse>({
    queryKey: ['admin', 'metrics', 'user-locations', windowDays],
    queryFn: () =>
      adminGet<AdminUserLocationsResponse>(
        `/metrics/user-locations?window_days=${windowDays}`,
      ),
    staleTime: STALE_MS,
    refetchInterval: STALE_MS, // auto-refresh once per 5 min
  })
}
