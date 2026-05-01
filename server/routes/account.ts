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
import { getServerEnv } from '../env.ts'

export const accountRouter = Router()

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

// ── POST /api/account/change-password ────────────────────────────────────
//
// Body: `{ current: string, new: string }`
// Re-auths the caller with `current` against the GoTrue password grant —
// returns 401 WRONG_PASSWORD on mismatch — then admin-updates to `new`.
// Closes the security gap that previously let any authenticated session
// silently rotate the password without proving knowledge of the old one
// (the prior `auth.updateUser({ password })` call from the iOS / web
// settings pages didn't challenge for the current password).
//
// Wired 2026-04-27 as part of P.8 (Profile slice plan).
accountRouter.post(
  '/change-password',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
      return
    }

    const body = (req.body ?? {}) as { current?: unknown; new?: unknown }
    const currentPassword = typeof body.current === 'string' ? body.current : ''
    const newPassword = typeof body.new === 'string' ? body.new : ''

    if (!currentPassword || !newPassword) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'current and new passwords are required' },
      })
      return
    }
    if (newPassword.length < 8) {
      res.status(400).json({
        error: { code: 'WEAK_PASSWORD', message: 'New password must be at least 8 characters' },
      })
      return
    }

    try {
      // Fetch the user's email so we can verify the current password.
      // `supabaseAdmin.auth.admin.getUserById` returns the auth row
      // with the email — that's the canonical credential identifier.
      const { data: userResponse, error: userErr } =
        await supabaseAdmin.auth.admin.getUserById(userId)

      if (userErr || !userResponse?.user?.email) {
        res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'User profile missing' },
        })
        return
      }

      const email = userResponse.user.email

      // Verify current password by hitting the GoTrue password grant
      // directly. Uses the service-role key as the `apikey` header —
      // same pattern `auth.ts` already uses for the refresh-token
      // verify path. The password-grant endpoint accepts either anon
      // or service-role; we pick service-role only to avoid adding a
      // new env var. The session GoTrue returns isn't attached to
      // anything — the only signal we need is "did GoTrue accept
      // these credentials".
      const env = getServerEnv()
      const verifyRes = await fetch(
        `${env.SUPABASE_URL}/auth/v1/token?grant_type=password`,
        {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password: currentPassword }),
          signal: AbortSignal.timeout(10_000),
        },
      )

      if (!verifyRes.ok) {
        // GoTrue returns 400 with `error_description: "Invalid login
        // credentials"` for a wrong password. Surface a friendly,
        // unambiguous code so the client can show "wrong password"
        // copy without parsing the underlying message.
        res.status(401).json({
          error: { code: 'WRONG_PASSWORD', message: 'Current password is incorrect' },
        })
        return
      }

      // Current password verified — admin-update to the new one.
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { password: newPassword },
      )

      if (updateErr) {
        console.error(`[account/change-password] update failed: ${updateErr.message}`)
        res.status(500).json({
          error: { code: 'UPDATE_FAILED', message: 'Could not update password — try again' },
        })
        return
      }

      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
)
