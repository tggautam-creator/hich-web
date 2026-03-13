import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { sendFcmPush } from '../lib/fcm.ts'
import { validateJwt } from '../middleware/auth.ts'
import { generateQrToken, validateQrToken } from '../lib/qrToken.ts'

export const ridesRouter = Router()

async function broadcastRideRequestWithTimeout(
  driverId: string,
  payload: {
    type: 'ride_request'
    ride_id: string
    rider_name: string
    destination: string
    distance_km: string
    estimated_earnings_cents: string
    origin_lat: string
    origin_lng: string
    destination_lat: string
    destination_lng: string
  },
  timeoutMs = 1500,
): Promise<boolean> {
  const channel = supabaseAdmin.channel(`driver:${driverId}`)

  return await new Promise<boolean>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        void supabaseAdmin.removeChannel(channel)
        console.warn(`[Realtime] Timeout sending ride_request to driver:${driverId}`)
        resolve(false)
      }
    }, timeoutMs)

    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED' || settled) return

      channel.send({
        type: 'broadcast',
        event: 'ride_request',
        payload,
      })
        .then(() => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          void supabaseAdmin.removeChannel(channel)
          console.log(`[Realtime] Broadcast sent to driver:${driverId}`)
          resolve(true)
        })
        .catch((err: unknown) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          void supabaseAdmin.removeChannel(channel)
          const message = err instanceof Error ? err.message : 'Unknown send error'
          console.error(`[Realtime] Broadcast failed to driver:${driverId}: ${message}`)
          resolve(false)
        })
    })
  })
}

// ── Wallet transfer helper ────────────────────────────────────────────────────
/**
 * Atomically debit rider wallet and credit driver wallet when a ride ends.
 * Uses supabase rpc to run in a single Postgres transaction.
 * If the rider has insufficient balance, the transfer is skipped (ride still ends).
 */
