import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { sendFcmPush } from '../lib/fcm.ts'
import { validateJwt } from '../middleware/auth.ts'
import { generateQrToken, validateQrToken } from '../lib/qrToken.ts'
import { computeTransitDropoffSuggestions, fetchDrivingRoute, type TransitDropoffSuggestion } from '../lib/transitSuggestions.ts'
import { realtimeBroadcast, realtimeBroadcastMany } from '../lib/realtimeBroadcast.ts'
import { chargeRideFare } from '../lib/stripeConnect.ts'

export const ridesRouter = Router()

interface GeoPoint {
  type: 'Point'
  coordinates: [number, number]
}

// ── Server-side fare calculation ──────────────────────────────────────────────
const DEG_TO_RAD = Math.PI / 180
const EARTH_RADIUS_M = 6_371_000
const KM_TO_MILES = 0.621371
const MIN_FARE_CENTS = 200
const MAX_FARE_CENTS = 4000
const BASE_CENTS = 100
const PER_MIN_CENTS = 5
const PLATFORM_FEE_RATE = 0
const DEFAULT_MPG = 25
const DEFAULT_GAS_PRICE_PER_GALLON = 3.50

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = lat1 * DEG_TO_RAD
  const φ2 = lat2 * DEG_TO_RAD
  const Δφ = (lat2 - lat1) * DEG_TO_RAD
  const Δλ = (lng2 - lng1) * DEG_TO_RAD
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function computeRideFare(
  ride: { pickup_point: GeoPoint | null; dropoff_point: GeoPoint | null; started_at: string | null },
  endedAt: string,
): { fare_cents: number; platform_fee_cents: number; driver_earns_cents: number; distance_miles: number; duration_min: number } {
  // Duration from actual ride timestamps
  const startMs = ride.started_at ? new Date(ride.started_at).getTime() : Date.now()
  const endMs = new Date(endedAt).getTime()
  const durationMin = Math.max(0, Math.round((endMs - startMs) / 60000))

  // Distance: actual pickup GPS → actual dropoff GPS only.
  // Never fall back to planned origin/destination — fare must reflect real travel.
  let distanceM = 0
  if (ride.pickup_point && ride.dropoff_point) {
    distanceM = haversineMetres(
      ride.pickup_point.coordinates[1], ride.pickup_point.coordinates[0],
      ride.dropoff_point.coordinates[1], ride.dropoff_point.coordinates[0],
    )
  }
  const distanceMiles = (distanceM / 1000) * KM_TO_MILES

  // Gas cost
  const gallonsUsed = distanceMiles / DEFAULT_MPG
  const gasCostCents = Math.round(gallonsUsed * DEFAULT_GAS_PRICE_PER_GALLON * 100)
  const timeCostCents = Math.round(durationMin * PER_MIN_CENTS)

  const raw = BASE_CENTS + gasCostCents + timeCostCents
  const fareCents = Math.max(MIN_FARE_CENTS, Math.min(MAX_FARE_CENTS, raw))
  const platformFeeCents = Math.round(fareCents * PLATFORM_FEE_RATE)
  const driverEarnsCents = fareCents - platformFeeCents

  return { fare_cents: fareCents, platform_fee_cents: platformFeeCents, driver_earns_cents: driverEarnsCents, distance_miles: distanceMiles, duration_min: durationMin }
}

interface RideRequestBody {
  origin: GeoPoint
  destination_bearing?: number
  destination_name?: string
  destination_lat?: number
  destination_lng?: number
  distance_km?: number
  estimated_fare_cents?: number
  route_polyline?: string
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

    // Guard: block duplicate ride requests from the same rider (BUG-036)
    // Exclude scheduled rides for future dates — they shouldn't block on-demand requests
    const today = new Date().toISOString().split('T')[0]
    const { data: existingRide } = await supabaseAdmin
      .from('rides')
      .select('id')
      .eq('rider_id', riderId)
      .in('status', ['requested', 'accepted', 'coordinating', 'active'])
      .or(`schedule_id.is.null,trip_date.is.null,trip_date.eq.${today}`)
      .limit(1)
      .maybeSingle()

    if (existingRide) {
      res.status(409).json({
        error: { code: 'ACTIVE_RIDE_EXISTS', message: 'You already have an active ride. Cancel it first.' },
      })
      return
    }

    const destinationGeo = (typeof body.destination_lat === 'number' && typeof body.destination_lng === 'number')
      ? { type: 'Point' as const, coordinates: [body.destination_lng, body.destination_lat] as [number, number] }
      : null

    const { data: ride, error: rideError } = await supabaseAdmin
      .from('rides')
      .insert({
        rider_id: riderId,
        origin: body.origin,
        destination: destinationGeo,
        destination_name: body.destination_name ?? null,
        destination_bearing: body.destination_bearing ?? null,
        route_polyline: typeof body.route_polyline === 'string' ? body.route_polyline : null,
        status: 'requested',
      })
      .select('id')
      .single()

    if (rideError ?? !ride) {
      next(rideError ?? new Error('Failed to create ride'))
      return
    }

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
      const nearbyIds = (nearbyRows as Array<{ user_id: string }>).map((r) => r.user_id)
        .filter((id) => id !== riderId)
      driverIds = nearbyIds
      stage = 2
    } else {
      // Stage 1 fallback — notify all online drivers
      const { data: onlineRows } = await supabaseAdmin
        .from('driver_locations')
        .select('user_id')
        .eq('is_online', true)

      const onlineIds = new Set((onlineRows ?? []).map((r: { user_id: string }) => r.user_id))

      const { data: allDrivers, error: allErr } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('is_driver', true)
        .neq('id', riderId)

      if (allErr) {
        next(allErr)
        return
      }

      driverIds = (allDrivers ?? []).map((d: { id: string }) => d.id)
        .filter((id: string) => onlineIds.has(id))
      stage = 1
    }

    console.log(`[rides/request] riderId=${riderId}, stage=${stage}, driverIds=${JSON.stringify(driverIds)}`)

    const { data: tokenRows } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .in('user_id', driverIds)

    const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)
    console.log(`[rides/request] Found ${tokens.length} push tokens for ${driverIds.length} drivers`)
    const notifiedCount = await sendFcmPush(tokens, {
      title: 'New ride request nearby',
      body: 'A rider needs a lift — open HICH to view.',
      data: { type: 'ride_request', ride_id: ride.id },
    })

    const fareCents = typeof body.estimated_fare_cents === 'number' ? body.estimated_fare_cents : 0
    const platformFee = Math.round(fareCents * 0.15)
    const driverEarns = fareCents - platformFee

    // Fetch rider name + rating for notifications and broadcasts
    const riderProfile = await supabaseAdmin
      .from('users')
      .select('full_name, rating_avg, rating_count')
      .eq('id', riderId)
      .single()
    const riderName = riderProfile.data?.full_name ?? 'A rider'

    // Persist notifications as a reliable fallback when realtime/push is delayed.
    if (driverIds.length > 0) {
      const notificationRows = driverIds.map((driverId) => ({
        user_id: driverId,
        type: 'ride_request',
        title: 'New ride request nearby',
        body: 'A rider needs a lift — open HICH to view.',
        data: {
          type: 'ride_request',
          ride_id: ride.id,
          rider_name: riderName,
          destination: body.destination_name ?? 'Nearby destination',
          distance_km: String(body.distance_km ?? '–'),
          estimated_earnings_cents: String(driverEarns),
          origin_lat: String(body.origin.coordinates[1]),
          origin_lng: String(body.origin.coordinates[0]),
          destination_lat: typeof body.destination_lat === 'number' ? String(body.destination_lat) : '',
          destination_lng: typeof body.destination_lng === 'number' ? String(body.destination_lng) : '',
          rider_rating: String(riderProfile.data?.rating_avg ?? ''),
          rider_rating_count: String(riderProfile.data?.rating_count ?? '0'),
        },
      }))

      const { error: notifErr } = await supabaseAdmin
        .from('notifications')
        .insert(notificationRows)

      if (notifErr) {
        console.error(`[rides/request] Failed to persist notifications: ${notifErr.message}`)
      }
    }

    // Broadcast via Supabase Realtime so in-app listeners receive instantly

    const realtimePayload = {
      type: 'ride_request' as const,
      ride_id: ride.id,
      rider_name: riderName,
      destination: body.destination_name ?? 'Nearby destination',
      distance_km: String(body.distance_km ?? '–'),
      estimated_earnings_cents: String(driverEarns),
      origin_lat: String(body.origin.coordinates[1]),
      origin_lng: String(body.origin.coordinates[0]),
      destination_lat: typeof body.destination_lat === 'number' ? String(body.destination_lat) : '',
      destination_lng: typeof body.destination_lng === 'number' ? String(body.destination_lng) : '',
      rider_rating: String(riderProfile.data?.rating_avg ?? ''),
      rider_rating_count: String(riderProfile.data?.rating_count ?? '0'),
    }

    const realtimeResults = await Promise.all(
      driverIds.map((driverId) => realtimeBroadcast(`driver:${driverId}`, 'ride_request', realtimePayload)),
    )
    const realtimeSentCount = realtimeResults.filter(Boolean).length

    const logEntry: Record<string, unknown> = {
      ride_id: ride.id,
      stage,
      drivers_notified: notifiedCount,
      realtime_broadcast_attempted: driverIds.length,
      realtime_broadcast_sent: realtimeSentCount,
    }
    if (fallbackTriggered) logEntry['fallback_triggered'] = true
    console.log(JSON.stringify(logEntry))

    res.status(201).json({ ride_id: ride.id })
  },
)

/**
 * PATCH /api/rides/:id/cancel — rider or driver cancels the ride.
 * Allowed in statuses: requested, accepted, coordinating.
 * Broadcasts cancellation to the other party via Realtime.
 */
