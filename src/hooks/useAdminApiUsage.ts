/**
 * 2026-05-19 — wraps `GET /api/admin/api-usage`. Shape mirrors
 * `server/lib/apiUsage.ts::UsageSnapshot`.
 */
import { useQuery } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

export interface ServiceUsage {
  service: string
  label: string
  notes: string
  today: number
  monthly: number
  daily_quota: number | null
  monthly_quota: number | null
  daily_pct: number | null
  monthly_pct: number | null
}

export interface ApiUsageResponse {
  ok: true
  as_of: string
  today: string
  services: ServiceUsage[]
  trend: { service: string; days: { date: string; count: number }[] }[]
}

const REFRESH_MS = 60 * 1000

export function useAdminApiUsage() {
  return useQuery<ApiUsageResponse>({
    queryKey: ['admin', 'api-usage'],
    queryFn: () => adminGet<ApiUsageResponse>('/api-usage'),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  })
}
