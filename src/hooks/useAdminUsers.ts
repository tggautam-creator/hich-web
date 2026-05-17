import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

/**
 * Slice 1.3a — admin user search + profile detail hooks.
 *
 * Mirrors the response shapes in server/routes/admin/users.ts.
 * Keep both files in sync.
 */

export interface AdminSearchHit {
  id: string
  email: string
  full_name: string | null
  is_driver: boolean
  created_at: string
  last_active_at: string | null
}

export interface AdminUserSearch {
  ok: true
  q: string
  total: number
  users: AdminSearchHit[]
  limit: number
  offset: number
}

export interface AdminUserOverview {
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

const ONE_MIN_MS = 60 * 1000
const FIVE_MIN_MS = 5 * ONE_MIN_MS

export function useAdminUserSearch(args: {
  q: string
  limit?: number
  offset?: number
}) {
  const { q, limit = 25, offset = 0 } = args
  return useQuery<AdminUserSearch>({
    queryKey: ['admin', 'users', 'search', q, limit, offset],
    queryFn: () =>
      adminGet<AdminUserSearch>(
        `/users/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
      ),
    // keepPreviousData → the result list doesn't flicker between
    // keystrokes while the next search resolves.
    placeholderData: keepPreviousData,
    // 1-min freshness: marketing tweaks the query a lot; we don't
    // want to re-hit the server on every back-tab.
    staleTime: ONE_MIN_MS,
  })
}

export function useAdminUserDetail(userId: string | undefined) {
  return useQuery<AdminUserOverview>({
    queryKey: ['admin', 'users', 'detail', userId],
    queryFn: () => adminGet<AdminUserOverview>(`/users/${userId}`),
    enabled: typeof userId === 'string' && userId.length > 0,
    staleTime: FIVE_MIN_MS,
  })
}
