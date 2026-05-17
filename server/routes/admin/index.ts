import { Router, type Request, type Response } from 'express'
import { validateJwt } from '../../middleware/auth.ts'
import { adminAuth } from '../../middleware/adminAuth.ts'
import { adminMetricsRouter } from './metrics.ts'
import { adminFunnelRouter } from './funnel.ts'
import { adminUsersRouter } from './users.ts'

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
