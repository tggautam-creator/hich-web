import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { sendFcmPush } from '../lib/fcm.ts'
import { validateJwt } from '../middleware/auth.ts'

export const notificationsRouter = Router()

interface SendBody {
  user_id: string
  title: string
  body: string
  data?: Record<string, string>
}

/**
 * POST /api/notifications/send
 *
 * Sends a push notification to a specific user via their stored FCM tokens.
 */
notificationsRouter.post(
  '/send',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const senderId = res.locals['userId'] as string
    const { user_id, title, body: messageBody, data } = req.body as SendBody

    if (!user_id || !title || !messageBody) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'user_id, title, and body are required' },
      })
      return
    }

    // Verify sender has an active ride/chat with the target user
    const { data: sharedRide } = await supabaseAdmin
      .from('rides')
      .select('id')
      .or(`and(rider_id.eq.${senderId},driver_id.eq.${user_id}),and(rider_id.eq.${user_id},driver_id.eq.${senderId})`)
      .in('status', ['accepted', 'coordinating', 'active'])
      .limit(1)
      .single()

    if (!sharedRide) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You can only send notifications to users you have an active ride with' },
      })
      return
    }

    const { data: tokenRows, error: tokenErr } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', user_id)

    if (tokenErr) {
      next(tokenErr)
      return
    }

    const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)

    if (tokens.length === 0) {
      res.status(404).json({
        error: { code: 'NO_TOKENS', message: 'No push tokens found for this user' },
      })
      return
    }

    const sentCount = await sendFcmPush(tokens, {
      title,
      body: messageBody,
      data: data ?? {},
    })

    res.status(200).json({ sent: sentCount, total_tokens: tokens.length })
  },
)

/**
 * GET /api/notifications
 *
 * Returns the authenticated user's notifications, most recent first.
 * Query params:
 *   - unread_only: 'true' to filter only unread
 *   - limit: number (default 50)
 */
notificationsRouter.get(
  '/',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const unreadOnly = req.query['unread_only'] === 'true'
    const limit = Math.min(parseInt(req.query['limit'] as string, 10) || 50, 100)

    let query = supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.eq('is_read', false)
      // Exclude ride_request notifications older than 1 hour — they become stale
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      query = query.or(`type.neq.ride_request,created_at.gte.${oneHourAgo}`)
    }

    const { data, error } = await query

    if (error) {
      next(error)
      return
    }

    res.status(200).json({ notifications: data ?? [] })
  },
)

/**
 * GET /api/notifications/unread-count
 *
 * Returns the count of unread notifications for badge display.
 */
notificationsRouter.get(
  '/unread-count',
  validateJwt,
  async (_req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string

    const { count, error } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)

    if (error) {
      next(error)
      return
    }

    res.status(200).json({ count: count ?? 0 })
  },
)

/**
 * PATCH /api/notifications/:id/read
 *
 * Marks a single notification as read.
 */
notificationsRouter.patch(
  '/:id/read',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const notifId = req.params['id'] as string

    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notifId)
      .eq('user_id', userId)

    if (error) {
      next(error)
      return
    }

    res.status(200).json({ id: notifId, is_read: true })
  },
)

/**
 * PATCH /api/notifications/read-all
 *
 * Marks all notifications as read for the authenticated user.
 */
notificationsRouter.patch(
  '/read-all',
  validateJwt,
  async (_req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string

    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)

    if (error) {
      next(error)
      return
    }

    res.status(200).json({ success: true })
  },
)