ridesRouter.patch(
  '/:id/cancel',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const rideId = req.params['id'] as string

    if (!rideId) {
      res.status(400).json({
        error: { code: 'INVALID_PARAMS', message: 'Ride ID is required' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({
        error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' },
      })
      return
    }

    // Either rider or driver can cancel
    console.log(`[rides/cancel:DEBUG] ENTRY rideId=${rideId} callerId=${userId} ride.status=${ride.status} ride.driver_id=${ride.driver_id} ride.rider_id=${ride.rider_id}`)
    if (ride.rider_id !== userId && ride.driver_id !== userId) {
      // ── Path C: driver cancels BEFORE select-driver was called (driver_id is null) ──
      // Check if the caller has a pending/selected ride_offer for this ride
      const { data: callerOffer } = await supabaseAdmin
        .from('ride_offers')
        .select('id, status')
        .eq('ride_id', rideId)
        .eq('driver_id', userId)
        .in('status', ['pending', 'selected'])
        .maybeSingle()

      if (!callerOffer) {
        console.log(`[rides/cancel:DEBUG] Path C REJECTED — no pending/selected offer for driver ${userId} on ride ${rideId}`)
        res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Only a ride participant can cancel' },
        })
        return
      }

      // Release this driver's offer
      await supabaseAdmin
        .from('ride_offers')
        .update({ status: 'released' })
        .eq('id', callerOffer.id)

      // If this was the 'selected' offer, revert ride state and standby offers
      if (callerOffer.status === 'selected') {
        await supabaseAdmin
          .from('rides')
          .update({
            status: 'requested',
            driver_id: null,
            driver_destination: null,
            driver_destination_name: null,
            driver_route_polyline: null,
          })
          .eq('id', rideId)

        await supabaseAdmin
          .from('ride_offers')
          .update({ status: 'pending' })
          .eq('ride_id', rideId)
          .eq('status', 'standby')
      }

      // Fetch remaining pending offers for standby count
      const { data: remainingOffers } = await supabaseAdmin
        .from('ride_offers')
        .select('driver_id')
        .eq('ride_id', rideId)
        .eq('status', 'pending')

      const standbyCount = (remainingOffers ?? []).length

      // Broadcast driver_cancelled to rider channels
      const pathCPayload: Record<string, unknown> = {
        type: 'driver_cancelled',
        ride_id: rideId,
        cancelled_driver_id: userId,
        standby_count: standbyCount,
      }
      await Promise.all([
        realtimeBroadcast(`waiting:${ride.rider_id}`, 'driver_cancelled', pathCPayload),
        realtimeBroadcast(`multi-driver:${rideId}`, 'driver_cancelled', pathCPayload),
      ])

      console.log(`[rides/cancel] Path C: driver ${userId} cancelled offer for ride ${rideId} (pre-selection)`)
      res.status(200).json({ ride_id: rideId, status: ride.status, driver_cancelled: true, standby_count: standbyCount })
      return
    }

    const cancellableStatuses = ['requested', 'accepted', 'coordinating']
    const originalStatus = ride.status
    if (!cancellableStatuses.includes(originalStatus)) {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${originalStatus}', cannot cancel` },
      })
      return
    }

    const isDriverCancel = ride.driver_id === userId
    const cancellerRole = isDriverCancel ? 'driver' : 'rider'

    // ── DRIVER cancels an accepted/coordinating/requested ride → revert to requested + re-match ──
    // Note: 'requested' is included because select-driver may have set driver_id
    // before status transitions to 'accepted' (race condition), or the ride was
    // left in an inconsistent state. A driver cancel should NEVER permanently
    // cancel the ride — only the rider can do that.
    if (isDriverCancel && (originalStatus === 'accepted' || originalStatus === 'coordinating' || originalStatus === 'requested')) {
      console.log(`[rides/cancel:DEBUG] Path A: driver ${userId} cancelling ${originalStatus} ride ${rideId}`)
      const { error: revertErr } = await supabaseAdmin
        .from('rides')
        .update({
          status: 'requested',
          driver_id: null,
          driver_destination: null,
          driver_destination_name: null,
          driver_route_polyline: null,
          pickup_point: null,
          pickup_confirmed: false,
          dropoff_point: null,
          dropoff_confirmed: false,
        })
        .eq('id', rideId)

      if (revertErr) { next(revertErr); return }

      // Clean up all chat messages so the next driver starts with a clean slate
      await supabaseAdmin
        .from('messages')
        .delete()
        .eq('ride_id', rideId)

      // Mark the cancelled driver's offer as 'released'
      await supabaseAdmin
        .from('ride_offers')
        .update({ status: 'released' })
        .eq('ride_id', rideId)
        .eq('driver_id', userId)

      // Revert standby offers back to 'pending' — these drivers are back in the running
      await supabaseAdmin
        .from('ride_offers')
        .update({ status: 'pending' })
        .eq('ride_id', rideId)
        .eq('status', 'standby')

      // Fetch remaining pending offers (standby drivers that were reverted)
      const { data: pendingOffers } = await supabaseAdmin
        .from('ride_offers')
        .select('driver_id')
        .eq('ride_id', rideId)
        .eq('status', 'pending')

      const pendingDriverIds = (pendingOffers ?? []).map((o: { driver_id: string }) => o.driver_id)

      // Broadcast driver_cancelled to the rider with standby info
      const driverCancelPayload: Record<string, unknown> = {
        type: 'driver_cancelled',
        ride_id: rideId,
        cancelled_driver_id: userId,
        standby_count: pendingDriverIds.length,
      }
      await Promise.all([
        realtimeBroadcast(`rider:${ride.rider_id}`, 'driver_cancelled', driverCancelPayload),
        realtimeBroadcast(`rider-pickup:${ride.rider_id}`, 'driver_cancelled', driverCancelPayload),
        realtimeBroadcast(`waiting:${ride.rider_id}`, 'driver_cancelled', driverCancelPayload),
        realtimeBroadcast(`chat:${rideId}`, 'driver_cancelled', driverCancelPayload),
        realtimeBroadcast(`multi-driver:${rideId}`, 'driver_cancelled', driverCancelPayload),
        realtimeBroadcast(`myrides:${ride.rider_id}`, 'ride_status_changed', { ride_id: rideId, status: 'requested' }),
        realtimeBroadcast(`myrides:${userId}`, 'ride_status_changed', { ride_id: rideId, status: 'requested' }),
      ])

      // Send FCM push to the rider
      const { data: riderTokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', ride.rider_id)
      const riderTokenList = (riderTokens ?? []).map((t: { token: string }) => t.token)
      if (riderTokenList.length > 0) {
        await sendFcmPush(riderTokenList, {
          title: 'Driver cancelled',
          body: pendingDriverIds.length > 0
            ? `Finding you a new driver… ${pendingDriverIds.length} driver${pendingDriverIds.length > 1 ? 's' : ''} still available.`
            : 'Finding you a new driver…',
          data: { type: 'driver_cancelled', ride_id: rideId },
        })
      }

      if (pendingDriverIds.length > 0) {
        // ── Standby drivers exist → notify only them (they're already aware of the ride) ──
        const { data: tokenRows } = await supabaseAdmin
          .from('push_tokens')
          .select('token')
          .in('user_id', pendingDriverIds)

        const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)
        if (tokens.length > 0) {
          await sendFcmPush(tokens, {
            title: 'Rider needs a new driver',
            body: 'The selected driver cancelled — your offer is still active!',
            data: { type: 'ride_request_renewed', ride_id: rideId },
          })
        }

        // Fetch full ride details so renewed notification has all fields needed by RideRequestNotification
        const { data: fullRideForStandby } = await supabaseAdmin
          .from('rides')
          .select('id, origin, destination, destination_name, rider_id')
          .eq('id', rideId)
          .single()

        let renewedPayload: Record<string, unknown> = {
          type: 'ride_request_renewed', ride_id: rideId,
        }

        if (fullRideForStandby) {
          const origin = fullRideForStandby.origin as unknown as { coordinates: number[] }
          const dest = fullRideForStandby.destination as unknown as { coordinates: number[] } | null

          const { data: riderProfile } = await supabaseAdmin
            .from('users')
            .select('full_name')
            .eq('id', fullRideForStandby.rider_id)
            .single()

          renewedPayload = {
            type: 'ride_request_renewed',
            ride_id: rideId,
            rider_name: riderProfile?.full_name ?? 'A rider',
            destination: fullRideForStandby.destination_name ?? 'Nearby destination',
            distance_km: '–',
            estimated_earnings_cents: '0',
            origin_lat: String(origin.coordinates[1]),
            origin_lng: String(origin.coordinates[0]),
            destination_lat: dest ? String(dest.coordinates[1]) : '',
            destination_lng: dest ? String(dest.coordinates[0]) : '',
          }
        }

        // Realtime: notify standby drivers their offer is active again (with full ride details)
        for (const driverId of pendingDriverIds) {
          void realtimeBroadcast(`driver:${driverId}`, 'ride_request_renewed', renewedPayload)
        }
      } else {
        // ── No standby drivers → re-broadcast to all drivers (existing behavior) ──
        const { data: allOnlineDrivers } = await supabaseAdmin
          .from('driver_locations')
          .select('user_id')
          .eq('is_online', true)

        const onlineIds = (allOnlineDrivers ?? []).map((d: { user_id: string }) => d.user_id)

        const { data: allDrivers } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('is_driver', true)

        const driverIds = (allDrivers ?? [])
          .map((d: { id: string }) => d.id)
          .filter((id: string) => id !== userId && id !== ride.rider_id && onlineIds.includes(id))

        if (driverIds.length > 0) {
          const { data: tokenRows } = await supabaseAdmin
            .from('push_tokens')
            .select('token')
            .in('user_id', driverIds)

          const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)
          if (tokens.length > 0) {
            await sendFcmPush(tokens, {
              title: 'New ride request nearby',
              body: 'A rider needs a lift — open HICH to view.',
              data: { type: 'ride_request', ride_id: rideId },
            })
          }
        }

        // Realtime re-broadcast ride_request to in-app drivers
        const { data: fullRide } = await supabaseAdmin
          .from('rides')
          .select('id, origin, destination, destination_name, rider_id')
          .eq('id', rideId)
          .single()

        if (fullRide) {
          const origin = fullRide.origin as unknown as { coordinates: number[] }
          const dest = fullRide.destination as unknown as { coordinates: number[] } | null

          const { data: riderProfile } = await supabaseAdmin
            .from('users')
            .select('full_name')
            .eq('id', fullRide.rider_id)
            .single()

          const realtimePayload = {
            type: 'ride_request' as const,
            ride_id: rideId,
            rider_name: riderProfile?.full_name ?? 'A rider',
            destination: fullRide.destination_name ?? 'Nearby destination',
            distance_km: '–',
            estimated_earnings_cents: '0',
            origin_lat: String(origin.coordinates[1]),
            origin_lng: String(origin.coordinates[0]),
            destination_lat: dest ? String(dest.coordinates[1]) : '',
            destination_lng: dest ? String(dest.coordinates[0]) : '',
          }

          const broadcastDriverIds = (allDrivers ?? [])
            .map((d: { id: string }) => d.id)
            .filter((id: string) => id !== userId && id !== ride.rider_id)

          await Promise.all(
            broadcastDriverIds.map((driverId) => realtimeBroadcast(`driver:${driverId}`, 'ride_request', realtimePayload)),
          )
        }
      }

      console.log(`[rides/cancel] rideId=${rideId} driver-cancelled by ${userId}, reverted to requested, standby_count=${pendingDriverIds.length}`)
      res.status(200).json({ ride_id: rideId, status: 'requested', driver_cancelled: true, standby_count: pendingDriverIds.length })
      return
    }

    // ── Rider cancel or driver cancel of a 'requested' ride → permanent cancel ──
    console.log(`[rides/cancel:DEBUG] Path B: permanent cancel by ${cancellerRole} ${userId} for ride ${rideId} (was ${originalStatus})`)
    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'cancelled' })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Release any pending ride_offers for this ride
    await supabaseAdmin
      .from('ride_offers')
      .update({ status: 'released' })
      .eq('ride_id', rideId)
      .in('status', ['pending', 'selected'])

    // Notify the other party
    const otherUserId = userId === ride.rider_id ? ride.driver_id : ride.rider_id

    if (otherUserId) {
      // Broadcast to the other party's notification channel
      const channelName = cancellerRole === 'rider'
        ? `driver:${otherUserId}`
        : `rider:${otherUserId}`

      await Promise.all([
        realtimeBroadcast(channelName, 'ride_cancelled', {
          type: 'ride_cancelled', ride_id: rideId, cancelled_by: cancellerRole,
        }),
        // Also notify pickup pages if rider/driver is on navigation screen
        ...(cancellerRole === 'driver' ? [
          realtimeBroadcast(`rider-pickup:${otherUserId}`, 'ride_cancelled', {
            type: 'ride_cancelled', ride_id: rideId, cancelled_by: cancellerRole,
          }),
        ] : [
          realtimeBroadcast(`driver-pickup:${otherUserId}`, 'ride_cancelled', {
            type: 'ride_cancelled', ride_id: rideId, cancelled_by: cancellerRole,
          }),
        ]),
        realtimeBroadcast(`myrides:${otherUserId}`, 'ride_status_changed', {
          ride_id: rideId, status: 'cancelled',
        }),
      ])

      // Send FCM push
      const { data: otherTokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', otherUserId)

      const tokens = (otherTokens ?? []).map((t: { token: string }) => t.token)
      if (tokens.length > 0) {
        await sendFcmPush(tokens, {
          title: 'Ride Cancelled',
          body: `The ${cancellerRole} cancelled the ride.`,
          data: { type: 'ride_cancelled', ride_id: rideId },
        })
      }
    }

    // Also refresh the canceller's own MyRides
    await realtimeBroadcast(`myrides:${userId}`, 'ride_status_changed', {
      ride_id: rideId, status: 'cancelled',
    })

    // Broadcast to the chat channel so MessagingWindow updates if open
    await realtimeBroadcast(`chat:${rideId}`, 'ride_cancelled', {
      type: 'ride_cancelled', ride_id: rideId, cancelled_by: cancellerRole,
    })

    // If ride was in 'requested' status (board ride), also broadcast to all drivers for cleanup
    if (originalStatus === 'requested') {
      const { data: allDrivers } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('is_driver', true)
        .neq('id', userId)

      for (const driver of allDrivers ?? []) {
        void realtimeBroadcast(`driver:${driver.id}`, 'ride_cancelled', {
          type: 'ride_cancelled', ride_id: rideId,
        })
      }
    }

    console.log(`[rides/cancel] rideId=${rideId} cancelled by ${cancellerRole} (${userId})`)
    res.status(200).json({ ride_id: rideId, status: 'cancelled' })

    // Clean up stale ride_request notifications for this ride (fire-and-forget)
    void supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('type', 'ride_request')
      .eq('is_read', false)
      .contains('data', { ride_id: rideId })
      .then(({ error: cleanupErr }) => {
        if (cleanupErr) console.warn(`[rides/cancel] notification cleanup error: ${cleanupErr.message}`)
      })
  },
)

/**
 * GET /api/rides/:id/status — lightweight status check for notification staleness.
 */
ridesRouter.get(
  '/:id/status',
  validateJwt,
  async (req: Request, res: Response, _next: NextFunction) => {
    const rideId = req.params['id'] as string

    const { data, error } = await supabaseAdmin
      .from('rides')
      .select('status')
      .eq('id', rideId)
      .single()

    if (error ?? !data) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    res.status(200).json({ ride_id: rideId, status: data.status })
  },
)

