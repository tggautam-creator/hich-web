import { Router, type Request, type Response } from 'express'
import { validateJwt } from '../../middleware/auth.ts'
import { adminAuth } from '../../middleware/adminAuth.ts'
import { adminMetricsRouter } from './metrics.ts'
import { adminFunnelRouter } from './funnel.ts'
import { adminUsersRouter } from './users.ts'
import { adminActionsRouter } from './actions.ts'
import { adminStripeRouter } from './stripe.ts'
import { adminRefundsRouter } from './refunds.ts'
import { adminCampaignsRouter } from './campaigns.ts'
import { adminLiveRouter } from './live.ts'
import { adminAuditRouter } from './audit.ts'
import { adminAlertsRouter } from './alerts.ts'
import { adminRideBoardRouter } from './rideBoard.ts'
import { adminReportsRouter } from './reports.ts'
import { adminRidesRouter } from './rides.ts'
import { adminGhostRefundsRouter } from './ghostRefunds.ts'
import { adminDeclineReasonsRouter } from './declineReasons.ts'
import { adminStatsRouter } from './stats.ts'
import { adminSafetyEndedRouter } from './safetyEnded.ts'
import { adminRideSafetyActionsRouter } from './rideSafetyActions.ts'

/**
 * `/api/admin/*` — Tago internal admin API.
 *
 * Permission model (Phase 1):
 *   - Every route runs `validateJwt` first (sets `res.locals.userId`)
 *   - Then `adminAuth` (verifies `public.users.is_admin = true`)
 *   - Non-admins receive 403, not 401 — their token is valid; they
 *     just lack permission.
 *
 * What lives here (Phase 1):
 *   - GET  /ping             → health + identity check (Slice 0.3)
 *   - GET  /metrics/overview → KPI cards for dashboard (Slice 1.1)
 *   - GET  /metrics/funnel   → user funnel breakdown (Slice 1.2)
 *   - GET  /users/search     → user lookup (Slice 1.3)
 *   - GET  /users/:id        → user detail (Slice 1.3)
 *   - POST /campaigns        → push/email/in-app campaign (Slice 1.4-1.6)
 *   - GET  /live/events      → realtime event feed (Slice 1.7)
 *   - GET  /campaigns        → campaign history (Slice 1.8)
 *   - GET  /audit-log        → admin action log (Slice 1.8)
 *
 * Each subroute file (e.g. `metrics.ts`, `users.ts`) attaches to this
 * router so this index stays a flat scaffold.
 */
export const adminRouter = Router()

// Every admin endpoint requires JWT + admin permission. Applied at
// router-level so individual handlers can't accidentally skip.
adminRouter.use(validateJwt)
adminRouter.use(adminAuth)

/**
 * GET /api/admin/ping
 *
 * Health + identity probe. Returns 200 with the admin's user id +
 * the env the server is running in. First admin endpoint that ships;
 * lets the admin app shell verify "I am an admin and the API is up"
 * before rendering anything heavier.
 *
 * Phase 1 dashboards will hit this on mount to detect a stale token
 * or revoked admin status (Tarun flipped `is_admin = false` in SQL).
 */
adminRouter.get('/ping', (_req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  res.status(200).json({
    ok: true,
    user_id: userId,
    is_admin: true,
    server_env: process.env['NODE_ENV'] ?? 'development',
    server_time: new Date().toISOString(),
  })
})

// Sub-routers attach below. Each one owns a slice of the admin surface.
adminRouter.use('/metrics', adminMetricsRouter)
// /funnel mounts under /metrics so the URL is /api/admin/metrics/funnel,
// matching the rest of the analytics surface even though the implementation
// lives in its own file alongside the per-user drill-down endpoint.
adminMetricsRouter.use('/funnel', adminFunnelRouter)
adminRouter.use('/users', adminUsersRouter)
// Admin Actions tab — write surfaces + per-user audit reads. Mounted
// under /users so the routes share the /:id parameter shape with
// adminUsersRouter (`POST /api/admin/users/:id/actions/push`,
// `GET /api/admin/users/:id/audit`, etc.).
adminRouter.use('/users', adminActionsRouter)
adminRouter.use('/stripe', adminStripeRouter)
// Slice 1.3e — ride refunds. Owns POST /api/admin/rides/:rideId/refund.
adminRouter.use('/rides', adminRefundsRouter)
// 2026-05-23 — Read-only ride visibility for ops.
// Owns GET /api/admin/rides (inbox) + GET /api/admin/rides/:id (detail).
// Coexists with adminRefundsRouter via method routing (refunds = POST only).
adminRouter.use('/rides', adminRidesRouter)
// 2026-05-23 — ghost-driver auto-refund queue visibility.
// Owns GET /api/admin/ghost-refunds. Closes the schema-audit gap
// where ghost_refunds rows existed but had no admin surface.
adminRouter.use('/ghost-refunds', adminGhostRefundsRouter)
// 2026-05-23 — supply-side decline analytics from
// driver_decline_reasons. Owns GET /api/admin/decline-reasons.
adminRouter.use('/decline-reasons', adminDeclineReasonsRouter)
// 2026-05-24 — v1.2 Phase 3 admin review queue for rides ended via
// the safety net (auto-divergence / max-duration cron + user-button
// safety end). Owns GET /api/admin/safety-ended.
adminRouter.use('/safety-ended', adminSafetyEndedRouter)
// 2026-05-24 — v1.2 Phase 3 force-safety-check escalation. Owns
// POST /api/admin/rides/:id/force-safety-check. Coexists with the
// read-only adminRidesRouter + write adminRefundsRouter at the
// same /rides URL prefix via method routing.
adminRouter.use('/rides', adminRideSafetyActionsRouter)
// 2026-05-23 — network-wide stats dashboard (Slice 5).
// Owns GET /api/admin/stats. Single fat response: KPIs + 30d
// daily chart + lifetime totals + funnel snapshot.
adminRouter.use('/stats', adminStatsRouter)
// Slice 1.4 — broadcast push composer. Owns GET /audience/preview + POST /push.
adminRouter.use('/campaigns', adminCampaignsRouter)
// Slice 1.7 — live ops snapshot.
adminRouter.use('/live', adminLiveRouter)
// Slice 1.8 — global audit log feed.
adminRouter.use('/audit-log', adminAuditRouter)
// Slice 1.9 — operational alerts panel.
adminRouter.use('/alerts', adminAlertsRouter)
// 2026-05-18 — ride-board monitoring (posts, offers, force-cancel).
adminRouter.use('/ride-board', adminRideBoardRouter)
// Phase 3b of docs/REPORTS_PLAN.md — admin reports inbox + detail
// + thread compose. Inherits the JWT + adminAuth gate from the
// router-level middleware above.
adminRouter.use('/reports', adminReportsRouter)

// 2026-05-19 — API usage gauges (Resend, FCM, Google Maps family).
adminRouter.get('/api-usage', async (_req, res, next) => {
  try {
    const { getUsageSnapshot } = await import('../../lib/apiUsage.ts')
    const snap = await getUsageSnapshot()
    res.status(200).json(snap)
  } catch (err) {
    next(err)
  }
})
