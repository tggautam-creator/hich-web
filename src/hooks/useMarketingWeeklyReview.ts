/**
 * Hooks for Feature 4 — Weekly Slack review.
 *
 * Cron runs Mondays after 9 AM PT, summarizing last Mon→Sun and
 * posting to the SLACK_MARKETING_WEBHOOK_URL channel. These hooks
 * surface the most recent run + manual generate/send/test-ping.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPost } from '@/lib/admin/api'

export interface WeeklyHighlight {
  icon: string
  text: string
}

export interface WeeklyContext {
  for_week_starting: string
  for_week_ending: string
  metrics: {
    rides_this_week: number
    revenue_this_week_cents: number
    rides_prev_week: number
    revenue_prev_week_cents: number
    signups_this_week: number
    signups_prev_week: number
    dau_this_week: number
    new_drivers_this_week: number
  }
  content: {
    stories_shipped: number
    stories_posted: number
    stories_skipped: number
    posters_shipped: number
    posters_posted: number
    posters_skipped: number
    top_corridors: string[]
    top_poster_angles: string[]
  }
  theme: { theme_name: string | null; theme_summary: string | null }
  events: {
    next_7d: Array<{ title: string; event_date: string; category: string; days_until: number }>
  }
}

export interface WeeklyReview {
  id: string
  for_week_starting: string
  generated_at: string
  llm_model: string | null
  summary: string | null
  highlights: WeeklyHighlight[]
  next_week_focus: string | null
  context_snapshot: WeeklyContext | null
  slack_payload: unknown | null
  slack_sent_at: string | null
  slack_response_status: number | null
  slack_response_body: string | null
  input_tokens: number | null
  output_tokens: number | null
  error: string | null
}

export interface WeeklyHistoryRow {
  id: string
  for_week_starting: string
  generated_at: string
  summary: string | null
  slack_sent_at: string | null
  slack_response_status: number | null
  error: string | null
}

interface GetResponse {
  ok: true
  current: WeeklyReview | null
  history: WeeklyHistoryRow[]
  week_starting: string
}

const QUERY_KEY = ['admin', 'marketing', 'weekly-review'] as const

export function useWeeklyReview() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => adminGet<GetResponse>('/marketing/weekly-review'),
    staleTime: 60 * 1000,
  })
}

export function useGenerateWeeklyReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      adminPost<{ ok: true; review: WeeklyReview }>('/marketing/weekly-review/generate', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY })
      void qc.invalidateQueries({ queryKey: ['admin', 'api-usage'] })
    },
  })
}

export function useSendWeeklyReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      adminPost<{ ok: boolean; status: number; body: string; review: WeeklyReview }>(
        '/marketing/weekly-review/send', {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: () =>
      adminPost<{ ok: boolean; status: number; body: string }>(
        '/marketing/weekly-review/test-webhook', {},
      ),
  })
}
