/**
 * Account-management routes — currently just deletion.
 *
 * Apple App Store guideline 5.1.1(v) (2022) requires apps that support
 * account creation to also offer in-app account deletion. This route is
 * the server side of that flow:
 *
 *   POST /api/account/delete   (JWT-protected, no body)
 *     → purges all PII associated with the signed-in user across every
 *       table that references `users.id`, deletes the row from
 *       `auth.users` via the admin SDK, and returns 204 No Content.
 *
 * The deletion order mirrors `server/scripts/deleteUser.ts` (the manual
 * admin script): child tables first, then the user row, then auth.users.
 * Errors on any step are logged but do NOT abort — partial deletion is
 * better than zero deletion when a user has explicitly requested it.
 */

import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'

export const accountRouter = Router()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(table: string, column: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any)
    .delete()
    .eq(column, userId)
  if (error) {
    console.error(`[account/delete] ${table}.${column} purge failed: ${error.message}`)
  }
}

// ── POST /api/account/delete ──────────────────────────────────────────────
accountRouter.post(
  '/delete',
  validateJwt,
  async (_req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
      return
    }

    try {
      console.log(`[account/delete] starting for userId=${userId}`)

      // Order matters — child tables before parent. We iterate even if
      // some fail so the eventual auth.users delete still runs.
      await purge('location_shares', 'user_id', userId)
      await purge('push_tokens', 'user_id', userId)
      await purge('notifications', 'user_id', userId)
      await purge('ride_ratings', 'rater_id', userId)
      await purge('ride_ratings', 'rated_id', userId)
      await purge('ride_offers', 'driver_id', userId)
      await purge('saved_addresses', 'user_id', userId)
      await purge('ride_schedules', 'user_id', userId)
      await purge('messages', 'sender_id', userId)
      await purge('driver_routines', 'user_id', userId)
      await purge('transactions', 'user_id', userId)
      await purge('driver_locations', 'user_id', userId)
      await purge('rides', 'rider_id', userId)
      await purge('rides', 'driver_id', userId)
      await purge('vehicles', 'user_id', userId)
      await purge('users', 'id', userId)

      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
      if (authErr) {
        // App-data is already gone; auth.users delete failure is recoverable
        // by an operator (rare — happens if Supabase project restored the
        // user via a webhook, etc.). Log loudly but treat the request as
        // succeeded for the client; the user's session is invalid anyway.
        console.error(`[account/delete] auth.admin.deleteUser failed: ${authErr.message}`)
      }

      console.log(`[account/delete] done for userId=${userId}`)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
)
