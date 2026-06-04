/**
 * v1.3 Sprint 12 Slice 5b — React Query wrapper over
 * `GET /api/users/me/stats`. Mirrors iOS
 * `ProfilePage.loadUserStats()` lifecycle.
 *
 * Stays silent on error (matches iOS — `if let response = try? await
 * api.send(UserStatsEndpoint())`). Callers fall back to the cached
 * `auth.profile` rating values so the TrustBadges row never pops in
 * — it just sharpens once the server response lands.
 *
 * No polling (data is stable across the page lifetime); refetches on
 * window-focus so a freshly-completed ride bumps the count without a
 * manual reload.
 */
import { useQuery } from '@tanstack/react-query'
import { fetchMyStats, type MyStats } from '@/lib/userStatsApi'

interface UseMyStatsOptions {
  enabled?: boolean
}

export function useMyStats({ enabled = true }: UseMyStatsOptions = {}) {
  return useQuery<MyStats>({
    queryKey: ['users', 'me', 'stats'],
    queryFn: fetchMyStats,
    enabled,
    retry: false,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  })
}
