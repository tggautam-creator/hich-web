import { useQuery } from '@tanstack/react-query'
import { adminGet } from '@/lib/admin/api'
import type { StuckReason } from '@/hooks/useAdminLive'

/**
 * Slice 1.9 — operational alerts panel hook.
 *
 * Polls /api/admin/alerts every 30s while the tab is focused.
 * Each category is independently capped at 50 items by the server;
 * the `truncated` flag fires when the full count exceeds that.
 */

export interface StuckRideAlert {
  ride_id: string
  status: 'requested' | 'accepted' | 'coordinating' | 'active'
  rider_id: string
  driver_id: string | null
  stuck_reason: StuckReason
  stuck_for_ms: number
  fare_cents: number | null
  rider_name: string | null
  driver_name: string | null
}

export interface PaymentAlert {
  ride_id: string
  rider_id: string
  driver_id: string | null
  rider_name: string | null
  driver_name: string | null
  fare_cents: number | null
  ended_at: string | null
  payment_status: string | null
}

export interface NegativeWalletAlert {
  user_id: string
  name: string | null
  email: string | null
  wallet_balance_cents: number
  is_driver: boolean
}

export interface SuspensionAlert {
  user_id: string
  name: string | null
  email: string | null
  suspended_at: string
  suspended_reason: string | null
}

export interface AlertCategory<T> {
  count: number
  truncated: boolean
  items: T[]
}

export interface AlertsResponse {
  ok: true
  generated_at: string
  total_count: number
  stuck_rides: AlertCategory<StuckRideAlert>
  failed_payments: AlertCategory<PaymentAlert>
  unpaid_completed: AlertCategory<PaymentAlert>
  negative_wallets: AlertCategory<NegativeWalletAlert>
  recent_suspensions: AlertCategory<SuspensionAlert>
}

const POLL_MS = 30 * 1000

export function useAdminAlerts(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts
  return useQuery<AlertsResponse>({
    queryKey: ['admin', 'alerts'],
    queryFn: () => adminGet<AlertsResponse>('/alerts'),
    enabled,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: POLL_MS - 1,
  })
}