/**
 * PATCH /api/rides/:id/accept
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

    // Verify caller is a driver (BUG-038)
    const { data: driverProfile } = await supabaseAdmin
      .from('users')
      .select('is_driver')
      .eq('id', driverId)
      .single()

    if (!driverProfile?.is_driver) {
      res.status(403).json({
        error: { code: 'NOT_A_DRIVER', message: 'Only drivers can accept rides' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({
        error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' },
      })
      return
    }

    // Prevent self-accept (BUG-038)
    if (ride.rider_id === driverId) {
      res.status(409).json({
        error: { code: 'SELF_ACCEPT', message: 'Cannot accept your own ride' },
      })
      return
    }

    // If this driver is already the ride's selected driver (e.g. auto-selected
    // by WaitingRoom polling before the driver tapped Accept), just return success.
    // Still save their destination if provided so DropoffSelection has it.
    if (ride.driver_id === driverId) {
      const earlyBody = req.body as Record<string, unknown>
      const earlyHasDest = typeof earlyBody['driver_destination_lat'] === 'number' && typeof earlyBody['driver_destination_lng'] === 'number'
      if (earlyHasDest) {
        const destGeo: GeoPoint = {
          type: 'Point',
          coordinates: [Number(earlyBody['driver_destination_lng']), Number(earlyBody['driver_destination_lat'])],
        }
        await supabaseAdmin
          .from('ride_offers')
          .update({
            driver_destination: destGeo,
            driver_destination_name: typeof earlyBody['driver_destination_name'] === 'string' ? earlyBody['driver_destination_name'] : null,
            driver_route_polyline: typeof earlyBody['driver_route_polyline'] === 'string' ? earlyBody['driver_route_polyline'] : null,
            overlap_pct: typeof earlyBody['overlap_pct'] === 'number' ? earlyBody['overlap_pct'] : null,
          })
          .eq('ride_id', rideId)
          .eq('driver_id', driverId)
      }
      console.log(`[rides/accept] rideId=${rideId} driver=${driverId} already selected, returning success`)
      res.status(200).json({ ride_id: rideId, status: ride.status, offer_status: 'selected' })
      return
    }

    if (ride.status !== 'requested' && ride.status !== 'accepted' && ride.status !== 'coordinating') {
      res.status(409).json({
        error: { code: 'RIDE_NOT_AVAILABLE', message: `Ride status is '${ride.status}', cannot accept` },
      })
      return
    }

    // Look up driver's active vehicle
    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .select('id')
      .eq('user_id', driverId)
      .eq('is_active', true)
      .limit(1)
      .single()

    // Insert offer into ride_offers (upsert to handle duplicate accepts).
    // If a driver has already been selected (status 'accepted' or 'coordinating'),
    // join as 'standby' so they can take over if the selected driver cancels.
    //
    // Race-condition guard: WaitingRoom may have auto-selected this driver via
    // select-driver between our initial ride fetch and now. Check the existing
    // offer before deciding on standby.
    let offerStatus: 'pending' | 'standby' = (ride.status === 'accepted' || ride.status === 'coordinating') ? 'standby' : 'pending'

    console.log(`[rides/accept:DEBUG] rideId=${rideId} driver=${driverId} ride.status=${ride.status} ride.driver_id=${ride.driver_id} initial offerStatus=${offerStatus}`)

    if (offerStatus === 'standby') {
      // Fetch this driver's existing offer to resolve race conditions
      const { data: existingOffer } = await supabaseAdmin
        .from('ride_offers')
        .select('status')
        .eq('ride_id', rideId)
        .eq('driver_id', driverId)
        .single()

      console.log(`[rides/accept:DEBUG] existingOffer=${JSON.stringify(existingOffer)}`)

      if (existingOffer?.status === 'selected') {
        // select-driver already chose this driver — return success
        console.log(`[rides/accept] rideId=${rideId} driver=${driverId} already selected (offer), returning success`)
        res.status(200).json({ ride_id: rideId, status: ride.status, offer_status: 'selected' })
        return
      }

      if (existingOffer?.status === 'pending') {
        // Driver was reverted from standby by a cancel (their offer is already
        // 'pending'). Don't put them back on standby — keep as pending so the
        // normal accept flow proceeds and WaitingRoom can select them.
        console.log(`[rides/accept] rideId=${rideId} driver=${driverId} has existing pending offer, keeping as pending (not standby)`)
        offerStatus = 'pending'
      }

      // If still standby (new driver joining for the first time while ride is
      // accepted), double-check the ride hasn't changed since our initial fetch
      if (offerStatus === 'standby') {
        const { data: freshRide } = await supabaseAdmin
          .from('rides')
          .select('driver_id, status')
          .eq('id', rideId)
          .single()

        console.log(`[rides/accept:DEBUG] freshRide=${JSON.stringify(freshRide)}`)

        if (freshRide?.driver_id === driverId) {
          console.log(`[rides/accept] rideId=${rideId} driver=${driverId} already selected (ride re-fetch), returning success`)
          res.status(200).json({ ride_id: rideId, status: freshRide.status, offer_status: 'selected' })
          return
        }

        if (freshRide && freshRide.status === 'requested') {
          offerStatus = 'pending'
        }
      }
    }

    console.log(`[rides/accept:DEBUG] final offerStatus=${offerStatus}`)

    const { error: offerErr } = await supabaseAdmin
      .from('ride_offers')
      .upsert(
        { ride_id: rideId, driver_id: driverId, vehicle_id: vehicle?.id ?? null, status: offerStatus },
        { onConflict: 'ride_id,driver_id' },
      )

    if (offerErr) {
      next(offerErr)
      return
    }

    // If driver joined as standby (ride already has a selected driver),
    // notify them immediately and skip the rider-facing broadcast.
    if (offerStatus === 'standby') {
      void realtimeBroadcast(`driver:${driverId}`, 'ride_standby', {
        type: 'ride_standby',
        ride_id: rideId,
      })
      console.log(`[rides/accept] rideId=${rideId} driver=${driverId} joined as standby`)
      res.status(200).json({ ride_id: rideId, status: ride.status, offer_status: 'standby' })
      return
    }

    // If driver included their destination, save it on the offer
    const body = req.body as Record<string, unknown>
    const hasDriverDest = typeof body['driver_destination_lat'] === 'number' && typeof body['driver_destination_lng'] === 'number'
    if (hasDriverDest) {
      const destGeo: GeoPoint = {
        type: 'Point',
        coordinates: [Number(body['driver_destination_lng']), Number(body['driver_destination_lat'])],
      }
      await supabaseAdmin
        .from('ride_offers')
        .update({
          driver_destination: destGeo,
          driver_destination_name: typeof body['driver_destination_name'] === 'string' ? body['driver_destination_name'] : null,
          driver_route_polyline: typeof body['driver_route_polyline'] === 'string' ? body['driver_route_polyline'] : null,
          overlap_pct: typeof body['overlap_pct'] === 'number' ? body['overlap_pct'] : null,
        })
        .eq('ride_id', rideId)
        .eq('driver_id', driverId)
    }

    // Count current pending offers for this ride
    const { count: offerCount } = await supabaseAdmin
      .from('ride_offers')
      .select('id', { count: 'exact', head: true })
      .eq('ride_id', rideId)
      .eq('status', 'pending')

    // Fetch driver info for enriched broadcast
    const { data: driverInfo } = await supabaseAdmin
      .from('users')
      .select('full_name, avatar_url, rating_avg, rating_count')
      .eq('id', driverId)
      .single()

    // Broadcast offer to rider via Realtime so WaitingRoom can collect offers
    const acceptPayload: Record<string, unknown> = {
      type: 'ride_accepted',
      ride_id: rideId,
      driver_id: driverId,
      offer_count: offerCount ?? 1,
      driver_name: driverInfo?.full_name ?? null,
      driver_avatar: driverInfo?.avatar_url ?? null,
      driver_rating: driverInfo?.rating_avg ?? null,
      driver_rating_count: driverInfo?.rating_count ?? 0,
      overlap_pct: hasDriverDest && typeof body['overlap_pct'] === 'number' ? body['overlap_pct'] : null,
      driver_destination_name: hasDriverDest && typeof body['driver_destination_name'] === 'string' ? body['driver_destination_name'] : null,
    }
    const realtimeTargets = [`rider:${ride.rider_id}`, `waiting:${ride.rider_id}`]
    await Promise.all(
      realtimeTargets.map((ch) => realtimeBroadcast(ch, 'ride_accepted', acceptPayload)),
    )

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

    console.log(`[rides/accept] rideId=${rideId} driver=${driverId} offerCount=${offerCount}`)
    res.status(200).json({ ride_id: rideId, status: 'requested', offer_status: 'pending', offer_count: offerCount })
  },
)

/**
 * PATCH /api/rides/:id/confirm-dropoff — rider accepts the drop-off arrangement.
 * Status → 'coordinating'.
 */
ridesRouter.patch(
  '/:id/confirm-dropoff',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const rideId = req.params['id'] as string

    if (!rideId) {
      res.status(400).json({
        error: { code: 'INVALID_PARAMS', message: 'Ride ID is required' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({
        error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' },
      })
      return
    }

    if (ride.rider_id !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only the rider can confirm drop-off' },
      })
      return
    }

    if (ride.status !== 'accepted') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot confirm drop-off` },
      })
      return
    }

    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'coordinating' })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Notify driver that rider accepted the drop-off
    if (ride.driver_id) {
      const { data: driverTokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', ride.driver_id)

      const tokens = (driverTokens ?? []).map((t: { token: string }) => t.token)
      if (tokens.length > 0) {
        await sendFcmPush(tokens, {
          title: 'Drop-off confirmed',
          body: 'The rider accepted the drop-off arrangement.',
          data: { type: 'dropoff_confirmed', ride_id: rideId },
        })
      }
    }

    res.status(200).json({ ride_id: rideId, status: 'coordinating' })
  },
)

/**
 * PATCH /api/rides/:id/decline-dropoff — rider declines drop-off.
 * Status → 'requested', notify next drivers.
 */
ridesRouter.patch(
  '/:id/decline-dropoff',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const rideId = req.params['id'] as string

    if (!rideId) {
      res.status(400).json({
        error: { code: 'INVALID_PARAMS', message: 'Ride ID is required' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status, origin')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({
        error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' },
      })
      return
    }

    if (ride.rider_id !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only the rider can decline drop-off' },
      })
      return
    }

    if (ride.status !== 'accepted') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot decline drop-off` },
      })
      return
    }

    // Reset to requested, clear driver
    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'requested', driver_id: null })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Re-notify online drivers (Stage 1 fallback — notify all online)
    const { data: onlineRows } = await supabaseAdmin
      .from('driver_locations')
      .select('user_id')
      .eq('is_online', true)

    const onlineIds = new Set((onlineRows ?? []).map((r: { user_id: string }) => r.user_id))

    const { data: allDrivers } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('is_driver', true)

    const driverIds = (allDrivers ?? [])
      .map((d: { id: string }) => d.id)
      .filter((id: string) => id !== ride.driver_id && id !== ride.rider_id && onlineIds.has(id))

    if (driverIds.length > 0) {
      const { data: tokenRows } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .in('user_id', driverIds)

      const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)
      await sendFcmPush(tokens, {
        title: 'New ride request nearby',
        body: 'A rider needs a lift — open HICH to view.',
        data: { type: 'ride_request', ride_id: rideId },
      })
    }

    res.status(200).json({ ride_id: rideId, status: 'requested' })
  },
)

/**
 * PATCH /api/rides/:id/select-driver — rider selects a driver from multi-driver offers.
 * Sets driver_id, status → 'accepted'. Sends FCM release to all other drivers.
 */
