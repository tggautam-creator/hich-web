import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

/**
 * Slice 1.2 — admin funnel breakdown hooks.
 *
 * Two endpoints, two hooks:
 *   - useAdminFunnel(range, mode)
 *       → step counts + drop-off % for the funnel chart
 *   - useAdminStuckUsers(step, range, mode, limit, offset)
 *       → paginated list of users stuck at a given step
 *         (only fires when `step` is non-null, ie the drawer is open)
 *
 * Response shapes mirror server/routes/admin/funnel.ts exactly — keep
 * the two files in sync so TypeScript flags drift at the call sites.
 */

export type FunnelStep =
  | 'signed_up'
  | 'verified_email'
  | 'completed_profile'
  | 'payment_or_vehicle'
  | 'completed_first_ride'

export type FunnelRange = '7d' | '30d' | '90d' | 'all'
export type FunnelMode = 'rider' | 'driver' | 'both'

export interface FunnelStepResult {
  key: FunnelStep
  label: string
  count: number
  drop_off_from_previous_pct: number | null
  drop_off_from_top_pct: number | null
}

export interface AdminFunnel {
  ok: true
  range: FunnelRange
  mode: FunnelMode
  steps: FunnelStepResult[]
  total_in_cohort: number
  generated_at: string
}

export interface StuckUser {
  id: string
  email: string
  full_name: string | null
  is_driver: boolean
  created_at: string
  days_since_signup: number
}

export interface AdminStuckUsers {
  ok: true
  step: FunnelStep
  range: FunnelRange
  mode: FunnelMode
  total: number
  users: StuckUser[]
  limit: number
  offset: number
}

const FIVE_MIN_MS = 5 * 60 * 1000

export function useAdminFunnel(range: FunnelRange, mode: FunnelMode) {
  return useQuery<AdminFunnel>({
    queryKey: ['admin', 'funnel', range, mode],
    queryFn: () =>
      adminGet<AdminFunnel>(`/metrics/funnel?range=${range}&mode=${mode}`),
    // keepPreviousData so the chart doesn't blank out when the user
    // flips a filter — they see the old bars dim slightly while the
    // new fetch resolves.
    placeholderData: keepPreviousData,
    staleTime: FIVE_MIN_MS,
    gcTime: FIVE_MIN_MS * 2,
  })
}

export function useAdminStuckUsers(args: {
  step: FunnelStep | null
  range: FunnelRange
  mode: FunnelMode
  limit?: number
  offset?: number
}) {
  const { step, range, mode, limit = 50, offset = 0 } = args
  return useQuery<AdminStuckUsers>({
    queryKey: ['admin', 'stuck-users', step, range, mode, limit, offset],
    queryFn: () =>
      adminGet<AdminStuckUsers>(
        `/users/stuck?step=${step}&range=${range}&mode=${mode}&limit=${limit}&offset=${offset}`,
      ),
    enabled: step !== null,
    placeholderData: keepPreviousData,
    staleTime: FIVE_MIN_MS,
  })
}
