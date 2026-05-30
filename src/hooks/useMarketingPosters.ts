/**
 * Hooks for the marketing Posters queue page (Phase 2).
 *
 * Mirrors useMarketingStories but for the feed-post pipeline:
 * 1 themed poster/day (vs 6 stories/day).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPatch, adminPost } from '@/lib/admin/api'

export type PosterItemStatus = 'pending' | 'copied' | 'posted' | 'skipped'
export type PosterAudience = 'rider' | 'driver' | 'both'

export interface PosterItem {
  id: string
  batch_id: string
  audience: PosterAudience
  canva_template: string | null
  headline: string
  subheadline: string | null
  body: string
  hashtags: string | null
  status: PosterItemStatus
  acted_at: string | null
  created_at: string
}

export interface PosterBatch {
  id: string
  for_date: string
  source: 'cron' | 'manual'
  llm_model: string
  item_count: number
  status: 'pending' | 'reviewed' | 'failed'
  error: string | null
  generated_at: string
  theme_snapshot: string | null
  weekly_focus_snapshot: string | null
  items: PosterItem[]
}

interface ListResponse {
  ok: true
  batches: PosterBatch[]
}

export function useMarketingPosterBatches() {
  return useQuery({
    queryKey: ['admin', 'marketing', 'posters'],
    queryFn: () => adminGet<ListResponse>('/marketing/posters'),
    staleTime: 60 * 1000,
  })
}

interface GenerateResponse {
  ok: true
  batch_id: string
  item_count: number
  skipped_existing: boolean
  reason?: string
}

export function useGeneratePosterBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (audience: PosterAudience = 'both') =>
      adminPost<GenerateResponse>('/marketing/posters/generate', { audience }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'posters'] })
    },
  })
}

export function useUpdatePosterItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: PosterItemStatus }) =>
      adminPatch<{ ok: true }>(`/marketing/posters/items/${itemId}`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'posters'] })
    },
  })
}
