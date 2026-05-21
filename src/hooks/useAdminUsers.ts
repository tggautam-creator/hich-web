import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { adminGet, adminPost } from '@/lib/admin/api'

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
    /** Slice 1.11 — most recent GPS upload via POST /api/users/me/location. */
    last_known_lat: number | null
    last_known_lng: number | null
    last_known_at: string | null
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

const ONE_MIN_MS = 60 * 1000
const FIVE_MIN_MS = 5 * ONE_MIN_MS

/**
 * 2026-05-19 — filter & sort additions.
 *   role / active / has_push / platform / university   filter chips
 *   sort                                                sort dropdown
 */
export type AdminUserRole = 'rider' | 'driver' | 'both'
export type AdminUserActive = '' | '1h' | '24h' | '7d' | 'dormant'
export type AdminUserHasPush = '' | 'yes' | 'no'
export type AdminUserPlatform = '' | 'ios' | 'web' | 'android'
export type AdminUserSort = 'newest' | 'oldest' | 'last_active' | 'name'

export function useAdminUserSearch(args: {
  q: string
  limit?: number
  offset?: number
  role?: AdminUserRole
  active?: AdminUserActive
  has_push?: AdminUserHasPush
  platform?: AdminUserPlatform
  university?: string
  sort?: AdminUserSort
}) {
  const {
    q,
    limit = 25,
    offset = 0,
    role = 'both',
    active = '',
    has_push = '',
    platform = '',
    university = '',
    sort = 'newest',
  } = args

  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (role !== 'both') params.set('role', role)
  if (active) params.set('active', active)
  if (has_push) params.set('has_push', has_push)
  if (platform) params.set('platform', platform)
  if (university) params.set('university', university)
  if (sort !== 'newest') params.set('sort', sort)
  params.set('limit', String(limit))
  params.set('offset', String(offset))

  return useQuery<AdminUserSearch>({
    queryKey: [
      'admin', 'users', 'search', q, limit, offset, role, active, has_push, platform, university, sort,
    ],
    queryFn: () => adminGet<AdminUserSearch>(`/users/search?${params.toString()}`),
    placeholderData: keepPreviousData,
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
  payment_status: string | null
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

// ── 2026-05-20 — board posts (ride_schedules) ───────────────────────────────

export type AdminScheduleStatus = 'upcoming' | 'past' | 'all'
export type AdminScheduleSort = 'date_desc' | 'date_asc'

export interface AdminUserSchedule {
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
  pending_offers_count: number
}

export interface AdminUserSchedules {
  ok: true
  schedules: AdminUserSchedule[]
  total: number
  upcoming_count: number
  past_count: number
  limit: number
  offset: number
}

export function useAdminUserSchedules(args: {
  userId: string | undefined
  enabled: boolean
  status: AdminScheduleStatus
  sort: AdminScheduleSort
  limit?: number
  offset?: number
}) {
  const { userId, enabled, status, sort, limit = 25, offset = 0 } = args
  const params = new URLSearchParams({
    status,
    sort,
    limit: String(limit),
    offset: String(offset),
  })
  return useQuery<AdminUserSchedules>({
    queryKey: ['admin', 'users', 'schedules', userId, status, sort, limit, offset],
    queryFn: () =>
      adminGet<AdminUserSchedules>(
        `/users/${userId}/schedules?${params.toString()}`,
      ),
    enabled: enabled && typeof userId === 'string' && userId.length > 0,
    placeholderData: keepPreviousData,
    staleTime: FIVE_MIN_MS,
  })
}

// ── 2026-05-20 — driver routines (recurring weekly schedules) ───────────────

export type AdminRoutineStatus = 'active' | 'inactive' | 'all'
export type AdminRoutineSort = 'newest' | 'oldest'

export interface AdminUserRoutine {
  id: string
  route_name: string
  direction_type: 'one_way' | 'roundtrip'
  day_of_week: number[]
  departure_time: string | null
  arrival_time: string | null
  is_active: boolean
  created_at: string
}

export interface AdminUserRoutines {
  ok: true
  routines: AdminUserRoutine[]
  total: number
  active_count: number
  inactive_count: number
  limit: number
  offset: number
}

export function useAdminUserRoutines(args: {
  userId: string | undefined
  enabled: boolean
  status: AdminRoutineStatus
  sort: AdminRoutineSort
  limit?: number
  offset?: number
}) {
  const { userId, enabled, status, sort, limit = 25, offset = 0 } = args
  const params = new URLSearchParams({
    status,
    sort,
    limit: String(limit),
    offset: String(offset),
  })
  return useQuery<AdminUserRoutines>({
    queryKey: ['admin', 'users', 'routines', userId, status, sort, limit, offset],
    queryFn: () =>
      adminGet<AdminUserRoutines>(
        `/users/${userId}/routines?${params.toString()}`,
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

// ── Slice 1.3c — Admin Actions tab hooks ────────────────────────────────────

export interface AdminAuditRow {
  id: string
  admin_id: string
  admin_email: string | null
  action: string
  payload: Record<string, unknown>
  created_at: string
}

export interface AdminUserAudit {
  ok: true
  audit: AdminAuditRow[]
  total: number
  limit: number
  offset: number
}

export function useAdminUserAudit(args: {
  userId: string | undefined
  enabled: boolean
  limit?: number
  offset?: number
}) {
  const { userId, enabled, limit = 25, offset = 0 } = args
  return useQuery<AdminUserAudit>({
    queryKey: ['admin', 'users', 'audit', userId, limit, offset],
    queryFn: () =>
      adminGet<AdminUserAudit>(`/users/${userId}/audit?limit=${limit}&offset=${offset}`),
    enabled: enabled && typeof userId === 'string' && userId.length > 0,
    placeholderData: keepPreviousData,
    // Audit rows write-once-read-many; a 30s window keeps the UI
    // fresh enough to show a just-fired action without hammering.
    staleTime: 30 * 1000,
  })
}

interface SendPushArgs { title: string; body: string; reason?: string }
interface SendPushResult { ok: true; sent: number; total_tokens: number }

/**
 * Builds a useMutation that fires an admin action against userId.
 * On success, invalidates the audit list + (when relevant) the
 * tab the action affects so the UI refreshes without a manual reload.
 */
export function useAdminSendPush(userId: string) {
  const qc = useQueryClient()
  return useMutation<SendPushResult, Error, SendPushArgs>({
    mutationFn: (args) =>
      adminPost<SendPushResult>(`/users/${userId}/actions/push`, args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'audit', userId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'notifications', userId] })
    },
  })
}

interface GrantCreditArgs { amount_cents: number; reason: string }
interface GrantCreditResult { ok: true; amount_cents: number; balance_after_cents: number | null }

export function useAdminGrantCredit(userId: string) {
  const qc = useQueryClient()
  return useMutation<GrantCreditResult, Error, GrantCreditArgs>({
    mutationFn: (args) =>
      adminPost<GrantCreditResult>(`/users/${userId}/actions/credit`, args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'audit', userId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'wallet', userId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'detail', userId] })
    },
  })
}

interface OverrideOnbArgs { onboarding_completed: boolean; reason: string }
interface OverrideOnbResult { ok: true; changed: boolean; onboarding_completed: boolean }

export interface AdminStripeBalance {
  ok: true
  available_cents: number
  pending_cents: number
  currency: string
}

/**
 * Tago's Stripe platform available balance. Used by the Grant Credit
 * form to (a) display the available balance to the admin, and (b)
 * client-side disable Credit when the requested grant exceeds it
 * (server enforces the same gate; this is the early-warning UI).
 *
 * Stale time 30s — balance changes whenever a top-up or withdrawal
 * processes, but we don't need real-time freshness on this surface.
 */
export function useAdminStripeBalance(enabled: boolean) {
  return useQuery<AdminStripeBalance>({
    queryKey: ['admin', 'stripe', 'balance'],
    queryFn: () => adminGet<AdminStripeBalance>('/stripe/balance'),
    enabled,
    staleTime: 30 * 1000,
  })
}

export function useAdminOverrideOnboarding(userId: string) {
  const qc = useQueryClient()
  return useMutation<OverrideOnbResult, Error, OverrideOnbArgs>({
    mutationFn: (args) =>
      adminPost<OverrideOnbResult>(`/users/${userId}/actions/override-onboarding`, args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'audit', userId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'detail', userId] })
    },
  })
}