ridesRouter.patch(
  '/:id/select-driver',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const rideId = req.params['id'] as string
    const { driver_id: selectedDriverId } = req.body as { driver_id?: string }

    if (!rideId) {
      res.status(400).json({
        error: { code: 'INVALID_PARAMS', message: 'Ride ID is required' },
      })
      return
    }

    if (!selectedDriverId) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'driver_id is required' },
      })
      return
    }

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

    if (ride.rider_id !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only the rider can select a driver' },
      })
      return
    }

    if (ride.status !== 'requested' && ride.status !== 'accepted' && ride.status !== 'coordinating') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot select driver` },
      })
      return
    }

    // Verify the selected driver's offer is still valid (pending)
    // Guards against race condition: if driver already cancelled (offer released),
    // we should not assign them to the ride.
    const { data: selectedOffer } = await supabaseAdmin
      .from('ride_offers')
      .select('id, status')
      .eq('ride_id', rideId)
      .eq('driver_id', selectedDriverId)
      .single()

    if (!selectedOffer || selectedOffer.status === 'released') {
      console.log(`[rides/select-driver] Rejected: driver ${selectedDriverId} offer is ${selectedOffer?.status ?? 'missing'} for ride ${rideId}`)
      res.status(409).json({
        error: { code: 'OFFER_NOT_AVAILABLE', message: 'This driver is no longer available' },
      })
      return
    }

    // Preserve 'coordinating' if already there (dropoff-done may have fired first)
    const newStatus = ride.status === 'coordinating' ? 'coordinating' : 'accepted'
    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: newStatus, driver_id: selectedDriverId })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Mark selected offer as 'selected', put all others on 'standby'
    await supabaseAdmin
      .from('ride_offers')
      .update({ status: 'selected' })
      .eq('ride_id', rideId)
      .eq('driver_id', selectedDriverId)

    await supabaseAdmin
      .from('ride_offers')
      .update({ status: 'standby' })
      .eq('ride_id', rideId)
      .neq('driver_id', selectedDriverId)
      .in('status', ['pending'])

    // Fetch standby driver IDs for targeted notifications
    const { data: standbyOffers } = await supabaseAdmin
      .from('ride_offers')
      .select('driver_id')
      .eq('ride_id', rideId)
      .eq('status', 'standby')

    const standbyDriverIds = (standbyOffers ?? []).map((o: { driver_id: string }) => o.driver_id)

    // Notify the selected driver
    const { data: selectedTokens } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', selectedDriverId)

    const selTokens = (selectedTokens ?? []).map((t: { token: string }) => t.token)
    if (selTokens.length > 0) {
      await sendFcmPush(selTokens, {
        title: 'You were selected!',
        body: 'The rider chose you — open HICH to start.',
        data: { type: 'driver_selected', ride_id: rideId },
      })
    }

    // Notify standby drivers with a polite message (not ride_cancelled)
    if (standbyDriverIds.length > 0) {
      for (const driverId of standbyDriverIds) {
        void realtimeBroadcast(`driver:${driverId}`, 'ride_standby', {
          type: 'ride_standby', ride_id: rideId,
        })
      }

      // FCM push to standby drivers (fire-and-forget)
      void (async () => {
        try {
          const { data: standbyTokenRows } = await supabaseAdmin
            .from('push_tokens')
            .select('token')
            .in('user_id', standbyDriverIds)
          const standbyTokens = (standbyTokenRows ?? []).map((t: { token: string }) => t.token)
          if (standbyTokens.length > 0) {
            await sendFcmPush(standbyTokens, {
              title: 'Rider coordinating with another driver',
              body: "We'll notify you if they cancel.",
              data: { type: 'ride_standby', ride_id: rideId },
            })
          }
        } catch {
          // non-fatal
        }
      })()
    }

    // Dismiss notifications for drivers who didn't have offers (were just notified)
    // Only broadcast ride_cancelled to non-standby, non-selected drivers
    const { data: allDrivers } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('is_driver', true)
      .neq('id', selectedDriverId)
      .neq('id', userId)

    const nonStandbyDrivers = (allDrivers ?? []).filter(
      (d: { id: string }) => !standbyDriverIds.includes(d.id),
    )
    for (const driver of nonStandbyDrivers) {
      void realtimeBroadcast(`driver:${driver.id}`, 'ride_cancelled', { type: 'ride_cancelled', ride_id: rideId })
    }

    // ── Copy driver destination from offer to ride (synchronous) ──────────────
    // Must happen before response so the rider sees driver_destination when they
    // load MessagingWindow.
    const { data: offerRow } = await supabaseAdmin
      .from('ride_offers')
      .select('driver_destination, driver_destination_name, driver_route_polyline, overlap_pct')
      .eq('ride_id', rideId)
      .eq('driver_id', selectedDriverId)
      .single()

    const driverHasDestination = !!offerRow?.driver_destination

    // Notify the selected driver via Realtime so they can navigate to DropoffSelection
    // without needing to call /accept again (avoids the race with WaitingRoom auto-select).
    const selectionGeo = offerRow?.driver_destination as { coordinates: [number, number] } | null | undefined
    void realtimeBroadcast(`driver:${selectedDriverId}`, 'driver_selected', {
      type: 'driver_selected',
      ride_id: rideId,
      driver_has_destination: driverHasDestination,
      driver_dest_lat: selectionGeo ? selectionGeo.coordinates[1] : null,
      driver_dest_lng: selectionGeo ? selectionGeo.coordinates[0] : null,
      driver_dest_name: offerRow?.driver_destination_name ?? null,
    })

    if (driverHasDestination) {
      await supabaseAdmin
        .from('rides')
        .update({
          driver_destination: offerRow.driver_destination,
          driver_destination_name: offerRow.driver_destination_name ?? null,
          driver_route_polyline: offerRow.driver_route_polyline ?? null,
        })
        .eq('id', rideId)
      console.log(`[rides/select-driver] Copied driver destination from offer for driver=${selectedDriverId}`)
    }

    // Fetch driver name for the response
    const { data: driverUser } = await supabaseAdmin
      .from('users')
      .select('full_name')
      .eq('id', selectedDriverId)
      .single()

    console.log(`[rides/select-driver] rideId=${rideId} selected driver=${selectedDriverId}`)
    res.status(200).json({ ride_id: rideId, status: 'accepted', driver_id: selectedDriverId, driver_has_destination: driverHasDestination, driver_name: driverUser?.full_name ?? null })

    // Clean up stale ride_request notifications for this ride (fire-and-forget)
    void supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('type', 'ride_request')
      .eq('is_read', false)
      .contains('data', { ride_id: rideId })
      .then(({ error: cleanupErr }) => {
        if (cleanupErr) console.warn(`[rides/select-driver] notification cleanup error: ${cleanupErr.message}`)
      })

    // ── Phase 2: Auto-detect driver destination from routines (fire-and-forget) ──
    // Only runs if the driver did NOT provide a destination during accept.
    void (async () => {
      try {
        if (driverHasDestination) return

        const apiKey = process.env['GOOGLE_MAPS_KEY']
        if (!apiKey) return

        // Fetch the ride with origin + destination for transit suggestions
        const { data: fullRide } = await supabaseAdmin
          .from('rides')
          .select('id, origin, destination')
          .eq('id', rideId)
          .single()
        if (!fullRide) return

        const rideOrigin = fullRide.origin as unknown as { type: string; coordinates: number[] } | null
        const rideDest = fullRide.destination as unknown as { type: string; coordinates: number[] } | null
        if (!rideOrigin?.coordinates || !rideDest?.coordinates) return

        // Check if the selected driver has a matching routine
        const now = new Date()
        const currentDay = now.getDay() // 0 = Sun
        const currentMinutes = now.getHours() * 60 + now.getMinutes()

        const { data: routines } = await supabaseAdmin
          .from('driver_routines')
          .select('id, destination, dest_address, route_polyline, departure_time, arrival_time, day_of_week')
          .eq('user_id', selectedDriverId)
          .eq('is_active', true)
          .contains('day_of_week', [currentDay])

        if (!routines || routines.length === 0) return

        // Find a routine whose time is within ±60 minutes of now
        let matchedRoutine: typeof routines[0] | null = null
        for (const routine of routines) {
          const timeStr = routine.departure_time ?? routine.arrival_time
          if (!timeStr) continue
          const [hh, mm] = timeStr.split(':').map(Number)
          const routineMinutes = (hh ?? 0) * 60 + (mm ?? 0)
          if (Math.abs(routineMinutes - currentMinutes) <= 60 || Math.abs(routineMinutes - currentMinutes) >= 1380) {
            matchedRoutine = routine
            break
          }
        }

        if (!matchedRoutine) return

        const routineDest = matchedRoutine.destination as unknown as { type: string; coordinates: number[] } | null
        if (!routineDest?.coordinates) return

        const driverDestLat = routineDest.coordinates[1]
        const driverDestLng = routineDest.coordinates[0]
        const driverLat = rideOrigin.coordinates[1]
        const driverLng = rideOrigin.coordinates[0]
        const riderDestLat = rideDest.coordinates[1]
        const riderDestLng = rideDest.coordinates[0]

        // Compute transit suggestions using existing polyline if available
        const { suggestions, polyline } = await computeTransitDropoffSuggestions(
          driverLat, driverLng,
          driverDestLat, driverDestLng,
          riderDestLat, riderDestLng,
          apiKey,
          matchedRoutine.route_polyline ?? undefined,
        )

        // Save driver destination on ride
        const destGeo: GeoPoint = { type: 'Point', coordinates: [driverDestLng, driverDestLat] }
        await supabaseAdmin
          .from('rides')
          .update({
            driver_destination: destGeo,
            driver_destination_name: matchedRoutine.dest_address ?? null,
            driver_route_polyline: polyline || matchedRoutine.route_polyline || null,
          })
          .eq('id', rideId)

        // Broadcast suggestions to both driver and rider
        if (suggestions.length > 0) {
          void realtimeBroadcast(`ride:${rideId}`, 'transit_suggestions', {
            ride_id: rideId,
            suggestions,
            driver_destination_name: matchedRoutine.dest_address ?? null,
            auto_detected: true,
          })
        }

        console.log(
          `[rides/select-driver] Auto-detected destination for driver=${selectedDriverId}`,
          `routine=${matchedRoutine.id} dest="${matchedRoutine.dest_address}" suggestions=${suggestions.length}`,
        )
      } catch (err) {
        console.error('[rides/select-driver] Auto-detect destination error:', err)
      }
    })()
  },
)

/**
 * GET /api/rides/:id/offers — list pending driver offers for a ride.
 * Returns driver info + vehicle info for the multi-driver selection screen.
 */
ridesRouter.get(
  '/:id/offers',
  validateJwt,
  async (req: Request, res: Response) => {
    const userId = res.locals['userId'] as string
    const rideId = req.params['id'] as string

    if (!rideId) {
      res.status(400).json({
        error: { code: 'INVALID_PARAMS', message: 'Ride ID is required' },
      })
      return
    }

    // Only the rider can view offers
    const { data: ride } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id')
      .eq('id', rideId)
      .single()

    if (!ride) {
      res.status(404).json({
        error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' },
      })
      return
    }

    if (ride.rider_id !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only the rider can view offers' },
      })
      return
    }

    // Fetch pending offers with driver + vehicle info
    const { data: offers, error: offersErr } = await supabaseAdmin
      .from('ride_offers')
      .select('id, driver_id, vehicle_id, status, created_at, driver_destination_name, overlap_pct')
      .eq('ride_id', rideId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (offersErr) {
      res.status(500).json({
        error: { code: 'DB_ERROR', message: 'Failed to fetch offers' },
      })
      return
    }

    // Enrich with driver + vehicle data
    const enriched = await Promise.all(
      (offers ?? []).map(async (offer) => {
        const { data: driver } = await supabaseAdmin
          .from('users')
          .select('id, full_name, avatar_url, rating_avg, rating_count')
          .eq('id', offer.driver_id)
          .single()

        let vehicle = null
        if (offer.vehicle_id) {
          const { data: v } = await supabaseAdmin
            .from('vehicles')
            .select('id, make, model, year, color, plate, seats_available, car_photo_url')
            .eq('id', offer.vehicle_id)
            .single()
          vehicle = v
        }

        // Get driver's latest location
        const { data: loc } = await supabaseAdmin
          .from('driver_locations')
          .select('location, heading, recorded_at')
          .eq('user_id', offer.driver_id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .single()

        return {
          offer_id: offer.id,
          driver_id: offer.driver_id,
          driver: driver ?? null,
          vehicle: vehicle ?? null,
          location: loc?.location ?? null,
          heading: loc?.heading ?? null,
          created_at: offer.created_at,
          driver_destination_name: offer.driver_destination_name ?? null,
          overlap_pct: offer.overlap_pct ?? null,
        }
      }),
    )

    res.status(200).json({ offers: enriched })
  },
)

/**
 * PATCH /api/rides/:id/pickup-point — driver sets the pickup location.
 * Saves pickup_point and optional pickup_note; broadcasts via Realtime to rider.
 */
ridesRouter.patch(
  '/:id/pickup-point',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const driverId = res.locals['userId'] as string
    const rideId = req.params['id'] as string
    const { lat, lng, note } = req.body as { lat?: number; lng?: number; note?: string }

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'lat and lng are required numbers' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, driver_id, rider_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (ride.driver_id !== driverId && ride.rider_id !== driverId) {
      // Also allow drivers who have a pending/selected offer (before select-driver assigns driver_id)
      const { count: offerCount } = await supabaseAdmin
        .from('ride_offers')
        .select('id', { count: 'exact', head: true })
        .eq('ride_id', rideId)
        .eq('driver_id', driverId)
        .in('status', ['pending', 'selected'])

      if ((offerCount ?? 0) === 0) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only ride participants can set pickup point' } })
        return
      }
    }

    if (ride.status !== 'requested' && ride.status !== 'accepted' && ride.status !== 'coordinating') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot set pickup` },
      })
      return
    }

    // PostGIS accepts GeoJSON for geography columns
    const pickupGeo: GeoPoint = { type: 'Point', coordinates: [lng, lat] }

    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({
        pickup_point: pickupGeo,
        pickup_note: (note && typeof note === 'string') ? note.trim().slice(0, 200) : null,
        pickup_confirmed: false, // Reset — new proposal needs acceptance
      })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Insert a pickup_suggestion message so rider sees it in chat
    const { data: suggestionMsg } = await supabaseAdmin
      .from('messages')
      .insert({
        ride_id: rideId,
        sender_id: driverId,
        content: 'Suggested pickup point',
        type: 'pickup_suggestion',
        meta: { lat, lng, note: note ?? null, proposed_by: driverId },
      })
      .select('id, ride_id, sender_id, content, type, meta, created_at')
      .single()

    // Broadcast the suggestion message to the ride chat channel
    if (suggestionMsg) {
      void realtimeBroadcast(`chat:${rideId}`, 'new_message', suggestionMsg as Record<string, unknown>)
      void realtimeBroadcast(`chat-badge:${rideId}`, 'new_message', suggestionMsg as Record<string, unknown>)
    }

    // Determine who to notify — the other party
    const proposerId = driverId
    const otherId = proposerId === ride.rider_id ? ride.driver_id : ride.rider_id
    const proposerRole = proposerId === ride.rider_id ? 'Rider' : 'Driver'

    // Broadcast pickup_set to the other party
    if (otherId) {
      const pickupPayload = { type: 'pickup_set', ride_id: rideId, lat, lng, note: note ?? null, proposed_by: proposerId }
      await realtimeBroadcastMany([`rider:${otherId}`, `rider-pickup:${otherId}`], 'pickup_set', pickupPayload)

      // Send FCM push to the other party
      const { data: otherTokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', otherId)

      const tokens = (otherTokens ?? []).map((t: { token: string }) => t.token)
      if (tokens.length > 0) {
        await sendFcmPush(tokens, {
          title: 'Pickup point suggested!',
          body: `${proposerRole} suggested a pickup point — open HICH to review.`,
          data: { type: 'pickup_set', ride_id: rideId },
        })
      }
    }

    console.log(`[rides/pickup-point] rideId=${rideId} pickup=(${lat},${lng})`)
    res.status(200).json({ ride_id: rideId, pickup_point: { lat, lng } })
  },
)

/**
 * PATCH /api/rides/:id/dropoff-point — driver suggests a different dropoff.
 * Inserts a dropoff_suggestion message so rider can accept or decline in chat.
 */
ridesRouter.patch(
  '/:id/dropoff-point',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const driverId = res.locals['userId'] as string
    const rideId = req.params['id'] as string
    const { lat, lng, name } = req.body as { lat?: number; lng?: number; name?: string }

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'lat and lng are required numbers' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, driver_id, rider_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (ride.driver_id !== driverId && ride.rider_id !== driverId) {
      // Also allow drivers who have a pending/selected offer (before select-driver assigns driver_id)
      const { count: offerCount } = await supabaseAdmin
        .from('ride_offers')
        .select('id', { count: 'exact', head: true })
        .eq('ride_id', rideId)
        .eq('driver_id', driverId)
        .in('status', ['pending', 'selected'])

      if ((offerCount ?? 0) === 0) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only ride participants can change dropoff' } })
        return
      }
    }

    if (ride.status !== 'requested' && ride.status !== 'accepted' && ride.status !== 'coordinating') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot change dropoff` },
      })
      return
    }

    // Update dropoff on ride
    const dropoffGeo: GeoPoint = { type: 'Point', coordinates: [lng, lat] }
    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({
        dropoff_point: dropoffGeo,
        destination: dropoffGeo,
        destination_name: (name && typeof name === 'string') ? name.trim().slice(0, 200) : null,
        dropoff_confirmed: false, // Reset — new proposal needs acceptance
      })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Insert a dropoff_suggestion message
    const { data: suggestionMsg } = await supabaseAdmin
      .from('messages')
      .insert({
        ride_id: rideId,
        sender_id: driverId,
        content: 'Suggested dropoff change',
        type: 'dropoff_suggestion',
        meta: { lat, lng, name: name ?? null, proposed_by: driverId },
      })
      .select('id, ride_id, sender_id, content, type, meta, created_at')
      .single()

    // Broadcast the suggestion to chat
    if (suggestionMsg) {
      void realtimeBroadcast(`chat:${rideId}`, 'new_message', suggestionMsg as Record<string, unknown>)
      void realtimeBroadcast(`chat-badge:${rideId}`, 'new_message', suggestionMsg as Record<string, unknown>)
    }

    // Notify the other party
    const dropProposerId = driverId
    const dropOtherId = dropProposerId === ride.rider_id ? ride.driver_id : ride.rider_id
    const dropProposerRole = dropProposerId === ride.rider_id ? 'Rider' : 'Driver'
    if (dropOtherId) {
      const { data: otherTokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', dropOtherId)
      const tokens = (otherTokens ?? []).map((t: { token: string }) => t.token)
      if (tokens.length > 0) {
        await sendFcmPush(tokens, {
          title: 'Dropoff location suggested!',
          body: `${dropProposerRole} suggested a dropoff point — open HICH to review.`,
          data: { type: 'dropoff_set', ride_id: rideId },
        })
      }
    }

    console.log(`[rides/dropoff-point] rideId=${rideId} dropoff=(${lat},${lng})`)
    res.status(200).json({ ride_id: rideId, dropoff_point: { lat, lng } })
  },
)

/**
 * POST /api/rides/:id/accept-details — rider accepts pickup/dropoff in chat.
 * Status → 'coordinating'. Both parties can now navigate to pickup screens.
 */
ridesRouter.post(
  '/:id/accept-details',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const riderId = res.locals['userId'] as string
    const rideId = req.params['id'] as string

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (ride.rider_id !== riderId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the rider can accept details' } })
      return
    }

    if (ride.status !== 'accepted' && ride.status !== 'coordinating') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot accept details` },
      })
      return
    }

    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'coordinating' })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Insert an acceptance system message
    const { data: acceptMsg } = await supabaseAdmin
      .from('messages')
      .insert({
        ride_id: rideId,
        sender_id: riderId,
        content: 'Rider accepted pickup details',
        type: 'details_accepted',
        meta: null,
      })
      .select('id, ride_id, sender_id, content, type, meta, created_at')
      .single()

    // Broadcast acceptance to chat
    if (acceptMsg) {
      void realtimeBroadcast(`chat:${rideId}`, 'new_message', acceptMsg as Record<string, unknown>)
      void realtimeBroadcast(`chat-badge:${rideId}`, 'new_message', acceptMsg as Record<string, unknown>)
    }

    // Broadcast details_accepted to driver — both rider:{id} and msg-driver:{id}
    if (ride.driver_id) {
      const detailsPayload = { type: 'details_accepted', ride_id: rideId }
      await realtimeBroadcastMany([`rider:${ride.driver_id}`, `msg-driver:${ride.driver_id}`], 'details_accepted', detailsPayload)

      // FCM push to driver
      const { data: driverTokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', ride.driver_id)

      const tokens = (driverTokens ?? []).map((t: { token: string }) => t.token)
      if (tokens.length > 0) {
        await sendFcmPush(tokens, {
          title: 'Ride details accepted!',
          body: 'The rider accepted — head to the pickup point.',
          data: { type: 'details_accepted', ride_id: rideId },
        })
      }
    }

    console.log(`[rides/accept-details] rideId=${rideId} rider accepted details`)
    res.status(200).json({ ride_id: rideId, status: 'coordinating' })
  },
)

