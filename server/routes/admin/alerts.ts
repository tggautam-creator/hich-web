/**
 * `/api/admin/alerts` — operational alerts panel (Slice 1.9).
 *
 * One endpoint returning every category of "needs ops attention"
 * signal in a single round trip. Categories (each independently
 * capped + flagged truncated):
 *
 *   - stuck_rides          — reuse the live-snapshot stuck detector
 *                            (awaiting_driver / coordinating_long /
 *                            driver_gps_stale / ride_long).
 *   - failed_payments      — rides with payment_status='failed'
 *                            after Stripe webhook returned a charge
 *                            failure. Manual reach-out or retry.
 *   - unpaid_completed     — completed rides where Stripe never came
 *                            back successfully (status='completed' AND
 *                            payment_status NOT IN ('paid','refunded'))
 *                            older than 10 min. Most actionable signal
 *                            of payment infrastructure drift.
 *   - negative_wallets     — users whose wallet_balance went negative
 *                            (typical cause: refund that pushed a
 *                            driver into overdraft via Slice 1.3e).
 *   - recent_suspensions   — users suspended in the last 24h. Pure
 *                            visibility — no action recommended;
 *                            shown so the team knows.
 *
 * Polling: the web client hits this every 30s while the tab is
 * focused. Each category does its own targeted query rather than
 * scanning the entire rides table; total round-trip is small even
 * with thousands of historical rides.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'
import {
  STUCK_AWAITING_DRIVER_MS,
  STUCK_COORDINATING_MS,
  STUCK_DRIVER_GPS_STALE_MS,
  STUCK_RIDE_LONG_MS,
  type StuckReason,
} from './live.ts'

export const adminAlertsRouter = Router()

const ACTIVE_STATUSES = ['requested', 'accepted', 'coordinating', 'active'] as const
const UNPAID_GRACE_MS = 10 * 60 * 1000 // 10 min between status=completed and webhook arrival
const MAX_PER_CATEGORY = 50

// ── response types ──────────────────────────────────────────────────────────

interface StuckRideAlert {
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

interface PaymentAlert {
  ride_id: string
  rider_id: string
  driver_id: string | null
  rider_name: string | null
  driver_name: string | null
  fare_cents: number | null
  ended_at: string | null
  payment_status: string | null
}

interface NegativeWalletAlert {
  user_id: string
  name: string | null
  email: string | null
  wallet_balance_cents: number
  is_driver: boolean
}

interface SuspensionAlert {
  user_id: string
  name: string | null
  email: string | null
  suspended_at: string
  suspended_reason: string | null
}

interface AlertCategory<T> {
  count: number
  truncated: boolean
  items: T[]
}

interface AlertsResponse {
  ok: true
  generated_at: string
  total_count: number
  stuck_rides: AlertCategory<StuckRideAlert>
  failed_payments: AlertCategory<PaymentAlert>
  unpaid_completed: AlertCategory<PaymentAlert>
  negative_wallets: AlertCategory<NegativeWalletAlert>
  recent_suspensions: AlertCategory<SuspensionAlert>
}

// ── helpers ──────────────────────────────────────────────────────────────────

interface StuckCandidate {
  status: 'requested' | 'accepted' | 'coordinating' | 'active'
  driver_id: string | null
  created_at: string
  started_at: string | null
  last_driver_ping_at: string | null
}

function computeStuck(r: StuckCandidate, nowMs: number): { reason: StuckReason; forMs: number } | null {
  if (r.status === 'requested') {
    if (r.driver_id) return null
    const age = nowMs - new Date(r.created_at).getTime()
    if (age > STUCK_AWAITING_DRIVER_MS) return { reason: 'awaiting_driver', forMs: age }
    return null
  }
  if (r.status === 'coordinating') {
    const age = nowMs - new Date(r.created_at).getTime()
    if (age > STUCK_COORDINATING_MS) return { reason: 'coordinating_long', forMs: age }
    return null
  }
  if (r.status === 'active') {
    if (r.last_driver_ping_at) {
      const sinceLastPing = nowMs - new Date(r.last_driver_ping_at).getTime()
      if (sinceLastPing > STUCK_DRIVER_GPS_STALE_MS) {
        return { reason: 'driver_gps_stale', forMs: sinceLastPing }
      }
    }
    if (r.started_at) {
      const sinceStart = nowMs - new Date(r.started_at).getTime()
      if (sinceStart > STUCK_RIDE_LONG_MS) return { reason: 'ride_long', forMs: sinceStart }
    }
  }
  return null
}

function takeAndFlag<T>(items: T[], max: number): AlertCategory<T> {
  if (items.length <= max) {
    return { count: items.length, truncated: false, items }
  }
  return { count: items.length, truncated: true, items: items.slice(0, max) }
}

// ── main endpoint ────────────────────────────────────────────────────────────

adminAlertsRouter.get(
  '/',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const nowMs = Date.now()
      const nowIso = new Date().toISOString()
      const suspendedSince = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString()
      const unpaidCutoff = new Date(nowMs - UNPAID_GRACE_MS).toISOString()

      // ── stuck rides ───────────────────────────────────────────────────
      const stuckQ = await supabaseAdmin
        .from('rides')
        .select('id, status, rider_id, driver_id, fare_cents, created_at, started_at, last_driver_ping_at')
        .in('status', ACTIVE_STATUSES as unknown as readonly never[])
        .limit(MAX_PER_CATEGORY * 4)
      if (stuckQ.error) throw stuckQ.error

      type StuckRow = StuckCandidate & {
        id: string
        rider_id: string
        fare_cents: number | null
      }
      const stuckRowsRaw = (stuckQ.data ?? []) as unknown as StuckRow[]
      const stuckRows = stuckRowsRaw
        .map((r) => {
          const stuck = computeStuck(r, nowMs)
          return stuck
            ? {
                ride_id: r.id,
                status: r.status,
                rider_id: r.rider_id,
                driver_id: r.driver_id,
                stuck_reason: stuck.reason,
                stuck_for_ms: stuck.forMs,
                fare_cents: r.fare_cents,
              }
            : null
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        // Worst first (longest stuck time)
        .sort((a, b) => b.stuck_for_ms - a.stuck_for_ms)

      // ── failed payments ──────────────────────────────────────────────
      const failedQ = await supabaseAdmin
        .from('rides')
        .select('id, rider_id, driver_id, fare_cents, ended_at, payment_status')
        .eq('payment_status', 'failed')
        .order('ended_at', { ascending: false })
        .limit(MAX_PER_CATEGORY + 1)
      if (failedQ.error) throw failedQ.error
      type PayRow = {
        id: string
        rider_id: string
        driver_id: string | null
        fare_cents: number | null
        ended_at: string | null
        payment_status: string | null
      }
      const failedRows = (failedQ.data ?? []) as unknown as PayRow[]

      // ── unpaid completed (>10 min after end, still not paid/refunded) ─
      // Stripe usually returns within seconds; >10 min strongly suggests
      // webhook drift or a missed event. Pull rides ended in the last
      // 7 days so the panel stays bounded.
      const since7d = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString()
      const unpaidQ = await supabaseAdmin
        .from('rides')
        .select('id, rider_id, driver_id, fare_cents, ended_at, payment_status')
        .eq('status', 'completed')
        .gte('ended_at', since7d)
        .lt('ended_at', unpaidCutoff)
        .not('payment_status', 'in', '("paid","refunded")')
        .order('ended_at', { ascending: false })
        .limit(MAX_PER_CATEGORY + 1)
      if (unpaidQ.error) throw unpaidQ.error
      const unpaidRows = (unpaidQ.data ?? []) as unknown as PayRow[]

      // ── negative wallets ─────────────────────────────────────────────
      const negQ = await supabaseAdmin
        .from('users')
        .select('id, full_name, email, wallet_balance, is_driver')
        .lt('wallet_balance', 0)
        .order('wallet_balance', { ascending: true }) // most negative first
        .limit(MAX_PER_CATEGORY + 1)
      if (negQ.error) throw negQ.error
      type UserNegRow = {
        id: string
        full_name: string | null
        email: string | null
        wallet_balance: number
        is_driver: boolean
      }
      const negRows = (negQ.data ?? []) as unknown as UserNegRow[]

      // ── recent suspensions (24h) ─────────────────────────────────────
      const susQ = await supabaseAdmin
        .from('users')
        .select('id, full_name, email, suspended_at, suspended_reason')
        .gte('suspended_at', suspendedSince)
        .order('suspended_at', { ascending: false })
        .limit(MAX_PER_CATEGORY + 1)
      if (susQ.error) throw susQ.error
      type UserSusRow = {
        id: string
        full_name: string | null
        email: string | null
        suspended_at: string
        suspended_reason: string | null
      }
      const susRows = (susQ.data ?? []) as unknown as UserSusRow[]

      // ── name hydration for everything that has a rider/driver ─────────
      const userIds = new Set<string>()
      for (const r of stuckRows) {
        userIds.add(r.rider_id)
        if (r.driver_id) userIds.add(r.driver_id)
      }
      for (const r of failedRows) {
        userIds.add(r.rider_id)
        if (r.driver_id) userIds.add(r.driver_id)
      }
      for (const r of unpaidRows) {
        userIds.add(r.rider_id)
        if (r.driver_id) userIds.add(r.driver_id)
      }

      const nameById = new Map<string, string>()
      if (userIds.size > 0) {
        const usersQ = await supabaseAdmin
          .from('users')
          .select('id, full_name, email')
          .in('id', Array.from(userIds))
        if (usersQ.error) throw usersQ.error
        type ULookup = { id: string; full_name: string | null; email: string | null }
        for (const u of (usersQ.data ?? []) as unknown as ULookup[]) {
          const label = u.full_name?.trim() || (u.email ? u.email.split('@')[0] : null) || u.id.slice(0, 8)
          nameById.set(u.id, label ?? u.id.slice(0, 8))
        }
      }
      const nameOrNull = (id: string | null): string | null =>
        id ? (nameById.get(id) ?? null) : null

      // ── shape responses ──────────────────────────────────────────────
      const stuckRides = takeAndFlag<StuckRideAlert>(
        stuckRows.map((r) => ({
          ride_id: r.ride_id,
          status: r.status,
          rider_id: r.rider_id,
          driver_id: r.driver_id,
          stuck_reason: r.stuck_reason,
          stuck_for_ms: r.stuck_for_ms,
          fare_cents: r.fare_cents,
          rider_name: nameOrNull(r.rider_id),
          driver_name: nameOrNull(r.driver_id),
        })),
        MAX_PER_CATEGORY,
      )

      const shapePay = (rows: PayRow[]): PaymentAlert[] =>
        rows.map((r) => ({
          ride_id: r.id,
          rider_id: r.rider_id,
          driver_id: r.driver_id,
          rider_name: nameOrNull(r.rider_id),
          driver_name: nameOrNull(r.driver_id),
          fare_cents: r.fare_cents,
          ended_at: r.ended_at,
          payment_status: r.payment_status,
        }))

      const failedPayments = takeAndFlag(shapePay(failedRows), MAX_PER_CATEGORY)
      const unpaidCompleted = takeAndFlag(shapePay(unpaidRows), MAX_PER_CATEGORY)

      const negativeWallets = takeAndFlag<NegativeWalletAlert>(
        negRows.map((u) => ({
          user_id: u.id,
          name: u.full_name,
          email: u.email,
          wallet_balance_cents: u.wallet_balance,
          is_driver: u.is_driver,
        })),
        MAX_PER_CATEGORY,
      )

      const recentSuspensions = takeAndFlag<SuspensionAlert>(
        susRows.map((u) => ({
          user_id: u.id,
          name: u.full_name,
          email: u.email,
          suspended_at: u.suspended_at,
          suspended_reason: u.suspended_reason,
        })),
        MAX_PER_CATEGORY,
      )

      const totalCount =
        stuckRides.count +
        failedPayments.count +
        unpaidCompleted.count +
        negativeWallets.count +
        recentSuspensions.count

      const body: AlertsResponse = {
        ok: true,
        generated_at: nowIso,
        total_count: totalCount,
        stuck_rides: stuckRides,
        failed_payments: failedPayments,
        unpaid_completed: unpaidCompleted,
        negative_wallets: negativeWallets,
        recent_suspensions: recentSuspensions,
      }
      res.status(200).json(body)
    } catch (err) {
      next(err)
    }
  },
)