interface SuspendArgs { suspended: boolean; reason?: string }
interface SuspendResult {
  ok: true
  changed: boolean
  suspended: boolean
  reason?: string | null
}

export function useAdminSuspend(userId: string) {
  const qc = useQueryClient()
  return useMutation<SuspendResult, Error, SuspendArgs>({
    mutationFn: (args) =>
      adminPost<SuspendResult>(`/users/${userId}/actions/suspend`, args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'audit', userId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'detail', userId] })
    },
  })
}

interface ResetPasswordArgs { reason?: string }
interface ResetPasswordResult { ok: true; email: string }

export function useAdminResetPassword(userId: string) {
  const qc = useQueryClient()
  return useMutation<ResetPasswordResult, Error, ResetPasswordArgs>({
    mutationFn: (args) =>
      adminPost<ResetPasswordResult>(`/users/${userId}/actions/reset-password`, args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'audit', userId] })
    },
  })
}

// ── Slice 1.3e — refund a ride ──────────────────────────────────────────────

export interface AdminRefundArgs {
  reason: string
  allow_driver_overdraft?: boolean
}

export interface AdminRefundResult {
  ok: true
  ride_id: string
  fare_cents: number
  rider_balance_after_cents: number | null
  driver_balance_after_cents: number | null
}

/**
 * Mutation for refunding a ride.
 * Caller must know the rideId AND the currently-viewed user id (for
 * invalidating that user's wallet / rides / audit queries on success).
 */
export function useAdminRefundRide(args: { rideId: string; viewedUserId: string }) {
  const { rideId, viewedUserId } = args
  const qc = useQueryClient()
  return useMutation<AdminRefundResult, Error, AdminRefundArgs>({
    mutationFn: (body) =>
      adminPost<AdminRefundResult>(`/rides/${rideId}/refund`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'audit', viewedUserId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'wallet', viewedUserId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'users', 'rides', viewedUserId] })
    },
  })
}