/**
 * POST /api/rides/:id/accept-location — accept the latest pickup or dropoff proposal.
 * Either party can accept the other's proposal.
 * Body: { location_type: 'pickup' | 'dropoff' }
 * When both pickup and dropoff are confirmed:
 *   - Search rides (no schedule_id) → status → 'coordinating'
 *   - Schedule rides → status → 'coordinating'
 */
ridesRouter.post(
  '/:id/accept-location',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const rideId = req.params['id'] as string
    const { location_type } = req.body as { location_type?: string }

    if (location_type !== 'pickup' && location_type !== 'dropoff') {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'location_type must be "pickup" or "dropoff"' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status, pickup_confirmed, dropoff_confirmed, schedule_id, pickup_point, dropoff_point, destination, destination_name')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (ride.rider_id !== userId && ride.driver_id !== userId) {
      // Also allow drivers who have a pending/selected offer (before select-driver assigns driver_id)
      const { count: offerCount } = await supabaseAdmin
        .from('ride_offers')
        .select('id', { count: 'exact', head: true })
        .eq('ride_id', rideId)
        .eq('driver_id', userId)
        .in('status', ['pending', 'selected'])

      if ((offerCount ?? 0) === 0) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only ride participants can accept locations' } })
        return
      }
    }

    if (ride.status !== 'requested' && ride.status !== 'accepted' && ride.status !== 'coordinating') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot accept location` },
      })
      return
    }

    // Update the confirmation flag
    const updateFields: Record<string, unknown> = {}
    if (location_type === 'pickup') {
      updateFields.pickup_confirmed = true
    } else {
      updateFields.dropoff_confirmed = true
    }

    // Check if both are now confirmed
    const pickupDone = location_type === 'pickup' ? true : ride.pickup_confirmed
    const dropoffDone = location_type === 'dropoff' ? true : ride.dropoff_confirmed

    if (pickupDone && dropoffDone && ride.status === 'accepted') {
      updateFields.status = 'coordinating'
    }

    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update(updateFields)
      .eq('id', rideId)

    if (updateErr) { next(updateErr); return }

    // Insert a system message with accepted location details for rich UI card
    const isPickup = location_type === 'pickup'
    const accepterRole = userId === ride.rider_id ? 'Rider' : 'Driver'

    // Include the accepted location's coordinates and name so the frontend can render a full info card
    const acceptedPoint = isPickup ? ride.pickup_point : (ride.dropoff_point ?? ride.destination)
    const acceptedCoords = acceptedPoint?.coordinates as [number, number] | undefined
    const acceptedName = isPickup ? undefined : (ride.destination_name ?? undefined)

    const { data: acceptMsg } = await supabaseAdmin
      .from('messages')
      .insert({
        ride_id: rideId,
        sender_id: userId,
        content: `${accepterRole} accepted ${isPickup ? 'pickup' : 'dropoff'} location`,
        type: 'location_accepted',
        meta: {
          location_type,
          accepted_by: userId,
          ...(acceptedCoords ? { lng: acceptedCoords[0], lat: acceptedCoords[1] } : {}),
          ...(acceptedName ? { name: acceptedName } : {}),
        },
      })
      .select('id, ride_id, sender_id, content, type, meta, created_at')
      .single()

    // Broadcast acceptance to chat
    if (acceptMsg) {
      void realtimeBroadcast(`chat:${rideId}`, 'new_message', acceptMsg as Record<string, unknown>)
      void realtimeBroadcast(`chat-badge:${rideId}`, 'new_message', acceptMsg as Record<string, unknown>)
    }

    // If both locations are now confirmed, broadcast to both parties
    if (pickupDone && dropoffDone) {
      const otherId = userId === ride.rider_id ? ride.driver_id : ride.rider_id
      const confirmPayload = { type: 'locations_confirmed', ride_id: rideId, is_scheduled: !!ride.schedule_id }

      // Broadcast to both parties' channels
      const confirmChannels: string[] = []
      for (const targetId of [userId, otherId]) {
        if (!targetId) continue
        confirmChannels.push(`rider:${targetId}`, `msg-driver:${targetId}`)
      }
      await realtimeBroadcastMany(confirmChannels, 'locations_confirmed', confirmPayload)

      // Also broadcast to chat channel
      void realtimeBroadcast(`chat-confirm:${rideId}`, 'locations_confirmed', confirmPayload)

      // FCM push to the other party
      if (otherId) {
        const { data: otherTokens } = await supabaseAdmin
          .from('push_tokens')
          .select('token')
          .eq('user_id', otherId)
        const tokens = (otherTokens ?? []).map((t: { token: string }) => t.token)
        if (tokens.length > 0) {
          await sendFcmPush(tokens, {
            title: 'Ride locations confirmed!',
            body: ride.schedule_id
              ? 'Both pickup and dropoff are set — your ride is confirmed!'
              : 'Both pickup and dropoff are set — navigate to pickup!',
            data: { type: 'locations_confirmed', ride_id: rideId },
          })
        }
      }
    } else {
      // Notify the other party that their proposal was accepted
      const otherId = userId === ride.rider_id ? ride.driver_id : ride.rider_id
      if (otherId) {
        const { data: otherTokens } = await supabaseAdmin
          .from('push_tokens')
          .select('token')
          .eq('user_id', otherId)
        const tokens = (otherTokens ?? []).map((t: { token: string }) => t.token)
        if (tokens.length > 0) {
          await sendFcmPush(tokens, {
            title: `${isPickup ? 'Pickup' : 'Dropoff'} accepted!`,
            body: `${accepterRole} accepted the ${isPickup ? 'pickup' : 'dropoff'} location.`,
            data: { type: 'location_accepted', ride_id: rideId, location_type },
          })
        }
      }
    }

    console.log(`[rides/accept-location] rideId=${rideId} ${location_type} accepted by ${userId}`)
    res.status(200).json({
      ride_id: rideId,
      location_type,
      pickup_confirmed: pickupDone,
      dropoff_confirmed: dropoffDone,
      both_confirmed: pickupDone && dropoffDone,
    })
  },
)

/**
 * POST /api/rides/:id/signal — rider signals the driver that they're close.
 */
ridesRouter.post(
  '/:id/signal',
  validateJwt,
  async (req: Request, res: Response, _next: NextFunction) => {
    const riderId = res.locals['userId'] as string
    const rideId = req.params['id'] as string

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (ride.rider_id !== riderId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the rider can signal' } })
      return
    }

    if (!['coordinating', 'accepted', 'en_route'].includes(ride.status)) {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot signal` },
      })
      return
    }

    // Persist signal as a chat message so driver page can detect it on load
    await supabaseAdmin.from('messages').insert({
      ride_id: rideId,
      sender_id: riderId,
      type: 'rider_signal',
      content: 'Rider is at the pickup point!',
      meta: { type: 'rider_signal' },
    })

    // Broadcast to driver via Realtime
    if (ride.driver_id) {
      await realtimeBroadcastMany(
        [`rider:${ride.driver_id}`, `rider-signal:${ride.driver_id}`],
        'rider_signal',
        { type: 'rider_signal', ride_id: rideId },
      )

      // Send FCM push to driver
      const { data: driverTokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', ride.driver_id)

      const tokens = (driverTokens ?? []).map((t: { token: string }) => t.token)
      if (tokens.length > 0) {
        await sendFcmPush(tokens, {
          title: 'Rider is nearby!',
          body: 'Your rider signalled that they\'re close to the pickup point.',
          data: { type: 'rider_signal', ride_id: rideId },
        })
      }
    }

    console.log(`[rides/signal] rideId=${rideId} rider signalled`)
    res.status(200).json({ ride_id: rideId, signalled: true })
  },
)

/**
 * GET /api/rides/:id/qr — generate a fresh HMAC-signed QR token for a ride.
 * Only the driver of the ride can request this.
 * Returns { token } — the frontend renders the QR from the token string.
 */
ridesRouter.get(
  '/:id/qr',
  validateJwt,
  async (req: Request, res: Response) => {
    const driverId = res.locals['userId'] as string
    const rideId = req.params['id'] as string

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, driver_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (ride.driver_id !== driverId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the driver can get the QR token' } })
      return
    }

    if (ride.status !== 'coordinating' && ride.status !== 'active') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', QR not available yet` },
      })
      return
    }

    const token = generateQrToken(driverId, rideId)
    res.status(200).json({ token })
  },
)

/**
 * POST /api/rides/:id/start — rider scans driver QR to start ride.
 * Validates HMAC token, sets status='active', started_at=NOW().
 */
