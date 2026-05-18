/**
 * 2026-05-18 — hooks for `/admin/ride-board`. Shapes mirror
 * `server/routes/admin/rideBoard.ts`. Force-cancel + notify use
 * `useMutation` so the page can fire them from per-row buttons.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPost } from '@/lib/admin/api'

// ── shared types (mirror server response shapes) ──────────────────────────────

export interface RideBoardMetricsResponse {
  ok: true
  today: { posts: number; offers: number; accepts: number }
  warnings: {
    unanswered_posts_over_7d: number
    pending_offers_over_2d: number
    pending_offers_total: number
  }
  as_of: string
}

export interface RideBoardPost {
  id: string
  user_id: string
  poster_name: string | null
  poster_email: string | null
  origin_address: string | null
  dest_address: string | null
  trip_date: string | null
  trip_time: string | null
  mode: 'rider' | 'driver'
  offer_count: number
  created_at: string
}

export interface RideBoardPostsResponse {
  ok: true
  posts: RideBoardPost[]
  total: number
  limit: number
  offset: number
}

export interface RideBoardOffer {
  id: string
  driver_id: string
  driver_name: string | null
  driver_email: string | null
  schedule_id: string | null
  poster_id?: string | null
  poster_name?: string | null
  poster_email?: string | null
  origin_address?: string | null
  dest_address?: string | null
  trip_date?: string | null
  trip_time?: string | null
  status: 'pending' | 'selected' | 'standby' | 'released'
  proposed_pickup_name: string | null
  proposed_dropoff_name: string | null
  proposed_fare_cents: number | null
  estimated_fare_cents: number | null
  proposed_transit_line_name: string | null
  overlap_pct: number | null
  created_at: string
}

export interface RideBoardOffersResponse {
  ok: true
  offers: RideBoardOffer[]
  total: number
  limit: number
  offset: number
}

export interface RideBoardPostOffersResponse {
  ok: true
  offers: RideBoardOffer[]
}

// ── hooks ─────────────────────────────────────────────────────────────────────

const METRICS_STALE_MS = 30 * 1000

export function useRideBoardMetrics(enabled = true) {
  return useQuery<RideBoardMetricsResponse>({
    queryKey: ['admin', 'ride-board', 'metrics'],
    queryFn: () => adminGet<RideBoardMetricsResponse>('/ride-board/metrics'),
    enabled,
    staleTime: METRICS_STALE_MS,
    refetchInterval: METRICS_STALE_MS, // auto-refresh once per 30s
  })
}

export interface UseRideBoardPostsArgs {
  mode?: 'rider' | 'driver'
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
  enabled?: boolean
}

export function useRideBoardPosts(args: UseRideBoardPostsArgs = {}) {
  const { mode, date_from, date_to, limit = 50, offset = 0, enabled = true } = args
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (mode) params.set('mode', mode)
  if (date_from) params.set('date_from', date_from)
  if (date_to) params.set('date_to', date_to)

  return useQuery<RideBoardPostsResponse>({
    queryKey: ['admin', 'ride-board', 'posts', mode, date_from, date_to, limit, offset],
    queryFn: () =>
      adminGet<RideBoardPostsResponse>(`/ride-board/posts?${params.toString()}`),
    enabled,
    placeholderData: keepPreviousData,
  })
}

export interface UseRideBoardOffersArgs {
  status?: 'pending' | 'selected' | 'standby' | 'released'
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
  enabled?: boolean
}

export function useRideBoardOffers(args: UseRideBoardOffersArgs = {}) {
  const { status, date_from, date_to, limit = 50, offset = 0, enabled = true } = args
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (status) params.set('status', status)
  if (date_from) params.set('date_from', date_from)
  if (date_to) params.set('date_to', date_to)

  return useQuery<RideBoardOffersResponse>({
    queryKey: ['admin', 'ride-board', 'offers', status, date_from, date_to, limit, offset],
    queryFn: () =>
      adminGet<RideBoardOffersResponse>(`/ride-board/offers?${params.toString()}`),
    enabled,
    placeholderData: keepPreviousData,
  })
}

export function useRideBoardPostOffers(postId: string | null) {
  return useQuery<RideBoardPostOffersResponse>({
    queryKey: ['admin', 'ride-board', 'post-offers', postId],
    queryFn: () =>
      adminGet<RideBoardPostOffersResponse>(`/ride-board/posts/${postId}/offers`),
    enabled: !!postId,
  })
}

// ── mutations ────────────────────────────────────────────────────────────────

export function useForceCancelOffer() {
  const qc = useQueryClient()
  return useMutation<
    { ok: true; offer_id: string; prior_status: string },
    Error,
    { offerId: string; reason: string }
  >({
    mutationFn: ({ offerId, reason }) =>
      adminPost(`/ride-board/offers/${offerId}/force-cancel`, { reason }),
    onSuccess: () => {
      // Refresh every list — the offer's status flipped and the
      // metrics card's pending count needs to drop too.
      void qc.invalidateQueries({ queryKey: ['admin', 'ride-board'] })
    },
  })
}

export function useNotifyUser() {
  return useMutation<
    { ok: true; campaign_id: string; slug: string },
    Error,
    { userId: string; title: string; body: string; reason?: string }
  >({
    mutationFn: ({ userId, title, body, reason }) =>
      adminPost(`/users/${userId}/actions/notify`, { title, body, reason }),
  })
}

// ── Analytics — funnel ───────────────────────────────────────────────────────

export interface FunnelStage {
  stage: 'posted' | 'offered' | 'selected' | 'completed'
  count: number
}

export interface FunnelResponse {
  ok: true
  window_days: number
  overall: FunnelStage[]
  by_mode: { rider: FunnelStage[]; driver: FunnelStage[] }
  by_week: { week_start: string; posted: number; offered: number; selected: number; completed: number }[]
  as_of: string
}

export function useRideBoardFunnel(windowDays = 30) {
  return useQuery<FunnelResponse>({
    queryKey: ['admin', 'ride-board', 'funnel', windowDays],
    queryFn: () => adminGet<FunnelResponse>(`/ride-board/funnel?window=${windowDays}`),
    staleTime: 60 * 1000,
  })
}

// ── Analytics — cities ───────────────────────────────────────────────────────

export interface RouteRow {
  origin_city: string
  dest_city: string
  mode: 'rider' | 'driver'
  post_count: number
  matched_count: number
  match_rate: number
}

export interface UnmatchedRow {
  origin_city: string
  dest_city: string
  post_count: number
}

export interface CitiesResponse {
  ok: true
  window_days: number
  top_routes: RouteRow[]
  unmatched_demand: UnmatchedRow[]
  unmatched_supply: UnmatchedRow[]
  as_of: string
}

export function useRideBoardCities(windowDays = 30) {
  return useQuery<CitiesResponse>({
    queryKey: ['admin', 'ride-board', 'cities', windowDays],
    queryFn: () => adminGet<CitiesResponse>(`/ride-board/cities?window=${windowDays}`),
    staleTime: 60 * 1000,
  })
}

// ── Analytics — time patterns ────────────────────────────────────────────────

export interface DailyTrendPoint {
  day: string
  posts: number
  offers: number
  selected: number
}

export interface TimePatternsResponse {
  ok: true
  window_days: number
  /** [day-of-week 0-6][hour 0-23] post counts. */
  hour_day_heatmap: number[][]
  daily_trend: DailyTrendPoint[]
  as_of: string
}

