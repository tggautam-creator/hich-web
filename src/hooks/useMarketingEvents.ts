/**
 * Smart marketing calendar hooks (Phase 5).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPatch, adminPost } from '@/lib/admin/api'
import { supabase } from '@/lib/supabase'
import { AdminApiException } from '@/lib/admin/api'

export type EventCategory = 'holiday' | 'academic' | 'campus' | 'travel-trigger' | 'custom'
export type EventSource = 'seeded' | 'ai_suggested' | 'manual'
export type EventAudience = 'rider' | 'driver' | 'both'

export interface MarketingEvent {
  id: string
  title: string
  event_date: string
  end_date: string | null
  category: EventCategory
  location_hint: string | null
  description: string | null
  target_audience: EventAudience
  source: EventSource
  target_lead_time_days: number
  reminder_dismissed_at: string | null
  notes: string | null
  linked_story_batch_ids: string[]
  linked_poster_item_ids: string[]
  /** Google Search citation URLs (Phase 5.1; empty for seeded/manual). */
  source_urls: string[] | null
  created_at: string
  updated_at: string
}

interface ListResponse {
  ok: true
  events: MarketingEvent[]
  reminders: MarketingEvent[]
}

export function useMarketingEvents() {
  return useQuery({
    queryKey: ['admin', 'marketing', 'events'],
    queryFn: () => adminGet<ListResponse>('/marketing/events'),
    staleTime: 60 * 1000,
  })
}

export function useSeedEvents() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      adminPost<{ ok: true; inserted: number; skipped: number }>('/marketing/events/seed', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'events'] })
    },
  })
}

export function useRefreshAiEvents() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      adminPost<{
        ok: true
        inserted: number
        skipped: number
        sources_count?: number
        skipped_duplicate?: number
        skipped_invalid?: number
        insert_errors?: string[]
      }>('/marketing/events/refresh-ai', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'events'] })
      // Refresh Gemini quota banner (Pro + grounding call counted).
      void qc.invalidateQueries({ queryKey: ['admin', 'api-usage'] })
    },
  })
}

export interface AddEventArgs {
  title: string
  event_date: string
  end_date?: string
  category?: EventCategory
  location_hint?: string
  description?: string
  target_audience?: EventAudience
  target_lead_time_days?: number
  notes?: string
}

export function useAddManualEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: AddEventArgs) =>
      adminPost<{ ok: true; event: MarketingEvent }>('/marketing/events', args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'events'] })
    },
  })
}

export function useDismissEventReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (eventId: string) =>
      adminPatch<{ ok: true }>(`/marketing/events/${eventId}/dismiss`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'events'] })
    },
  })
}

export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (!token) {
        throw new AdminApiException({
          status: 0, code: 'NO_SESSION', message: 'No active session — sign in again.',
        })
      }
      const res = await fetch(`/api/admin/marketing/events/${eventId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as
          | { error?: { code?: string; message?: string } }
          | undefined
        throw new AdminApiException({
          status: res.status,
          code: body?.error?.code ?? 'UNKNOWN',
          message: body?.error?.message ?? `Server returned ${res.status}`,
        })
      }
      return res.json() as Promise<{ ok: true }>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'events'] })
    },
  })
}