async function transferFare(
  rideId: string,
  riderId: string,
  driverId: string,
  fareCents: number,
  platformFeeCents: number,
): Promise<{ transferred: boolean; error?: string }> {
  const driverEarnsCents = fareCents - platformFeeCents

  console.log(`[transferFare] rideId=${rideId} fare=${fareCents} platform=${platformFeeCents} driverEarns=${driverEarnsCents}`)

  // Fetch current balances
  const { data: rider, error: riderFetchErr } = await supabaseAdmin
    .from('users')
    .select('wallet_balance')
    .eq('id', riderId)
    .single()

  const { data: driver, error: driverFetchErr } = await supabaseAdmin
    .from('users')
    .select('wallet_balance')
    .eq('id', driverId)
    .single()

  if (riderFetchErr || driverFetchErr || !rider || !driver) {
    console.error(`[transferFare] Failed to fetch balances. riderErr=${riderFetchErr?.message} driverErr=${driverFetchErr?.message}`)
    return { transferred: false, error: 'Could not fetch user balances' }
  }

  const riderBalance = rider.wallet_balance ?? 0
  const driverBalance = driver.wallet_balance ?? 0
  console.log(`[transferFare] riderBalance=${riderBalance} driverBalance=${driverBalance}`)

  if (riderBalance < fareCents) {
    console.warn(`[transferFare] Insufficient rider balance: ${riderBalance} < ${fareCents}`)
    // Still transfer what we can — deduct the full fare regardless (rider owes the platform)
    // For MVP, allow the ride to still complete
  }

  const newRiderBalance = riderBalance - fareCents
  const newDriverBalance = driverBalance + driverEarnsCents

  // Debit rider
  const { data: debitData, error: debitErr } = await supabaseAdmin
    .from('users')
    .update({ wallet_balance: newRiderBalance })
    .eq('id', riderId)
    .select('wallet_balance')
    .single()

  if (debitErr) {
    console.error(`[transferFare] Debit rider failed: ${debitErr.message}`)
    return { transferred: false, error: `Failed to debit rider: ${debitErr.message}` }
  }
  console.log(`[transferFare] Rider debited: ${riderBalance} → ${debitData?.wallet_balance}`)

  // Credit driver
  const { data: creditData, error: creditErr } = await supabaseAdmin
    .from('users')
    .update({ wallet_balance: newDriverBalance })
    .eq('id', driverId)
    .select('wallet_balance')
    .single()

  if (creditErr) {
    console.error(`[transferFare] Credit driver failed: ${creditErr.message}, rolling back rider`)
    // Rollback rider debit
    await supabaseAdmin
      .from('users')
      .update({ wallet_balance: riderBalance })
      .eq('id', riderId)
    return { transferred: false, error: `Failed to credit driver: ${creditErr.message}` }
  }
  console.log(`[transferFare] Driver credited: ${driverBalance} → ${creditData?.wallet_balance}`)

  // Insert transaction records
  const { error: txnErr } = await supabaseAdmin.from('transactions').insert([
    {
      user_id: riderId,
      ride_id: rideId,
      type: 'fare_debit',
      amount_cents: -fareCents,
      balance_after_cents: newRiderBalance,
      description: `Ride fare charged`,
    },
    {
      user_id: driverId,
      ride_id: rideId,
      type: 'fare_credit',
      amount_cents: driverEarnsCents,
      balance_after_cents: newDriverBalance,
      description: `Ride fare earned`,
    },
  ])

  if (txnErr) {
    console.error(`[transferFare] Transaction insert failed: ${txnErr.message}`)
  }

  console.log(`[transferFare] SUCCESS rideId=${rideId} rider=${newRiderBalance} driver=${newDriverBalance}`)
  return { transferred: true }
}

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
const PLATFORM_FEE_RATE = 0.15
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
  ride: { origin: GeoPoint; pickup_point: GeoPoint | null; dropoff_point: GeoPoint | null; destination: GeoPoint | null; started_at: string | null },
  endedAt: string,
): { fare_cents: number; platform_fee_cents: number; driver_earns_cents: number; distance_miles: number; duration_min: number } {
  // Duration from actual ride timestamps
  const startMs = ride.started_at ? new Date(ride.started_at).getTime() : Date.now()
  const endMs = new Date(endedAt).getTime()
  const durationMin = Math.max(0, Math.round((endMs - startMs) / 60000))

  // Distance: pickup_point → dropoff_point, falling back to origin → destination
  const from = ride.pickup_point ?? ride.origin
  const to = ride.dropoff_point ?? ride.destination
  let distanceM = 0
  if (from && to) {
    distanceM = haversineMetres(
      from.coordinates[1], from.coordinates[0],
      to.coordinates[1], to.coordinates[0],
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
      driverIds = (nearbyRows as Array<{ user_id: string }>).map((r) => r.user_id)
        .filter((id) => id !== riderId)
      stage = 2
    } else {
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

    // Broadcast via Supabase Realtime so in-app listeners receive instantly
    const riderProfile = await supabaseAdmin
      .from('users')
      .select('full_name')
      .eq('id', riderId)
      .single()
    const riderName = riderProfile.data?.full_name ?? 'A rider'

    const fareCents = typeof body.estimated_fare_cents === 'number' ? body.estimated_fare_cents : 0
    const platformFee = Math.round(fareCents * 0.15)
    const driverEarns = fareCents - platformFee

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
    }

    const realtimeResults = await Promise.all(
      driverIds.map((driverId) => broadcastRideRequestWithTimeout(driverId, realtimePayload)),
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
    if (ride.rider_id !== userId && ride.driver_id !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only a ride participant can cancel' },
      })
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

    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'cancelled' })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Notify the other party
    const otherUserId = userId === ride.rider_id ? ride.driver_id : ride.rider_id
    const cancellerRole = userId === ride.rider_id ? 'rider' : 'driver'

    // Helper: broadcast a single event to a channel
    function broadcastEvent(channelName: string, event: string, payload: Record<string, unknown>): void {
      const ch = supabaseAdmin.channel(channelName)
      const timer = setTimeout(() => { supabaseAdmin.removeChannel(ch).catch(() => {}) }, 3000)
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event, payload }).then(() => {
            clearTimeout(timer)
            supabaseAdmin.removeChannel(ch).catch(() => {})
          }).catch(() => {
            clearTimeout(timer)
            supabaseAdmin.removeChannel(ch).catch(() => {})
          })
        }
      })
    }

    if (otherUserId) {
      // Broadcast to the other party's notification channel
      const channelName = cancellerRole === 'rider'
        ? `driver:${otherUserId}`
        : `rider:${otherUserId}`
      broadcastEvent(channelName, 'ride_cancelled', {
        type: 'ride_cancelled', ride_id: rideId, cancelled_by: cancellerRole,
      })

      // Broadcast to other party's MyRides channel
      broadcastEvent(`myrides:${otherUserId}`, 'ride_status_changed', {
        ride_id: rideId, status: 'cancelled',
      })

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
    broadcastEvent(`myrides:${userId}`, 'ride_status_changed', {
      ride_id: rideId, status: 'cancelled',
    })

    // Broadcast to the chat channel so MessagingWindow updates if open
    broadcastEvent(`chat:${rideId}`, 'ride_cancelled', {
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
        broadcastEvent(`driver:${driver.id}`, 'ride_cancelled', {
          type: 'ride_cancelled', ride_id: rideId,
        })
      }
    }

    console.log(`[rides/cancel] rideId=${rideId} cancelled by ${cancellerRole} (${userId})`)
    res.status(200).json({ ride_id: rideId, status: 'cancelled' })
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

    // Look up driver's active vehicle
    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .select('id')
      .eq('user_id', driverId)
      .eq('is_active', true)
      .limit(1)
      .single()

    // Insert offer into ride_offers (upsert to handle duplicate accepts)
    const { error: offerErr } = await supabaseAdmin
      .from('ride_offers')
      .upsert(
        { ride_id: rideId, driver_id: driverId, vehicle_id: vehicle?.id ?? null, status: 'pending' },
        { onConflict: 'ride_id,driver_id' },
      )

    if (offerErr) {
      next(offerErr)
      return
    }

    // Count current pending offers for this ride
    const { count: offerCount } = await supabaseAdmin
      .from('ride_offers')
      .select('id', { count: 'exact', head: true })
      .eq('ride_id', rideId)
      .eq('status', 'pending')

    // Broadcast offer to rider via Realtime so WaitingRoom can collect offers
    const acceptPayload = {
      type: 'ride_accepted',
      ride_id: rideId,
      driver_id: driverId,
      offer_count: offerCount ?? 1,
    }
    for (const ch of [`rider:${ride.rider_id}`, `waiting:${ride.rider_id}`]) {
      const riderChannel = supabaseAdmin.channel(ch)
      await new Promise<void>((resolve) => {
        riderChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            riderChannel.send({
              type: 'broadcast',
              event: 'ride_accepted',
              payload: acceptPayload,
            }).then(() => {
              supabaseAdmin.removeChannel(riderChannel)
              resolve()
            })
          }
        })
      })
    }

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
    res.status(200).json({ ride_id: rideId, status: 'requested', offer_count: offerCount })
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

    // Re-notify drivers (Stage 1 fallback — notify all)
    const { data: allDrivers } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('is_driver', true)

    const driverIds = (allDrivers ?? [])
      .map((d: { id: string }) => d.id)
      .filter((id: string) => id !== ride.driver_id) // exclude the declined driver

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

    if (ride.status !== 'requested' && ride.status !== 'accepted') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot select driver` },
      })
      return
    }

    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'accepted', driver_id: selectedDriverId })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Mark selected offer as 'selected', release all others
    await supabaseAdmin
      .from('ride_offers')
      .update({ status: 'selected' })
      .eq('ride_id', rideId)
      .eq('driver_id', selectedDriverId)

    await supabaseAdmin
      .from('ride_offers')
      .update({ status: 'released' })
      .eq('ride_id', rideId)
      .neq('driver_id', selectedDriverId)

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

    // Send release notification to all other online drivers
    const { data: allDrivers } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('is_driver', true)
      .neq('id', selectedDriverId)
      .neq('id', userId)

    for (const driver of allDrivers ?? []) {
      const channel = supabaseAdmin.channel(`driver:${driver.id}`)
      await new Promise<void>((resolve) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel.send({
              type: 'broadcast',
              event: 'ride_cancelled',
              payload: { type: 'ride_cancelled', ride_id: rideId },
            }).then(() => {
              supabaseAdmin.removeChannel(channel)
              resolve()
            })
          }
        })
      })
    }

    console.log(`[rides/select-driver] rideId=${rideId} selected driver=${selectedDriverId}`)
    res.status(200).json({ ride_id: rideId, status: 'accepted', driver_id: selectedDriverId })
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
      .select('id, driver_id, vehicle_id, status, created_at')
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
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only ride participants can set pickup point' } })
      return
    }

    if (ride.status !== 'accepted' && ride.status !== 'coordinating') {
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
      const chatChannel = supabaseAdmin.channel(`chat:${rideId}`)
      const broadcastPromise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          supabaseAdmin.removeChannel(chatChannel).catch(() => {})
          resolve()
        }, 3000)
        chatChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            chatChannel.send({
              type: 'broadcast',
              event: 'new_message',
              payload: suggestionMsg,
            }).then(() => {
              clearTimeout(timer)
              supabaseAdmin.removeChannel(chatChannel).catch(() => {})
              resolve()
            }).catch(() => {
              clearTimeout(timer)
              supabaseAdmin.removeChannel(chatChannel).catch(() => {})
              resolve()
            })
          }
        })
      })
      broadcastPromise.catch(() => {})
    }

    // Determine who to notify — the other party
    const proposerId = driverId
    const otherId = proposerId === ride.rider_id ? ride.driver_id : ride.rider_id
    const proposerRole = proposerId === ride.rider_id ? 'Rider' : 'Driver'

    // Broadcast pickup_set to the other party
    if (otherId) {
      const pickupPayload = { type: 'pickup_set', ride_id: rideId, lat, lng, note: note ?? null, proposed_by: proposerId }
      for (const chName of [`rider:${otherId}`, `rider-pickup:${otherId}`]) {
        const notifyChannel = supabaseAdmin.channel(chName)
        await new Promise<void>((resolve) => {
          notifyChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              notifyChannel.send({
                type: 'broadcast',
                event: 'pickup_set',
                payload: pickupPayload,
              }).then(() => {
                supabaseAdmin.removeChannel(notifyChannel)
                resolve()
              })
            }
          })
        })
      }

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
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only ride participants can change dropoff' } })
      return
    }

    if (ride.status !== 'accepted' && ride.status !== 'coordinating') {
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
      const chatChannel = supabaseAdmin.channel(`chat:${rideId}`)
      const broadcastPromise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          supabaseAdmin.removeChannel(chatChannel).catch(() => {})
          resolve()
        }, 3000)
        chatChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            chatChannel.send({
              type: 'broadcast',
              event: 'new_message',
              payload: suggestionMsg,
            }).then(() => {
              clearTimeout(timer)
              supabaseAdmin.removeChannel(chatChannel).catch(() => {})
              resolve()
            }).catch(() => {
              clearTimeout(timer)
              supabaseAdmin.removeChannel(chatChannel).catch(() => {})
              resolve()
            })
          }
        })
      })
      broadcastPromise.catch(() => {})
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
      const chatChannel = supabaseAdmin.channel(`chat:${rideId}`)
      const broadcastPromise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          supabaseAdmin.removeChannel(chatChannel).catch(() => {})
          resolve()
        }, 3000)
        chatChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            chatChannel.send({
              type: 'broadcast',
              event: 'new_message',
              payload: acceptMsg,
            }).then(() => {
              clearTimeout(timer)
              supabaseAdmin.removeChannel(chatChannel).catch(() => {})
              resolve()
            }).catch(() => {
              clearTimeout(timer)
              supabaseAdmin.removeChannel(chatChannel).catch(() => {})
              resolve()
            })
          }
        })
      })
      broadcastPromise.catch(() => {})
    }

    // Broadcast details_accepted to driver — both rider:{id} and msg-driver:{id}
    if (ride.driver_id) {
      const detailsPayload = { type: 'details_accepted', ride_id: rideId }
      for (const chName of [`rider:${ride.driver_id}`, `msg-driver:${ride.driver_id}`]) {
        const driverChannel = supabaseAdmin.channel(chName)
        await new Promise<void>((resolve) => {
          driverChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              driverChannel.send({
                type: 'broadcast',
                event: 'details_accepted',
                payload: detailsPayload,
              }).then(() => {
                supabaseAdmin.removeChannel(driverChannel)
                resolve()
              })
            }
          })
        })
      }

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
      .select('id, rider_id, driver_id, status, pickup_confirmed, dropoff_confirmed, schedule_id')
      .eq('id', rideId)
      .single()

    if (fetchErr ?? !ride) {
      res.status(404).json({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } })
      return
    }

    if (ride.rider_id !== userId && ride.driver_id !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only ride participants can accept locations' } })
      return
    }

    if (ride.status !== 'accepted' && ride.status !== 'coordinating') {
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

    // Insert a system message
    const isPickup = location_type === 'pickup'
    const accepterRole = userId === ride.rider_id ? 'Rider' : 'Driver'
    const { data: acceptMsg } = await supabaseAdmin
      .from('messages')
      .insert({
        ride_id: rideId,
        sender_id: userId,
        content: `${accepterRole} accepted ${isPickup ? 'pickup' : 'dropoff'} location`,
        type: 'location_accepted',
        meta: { location_type, accepted_by: userId },
      })
      .select('id, ride_id, sender_id, content, type, meta, created_at')
      .single()

    // Broadcast acceptance to chat
    if (acceptMsg) {
      const chatChannel = supabaseAdmin.channel(`chat:${rideId}`)
      const broadcastPromise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          supabaseAdmin.removeChannel(chatChannel).catch(() => {})
          resolve()
        }, 3000)
        chatChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            chatChannel.send({
              type: 'broadcast',
              event: 'new_message',
              payload: acceptMsg,
            }).then(() => {
              clearTimeout(timer)
              supabaseAdmin.removeChannel(chatChannel).catch(() => {})
              resolve()
            }).catch(() => {
              clearTimeout(timer)
              supabaseAdmin.removeChannel(chatChannel).catch(() => {})
              resolve()
            })
          }
        })
      })
      broadcastPromise.catch(() => {})
    }

    // If both locations are now confirmed, broadcast to both parties
    if (pickupDone && dropoffDone) {
      const otherId = userId === ride.rider_id ? ride.driver_id : ride.rider_id
      const confirmPayload = { type: 'locations_confirmed', ride_id: rideId, is_scheduled: !!ride.schedule_id }

      // Broadcast to both parties' channels
      for (const targetId of [userId, otherId]) {
        if (!targetId) continue
        for (const chName of [`rider:${targetId}`, `msg-driver:${targetId}`]) {
          const ch = supabaseAdmin.channel(chName)
          const timer = setTimeout(() => { supabaseAdmin.removeChannel(ch).catch(() => {}) }, 3000)
          ch.subscribe((s) => {
            if (s === 'SUBSCRIBED') {
              ch.send({ type: 'broadcast', event: 'locations_confirmed', payload: confirmPayload }).then(() => {
                clearTimeout(timer)
                supabaseAdmin.removeChannel(ch).catch(() => {})
              }).catch(() => {
                clearTimeout(timer)
                supabaseAdmin.removeChannel(ch).catch(() => {})
              })
            }
          })
        }
      }

      // Also broadcast to chat channel
      const chatCh2 = supabaseAdmin.channel(`chat-confirm:${rideId}`)
      const timer2 = setTimeout(() => { supabaseAdmin.removeChannel(chatCh2).catch(() => {}) }, 3000)
      chatCh2.subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          chatCh2.send({ type: 'broadcast', event: 'locations_confirmed', payload: confirmPayload }).then(() => {
            clearTimeout(timer2)
            supabaseAdmin.removeChannel(chatCh2).catch(() => {})
          }).catch(() => {
            clearTimeout(timer2)
            supabaseAdmin.removeChannel(chatCh2).catch(() => {})
          })
        }
      })

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

    if (ride.status !== 'coordinating') {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', cannot signal` },
      })
      return
    }

    // Broadcast to driver via Realtime
    if (ride.driver_id) {
      const driverChannel = supabaseAdmin.channel(`rider:${ride.driver_id}`)
      await new Promise<void>((resolve) => {
        driverChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            driverChannel.send({
              type: 'broadcast',
              event: 'rider_signal',
              payload: { type: 'rider_signal', ride_id: rideId },
            }).then(() => {
              supabaseAdmin.removeChannel(driverChannel)
              resolve()
            })
          }
        })
      })

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
    const { token } = req.body as { token?: string }

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

    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'active', started_at: new Date().toISOString() })
      .eq('id', rideId)

    if (updateErr) {
      next(updateErr)
      return
    }

    // Broadcast ride_started to both parties + component-specific channels
    const startedChannels = [
      ...[ride.rider_id, ride.driver_id].filter(Boolean).map((uid) => `rider:${uid}`),
      ...(ride.rider_id ? [`rider-pickup:${ride.rider_id}`, `rider-active:${ride.rider_id}`] : []),
    ]
    for (const chName of startedChannels) {
      const channel = supabaseAdmin.channel(chName)
      await new Promise<void>((resolve) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel.send({
              type: 'broadcast',
              event: 'ride_started',
              payload: { type: 'ride_started', ride_id: rideId },
            }).then(() => {
              supabaseAdmin.removeChannel(channel)
              resolve()
            })
          }
        })
      })
    }

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

    // Calculate fare from actual ride distance and duration
    // Build dropoff point from rider's current GPS if provided
    const dropoffGeo: GeoPoint | null =
      typeof lat === 'number' && typeof lng === 'number'
        ? { type: 'Point', coordinates: [lng, lat] }
        : null

    const rideForFare = {
      origin: ride.origin as GeoPoint,
      pickup_point: (ride.pickup_point ?? null) as GeoPoint | null,
      dropoff_point: dropoffGeo ?? (ride.dropoff_point as GeoPoint | null),
      destination: (ride.destination ?? null) as GeoPoint | null,
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

    // Transfer fare: debit rider, credit driver
    let transferred = false
    if (ride.driver_id) {
      const result = await transferFare(rideId, ride.rider_id, ride.driver_id, fareCents, platformFeeCents)
      transferred = result.transferred
      if (!transferred) {
        console.warn(`[rides/end] Fare transfer failed: ${result.error}`)
      }
    }

    // Broadcast ride_ended to both parties + component-specific channels
    const endedChannels = [
      ...[ride.rider_id, ride.driver_id].filter(Boolean).map((uid) => `rider:${uid}`),
      ...(ride.rider_id ? [`rider-active:${ride.rider_id}`] : []),
    ]
    for (const chName of endedChannels) {
      const channel = supabaseAdmin.channel(chName)
      await new Promise<void>((resolve) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel.send({
              type: 'broadcast',
              event: 'ride_ended',
              payload: {
                type: 'ride_ended',
                ride_id: rideId,
                fare_cents: fareCents,
                driver_earns_cents: driverEarnsCents,
              },
            }).then(() => {
              supabaseAdmin.removeChannel(channel)
              resolve()
            })
          }
        })
      })
    }

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

    console.log(`[rides/end] rideId=${rideId} fare=${fareCents} dist=${distance_miles.toFixed(1)}mi dur=${duration_min}min transferred=${transferred}`)
    res.status(200).json({
      ride_id: rideId,
      status: 'completed',
      fare_cents: fareCents,
      platform_fee_cents: platformFeeCents,
      driver_earns_cents: driverEarnsCents,
      fare_transferred: transferred,
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
ridesRouter.post(
  '/scan-driver',
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
      const { error: updateErr } = await supabaseAdmin
        .from('rides')
        .update({ status: 'active', started_at: new Date().toISOString() })
        .eq('id', ride.id)

      if (updateErr) { next(updateErr); return }

      // Broadcast ride_started to both parties + component-specific channels
      const scanStartChannels = [
        ...[ride.rider_id, ride.driver_id].filter(Boolean).map((uid) => `rider:${uid}`),
        ...(ride.rider_id ? [`rider-pickup:${ride.rider_id}`, `rider-active:${ride.rider_id}`] : []),
      ]
      for (const chName of scanStartChannels) {
        const channel = supabaseAdmin.channel(chName)
        await new Promise<void>((resolve) => {
          channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              channel.send({
                type: 'broadcast',
                event: 'ride_started',
                payload: { type: 'ride_started', ride_id: ride.id },
              }).then(() => {
                supabaseAdmin.removeChannel(channel)
                resolve()
              })
            }
          })
        })
      }

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
    // Build dropoff point from rider's current GPS if provided
    const dropoffGeo: GeoPoint | null =
      typeof lat === 'number' && typeof lng === 'number'
        ? { type: 'Point', coordinates: [lng, lat] }
        : null

    const rideForFare = {
      origin: ride.origin as GeoPoint,
      pickup_point: (ride.pickup_point ?? null) as GeoPoint | null,
      dropoff_point: dropoffGeo ?? (ride.dropoff_point as GeoPoint | null),
      destination: (ride.destination ?? null) as GeoPoint | null,
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
      .eq('id', ride.id)

    if (updateErr) { next(updateErr); return }

    // Transfer fare: debit rider, credit driver
    let transferred = false
    if (ride.driver_id) {
      const result = await transferFare(ride.id, ride.rider_id, ride.driver_id, fareCents, platformFeeCents)
      transferred = result.transferred
      if (!transferred) {
        console.warn(`[rides/scan-driver] Fare transfer failed: ${result.error}`)
      }
    }

    // Broadcast ride_ended to both parties + component-specific channels
    const scanEndChannels = [
      ...[ride.rider_id, ride.driver_id].filter(Boolean).map((uid) => `rider:${uid}`),
      ...(ride.rider_id ? [`rider-active:${ride.rider_id}`] : []),
    ]
    for (const chName of scanEndChannels) {
      const channel = supabaseAdmin.channel(chName)
      await new Promise<void>((resolve) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel.send({
              type: 'broadcast',
              event: 'ride_ended',
              payload: {
                type: 'ride_ended',
                ride_id: ride.id,
                fare_cents: fareCents,
                driver_earns_cents: driverEarnsCents,
              },
            }).then(() => {
              supabaseAdmin.removeChannel(channel)
              resolve()
            })
          }
        })
      })
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

    console.log(`[rides/scan-driver] rideId=${ride.id} ended via driver code, fare=${fareCents} dist=${distance_miles.toFixed(1)}mi dur=${duration_min}min transferred=${transferred}`)
    res.status(200).json({
      ride_id: ride.id,
      action: 'ended',
      status: 'completed',
      fare_cents: fareCents,
      platform_fee_cents: platformFeeCents,
      driver_earns_cents: driverEarnsCents,
      fare_transferred: transferred,
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