ridesRouter.post(
  '/:id/start',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const riderId = res.locals['userId'] as string
    const rideId = req.params['id'] as string
    const { token, lat, lng } = req.body as { token?: string; lat?: number; lng?: number }

    if (!token || typeof token !== 'string') {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'token is required' },
      })
      return
    }

    // Validate the HMAC-signed QR token
    const parsed = validateQrToken(token)
    if (!parsed) {
      res.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'QR token is invalid or expired' },
      })
      return
    }

    // Token must match this ride
    if (parsed.rideId !== rideId) {
      res.status(400).json({
        error: { code: 'TOKEN_MISMATCH', message: 'QR token does not match this ride' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (ride.rider_id !== riderId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the rider can start the ride' } })
      return
    }

    if (ride.driver_id !== parsed.driverId) {
      res.status(400).json({
        error: { code: 'DRIVER_MISMATCH', message: 'QR token driver does not match ride driver' },
      })
      return
    }

    if (ride.status !== 'coordinating') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot start` },
      })
      return
    }

    // Save rider's actual GPS as pickup_point (where ride truly starts)
    const startUpdate: Record<string, unknown> = {
      status: 'active',
      started_at: new Date().toISOString(),
    }
    if (typeof lat === 'number' && typeof lng === 'number') {
      startUpdate.pickup_point = { type: 'Point', coordinates: [lng, lat] }
    }

    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update(startUpdate)
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Release standby offers now that the ride has started
    const { data: standbyOffers } = await supabaseAdmin
      .from('ride_offers')
      .select('driver_id')
      .eq('ride_id', rideId)
      .eq('status', 'standby')

    const standbyDriverIds = (standbyOffers ?? []).map((o: { driver_id: string }) => o.driver_id)

    await supabaseAdmin
      .from('ride_offers')
      .update({ status: 'released' })
      .eq('ride_id', rideId)
      .eq('status', 'standby')

    // Notify standby drivers that the ride has started (dismiss their notifications)
    for (const driverId of standbyDriverIds) {
      void realtimeBroadcast(`driver:${driverId}`, 'ride_cancelled', { type: 'ride_cancelled', ride_id: rideId })
    }

    // Broadcast ride_started to both parties + component-specific channels
    const startedChannels = [
      ...[ride.rider_id, ride.driver_id].filter(Boolean).map((uid) => `rider:${uid}`),
      ...(ride.rider_id ? [`rider-pickup:${ride.rider_id}`, `rider-active:${ride.rider_id}`] : []),
      ...(ride.driver_id ? [`driver-pickup:${ride.driver_id}`, `driver:${ride.driver_id}`] : []),
    ]
    await realtimeBroadcastMany(startedChannels, 'ride_started', { type: 'ride_started', ride_id: rideId })

    // FCM push to driver
    if (ride.driver_id) {
      const { data: driverTokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', ride.driver_id)

      const tokens = (driverTokens ?? []).map((t: { token: string }) => t.token)
      if (tokens.length > 0) {
        await sendFcmPush(tokens, {
          title: 'Ride started!',
          body: 'Your rider scanned the QR — drive safely!',
          data: { type: 'ride_started', ride_id: rideId },
        })
      }
    }

    console.log(`[rides/start] rideId=${rideId} ride started`)
    res.status(200).json({ ride_id: rideId, status: 'active' })
  },
)

/**
 * POST /api/rides/:id/end — rider scans driver QR to end ride.
 * Validates HMAC token, calculates final fare, sets status='completed'.
 */
ridesRouter.post(
  '/:id/end',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const riderId = res.locals['userId'] as string
    const rideId = req.params['id'] as string
    const { token, lat, lng } = req.body as { token?: string; lat?: number; lng?: number }

    if (!token || typeof token !== 'string') {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'token is required' },
      })
      return
    }

    const parsed = validateQrToken(token)
    if (!parsed) {
      res.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'QR token is invalid or expired' },
      })
      return
    }

    if (parsed.rideId !== rideId) {
      res.status(400).json({
        error: { code: 'TOKEN_MISMATCH', message: 'QR token does not match this ride' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (ride.rider_id !== riderId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the rider can end the ride' } })
      return
    }

    if (ride.driver_id !== parsed.driverId) {
      res.status(400).json({
        error: { code: 'DRIVER_MISMATCH', message: 'QR token driver does not match ride driver' },
      })
      return
    }

    if (ride.status !== 'active') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot end` },
      })
      return
    }

    // Minimum ride duration: 60 seconds
    if (ride.started_at) {
      const elapsedSec = (Date.now() - new Date(ride.started_at as string).getTime()) / 1000
      if (elapsedSec < 60) {
        res.status(400).json({
          error: { code: 'TOO_SHORT', message: 'Ride must be active for at least 60 seconds before ending' },
        })
        return
      }
    }

    // Calculate fare from actual GPS distance and duration
    // Build dropoff point from rider's current GPS if provided
    let dropoffGeo: GeoPoint | null =
      typeof lat === 'number' && typeof lng === 'number'
        ? { type: 'Point', coordinates: [lng, lat] }
        : null

    // Fallback: use driver's last known GPS from driver_locations table
    if (!dropoffGeo && ride.driver_id) {
      const { data: driverLoc } = await supabaseAdmin
        .from('driver_locations')
        .select('location')
        .eq('user_id', ride.driver_id)
        .single()
      if (driverLoc?.location) {
        dropoffGeo = driverLoc.location as unknown as GeoPoint
      }
    }

    const rideForFare = {
      pickup_point: (ride.pickup_point ?? null) as GeoPoint | null,
      dropoff_point: dropoffGeo,
      started_at: ride.started_at as string | null,
    }

    const endedAt = new Date().toISOString()
    const { fare_cents: fareCents, platform_fee_cents: platformFeeCents, driver_earns_cents: driverEarnsCents, distance_miles, duration_min } =
      computeRideFare(rideForFare, endedAt)

    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({
        status: 'completed',
        ended_at: endedAt,
        fare_cents: fareCents,
        ...(dropoffGeo ? { dropoff_point: dropoffGeo } : {}),
      })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Charge rider's card and route to driver via Stripe Connect
    let paymentStatus = 'pending'
    let paymentIntentId: string | undefined
    let stripeFeeCents = 0

    if (ride.driver_id) {
      // Look up rider + driver Stripe info
      const [riderRes, driverRes] = await Promise.all([
        supabaseAdmin.from('users').select('stripe_customer_id, default_payment_method_id').eq('id', ride.rider_id).single(),
        supabaseAdmin.from('users').select('stripe_account_id, stripe_onboarding_complete').eq('id', ride.driver_id).single(),
      ])

      const rider = riderRes.data
      const driver = driverRes.data

      if (
        rider?.stripe_customer_id &&
        rider?.default_payment_method_id &&
        driver?.stripe_account_id &&
        driver?.stripe_onboarding_complete
      ) {
        const chargeResult = await chargeRideFare({
          rideId,
          fareCents,
          riderCustomerId: rider.stripe_customer_id as string,
          riderPaymentMethodId: rider.default_payment_method_id as string,
          driverAccountId: driver.stripe_account_id as string,
        })

        if (chargeResult.success) {
          paymentStatus = 'processing'
          paymentIntentId = chargeResult.paymentIntentId
          stripeFeeCents = chargeResult.stripFeeCents ?? 0
        } else {
          paymentStatus = 'failed'
          console.warn(`[rides/end] Stripe charge failed: ${chargeResult.error}`)
        }
      } else {
        // Missing payment setup — log but don't block ride end
        paymentStatus = 'failed'
        console.warn(`[rides/end] Missing Stripe setup: rider_customer=${!!rider?.stripe_customer_id} rider_pm=${!!rider?.default_payment_method_id} driver_acct=${!!driver?.stripe_account_id} driver_verified=${!!driver?.stripe_onboarding_complete}`)
      }

      // Update ride with payment info
      await supabaseAdmin
        .from('rides')
        .update({
          payment_status: paymentStatus,
          ...(paymentIntentId ? { payment_intent_id: paymentIntentId } : {}),
          stripe_fee_cents: stripeFeeCents,
        })
        .eq('id', rideId)
    }

    // Broadcast ride_ended to both parties + component-specific channels
    const endedChannels = [
      ...[ride.rider_id, ride.driver_id].filter(Boolean).map((uid) => `rider:${uid}`),
      ...(ride.rider_id ? [`rider-active:${ride.rider_id}`] : []),
    ]
    await realtimeBroadcastMany(endedChannels, 'ride_ended', {
      type: 'ride_ended',
      ride_id: rideId,
      fare_cents: fareCents,
      driver_earns_cents: driverEarnsCents,
    })

    // FCM push to driver
    if (ride.driver_id) {
      const { data: driverTokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', ride.driver_id)

      const tokens = (driverTokens ?? []).map((t: { token: string }) => t.token)
      if (tokens.length > 0) {
        await sendFcmPush(tokens, {
          title: 'Ride completed!',
          body: `You earned $${(driverEarnsCents / 100).toFixed(2)} — great driving!`,
          data: { type: 'ride_ended', ride_id: rideId },
        })
      }
    }

    console.log(`[rides/end] rideId=${rideId} fare=${fareCents} stripeFee=${stripeFeeCents} dist=${distance_miles.toFixed(1)}mi dur=${duration_min}min payment=${paymentStatus}`)
    res.status(200).json({
      ride_id: rideId,
      status: 'completed',
      fare_cents: fareCents,
      platform_fee_cents: platformFeeCents,
      driver_earns_cents: driverEarnsCents,
      stripe_fee_cents: stripeFeeCents,
      payment_status: paymentStatus,
    })
  },
)

/**
 * POST /api/rides/scan-driver — rider scans driver QR (or enters code) to start/end ride.
 *
 * The driver_code is the first 8 characters of the driver's user UUID.
 * The QR encodes the full driver UUID prefixed with "hich:".
 *
 * Flow:
 *  1. Resolve the driver from driver_code (full UUID or first 8 chars)
 *  2. Find a ride between this rider and driver in status 'coordinating' or 'active'
 *  3. If coordinating → start ride (set active + started_at)
 *  4. If active → end ride (set completed + ended_at + fare)
 */
// Tight rate limit for scan-driver to prevent brute-forcing 8-char driver codes
const scanDriverLimiter = rateLimit({
  windowMs: 30 * 1000,  // 30 seconds
  max: 5,                // 5 attempts per 30s per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many scan attempts, please wait' } },
})

ridesRouter.post(
  '/scan-driver',
  scanDriverLimiter,
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const riderId = res.locals['userId'] as string
    const { driver_code, lat, lng } = req.body as { driver_code?: string; lat?: number; lng?: number }

    if (!driver_code || typeof driver_code !== 'string') {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'driver_code is required' },
      })
      return
    }

    // Strip "hich:" prefix if present (from QR scan)
    const code = driver_code.startsWith('hich:') ? driver_code.slice(5) : driver_code

    // Resolve driver — try full UUID first, then prefix range match
    let driverId: string | null = null
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    if (uuidRegex.test(code)) {
      // Full UUID — exact match
      const { data } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', code)
        .single()
      if (data) driverId = data.id
    } else if (/^[0-9a-f]{8}$/i.test(code)) {
      // Short code — first 8 chars of UUID.
      // Use UUID range query: gte(prefix-0000...) and lt(prefix+1-0000...)
      // This works natively with PostgreSQL UUID comparison (lexicographic).
      const lower = code.toLowerCase()
      const prefixNum = parseInt(lower, 16)
      const nextPrefix = (prefixNum + 1).toString(16).padStart(8, '0')
      const minId = `${lower}-0000-0000-0000-000000000000`
      const maxId = `${nextPrefix}-0000-0000-0000-000000000000`

      const { data } = await supabaseAdmin
        .from('users')
        .select('id')
        .gte('id', minId)
        .lt('id', maxId)
        .limit(1)
        .single()
      if (data) driverId = data.id
    }

    if (!driverId) {
      res.status(404).json({
        error: { code: 'DRIVER_NOT_FOUND', message: 'No driver found with that code' },
      })
      return
    }

    if (driverId === riderId) {
      res.status(400).json({
        error: { code: 'SELF_SCAN', message: 'You cannot scan your own code' },
      })
      return
    }

    // Find a ride between this rider and driver
    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('*')
      .eq('rider_id', riderId)
      .eq('driver_id', driverId)
      .in('status', ['coordinating', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({
        error: { code: 'NO_RIDE', message: 'No active ride found between you and this driver' },
      })
      return
    }

    // ── Coordinating → start ride ──────────────────────────────────────────
    if (ride.status === 'coordinating') {
      // Save rider's actual GPS as pickup_point (where ride truly starts)
      const scanStartUpdate: Record<string, unknown> = {
        status: 'active',
        started_at: new Date().toISOString(),
      }
      if (typeof lat === 'number' && typeof lng === 'number') {
        scanStartUpdate.pickup_point = { type: 'Point', coordinates: [lng, lat] }
      }

      const { error: updateErr } = await supabaseAdmin
        .from('rides')
        .update(scanStartUpdate)
        .eq('id', ride.id)

      if (updateErr) { next(updateErr); return }

      // Release standby offers now that the ride has started
      const { data: scanStandbyOffers } = await supabaseAdmin
        .from('ride_offers')
        .select('driver_id')
        .eq('ride_id', ride.id)
        .eq('status', 'standby')

      const scanStandbyIds = (scanStandbyOffers ?? []).map((o: { driver_id: string }) => o.driver_id)

      await supabaseAdmin
        .from('ride_offers')
        .update({ status: 'released' })
        .eq('ride_id', ride.id)
        .eq('status', 'standby')

      for (const sid of scanStandbyIds) {
        void realtimeBroadcast(`driver:${sid}`, 'ride_cancelled', { type: 'ride_cancelled', ride_id: ride.id })
      }

      // Broadcast ride_started to both parties + component-specific channels
      const scanStartChannels = [
        ...[ride.rider_id, ride.driver_id].filter(Boolean).map((uid) => `rider:${uid}`),
        ...(ride.rider_id ? [`rider-pickup:${ride.rider_id}`, `rider-active:${ride.rider_id}`] : []),
        ...(ride.driver_id ? [`driver-pickup:${ride.driver_id}`, `driver:${ride.driver_id}`] : []),
      ]
      await realtimeBroadcastMany(scanStartChannels, 'ride_started', { type: 'ride_started', ride_id: ride.id })

      // FCM push to driver
      const { data: driverTokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', driverId)
      const tokens = (driverTokens ?? []).map((t: { token: string }) => t.token)
      if (tokens.length > 0) {
        await sendFcmPush(tokens, {
          title: 'Ride started!',
          body: 'Your rider scanned your code — drive safely!',
          data: { type: 'ride_started', ride_id: ride.id },
        })
      }

      console.log(`[rides/scan-driver] rideId=${ride.id} started via driver code`)
      res.status(200).json({ ride_id: ride.id, action: 'started', status: 'active' })
      return
    }

    // ── Active → end ride ──────────────────────────────────────────────────
    // Minimum ride duration: 60 seconds
    if (ride.started_at) {
      const elapsedSec = (Date.now() - new Date(ride.started_at as string).getTime()) / 1000
      if (elapsedSec < 60) {
        res.status(400).json({
          error: { code: 'TOO_SHORT', message: 'Ride must be active for at least 60 seconds before ending' },
        })
        return
      }
    }

    // Build dropoff point from rider's current GPS if provided
    let scanDropoffGeo: GeoPoint | null =
      typeof lat === 'number' && typeof lng === 'number'
        ? { type: 'Point', coordinates: [lng, lat] }
        : null

    // Fallback: use driver's last known GPS from driver_locations table
    if (!scanDropoffGeo && ride.driver_id) {
      const { data: driverLoc } = await supabaseAdmin
        .from('driver_locations')
        .select('location')
        .eq('user_id', ride.driver_id)
        .single()
      if (driverLoc?.location) {
        scanDropoffGeo = driverLoc.location as unknown as GeoPoint
      }
    }

    const rideForFare = {
      pickup_point: (ride.pickup_point ?? null) as GeoPoint | null,
      dropoff_point: scanDropoffGeo,
      started_at: ride.started_at as string | null,
    }

    const endedAt = new Date().toISOString()
    const { fare_cents: fareCents, platform_fee_cents: platformFeeCents, driver_earns_cents: driverEarnsCents, distance_miles, duration_min } =
      computeRideFare(rideForFare, endedAt)

    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({
        status: 'completed',
        ended_at: endedAt,
        fare_cents: fareCents,
        ...(scanDropoffGeo ? { dropoff_point: scanDropoffGeo } : {}),
      })
      .eq('id', ride.id)

    if (updateErr) { next(updateErr); return }

    // Broadcast ride_ended immediately so both rider & driver transition fast
    const scanEndChannels = [
      ...[ride.rider_id, ride.driver_id].filter(Boolean).map((uid) => `rider:${uid}`),
      ...(ride.rider_id ? [`rider-active:${ride.rider_id}`] : []),
    ]
    await realtimeBroadcastMany(scanEndChannels, 'ride_ended', {
      type: 'ride_ended',
      ride_id: ride.id,
      fare_cents: fareCents,
      driver_earns_cents: driverEarnsCents,
    })

    // Charge rider's card and route to driver via Stripe Connect
    let scanPaymentStatus = 'pending'
    let scanPaymentIntentId: string | undefined
    let scanStripeFeeCents = 0

    if (ride.driver_id) {
      const [riderRes, driverRes] = await Promise.all([
        supabaseAdmin.from('users').select('stripe_customer_id, default_payment_method_id').eq('id', ride.rider_id).single(),
        supabaseAdmin.from('users').select('stripe_account_id, stripe_onboarding_complete').eq('id', ride.driver_id).single(),
      ])

      const scanRider = riderRes.data
      const scanDriver = driverRes.data

      if (
        scanRider?.stripe_customer_id &&
        scanRider?.default_payment_method_id &&
        scanDriver?.stripe_account_id &&
        scanDriver?.stripe_onboarding_complete
      ) {
        const chargeResult = await chargeRideFare({
          rideId: ride.id,
          fareCents,
          riderCustomerId: scanRider.stripe_customer_id as string,
          riderPaymentMethodId: scanRider.default_payment_method_id as string,
          driverAccountId: scanDriver.stripe_account_id as string,
        })

        if (chargeResult.success) {
          scanPaymentStatus = 'processing'
          scanPaymentIntentId = chargeResult.paymentIntentId
          scanStripeFeeCents = chargeResult.stripFeeCents ?? 0
        } else {
          scanPaymentStatus = 'failed'
          console.warn(`[rides/scan-driver] Stripe charge failed: ${chargeResult.error}`)
        }
      } else {
        scanPaymentStatus = 'failed'
        console.warn(`[rides/scan-driver] Missing Stripe setup for ride ${ride.id}`)
      }

      await supabaseAdmin
        .from('rides')
        .update({
          payment_status: scanPaymentStatus,
          ...(scanPaymentIntentId ? { payment_intent_id: scanPaymentIntentId } : {}),
          stripe_fee_cents: scanStripeFeeCents,
        })
        .eq('id', ride.id)
    }

    // FCM push to driver
    const { data: driverTokens2 } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', driverId)
    const tokens2 = (driverTokens2 ?? []).map((t: { token: string }) => t.token)
    if (tokens2.length > 0) {
      await sendFcmPush(tokens2, {
        title: 'Ride completed!',
        body: `You earned $${(driverEarnsCents / 100).toFixed(2)} — great driving!`,
        data: { type: 'ride_ended', ride_id: ride.id },
      })
    }

    console.log(`[rides/scan-driver] rideId=${ride.id} ended via driver code, fare=${fareCents} stripeFee=${scanStripeFeeCents} dist=${distance_miles.toFixed(1)}mi dur=${duration_min}min payment=${scanPaymentStatus}`)
    res.status(200).json({
      ride_id: ride.id,
      action: 'ended',
      status: 'completed',
      fare_cents: fareCents,
      platform_fee_cents: platformFeeCents,
      driver_earns_cents: driverEarnsCents,
      stripe_fee_cents: scanStripeFeeCents,
      payment_status: scanPaymentStatus,
    })
  },
)

