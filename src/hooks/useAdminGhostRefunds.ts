/**
 * 2026-05-23 — admin visibility into the ghost-driver auto-refund
 * queue. Mirrors the server response shape in
 * server/routes/admin/ghostRefunds.ts; keep both in sync.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'

const THIRTY_SEC_MS = 30 * 1000

export type GhostRefundStatusFilter = 'pending' | 'refunded' | 'all'

export interface AdminGhostRefundRow {
  id: string
  ride_id: string
  rider_id: string
  driver_id: string
  amount_cents: number
  payment_intent_id: string
  reminder_sent_at: string | null
  refunded_at: string | null
  stripe_refund_id: string | null
  created_at: string
  rider_name: string | null
  rider_email: string | null
  driver_name: string | null
  driver_email: string | null
  ride_origin_name: string | null
  ride_destination_name: string | null
  ride_ended_at: string | null
}

export interface AdminGhostRefundsResponse {
  ok: true
  rows: AdminGhostRefundRow[]
  total: number
  counts: {
    pending: number
    refunded: number
    pending_amount_cents: number
    refunded_amount_cents: number
  }
  limit: number
  offset: number
}

export function useAdminGhostRefunds(args: {
  status?: GhostRefundStatusFilter
  limit?: number
  offset?: number
}) {
  const { status = 'all', limit = 25, offset = 0 } = args
  const params = new URLSearchParams()
  params.set('status', status)
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  return useQuery<AdminGhostRefundsResponse>({
    queryKey: ['admin', 'ghost-refunds', status, limit, offset],
    queryFn: () =>
      adminGet<AdminGhostRefundsResponse>(`/ghost-refunds?${params.toString()}`),
    placeholderData: keepPreviousData,
    staleTime: THIRTY_SEC_MS,
    refetchInterval: THIRTY_SEC_MS,
  })
}
