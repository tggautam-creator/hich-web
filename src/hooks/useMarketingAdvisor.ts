/**
 * Marketing Advisor chat hooks (Phase 4).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminGet, adminPost } from '@/lib/admin/api'
import { supabase } from '@/lib/supabase'
import { AdminApiException } from '@/lib/admin/api'

export interface AdvisorThread {
  id: string
  title: string
  user_id: string
  created_at: string
  updated_at: string
}

export interface AdvisorMessage {
  id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

interface ListThreadsResponse {
  ok: true
  threads: AdvisorThread[]
}

interface ThreadDetailResponse {
  ok: true
  thread: AdvisorThread
  messages: AdvisorMessage[]
}

interface CreateThreadResponse {
  ok: true
  thread: AdvisorThread
}

interface SendMessageResponse {
  ok: true
  assistant_message: AdvisorMessage
  model_used?: string
}

export function useAdvisorThreads() {
  return useQuery({
    queryKey: ['admin', 'marketing', 'advisor', 'threads'],
    queryFn: () => adminGet<ListThreadsResponse>('/marketing/advisor/threads'),
    staleTime: 30 * 1000,
  })
}

export function useAdvisorThread(threadId: string | null) {
  return useQuery({
    queryKey: ['admin', 'marketing', 'advisor', 'thread', threadId],
    queryFn: () => adminGet<ThreadDetailResponse>(`/marketing/advisor/threads/${threadId}`),
    enabled: Boolean(threadId),
    staleTime: 5 * 1000,
  })
}

export function useCreateAdvisorThread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (title?: string) =>
      adminPost<CreateThreadResponse>('/marketing/advisor/threads', { title: title ?? '' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'advisor', 'threads'] })
    },
  })
}

export function useSendAdvisorMessage(threadId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => {
      if (!threadId) throw new Error('no thread selected')
      return adminPost<SendMessageResponse>(
        `/marketing/advisor/threads/${threadId}/messages`,
        { content },
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'advisor', 'thread', threadId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'advisor', 'threads'] })
      // Refresh Gemini quota banner. One advisor turn can spend
      // multiple Gemini calls (tool-use loop iterations) — the
      // server counts each, and we refetch so the banner reflects
      // them within seconds instead of after the 60s poll.
      void qc.invalidateQueries({ queryKey: ['admin', 'api-usage'] })
    },
  })
}

/**
 * Delete uses native fetch since adminApi doesn't export a DELETE
 * helper. Mirrors the same auth + error-envelope pattern.
 */
export function useDeleteAdvisorThread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (threadId: string) => {
      const { data: sessionRes } = await supabase.auth.getSession()
      const token = sessionRes.session?.access_token
      if (!token) {
        throw new AdminApiException({
          status: 0,
          code: 'NO_SESSION',
          message: 'No active session — sign in again.',
        })
      }
      const res = await fetch(`/api/admin/marketing/advisor/threads/${threadId}`, {
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
      void qc.invalidateQueries({ queryKey: ['admin', 'marketing', 'advisor', 'threads'] })
    },
  })
}
