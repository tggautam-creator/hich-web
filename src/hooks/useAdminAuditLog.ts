import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

/**
 * Slice 1.8 — global admin audit log hook.
 *
 * Mirrors the response shape of server/routes/admin/audit.ts. Filters
 * are passed as a stable object so the queryKey changes only when a
 * filter does — switching pages within the same filter set keeps the
 * previous page on screen during the refetch.
 */

export interface AuditLogRow {
  id: string
  admin_id: string
  admin_email: string | null
  target_user_id: string | null
  target_email: string | null
  action: string
  payload: Record<string, unknown>
  created_at: string
}

export interface AuditLogResponse {
  ok: true
  audit: AuditLogRow[]
  total: number
  limit: number
  offset: number
  distinct_actions: string[]
}

export interface AuditLogFilters {
  action?: string
  admin_id?: string
  /** UUID string, or the literal 'null' to filter for broadcast (no target). */
  target_user_id?: string
}

interface UseAdminAuditLogArgs {
  limit?: number
  offset?: number
  filters?: AuditLogFilters
  enabled?: boolean
}

const DEFAULT_LIMIT = 25
const STALE_MS = 30 * 1000

export function useAdminAuditLog(args: UseAdminAuditLogArgs = {}) {
  const { limit = DEFAULT_LIMIT, offset = 0, filters = {}, enabled = true } = args

  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (filters.action) params.set('action', filters.action)
  if (filters.admin_id) params.set('admin_id', filters.admin_id)
  if (filters.target_user_id) params.set('target_user_id', filters.target_user_id)

  return useQuery<AuditLogResponse>({
    queryKey: ['admin', 'audit-log', limit, offset, filters],
    queryFn: () =>
      adminGet<AuditLogResponse>(`/audit-log?${params.toString()}`),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  })
}
