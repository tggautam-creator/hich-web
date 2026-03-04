import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { sendFcmPush } from '../lib/fcm.ts'
import { validateJwt } from '../middleware/auth.ts'

export const ridesRouter = Router()

interface GeoPoint {
  type: 'Point'
  coordinates: [number, number]
}

interface RideRequestBody {
  origin: GeoPoint
  destination_bearing?: number
}

function isGeoPoint(val: unknown): val is GeoPoint {
  if (typeof val !== 'object' || val === null) return false
  const obj = val as Record<string, unknown>
  return (
    obj['type'] === 'Point' &&
    Array.isArray(obj['coordinates']) &&
    (obj['coordinates'] as unknown[]).length === 2
  )
}

/**
 * POST /api/rides/request — Stage 2 (with Stage 1 fallback).
 *
 * Stage 2: query drivers within 15km who have a location update within 5 min.
 * Fallback to Stage 1 (all drivers) when Stage 2 returns zero results.
 *
 * Body: { origin: GeoPoint, destination_bearing?: number }
 * Returns: { ride_id: string }
 */
ridesRouter.post(
  '/request',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const riderId = res.locals['userId'] as string
    const body = req.body as RideRequestBody

    if (!isGeoPoint(body.origin)) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'origin must be a GeoPoint { type, coordinates }' },
      })
      return
    }

    // 1. Insert ride
    const { data: ride, error: rideError } = await supabaseAdmin
      .from('rides')
      .insert({
        rider_id: riderId,
        origin: body.origin,
        destination_bearing: body.destination_bearing ?? null,
        status: 'requested',
      })
      .select('id')
      .single()

    if (rideError ?? !ride) {
      next(rideError ?? new Error('Failed to create ride'))
      return
    }

    // 2. Stage 2: find drivers within 15km with a recent location ping
    const { data: nearbyRows, error: nearbyErr } = await supabaseAdmin.rpc(
      'nearby_active_drivers',
      {
        origin_lng: body.origin.coordinates[0],
        origin_lat: body.origin.coordinates[1],
      },
    )

    const hasNearby = !nearbyErr && Array.isArray(nearbyRows) && nearbyRows.length > 0
    const fallbackTriggered = !nearbyErr && Array.isArray(nearbyRows) && nearbyRows.length === 0

    let driverIds: string[]
    let stage: number

    if (hasNearby) {
      driverIds = (nearbyRows as Array<{ user_id: string }>).map((r) => r.user_id)
      stage = 2
    } else {
      // Stage 1 fallback: notify every driver on the platform
      const { data: allDrivers, error: allErr } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('is_driver', true)

      if (allErr) {
        next(allErr)
        return
      }

      driverIds = (allDrivers ?? []).map((d: { id: string }) => d.id)
      stage = 1
    }

    // 3. Fetch FCM tokens for the selected driver IDs
    const { data: tokenRows } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .in('user_id', driverIds)

    // 4. Send FCM push to every token found
    const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)
    const notifiedCount = await sendFcmPush(tokens, {
      title: 'New ride request nearby',
      body: 'A rider needs a lift — open HICH to view.',
      data: { type: 'ride_request', ride_id: ride.id },
    })

    // 5. Log for observability
    const logEntry: Record<string, unknown> = { ride_id: ride.id, stage, drivers_notified: notifiedCount }
    if (fallbackTriggered) logEntry['fallback_triggered'] = true
    console.log(JSON.stringify(logEntry))

    res.status(201).json({ ride_id: ride.id })
  },
)

/**
 * PATCH /api/rides/:id/accept
 *
 * A driver accepts a ride request.
 * Sets status='accepted', driver_id=current user.
 * Sends push notification to the rider.
 *
 * Returns: { ride_id, status: 'accepted' }
 */
ridesRouter.patch(
  '/:id/accept',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const driverId = res.locals['userId'] as string
    const rideId = req.params['id'] as string

    if (!rideId) {
      res.status(400).json({
        error: { code: 'INVALID_PARAMS', message: 'Ride ID is required' },
      })
      return
    }

    // 1. Verify ride exists and is still in 'requested' status
    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({
        error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' },
      })
      return
    }

    if (ride.status !== 'requested') {
      res.status(409).json({
        error: { code: 'RIDE_NOT_AVAILABLE', message: `Ride status is '${ride.status}', cannot accept` },
      })
      return
    }

    // 2. Update ride: set status='accepted' and assign driver
    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'accepted', driver_id: driverId })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // 3. Send push notification to rider
    const { data: riderTokens } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', ride.rider_id)

    const tokens = (riderTokens ?? []).map((t: { token: string }) => t.token)
    if (tokens.length > 0) {
      await sendFcmPush(tokens, {
        title: 'Driver found!',
        body: 'A driver has accepted your ride request.',
        data: { type: 'ride_accepted', ride_id: rideId },
      })
    }

    res.status(200).json({ ride_id: rideId, status: 'accepted' })
  },
)
