/**
 * 2026-05-20 — React Query hooks for `/api/report/*`. Phase 2 of the
 * reports system. Server contract lives in `server/routes/report.ts`;
 * keep both in sync.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { reportsGet, reportsPost } from '@/lib/reportsApi'
import type { ReportCategory, ReportStatus } from '@/components/reports/categoryConfig'

export type ReportSeverity = 'emergency' | 'urgent' | 'normal' | 'low'

export interface ReportListItem {
  id: string
  category: ReportCategory | string
  severity: ReportSeverity
  status: ReportStatus
  title: string
  body: string
  ride_id: string | null
  schedule_id: string | null
  subject_user_id: string | null
  requested_refund_cents: number | null
  ride_state_at_report: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export interface ReportListResponse {
  ok: true
  reports: ReportListItem[]
  total: number
  limit: number
  offset: number
}

export interface ReportMessage {
  id: string
  author_id: string
  author_role: 'admin' | 'user'
  body: string
  channel: 'admin_panel' | 'email_inbound' | 'email_outbound' | 'in_app'
  created_at: string
}

export interface ReportAttachment {
  id: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
  uploaded_by: string
  created_at: string
}

export interface ReportDetailResponse {
  ok: true
  report: Omit<ReportListItem, never> & { metadata: Record<string, unknown> }
  messages: ReportMessage[]
  attachments: ReportAttachment[]
}

export interface CreateReportInput {
  category: ReportCategory
  body: string
  title?: string
  ride_id?: string | null
  subject_user_id?: string | null
  schedule_id?: string | null
  requested_refund_cents?: number | null
  metadata?: {
    app_version?: string
    platform?: 'ios' | 'android' | 'web'
    gps_lat?: number
    gps_lng?: number
  }
}

export interface CreateReportResponse {
  ok: true
  id: string
  severity: ReportSeverity
  status: ReportStatus
}

const FIVE_MIN_MS = 5 * 60 * 1000
const THIRTY_SEC_MS = 30 * 1000

export function useMyReports(args: { limit?: number; offset?: number } = {}) {
  const { limit = 25, offset = 0 } = args
  return useQuery<ReportListResponse>({
    queryKey: ['reports', 'me', limit, offset],
    queryFn: () => reportsGet<ReportListResponse>(`/me?limit=${limit}&offset=${offset}`),
    placeholderData: keepPreviousData,
    staleTime: FIVE_MIN_MS,
  })
}

export function useReportDetail(id: string | undefined) {
  return useQuery<ReportDetailResponse>({
    queryKey: ['reports', 'detail', id],
    queryFn: () => reportsGet<ReportDetailResponse>(`/${id}`),
    enabled: typeof id === 'string' && id.length > 0,
    // Threads are short and fresh-on-open is more important than
    // saving requests — 30s keeps admin replies visible quickly.
    staleTime: THIRTY_SEC_MS,
  })
}

export function useCreateReport() {
  const qc = useQueryClient()
  return useMutation<CreateReportResponse, Error, CreateReportInput>({
    mutationFn: (input) => reportsPost<CreateReportResponse>('/', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', 'me'] })
    },
  })
}

export function usePostReportMessage(reportId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true; id: string; created_at: string }, Error, { body: string }>({
    mutationFn: (input) => reportsPost(`/${reportId}/messages`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', 'detail', reportId] })
      void qc.invalidateQueries({ queryKey: ['reports', 'me'] })
    },
  })
}
