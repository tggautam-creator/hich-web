/**
 * `/api/admin/users/*` — user lookup + per-user admin surfaces.
 *
 * Sits behind the same JWT + adminAuth gate as the rest of the admin
 * router (mounted in `./index.ts`).
 *
 * Current endpoints (Slice 1.2):
 *   GET /stuck?step=&range=&mode=&limit=&offset=
 *     → list of users stuck at a given funnel step (for outreach)
 *
 * Future (Slice 1.3):
 *   GET /search?q=
 *   GET /:id   → profile detail
 */
import { Router } from 'express'
import { handleStuckUsers } from './funnel.ts'

export const adminUsersRouter = Router()

adminUsersRouter.get('/stuck', handleStuckUsers)
