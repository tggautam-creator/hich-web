/**
 * Live Activity push-token registration endpoints (LIVE.2,
 * 2026-04-30). iOS hits these whenever ActivityKit hands the app a
 * fresh push token (one per activity, ephemeral) so the server can
 * push update payloads directly to the activity's lock-screen card
 * via APNs.
 *
 * Lifecycle:
 *   • iOS starts an activity → ActivityKit yields a push token via
 *     `Activity.pushTokenUpdates`.
 *   • iOS calls POST /api/live-activity/register-token with
 *     {rideID, activityID, pushToken}.
 *   • Server upserts on (user_id, ride_id) so a re-started activity
 *     for the same ride overwrites the prior row.
 *   • iOS ends the activity → ActivityKit invalidates the token →
 *     iOS fires DELETE /api/live-activity/token/:activityID.
 *   • Server-side: APNs 410 Gone on a stale token → defensive
 *     cleanup in `lib/apns.ts` already deletes the row.
 *
 * All routes require a valid Supabase JWT (`validateJwt`). The
 * `ride_id` is verified to belong to the authenticated user as
 * either rider or driver — we don't want one user registering a
 * token against another user's ride id.
 */
import { Router } from 'express'
import type { Request, Response } from 'express'

import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'

interface RegisterBody {
  ride_id?: string
  activity_id?: string
  push_token?: string
}

export const liveActivityRouter = Router()
const router = liveActivityRouter

// All Live Activity routes require auth.
router.use(validateJwt)

/**
 * POST /api/live-activity/register-token
 *
 * Body: { ride_id, activity_id, push_token }
 *
 * Upserts on (user_id, ride_id). Returns 200 on success, 400 on
 * malformed body, 403 if the ride doesn't belong to the user.
 */
router.post('/register-token', async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const body = req.body as RegisterBody

  const rideId = body.ride_id?.trim()
  const activityId = body.activity_id?.trim()
  const pushToken = body.push_token?.trim()

  if (!rideId || !activityId || !pushToken) {
    res.status(400).json({
      error: {
        code: 'INVALID_BODY',
        message: 'ride_id, activity_id, and push_token are required',
      },
    })
    return
  }

  // Verify the ride belongs to this user (rider or driver). The DB's
  // RLS deny policy stops a user from inserting a token they don't
  // own, but the row creation goes through service-role so we need
  // an explicit check.
  const { data: rideRow, error: rideErr } = await supabaseAdmin
    .from('rides')
    .select('id, rider_id, driver_id')
    .eq('id', rideId)
    .maybeSingle()

  if (rideErr || !rideRow) {
    res.status(404).json({
      error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' },
    })
    return
  }

  if (rideRow.rider_id !== userId && rideRow.driver_id !== userId) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Ride does not belong to user' },
    })
    return
  }

  // Upsert on (user_id, ride_id) — one Live Activity per ride per
  // user, by design. ActivityKit can mint multiple tokens for a
  // single activity over its lifetime (Apple rotates them); each
  // refresh overwrites the previous row.
  // `as never` casts: migration 061 isn't in the generated DB
  // types yet — same pattern used elsewhere for unsynced tables
  // (see `routes/users.ts` notification_preferences upsert).
  const { error: upsertErr } = await supabaseAdmin
    .from('live_activity_tokens' as never)
    .upsert(
      {
        user_id: userId,
        ride_id: rideId,
        activity_id: activityId,
        push_token: pushToken,
      } as never,
      { onConflict: 'user_id,ride_id' },
    )

  if (upsertErr) {
    console.error('[LiveActivity] register-token upsert failed:', upsertErr)
    res.status(500).json({
      error: { code: 'DB_ERROR', message: 'Could not register token' },
    })
    return
  }

  res.status(200).json({ ok: true })
})

/**
 * DELETE /api/live-activity/token/:activityID
 *
 * Cleans up a token when iOS ends the activity. activity_id is the
 * cleanest key for this — by the time the activity ends iOS may
 * have lost the ride_id context (e.g. user signed out) but always
 * knows the activity id from `Activity.activities`.
 */
router.delete('/token/:activityID', async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const activityId = req.params.activityID

  if (!activityId) {
    res.status(400).json({
      error: { code: 'INVALID_PATH', message: 'activity_id required' },
    })
    return
  }

  const { error } = await supabaseAdmin
    .from('live_activity_tokens' as never)
    .delete()
    .eq('user_id', userId)
    .eq('activity_id', activityId)

  if (error) {
    console.error('[LiveActivity] delete failed:', error)
    res.status(500).json({
      error: { code: 'DB_ERROR', message: 'Could not delete token' },
    })
    return
  }

  res.status(200).json({ ok: true })
})

