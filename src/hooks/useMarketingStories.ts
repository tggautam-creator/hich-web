/**
 * Hooks for the marketing Stories queue page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPatch, adminPost } from '@/lib/admin/api'

export type StoryItemStatus = 'pending' | 'copied' | 'posted' | 'skipped'

export interface StoryItem {
  id: string
  batch_id: string
  corridor: string
  asking_for: 'driver' | 'rider'
  headline: string
  body: string
  date_label: string | null
  matched_ride_count: number
  status: StoryItemStatus
  acted_at: string | null
  created_at: string
}

export interface StoryBatch {
  id: string
  for_date: string
  source: 'cron' | 'manual'
  llm_model: string
  item_count: number
  status: 'pending' | 'reviewed' | 'failed'
  error: string | null
  generated_at: string
  items: StoryItem[]
}

interface ListResponse {
  ok: true
  batches: StoryBatch[]
}

export function useMarketingStoryBatches() {
  return useQuery({
    queryKey: ['admin', 'marketing', 'stories'],
    queryFn: () => adminGet<ListResponse>('/marketing/stories'),
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

export function useGenerateStoryBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => adminPost<GenerateResponse>('/marketing/stories/generate', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'stories'] })
    },
  })
}

export function useUpdateStoryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: StoryItemStatus }) =>
      adminPatch<{ ok: true }>(`/marketing/stories/items/${itemId}`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'stories'] })
    },
  })
}