/**
 * POST /api/rides/:id/rate — submit a rating for a completed ride.
 *
 * Body: { stars: 1-5, tags?: string[], comment?: string }
 *
 * Blind ratings — inserts the rating but does not reveal the other party's
 * rating until both have submitted. Returns { revealed: boolean } plus
 * the other rating if both exist.
 */
ridesRouter.post(
  '/:id/rate',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const rideId = req.params['id'] as string
    const { stars, tags, comment } = req.body as {
      stars?: unknown
      tags?: unknown
      comment?: unknown
    }

    // Validate stars
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'stars must be an integer 1-5' },
      })
      return
    }

    // Validate tags
    const tagArray: string[] = Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === 'string')
      : []

    // Validate comment
    const commentStr = typeof comment === 'string' && comment.trim().length > 0
      ? comment.trim()
      : null

    // Fetch ride
    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (ride.status !== 'completed') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: 'Can only rate completed rides' },
      })
      return
    }

    // Must be a participant
    if (ride.rider_id !== userId && ride.driver_id !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You are not a participant in this ride' },
      })
      return
    }

    const ratedId = ride.rider_id === userId ? ride.driver_id : ride.rider_id
    if (!ratedId) {
      res.status(400).json({
        error: { code: 'NO_COUNTERPART', message: 'Ride has no counterpart to rate' },
      })
      return
    }

    // Check for duplicate
    const { data: existing } = await supabaseAdmin
      .from('ride_ratings')
      .select('id')
      .eq('ride_id', rideId)
      .eq('rater_id', userId)
      .maybeSingle()

    if (existing) {
      res.status(409).json({
        error: { code: 'ALREADY_RATED', message: 'You have already rated this ride' },
      })
      return
    }

    // Insert rating
    const { error: insertErr } = await supabaseAdmin
      .from('ride_ratings')
      .insert({
        ride_id: rideId,
        rater_id: userId,
        rated_id: ratedId,
        stars,
        tags: tagArray,
        comment: commentStr,
      })

    if (insertErr) { next(insertErr); return }

    // Update rated user's rating_avg + rating_count
    const { data: allRatings } = await supabaseAdmin
      .from('ride_ratings')
      .select('stars')
      .eq('rated_id', ratedId)

    if (allRatings && allRatings.length > 0) {
      const count = allRatings.length
      const avg = allRatings.reduce((sum, r) => sum + r.stars, 0) / count
      await supabaseAdmin
        .from('users')
        .update({ rating_avg: Math.round(avg * 10) / 10, rating_count: count })
        .eq('id', ratedId)
    }

    // Check if the other party also rated → blind reveal
    const { data: otherRating } = await supabaseAdmin
      .from('ride_ratings')
      .select('*')
      .eq('ride_id', rideId)
      .eq('rater_id', ratedId)
      .maybeSingle()

    const revealed = otherRating !== null && otherRating !== undefined

    console.log(`[rides/rate] rideId=${rideId} rater=${userId} stars=${stars} revealed=${revealed}`)
    res.status(201).json({
      ride_id: rideId,
      stars,
      tags: tagArray,
      revealed,
      other_rating: revealed ? { stars: otherRating.stars, tags: otherRating.tags } : null,
    })
  },
)

// ── GET /api/rides/active ──────────────────────────────────────────────────────
/**
 * Returns the user's rides with status in (accepted, coordinating, active).
 * Includes the other party's user info for display.
 */
ridesRouter.get(
  '/active',
  validateJwt,
  async (_req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string

    const { data: rides, error } = await supabaseAdmin
      .from('rides')
      .select('*')
      .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
      .in('status', ['requested', 'accepted', 'coordinating', 'active'])
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      next(error)
      return
    }

    if (!rides || rides.length === 0) {
      res.status(200).json({ rides: [] })
      return
    }

    // Collect other-party user IDs
    const otherUserIds = rides.map((r: Record<string, unknown>) => {
      return r['rider_id'] === userId ? r['driver_id'] as string : r['rider_id'] as string
    }).filter(Boolean)

    const uniqueIds = [...new Set(otherUserIds)]

    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, full_name, avatar_url, rating_avg')
      .in('id', uniqueIds)

    const userMap = new Map(
      (users ?? []).map((u: Record<string, unknown>) => [u['id'] as string, u]),
    )

    // Also fetch schedule info for rides that have schedule_id
    const scheduleIds = rides
      .map((r: Record<string, unknown>) => r['schedule_id'] as string | null)
      .filter(Boolean) as string[]

    let scheduleMap = new Map<string, Record<string, unknown>>()
    if (scheduleIds.length > 0) {
      const { data: schedules } = await supabaseAdmin
        .from('ride_schedules')
        .select('id, origin_address, dest_address, trip_date, trip_time, time_type')
        .in('id', [...new Set(scheduleIds)])

      scheduleMap = new Map(
        (schedules ?? []).map((s: Record<string, unknown>) => [s['id'] as string, s]),
      )
    }

    const enriched = rides.map((r: Record<string, unknown>) => {
      const otherId = r['rider_id'] === userId ? r['driver_id'] as string : r['rider_id'] as string
      const role = r['rider_id'] === userId ? 'rider' : 'driver'
      return {
        ...r,
        my_role: role,
        other_user: userMap.get(otherId) ?? null,
        schedule: r['schedule_id'] ? scheduleMap.get(r['schedule_id'] as string) ?? null : null,
      }
    })

    res.status(200).json({ rides: enriched })
  },
)

// ── PATCH /api/rides/:id/driver-destination ───────────────────────────────────
/**
 * Driver sets where they're headed. System computes transit dropoff suggestions
 * along the driver's route and returns them.
 */
