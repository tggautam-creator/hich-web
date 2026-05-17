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

// ── Slice 1.3b — per-tab hooks ───────────────────────────────────────────────

export interface AdminUserRide {
  id: string
  status: string
  role: 'rider' | 'driver'
  other_party_id: string | null
  origin_name: string | null
  destination_name: string | null
  fare_cents: number | null
  created_at: string
  ended_at: string | null
}

export interface AdminUserRides {
  ok: true
  rides: AdminUserRide[]
  total: number
  limit: number
  offset: number
}

export function useAdminUserRides(args: {
  userId: string | undefined
  enabled: boolean
  limit?: number
  offset?: number
}) {
  const { userId, enabled, limit = 25, offset = 0 } = args
  return useQuery<AdminUserRides>({
    queryKey: ['admin', 'users', 'rides', userId, limit, offset],
    queryFn: () =>
      adminGet<AdminUserRides>(`/users/${userId}/rides?limit=${limit}&offset=${offset}`),
    enabled: enabled && typeof userId === 'string' && userId.length > 0,
    placeholderData: keepPreviousData,
    staleTime: FIVE_MIN_MS,
  })
}

export interface AdminWalletTxn {
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

export interface AdminUserWallet {
  ok: true
  wallet_balance_cents: number
  transactions: AdminWalletTxn[]
  total: number
  limit: number
  offset: number
}

export function useAdminUserWallet(args: {
  userId: string | undefined
  enabled: boolean
  limit?: number
  offset?: number
}) {
  const { userId, enabled, limit = 25, offset = 0 } = args
  return useQuery<AdminUserWallet>({
    queryKey: ['admin', 'users', 'wallet', userId, limit, offset],
    queryFn: () =>
      adminGet<AdminUserWallet>(`/users/${userId}/wallet?limit=${limit}&offset=${offset}`),
    enabled: enabled && typeof userId === 'string' && userId.length > 0,
    placeholderData: keepPreviousData,
    staleTime: FIVE_MIN_MS,
  })
}

export interface AdminUserNotification {
  id: string
  type: string
  title: string
  body: string
  is_read: boolean
  created_at: string
}

export interface AdminUserNotifications {
  ok: true
  notifications: AdminUserNotification[]
  total: number
  limit: number
  offset: number
}

export function useAdminUserNotifications(args: {
  userId: string | undefined
  enabled: boolean
  limit?: number
  offset?: number
}) {
  const { userId, enabled, limit = 25, offset = 0 } = args
  return useQuery<AdminUserNotifications>({
    queryKey: ['admin', 'users', 'notifications', userId, limit, offset],
    queryFn: () =>
      adminGet<AdminUserNotifications>(
        `/users/${userId}/notifications?limit=${limit}&offset=${offset}`,
      ),
    enabled: enabled && typeof userId === 'string' && userId.length > 0,
    placeholderData: keepPreviousData,
    staleTime: FIVE_MIN_MS,
  })
}

export interface AdminUserDevice {
  id: string
  token_suffix: string
  platform: 'ios' | 'android' | 'web' | null
  created_at: string
}

export interface AdminUserDevices {
  ok: true
  devices: AdminUserDevice[]
  total: number
}

export function useAdminUserDevices(args: {
  userId: string | undefined
  enabled: boolean
}) {
  const { userId, enabled } = args
  return useQuery<AdminUserDevices>({
    queryKey: ['admin', 'users', 'devices', userId],
    queryFn: () => adminGet<AdminUserDevices>(`/users/${userId}/devices`),
    enabled: enabled && typeof userId === 'string' && userId.length > 0,
    staleTime: FIVE_MIN_MS,
  })
}
