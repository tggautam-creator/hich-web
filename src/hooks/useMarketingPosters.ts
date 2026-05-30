/**
 * Hooks for the marketing Posters queue page — Phase 3 extended
 * (format picker + founder steering + on-demand image generation).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPatch, adminPost } from '@/lib/admin/api'

export type PosterItemStatus = 'pending' | 'copied' | 'posted' | 'skipped'
export type PosterAudience = 'rider' | 'driver' | 'both'
export type PosterFormat = 'ig_story' | 'ig_post' | 'a4_sheet' | 'custom'

export interface PosterItem {
  id: string
  batch_id: string
  audience: PosterAudience
  format: PosterFormat
  canva_template: string | null
  headline: string
  subheadline: string | null
  body: string
  hashtags: string | null
  caption: string | null
  image_prompt: string | null
  image_url: string | null
  image_generated_at: string | null
  image_model: string | null
  founder_note: string | null
  event_tag: string | null
  feature_spotlight: string | null
  theme_angle: string | null
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

export interface GeneratePosterArgs {
  audience: PosterAudience
  format: PosterFormat
  founder_note?: string
  event_tag?: string
  feature_spotlight?: string
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
    mutationFn: (args: GeneratePosterArgs) =>
      adminPost<GenerateResponse>('/marketing/posters/generate', args),
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

interface GenerateImageResponse {
  ok: true
  image_url: string
}

/**
 * Phase 3 — generate the actual poster IMAGE for a specific item
 * via gemini-2.5-flash-image. Returns the public Storage URL.
 * Re-callable (overwrites the existing image; failed retries clear
 * the stale URL so the UI shows the empty-state branch).
 */
export function useGeneratePosterImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) =>
      adminPost<GenerateImageResponse>(`/marketing/posters/items/${itemId}/generate-image`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'posters'] })
    },
  })
}