ridesRouter.patch(
  '/:id/driver-destination',
  validateJwt,
  async (req: Request, res: Response, _next: NextFunction) => {
    const driverId = res.locals['userId'] as string
    const rideId = req.params['id'] as string
    console.log(`[rides/driver-destination:DEBUG] ENTRY rideId=${rideId} driverId=${driverId}`)
    const { destination_lat, destination_lng, destination_name } = req.body as {
      destination_lat?: number
      destination_lng?: number
      destination_name?: string
    }

    if (typeof destination_lat !== 'number' || typeof destination_lng !== 'number') {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'destination_lat and destination_lng are required numbers' },
      })
      return
    }

    // Verify ride exists and driver is assigned
    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, driver_id, rider_id, status, origin, destination')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    // Check driver is a participant (via driver_id or ride_offers)
    if (ride.driver_id !== driverId) {
      const { count: offerCount } = await supabaseAdmin
        .from('ride_offers')
        .select('id', { count: 'exact', head: true })
        .eq('ride_id', rideId)
        .eq('driver_id', driverId)
        .in('status', ['pending', 'selected'])

      if ((offerCount ?? 0) === 0) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the assigned driver can set destination' } })
        return
      }
    }

    if (ride.status !== 'accepted' && ride.status !== 'coordinating' && ride.status !== 'requested') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot set driver destination` },
      })
      return
    }

    const apiKey = process.env['GOOGLE_MAPS_KEY']
    if (!apiKey) {
      res.status(500).json({
        error: { code: 'CONFIG_ERROR', message: 'Google Maps API key not configured' },
      })
      return
    }

    // Get driver's current position from origin
    const driverOrigin = ride.origin as unknown as GeoPoint | null
    if (!driverOrigin?.coordinates) {
      res.status(409).json({
        error: { code: 'NO_ORIGIN', message: 'Ride origin is not set or has invalid format' },
      })
      return
    }
    const driverLat = driverOrigin.coordinates[1]
    const driverLng = driverOrigin.coordinates[0]

    // Get rider's destination (may be null for bearing-only rides)
    const riderDest = ride.destination as unknown as GeoPoint | null
    const riderDestLat = riderDest?.coordinates?.[1] ?? null
    const riderDestLng = riderDest?.coordinates?.[0] ?? null

    try {
      // Save driver destination on ride
      const destGeo: GeoPoint = { type: 'Point', coordinates: [destination_lng, destination_lat] }

      let suggestions: TransitDropoffSuggestion[] = []
      let polyline: string | null = null

      // Only compute transit suggestions if rider has a destination set
      if (riderDestLat != null && riderDestLng != null) {
        const result = await computeTransitDropoffSuggestions(
          driverLat, driverLng,
          destination_lat, destination_lng,
          riderDestLat, riderDestLng,
          apiKey,
        )
        suggestions = result.suggestions
        polyline = result.polyline
      }

      const { error: updateErr } = await supabaseAdmin
        .from('rides')
        .update({
          driver_destination: destGeo,
          driver_destination_name: destination_name?.trim().slice(0, 200) ?? null,
          driver_route_polyline: polyline || null,
        })
        .eq('id', rideId)

      if (updateErr) {
        console.error('[rides/driver-destination] DB update error:', updateErr)
        res.status(500).json({
          error: { code: 'DB_UPDATE_ERROR', message: `Failed to save driver destination: ${updateErr.message}` },
        })
        return
      }

      // Broadcast transit suggestions to rider via Realtime
      void realtimeBroadcast(`ride:${rideId}`, 'transit_suggestions', {
        ride_id: rideId,
        suggestions,
        driver_destination_name: destination_name ?? null,
      })

      console.log(`[rides/driver-destination] rideId=${rideId} dest=(${destination_lat},${destination_lng}) suggestions=${suggestions.length}`)
      res.status(200).json({ suggestions, polyline })
    } catch (err) {
      console.error('[rides/driver-destination] Error computing suggestions:', err)
      const errMessage = err instanceof Error ? err.message : 'Unknown error'
      res.status(500).json({
        error: { code: 'SUGGESTION_ERROR', message: `Failed to compute transit suggestions: ${errMessage}` },
      })
    }
  },
)

// ── POST /api/rides/:id/preview-overlap ──────────────────────────────────────
/**
 * Read-only endpoint: computes route overlap between driver's destination and
 * rider's destination. Used on the RideSuggestion page BEFORE the driver accepts
 * so they can see overlap %, transit stations, and estimated earnings.
 */
ridesRouter.post(
  '/:id/preview-overlap',
  validateJwt,
  async (req: Request, res: Response) => {
    const rideId = req.params['id'] as string
    const body = req.body as Record<string, unknown>

    const driverDestLat = Number(body['driver_destination_lat'])
    const driverDestLng = Number(body['driver_destination_lng'])
    const driverLat = typeof body['driver_lat'] === 'number' ? Number(body['driver_lat']) : null
    const driverLng = typeof body['driver_lng'] === 'number' ? Number(body['driver_lng']) : null

    if (!rideId || isNaN(driverDestLat) || isNaN(driverDestLng)) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'driver_destination_lat and driver_destination_lng are required' },
      })
      return
    }

    const { data: ride } = await supabaseAdmin
      .from('rides')
      .select('id, origin, destination')
      .eq('id', rideId)
      .single()

    if (!ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    const rideOrigin = ride.origin as unknown as GeoPoint | null
    const rideDest = ride.destination as unknown as GeoPoint | null
    if (!rideOrigin?.coordinates || !rideDest?.coordinates) {
      res.status(400).json({
        error: { code: 'MISSING_COORDS', message: 'Ride is missing origin or destination coordinates' },
      })
      return
    }

    const riderOriginLat = rideOrigin.coordinates[1]
    const riderOriginLng = rideOrigin.coordinates[0]
    const riderDestLat = rideDest.coordinates[1]
    const riderDestLng = rideDest.coordinates[0]
    const originLat = driverLat ?? riderOriginLat
    const originLng = driverLng ?? riderOriginLng

    const apiKey = process.env['GOOGLE_MAPS_KEY']
    if (!apiKey) {
      res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Maps API key not configured' } })
      return
    }

    try {
      // Compute transit suggestions (reuses existing heavy lifter)
      const { suggestions, polyline } = await computeTransitDropoffSuggestions(
        originLat, originLng,
        driverDestLat, driverDestLng,
        riderDestLat, riderDestLng,
        apiKey,
      )

      // Compute overlap percentage
      const totalRiderDistM = haversineMetres(riderOriginLat, riderOriginLng, riderDestLat, riderDestLng)
      let overlapPct: number
      if (totalRiderDistM === 0) {
        overlapPct = 100
      } else {
        // Use the best transit suggestion's rider_progress_pct if available
        const bestProgress = suggestions.length > 0
          ? Math.max(...suggestions.map(s => s.rider_progress_pct ?? 0))
          : null
        if (bestProgress !== null && bestProgress > 0) {
          overlapPct = Math.min(100, bestProgress)
        } else {
          const remainingM = haversineMetres(driverDestLat, driverDestLng, riderDestLat, riderDestLng)
          overlapPct = Math.max(0, Math.min(100, Math.round((1 - remainingM / totalRiderDistM) * 100)))
        }
      }

      // Estimate fare using distance from origin to rider destination
      const distanceM = haversineMetres(originLat, originLng, riderDestLat, riderDestLng)
      const distanceMiles = (distanceM / 1000) * KM_TO_MILES

      // Fetch driving route for duration estimate
      const routeInfo = await fetchDrivingRoute(originLat, originLng, riderDestLat, riderDestLng, apiKey)
      const durationMin = routeInfo?.durationMin ?? Math.round(distanceMiles * 2) // fallback estimate

      const gallonsUsed = distanceMiles / DEFAULT_MPG
      const gasCostCents = Math.round(gallonsUsed * DEFAULT_GAS_PRICE_PER_GALLON * 100)
      const timeCostCents = Math.round(durationMin * PER_MIN_CENTS)
      const raw = BASE_CENTS + gasCostCents + timeCostCents
      const fareCents = Math.max(MIN_FARE_CENTS, Math.min(MAX_FARE_CENTS, raw))
      const platformFeeCents = Math.round(fareCents * PLATFORM_FEE_RATE)
      const driverEarnsCents = fareCents - platformFeeCents

      res.status(200).json({
        overlap_pct: overlapPct,
        transit_suggestions: suggestions,
        driver_route_polyline: polyline,
        estimated_fare_cents: fareCents,
        driver_earns_cents: driverEarnsCents,
      })
    } catch (err) {
      console.error('[rides/preview-overlap] Error:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      res.status(500).json({
        error: { code: 'OVERLAP_ERROR', message: `Failed to compute overlap: ${msg}` },
      })
    }
  },
)

// ── POST /api/rides/:id/suggest-transit-dropoff ──────────────────────────────
/**
 * Driver picks a transit station from the suggestions. Creates a
 * transit_dropoff_suggestion message in the chat for the rider to accept.
 */
ridesRouter.post(
  '/:id/suggest-transit-dropoff',
  validateJwt,
  async (req: Request, res: Response, _next: NextFunction) => {
    const driverId = res.locals['userId'] as string
    const rideId = req.params['id'] as string
    const {
      station_name,
      station_lat,
      station_lng,
      station_place_id,
      station_address,
      transit_options,
      walk_to_station_minutes,
      transit_to_dest_minutes,
      total_rider_minutes,
      transit_polyline,
      rider_progress_pct,
      ride_with_driver_minutes,
      full_transit_minutes,
      ride_distance_km,
    } = req.body as {
      station_name?: string
      station_lat?: number
      station_lng?: number
      station_place_id?: string
      station_address?: string
      transit_options?: unknown[]
      walk_to_station_minutes?: number
      transit_to_dest_minutes?: number
      total_rider_minutes?: number
      transit_polyline?: string | null
      rider_progress_pct?: number | null
      ride_with_driver_minutes?: number | null
      full_transit_minutes?: number | null
      ride_distance_km?: number | null
    }

    if (
      typeof station_name !== 'string' ||
      typeof station_lat !== 'number' ||
      typeof station_lng !== 'number'
    ) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'station_name, station_lat, station_lng are required' },
      })
      return
    }

    // Verify ride and driver
    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, driver_id, rider_id, status, origin, destination, destination_name, driver_destination, driver_destination_name, driver_route_polyline')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (ride.driver_id !== driverId) {
      const { count: offerCount } = await supabaseAdmin
        .from('ride_offers')
        .select('id', { count: 'exact', head: true })
        .eq('ride_id', rideId)
        .eq('driver_id', driverId)
        .in('status', ['pending', 'selected'])

      if ((offerCount ?? 0) === 0) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the driver can suggest a transit dropoff' } })
        return
      }
    }

    if (ride.status !== 'requested' && ride.status !== 'accepted' && ride.status !== 'coordinating') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot suggest transit dropoff` },
      })
      return
    }

    // Update dropoff point on the ride
    const dropoffGeo: GeoPoint = { type: 'Point', coordinates: [station_lng, station_lat] }
    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({
        dropoff_point: dropoffGeo,
        destination: dropoffGeo,
        destination_name: station_name.trim().slice(0, 200),
        dropoff_confirmed: false,
      })
      .eq('id', rideId)

    if (updateErr) {
      console.error('[rides/suggest-transit-dropoff] DB update error:', updateErr)
      res.status(500).json({
        error: { code: 'DB_UPDATE_ERROR', message: `Failed to update ride dropoff: ${updateErr.message}` },
      })
      return
    }

    // Extract coordinates for message meta
    const rideOrigin = ride.origin as unknown as GeoPoint | null
    const riderDest = ride.destination as unknown as GeoPoint | null
    const driverDest = (ride as Record<string, unknown>)['driver_destination'] as unknown as GeoPoint | null

    // Insert transit_dropoff_suggestion message
    const { data: msg } = await supabaseAdmin
      .from('messages')
      .insert({
        ride_id: rideId,
        sender_id: driverId,
        content: `Suggested transit dropoff: ${station_name}`,
        type: 'transit_dropoff_suggestion',
        meta: {
          station_name,
          station_lat,
          station_lng,
          station_place_id: station_place_id ?? null,
          station_address: station_address ?? null,
          transit_options: transit_options ?? [],
          walk_to_station_minutes: walk_to_station_minutes ?? 0,
          transit_to_dest_minutes: transit_to_dest_minutes ?? 0,
          total_rider_minutes: total_rider_minutes ?? 0,
          proposed_by: driverId,
          transit_polyline: transit_polyline ?? null,
          rider_progress_pct: rider_progress_pct ?? null,
          ride_with_driver_minutes: ride_with_driver_minutes ?? null,
          ride_distance_km: ride_distance_km ?? null,
          full_transit_minutes: full_transit_minutes ?? null,
          pickup_lat: rideOrigin?.coordinates?.[1] ?? null,
          pickup_lng: rideOrigin?.coordinates?.[0] ?? null,
          rider_dest_lat: riderDest?.coordinates?.[1] ?? null,
          rider_dest_lng: riderDest?.coordinates?.[0] ?? null,
          rider_dest_name: (ride as Record<string, unknown>)['destination_name'] ?? null,
          driver_dest_lat: driverDest?.coordinates?.[1] ?? null,
          driver_dest_lng: driverDest?.coordinates?.[0] ?? null,
          driver_dest_name: (ride as Record<string, unknown>)['driver_destination_name'] ?? null,
          driver_route_polyline: (ride as Record<string, unknown>)['driver_route_polyline'] ?? null,
        },
      })
      .select('id, ride_id, sender_id, content, type, meta, created_at')
      .single()

    // Broadcast the message to chat
    if (msg) {
      void realtimeBroadcast(`chat:${rideId}`, 'new_message', msg as Record<string, unknown>)
      void realtimeBroadcast(`chat-badge:${rideId}`, 'new_message', msg as Record<string, unknown>)
    }

    // Notify rider via push
    if (ride.rider_id) {
      const { data: riderTokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token')
        .eq('user_id', ride.rider_id)
      const tokens = (riderTokens ?? []).map((t: { token: string }) => t.token)
      if (tokens.length > 0) {
        await sendFcmPush(tokens, {
          title: 'Transit dropoff suggested!',
          body: `Driver suggests dropping you at ${station_name} — open HICH to review transit options.`,
          data: { type: 'transit_dropoff', ride_id: rideId },
        })
      }
    }

    // Broadcast dropoff_done to WaitingRoom so rider navigates to chat
    void realtimeBroadcast(`waiting:${ride.rider_id}`, 'dropoff_done', { ride_id: rideId })
    void realtimeBroadcast(`chat:${rideId}`, 'dropoff_done', { ride_id: rideId })

    console.log(`[rides/suggest-transit-dropoff] rideId=${rideId} station=${station_name}`)
    res.status(200).json({ ride_id: rideId, station_name, message: msg ?? null })
  },
)

/**
 * PATCH /api/rides/:id/dropoff-done — driver signals they're done choosing a
 * dropoff. Sets status → 'coordinating' and broadcasts to rider's WaitingRoom.
 */
ridesRouter.patch(
  '/:id/dropoff-done',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const driverId = res.locals['userId'] as string
    const rideId = req.params['id'] as string
    console.log(`[rides/dropoff-done:DEBUG] ENTRY rideId=${rideId} driverId=${driverId}`)

    if (!rideId) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'Ride ID is required' } })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    // Verify driver is participant
    if (ride.driver_id !== driverId) {
      const { count: offerCount } = await supabaseAdmin
        .from('ride_offers')
        .select('id', { count: 'exact', head: true })
        .eq('ride_id', rideId)
        .eq('driver_id', driverId)
        .in('status', ['pending', 'selected'])

      if ((offerCount ?? 0) === 0) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not the driver for this ride' } })
        return
      }
    }

    if (ride.status !== 'accepted' && ride.status !== 'requested' && ride.status !== 'coordinating') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot mark dropoff done` },
      })
      return
    }

    // Transition to coordinating and set driver_id if not already set
    const updateFields: Record<string, unknown> = {}
    if (ride.status !== 'coordinating') updateFields.status = 'coordinating'
    if (!ride.driver_id) updateFields.driver_id = driverId

    console.log(`[rides/dropoff-done:DEBUG] ride.status=${ride.status} ride.driver_id=${ride.driver_id} updateFields=${JSON.stringify(updateFields)}`)

    if (Object.keys(updateFields).length > 0) {
      const { error: updateErr } = await supabaseAdmin
        .from('rides')
        .update(updateFields)
        .eq('id', rideId)

      if (updateErr) { next(updateErr); return }
    }

    // Broadcast to rider's WaitingRoom + chat channel
    await Promise.all([
      realtimeBroadcast(`waiting:${ride.rider_id}`, 'dropoff_done', { ride_id: rideId }),
      realtimeBroadcast(`chat:${rideId}`, 'dropoff_done', { ride_id: rideId }),
      realtimeBroadcast(`rider:${ride.rider_id}`, 'dropoff_done', { ride_id: rideId }),
    ])

    console.log(`[rides/dropoff-done] rideId=${rideId} driver=${driverId} → coordinating`)
    res.status(200).json({ ride_id: rideId, status: 'coordinating' })
  },
)

// ─── Retry payment ────────────────────────────────────────────────────────────
/**
 * POST /api/rides/:id/retry-payment
 *
 * Rider retries a failed payment on a completed ride.
 * Uses the rider's current default payment method.
 */
ridesRouter.post(
  ':id/retry-payment',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const rideId = req.params['id'] as string

    try {
      const { data: ride, error: rideErr } = await supabaseAdmin
        .from('rides')
        .select('id, rider_id, driver_id, fare_cents, payment_status')
        .eq('id', rideId)
        .single()

      if (rideErr || !ride) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ride not found' } })
        return
      }

      if (ride.rider_id !== userId) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the rider can retry payment' } })
        return
      }

      if (ride.payment_status !== 'failed' && ride.payment_status !== 'pending') {
        res.status(400).json({ error: { code: 'INVALID_STATE', message: `Cannot retry: payment is ${ride.payment_status}` } })
        return
      }

      const fareCents = ride.fare_cents as number
      if (!fareCents || fareCents <= 0) {
        res.status(400).json({ error: { code: 'NO_FARE', message: 'No fare to charge' } })
        return
      }

      if (!ride.rider_id || !ride.driver_id) {
        res.status(400).json({ error: { code: 'INVALID_RIDE', message: 'Ride missing rider or driver' } })
        return
      }

      // Fetch rider + driver Stripe info
      const [riderRes, driverRes] = await Promise.all([
        supabaseAdmin.from('users').select('stripe_customer_id, default_payment_method_id').eq('id', ride.rider_id).single(),
        supabaseAdmin.from('users').select('stripe_account_id, stripe_onboarding_complete').eq('id', ride.driver_id).single(),
      ])

      const rider = riderRes.data
      const driver = driverRes.data

      if (!rider?.stripe_customer_id || !rider?.default_payment_method_id) {
        res.status(400).json({ error: { code: 'NO_PAYMENT_METHOD', message: 'Please add a payment method first' } })
        return
      }

      if (!driver?.stripe_account_id || !driver?.stripe_onboarding_complete) {
        res.status(400).json({ error: { code: 'DRIVER_NOT_SETUP', message: 'Driver payment account not ready' } })
        return
      }

      const chargeResult = await chargeRideFare({
        rideId,
        fareCents,
        riderCustomerId: rider.stripe_customer_id as string,
        riderPaymentMethodId: rider.default_payment_method_id as string,
        driverAccountId: driver.stripe_account_id as string,
      })

      if (chargeResult.success) {
        await supabaseAdmin
          .from('rides')
          .update({
            payment_status: 'processing',
            payment_intent_id: chargeResult.paymentIntentId,
            stripe_fee_cents: chargeResult.stripFeeCents ?? 0,
          })
          .eq('id', rideId)

        res.json({ success: true, payment_status: 'processing' })
      } else {
        res.status(402).json({ error: { code: 'CHARGE_FAILED', message: chargeResult.error ?? 'Payment failed' } })
      }
    } catch (err) {
      next(err)
    }
  },
)

// ─── Ride timeout cleanup ─────────────────────────────────────────────────────
/**
 * POST /api/rides/cleanup-stale
 *
 * Marks rides that have been active for > 4 hours as 'cancelled'.
 * Also cancels rides stuck in 'requested' for > 1 hour with no driver.
 * Intended to be called by a cron job (e.g., every 30 minutes).
 */
ridesRouter.post(
  '/cleanup-stale',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

      // Cancel rides active for > 4 hours
      const { data: timedOut } = await supabaseAdmin
        .from('rides')
        .update({ status: 'cancelled', ended_at: new Date().toISOString() })
        .eq('status', 'active')
        .lt('started_at', fourHoursAgo)
        .select('id')

      // Cancel rides stuck in requested for > 1 hour
      const { data: staleRequested } = await supabaseAdmin
        .from('rides')
        .update({ status: 'cancelled', ended_at: new Date().toISOString() })
        .eq('status', 'requested')
        .is('driver_id', null)
        .lt('created_at', oneHourAgo)
        .select('id')

      const timedOutCount = timedOut?.length ?? 0
      const staleCount = staleRequested?.length ?? 0

      if (timedOutCount > 0 || staleCount > 0) {
        console.log(`[rides/cleanup-stale] timed_out=${timedOutCount} stale_requested=${staleCount}`)
      }

      res.status(200).json({ timed_out: timedOutCount, stale_requested: staleCount })
    } catch (err) {
      next(err)
    }
  },
)
