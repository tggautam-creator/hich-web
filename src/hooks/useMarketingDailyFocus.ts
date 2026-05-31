/**
 * Hooks for Feature 3 — Daily focus brief.
 *
 * 4 endpoints: GET today's brief, spawn an advisor thread from it,
 * dismiss it, regenerate it. The GET refetches every 60s + on focus
 * so the founder switching tabs picks up overnight cron writes.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPost } from '@/lib/admin/api'

export type FocusPriority = 'high' | 'medium' | 'low'
export type FocusTag = 'supply' | 'demand' | 'content' | 'events' | 'ops' | 'growth'

export interface DailyFocusRecommendation {
  text: string
  priority: FocusPriority
  tag: FocusTag
}

export interface KpiDelta {
  // null when the prior value was zero (math undefined). UI renders
  // as "new" rather than 0% flat.
  dau_vs_yesterday_pct: number | null
  revenue_vs_yesterday_pct: number | null
  revenue_vs_7d_avg_pct: number | null
  rides_vs_7d_avg_pct: number | null
}

export interface DailyFocusContext {
  today: { iso: string; day_of_week: string; pt_offset_hours: number }
  kpis: {
    dau: number; wau: number; mau: number
    online_drivers: number; total_users: number; total_drivers: number
    stripe_onboarded_drivers: number; total_completed: number
    revenue_today_cents: number; universities: number
    rides_yesterday: number; rides_today_so_far: number
    revenue_yesterday_cents: number; revenue_last_7d_cents: number
    rides_last_7d: number; signups_yesterday: number; signups_last_7d: number
    dau_yesterday: number; delta: KpiDelta
  }
  events: {
    reminders: Array<{ id: string; title: string; event_date: string; category: string; target_audience: string; days_until: number; has_posters: boolean; has_stories: boolean }>
    next_7d: Array<{ id: string; title: string; event_date: string; category: string; target_audience: string; days_until: number; has_posters: boolean; has_stories: boolean }>
    next_14d: Array<{ id: string; title: string; event_date: string; category: string; target_audience: string; days_until: number; has_posters: boolean; has_stories: boolean }>
  }
  theme: { theme_name: string | null; theme_summary: string | null; week_focus: string | null; week_index: number }
  history: {
    stories_yesterday: Array<{ corridor: string; asking_for: string; headline: string; status: string }>
    posters_yesterday: Array<{ format: string; audience: string; headline: string; theme_angle: string | null; status: string }>
    yesterday_focus: string | null
  }
}

export interface DailyFocusBrief {
  id: string
  for_date: string
  generated_at: string
  llm_model: string | null
  dismissed_at: string | null
  focus: string | null
  detail: string | null
  recommendations: DailyFocusRecommendation[]
  kpi_snapshot: DailyFocusContext | null
  thread_id: string | null
  input_tokens: number | null
  output_tokens: number | null
  error: string | null
}

interface BriefResponse {
  ok: true
  brief: DailyFocusBrief
}

const QUERY_KEY = ['admin', 'marketing', 'daily-focus'] as const

export function useDailyFocus() {
  return useQuery<DailyFocusBrief | null>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      try {
        const r = await adminGet<BriefResponse>('/marketing/advisor/daily-focus')
        return r.brief
      } catch (err) {
        // 204 (no brief yet today, before 7 AM PT) surfaces as
        // null — adminGet throws on non-2xx but we want a clean
        // empty state. Re-throw anything that looks like a real
        // error so the UI can show it.
        const msg = err instanceof Error ? err.message : String(err)
        if (/204|no body|empty response/i.test(msg)) return null
        throw err
      }
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

export function useStartDailyFocusThread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      adminPost<{ ok: true; thread_id: string }>(
        '/marketing/advisor/daily-focus/start-thread', {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

export function useDismissDailyFocus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => adminPost<{ ok: true }>('/marketing/advisor/daily-focus/dismiss', {}),
    onMutate: async () => {
      // Optimistic hide so the banner disappears immediately on
      // click instead of flickering during the network roundtrip.
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const previous = qc.getQueryData<DailyFocusBrief | null>(QUERY_KEY)
      if (previous) {
        qc.setQueryData<DailyFocusBrief | null>(QUERY_KEY, {
          ...previous,
          dismissed_at: new Date().toISOString(),
        })
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      // Rollback if the server rejected.
      if (ctx?.previous !== undefined) {
        qc.setQueryData<DailyFocusBrief | null>(QUERY_KEY, ctx.previous)
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

export function useRegenerateDailyFocus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      adminPost<BriefResponse>('/marketing/advisor/daily-focus/regenerate', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY })
      // Pro/Flash quota counter changes too.
      void qc.invalidateQueries({ queryKey: ['admin', 'api-usage'] })
    },
  })
}
