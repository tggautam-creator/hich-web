/**
 * Operator-only health + maintenance endpoints.
 *
 * `/api/ops/health` is the bandwidth meter: a live view into how much of
 * the Supabase free-tier 2 GB/month egress budget the server has consumed
 * this month, which routes dominate request volume, and how long the
 * process has been up. Meant for the single operator (Tarun) to eyeball
 * during beta, not for a public dashboard.
 *
 * Renamed from `/api/admin/*` → `/api/ops/*` on 2026-05-17 (admin panel
 * Slice 0.3) so the `/api/admin/` namespace can be reserved for the new
 * JWT+is_admin-gated team admin panel API. The two have different access
 * models on purpose:
 *
 *   - `/api/ops/*`   (this file) — gated by `x-admin-token` shared secret
 *                                  header. One operator, one secret.
 *   - `/api/admin/*` (admin/index.ts) — gated by Supabase JWT + the
 *                                       caller's `users.is_admin = true`
 *                                       row. Per-user permission, audit
 *                                       trail per team member.
 *
 * Access is gated by a shared secret header (`x-admin-token`) so random
 * students can't hit it. Secret comes from `ADMIN_TOKEN` env; when unset,
 * the endpoint is simply disabled (returns 404) so we never ship an open
 * endpoint by accident.
 */

import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { getMetricsSnapshot } from '../middleware/metrics.ts'
import { sendGhostDriverReminders, processGhostDriverRefunds } from '../jobs/ghostRefund.ts'
import { sendPendingPaymentNudges } from '../jobs/paymentDunning.ts'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

export const opsRouter = Router()

function requireOpsToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env['ADMIN_TOKEN']
  if (!expected) {
    // No secret configured → pretend the route doesn't exist at all. Beats
    // advertising "this lives here but you can't see it".
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    return
  }
  const provided = req.header('x-admin-token')
  if (provided !== expected) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    return
  }
  next()
}

// ── F7 — Ghost-driver refund queue ────────────────────────────────────────────

/**
 * GET /api/ops/ghost-refunds — inspect pending / completed refunds.
 *   ?status=pending   (default) — reminder rows that have not yet refunded
 *   ?status=refunded              — history of completed auto-refunds
 */
opsRouter.get('/ghost-refunds', requireOpsToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query['status'] === 'refunded' ? 'refunded' : 'pending'
    const q = supabaseAdmin
      .from('ghost_refunds')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)

    const { data, error } = status === 'refunded'
      ? await q.not('refunded_at', 'is', null)
      : await q.is('refunded_at', null)

    if (error) {
      res.status(500).json({ error: { code: 'DB_ERROR', message: error.message } })
      return
    }
    res.json({ rows: data ?? [] })
  } catch (err) { next(err) }
})

/**
 * POST /api/ops/ghost-refunds/run — trigger the day-60 or day-90 sweep.
 *   { kind: 'reminders' | 'refunds' }
 */
opsRouter.post('/ghost-refunds/run', requireOpsToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kind = (req.body as { kind?: string } | undefined)?.kind
    if (kind !== 'reminders' && kind !== 'refunds') {
      res.status(400).json({ error: { code: 'INVALID_KIND', message: 'kind must be "reminders" or "refunds"' } })
      return
    }
    const result = kind === 'reminders'
      ? await sendGhostDriverReminders()
      : await processGhostDriverRefunds()
    res.json({ kind, result })
  } catch (err) { next(err) }
})

// ── 24 h payment-dunning cron ────────────────────────────────────────────────

/**
 * POST /api/ops/payment-dunning/run — fire the 24/48/72h FCM push sweep.
 *
 * No body. Intended to be called by a daily cron (or manually by ops while
 * no scheduler is wired up). Idempotent — `payment_nudges (ride_id, bucket)`
 * UNIQUE makes re-running the same day a no-op.
 */
opsRouter.post('/payment-dunning/run', requireOpsToken, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await sendPendingPaymentNudges()
    res.json({ result })
  } catch (err) { next(err) }
})

opsRouter.get('/health', requireOpsToken, (_req: Request, res: Response) => {
  const snap = getMetricsSnapshot()
  const mb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10

  res.json({
    ok: true,
    uptimeSeconds: snap.uptimeSeconds,
    totalRequests: snap.totalRequests,
    totalMB: mb(snap.totalBytes),
    month: {
      key: snap.month.key,
      requests: snap.month.requests,
      egressMB: mb(snap.month.bytes),
      supabaseFreeTierPct: snap.month.supabaseFreeTierPct,
      freeTierBudgetMB: 2048,
    },
    topPaths: snap.topPaths,
  })
})
