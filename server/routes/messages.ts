import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'
import { sendFcmPush } from '../lib/fcm.ts'

export const messagesRouter = Router()

/**
 * Check if a user is a participant in a ride — either as rider/driver on the
 * ride itself, or as a driver with a pending/selected offer (before select-driver
 * has set driver_id on the ride).
 */
async function isRideParticipant(
  rideId: string,
  userId: string,
  ride: { rider_id: string; driver_id: string | null },
): Promise<boolean> {
  if (ride.rider_id === userId || ride.driver_id === userId) return true

  // Check ride_offers for drivers who accepted but haven't been formally assigned yet
  const { count } = await supabaseAdmin
    .from('ride_offers')
    .select('id', { count: 'exact', head: true })
    .eq('ride_id', rideId)
    .eq('driver_id', userId)
    .in('status', ['pending', 'selected'])

  return (count ?? 0) > 0
}

/**
 * GET /api/messages/:rideId — fetch all messages for a ride.
 */
messagesRouter.get(
  '/:rideId',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const rideId = req.params['rideId'] as string

    // Verify the user is a participant
    const { data: ride, error: rideErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id')
      .eq('id', rideId)
      .single()

    if (rideErr || !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (!(await isRideParticipant(rideId, userId, ride))) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not a participant' } })
      return
    }

    const { data: messages, error: msgErr } = await supabaseAdmin
      .from('messages')
      .select('id, ride_id, sender_id, content, type, meta, created_at')
      .eq('ride_id', rideId)
      .order('created_at', { ascending: true })

    if (msgErr) {
      next(msgErr)
      return
    }

    res.json({ messages: messages ?? [] })
  },
)

/**
 * POST /api/messages/:rideId — send a message and broadcast via Realtime.
 */
messagesRouter.post(
  '/:rideId',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const senderId = res.locals['userId'] as string
    const rideId = req.params['rideId'] as string
    const { content } = req.body as { content?: string }

    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: 'content is required' } })
      return
    }

    // Verify the user is a participant
    const { data: ride, error: rideErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id')
      .eq('id', rideId)
      .single()

    if (rideErr || !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (!(await isRideParticipant(rideId, senderId, ride))) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not a participant' } })
      return
    }

    // Insert message
    const { data: msg, error: insertErr } = await supabaseAdmin
      .from('messages')
      .insert({ ride_id: rideId, sender_id: senderId, content: content.trim(), type: 'text' })
      .select('id, ride_id, sender_id, content, type, meta, created_at')
      .single()

    if (insertErr || !msg) {
      next(insertErr ?? new Error('Failed to insert message'))
      return
    }

    // Broadcast the new message to the ride chat channel (fire-and-forget with timeout)
    const recipientId = senderId === ride.rider_id ? ride.driver_id : ride.rider_id
    if (recipientId) {
      const channel = supabaseAdmin.channel(`chat:${rideId}`)
      const broadcastPromise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          supabaseAdmin.removeChannel(channel).catch(() => {})
          resolve()
        }, 3000)
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel.send({
              type: 'broadcast',
              event: 'new_message',
              payload: msg,
            }).then(() => {
              clearTimeout(timer)
              supabaseAdmin.removeChannel(channel).catch(() => {})
              resolve()
            }).catch(() => {
              clearTimeout(timer)
              supabaseAdmin.removeChannel(channel).catch(() => {})
              resolve()
            })
          }
        })
      })
      // Don't block the response on broadcast
      broadcastPromise.catch(() => {})

      // Send FCM push notification to recipient (fire-and-forget)
      void (async () => {
        try {
          const { data: tokenRows } = await supabaseAdmin
            .from('push_tokens')
            .select('token')
            .eq('user_id', recipientId)
          const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)
          if (tokens.length === 0) return
          const { data: sender } = await supabaseAdmin
            .from('users')
            .select('full_name')
            .eq('id', senderId)
            .single()
          const senderName = sender?.full_name ?? 'Someone'
          const trimmed = content.trim()
          await sendFcmPush(tokens, {
            title: senderName,
            body: trimmed.length > 100 ? trimmed.slice(0, 100) + '…' : trimmed,
            data: { type: 'new_message', ride_id: rideId },
          })
        } catch {
          // non-fatal
        }
      })()
    }

    res.status(201).json({ message: msg })
  },
)