export function useRideBoardTimePatterns(windowDays = 14) {
  return useQuery<TimePatternsResponse>({
    queryKey: ['admin', 'ride-board', 'time-patterns', windowDays],
    queryFn: () =>
      adminGet<TimePatternsResponse>(`/ride-board/time-patterns?window=${windowDays}`),
    staleTime: 60 * 1000,
  })
}

// ── Analytics — power users ──────────────────────────────────────────────────

export interface TopPoster {
  user_id: string
  full_name: string | null
  email: string | null
  posts: number
  matched: number
  match_rate: number
}

export interface TopDriver {
  user_id: string
  full_name: string | null
  email: string | null
  offers: number
  selected: number
  accept_rate: number
}

export interface PowerUsersResponse {
  ok: true
  window_days: number
  top_posters: TopPoster[]
  top_drivers: TopDriver[]
  as_of: string
}

export function useRideBoardPowerUsers(windowDays = 30) {
  return useQuery<PowerUsersResponse>({
    queryKey: ['admin', 'ride-board', 'power-users', windowDays],
    queryFn: () =>
      adminGet<PowerUsersResponse>(`/ride-board/power-users?window=${windowDays}`),
    staleTime: 60 * 1000,
  })
}

// ── Analytics — activity feed ────────────────────────────────────────────────

export interface ActivityEvent {
  kind: 'post' | 'offer'
  id: string
  created_at: string
  user_id: string
  user_name: string | null
  user_email: string | null
  origin_address: string | null
  dest_address: string | null
  offer_status?: string | null
}

export interface ActivityResponse {
  ok: true
  events: ActivityEvent[]
  as_of: string
}

const ACTIVITY_REFRESH_MS = 15 * 1000

export function useRideBoardActivity(limit = 50) {
  return useQuery<ActivityResponse>({
    queryKey: ['admin', 'ride-board', 'activity', limit],
    queryFn: () => adminGet<ActivityResponse>(`/ride-board/activity?limit=${limit}`),
    refetchInterval: ACTIVITY_REFRESH_MS,
    staleTime: ACTIVITY_REFRESH_MS,
  })
}
