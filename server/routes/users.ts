/**
 * Users-domain routes — small/read-only stats today, room for more
 * profile-shape endpoints later (email change, phone re-verify, etc.).
 *
 *   GET /api/users/me/stats   (JWT-protected)
 *     → `{ rides_completed, rating_avg, rating_count }`
 *
 * Authoritative replacement for the rides-completed count that both
 * web and iOS were sampling client-side via `select rides limit 50`
 * (incorrect once a user has more than 50 rides) plus the
 * `users.rating_avg`/`rating_count` pair already on `auth.profile`.
 * Single round-trip beats the two HEAD-count queries iOS was doing
 * post-2026-04-27 P.1.a, and surfaces a freshness signal too —
 * `auth.profile.rating_avg` only refreshes on `refreshProfile()`
 * which iOS doesn't call after every rate event.
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'

export const usersRouter = Router()

// ── GET /api/users/me/stats ──────────────────────────────────────────────
usersRouter.get(
  '/me/stats',
  validateJwt,
  async (_req: Request, res: Response) => {
    const userId = res.locals['userId'] as string
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
      return
    }

    try {
      // Profile row carries the canonical rating values.
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('users')
        .select('rating_avg, rating_count')
        .eq('id', userId)
        .single()

      if (profileErr || !profile) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User profile not found' } })
        return
      }

      // Single completed-rides count, server-side, using `head + exact`
      // so we don't drag rows down. The OR matches both rider-role
      // and driver-role rides; the server-enforced no-self-rides rule
      // means a single ride can't satisfy both predicates → no
      // double-counting.
      const { count, error: countErr } = await supabaseAdmin
        .from('rides')
        .select('id', { head: true, count: 'exact' })
        .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
        .eq('status', 'completed')

      if (countErr) {
        console.error(`[users/me/stats] count failed: ${countErr.message}`)
      }

      res.status(200).json({
        rides_completed: count ?? 0,
        rating_avg: profile.rating_avg as number | null,
        rating_count: (profile.rating_count as number | null) ?? 0,
      })
    } catch (err) {
      console.error(`[users/me/stats] unexpected error:`, err)
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Stats fetch failed' } })
    }
  },
)
