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
 * Requires JWT auth. Useful for testing and manual notification sends.
 */
notificationsRouter.post(
  '/send',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const { user_id, title, body: messageBody, data } = req.body as SendBody

    if (!user_id || !title || !messageBody) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'user_id, title, and body are required' },
      })
      return
    }

    // Fetch tokens for target user
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
