/**
 * `/api/admin/ghost-refunds/*` — admin visibility into the ghost-
 * driver auto-refund pipeline.
 *
 * 2026-05-23 — closes a Level-3 gap from the schema audit: the
 * `ghost_refunds` table had zero admin surface. These rows represent
 * the most uncomfortable kind of payment state — money the rider
 * paid that sat in TAGO custody because the driver never connected
 * a bank account. The 90-day cron reminds + auto-refunds, but ops
 * needs to see the queue + the outcomes.
 *
 * Endpoint:
 *   GET /api/admin/ghost-refunds?status=pending|refunded|all&limit=&offset=
 *
 * Auth gate inherited from the parent adminRouter (JWT + adminAuth).
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'

export const adminGhostRefundsRouter = Router()

type StatusFilter = 'pending' | 'refunded' | 'all'

interface GhostRefundRow {
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

interface GhostRefundsResponse {
  ok: true
  rows: GhostRefundRow[]
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

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

adminGhostRefundsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = clampInt(req.query['limit'], 25, 1, 100)
      const offset = clampInt(req.query['offset'], 0, 0, 100_000)
      const statusRaw = (req.query['status'] as string | undefined)?.trim() ?? 'all'
      const status: StatusFilter =
        statusRaw === 'pending' || statusRaw === 'refunded' ? statusRaw : 'all'

      // 1. Page of ghost_refunds rows + total for the filter.
      let query = supabaseAdmin
        .from('ghost_refunds')
        .select(
          'id, ride_id, rider_id, driver_id, amount_cents, payment_intent_id, reminder_sent_at, refunded_at, stripe_refund_id, created_at',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
      if (status === 'pending') {
        query = query.is('refunded_at', null)
      } else if (status === 'refunded') {
        query = query.not('refunded_at', 'is', null)
      }
      query = query.range(offset, offset + limit - 1)

      const { data: refunds, error: refundsErr, count } = await query
      if (refundsErr) throw refundsErr
      const refundRows = refunds ?? []

      // 2. KPI counts — separate cheap queries (head:true so we
      // don't pull rows). Sum-aware so the dashboard can show
      // "$X pending refund · $Y already refunded."
      const [pendingCountRes, refundedCountRes, pendingSumRes, refundedSumRes] =
        await Promise.all([
          supabaseAdmin
            .from('ghost_refunds')
            .select('id', { count: 'exact', head: true })
            .is('refunded_at', null),
          supabaseAdmin
            .from('ghost_refunds')
            .select('id', { count: 'exact', head: true })
            .not('refunded_at', 'is', null),
          // Sums via aggregate — PostgREST doesn't expose SUM() directly,
          // so pull just the amount_cents column for the relevant subset
          // + sum in app code. Acceptable for this admin endpoint
          // (ghost refund volume is low — measured in hundreds, not
          // millions of rows).
          supabaseAdmin
            .from('ghost_refunds')
            .select('amount_cents')
            .is('refunded_at', null),
          supabaseAdmin
            .from('ghost_refunds')
            .select('amount_cents')
            .not('refunded_at', 'is', null),
        ])
      if (pendingCountRes.error) throw pendingCountRes.error
      if (refundedCountRes.error) throw refundedCountRes.error
      if (pendingSumRes.error) throw pendingSumRes.error
      if (refundedSumRes.error) throw refundedSumRes.error

      const sumAmounts = (rows: Array<{ amount_cents: number | null }>): number =>
        rows.reduce((acc, r) => acc + (r.amount_cents ?? 0), 0)

      // 3. Enrich with rider + driver + ride context. Three batched
      // lookups, no per-row N+1.
      const userIds = new Set<string>()
      const rideIds = new Set<string>()
      for (const r of refundRows) {
        userIds.add(r.rider_id)
        userIds.add(r.driver_id)
        rideIds.add(r.ride_id)
      }
      const userIdList = Array.from(userIds)
      const rideIdList = Array.from(rideIds)

      const [usersRes, ridesRes] = await Promise.all([
        userIdList.length > 0
          ? supabaseAdmin
              .from('users')
              .select('id, full_name, email')
              .in('id', userIdList)
          : Promise.resolve({ data: [], error: null }),
        rideIdList.length > 0
          ? supabaseAdmin
              .from('rides')
              .select('id, origin_name, destination_name, ended_at')
              .in('id', rideIdList)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (usersRes.error) throw usersRes.error
      if (ridesRes.error) throw ridesRes.error

      const userMap = new Map<string, { full_name: string | null; email: string | null }>()
      for (const u of usersRes.data ?? []) {
        userMap.set(u.id, { full_name: u.full_name, email: u.email })
      }
      const rideMap = new Map<
        string,
        { origin_name: string | null; destination_name: string | null; ended_at: string | null }
      >()
      for (const r of ridesRes.data ?? []) {
        rideMap.set(r.id, {
          origin_name: r.origin_name,
          destination_name: r.destination_name,
          ended_at: r.ended_at,
        })
      }

      const enriched: GhostRefundRow[] = refundRows.map((r) => {
        const rider = userMap.get(r.rider_id)
        const driver = userMap.get(r.driver_id)
        const ride = rideMap.get(r.ride_id)
        return {
          id: r.id,
          ride_id: r.ride_id,
          rider_id: r.rider_id,
          driver_id: r.driver_id,
          amount_cents: r.amount_cents,
          payment_intent_id: r.payment_intent_id,
          reminder_sent_at: r.reminder_sent_at,
          refunded_at: r.refunded_at,
          stripe_refund_id: r.stripe_refund_id,
          created_at: r.created_at,
          rider_name: rider?.full_name ?? null,
          rider_email: rider?.email ?? null,
          driver_name: driver?.full_name ?? null,
          driver_email: driver?.email ?? null,
          ride_origin_name: ride?.origin_name ?? null,
          ride_destination_name: ride?.destination_name ?? null,
          ride_ended_at: ride?.ended_at ?? null,
        }
      })

      const payload: GhostRefundsResponse = {
        ok: true,
        rows: enriched,
        total: count ?? enriched.length,
        counts: {
          pending: pendingCountRes.count ?? 0,
          refunded: refundedCountRes.count ?? 0,
          pending_amount_cents: sumAmounts(pendingSumRes.data ?? []),
          refunded_amount_cents: sumAmounts(refundedSumRes.data ?? []),
        },
        limit,
        offset,
      }
      res.status(200).json(payload)
    } catch (err) {
      next(err)
    }
  },
)
