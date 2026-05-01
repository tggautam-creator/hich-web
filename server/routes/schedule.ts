import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { sendFcmPush } from '../lib/fcm.ts'
import { validateJwt } from '../middleware/auth.ts'
import { realtimeBroadcast } from '../lib/realtimeBroadcast.ts'
import { haversineMetres } from '../lib/polyline.ts'
import { checkUpcomingRides, expireMissedRides, expireStaleRequests, syncAllRoutines } from '../lib/scheduledReminders.ts'
import { resolveAndPersistDefaultPm } from './payment.ts'

export const scheduleRouter = Router()

// ── Reverse geocode helper ──────────────────────────────────────────────────
interface GeocodeResponse {
  results?: Array<{ formatted_address?: string }>
  status?: string
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = process.env['GOOGLE_MAPS_KEY']
  if (!key) return 'Unknown'
  try {
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(key)}`,
    )
    if (!resp.ok) return 'Unknown'
    const data = (await resp.json()) as GeocodeResponse
    if (data.status !== 'OK' || !data.results?.length) return 'Unknown'
    return data.results[0].formatted_address ?? 'Unknown'
  } catch {
    return 'Unknown'
  }
}

/** Forward-geocode an address string → lat/lng via Google Geocoding API */
async function forwardGeocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const key = process.env['GOOGLE_MAPS_KEY']
  if (!key) return null
  try {
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`,
    )
    if (!resp.ok) return null
    const data = (await resp.json()) as GeocodeResponse & { results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }> }
    if (data.status !== 'OK' || !data.results?.length) return null
    const loc = data.results[0].geometry?.location
    return loc ? { lat: loc.lat, lng: loc.lng } : null
  } catch {
    return null
  }
}

async function sendBoardDeclinedPush(
  userId: string,
  rideId: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    const { data: tokenRows, error } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId)

    if (error) {
      console.error('[schedule/board_declined] Failed to load push tokens:', error.message)
      return
    }

    const tokens = (tokenRows ?? []).map((row: { token: string }) => row.token)
    if (tokens.length === 0) return

    await sendFcmPush(tokens, {
      title,
      body,
      data: { type: 'board_declined', ride_id: rideId },
    })
  } catch (err: unknown) {
    console.error('[schedule/board_declined] Failed to send push:', err instanceof Error ? err.message : String(err))
  }
}

// ── Haversine distance (metres) ──────────────────────────────────────────────
function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180
  const R = 6_371_000
  const dLat = (lat2 - lat1) * toRad
  const dLng = (lng2 - lng1) * toRad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * GET /api/schedule/board
 *
 * Returns upcoming ride_schedules from all users (ride board).
 * Query params:
 *   - mode: 'driver' | 'rider' | undefined (filter by poster's mode)
 *   - lat, lng: requester's current location (enables proximity scoring)
 *   - dest_lat, dest_lng: requester's destination (enables bearing scoring)
 *   - trip_time: HH:MM:SS — requester's desired time (enables time scoring)
 *
 * When location params are provided, results are sorted by a relevance score
 * combining proximity, bearing similarity, and time window matching.
 * Otherwise, results are sorted chronologically by trip_date + trip_time.
 */
scheduleRouter.get(
  '/board',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const modeFilter = req.query['mode'] as string | undefined

    // Prefer the client's local "today" so the date-window filter matches
    // the timezone the user posted in. The stored trip_date/trip_time are
    // raw YYYY-MM-DD / HH:MM:SS in the user's local clock with no TZ info,
    // so comparing them to server UTC silently drops same-day posts when
    // the server is ahead of the user (e.g. UTC vs Pacific). Falls back to
    // server UTC for older clients that don't send these params.
    const clientDateParam = req.query['client_date'] as string | undefined
    const clientNowParam = req.query['client_now'] as string | undefined
    const today =
      clientDateParam && /^\d{4}-\d{2}-\d{2}$/.test(clientDateParam)
        ? clientDateParam
        : (new Date().toISOString().split('T')[0] as string)

    // Optional relevance params
    const userLat = parseFloat(req.query['lat'] as string)
    const userLng = parseFloat(req.query['lng'] as string)
    const destLat = parseFloat(req.query['dest_lat'] as string)
    const destLng = parseFloat(req.query['dest_lng'] as string)
    const userTime = req.query['trip_time'] as string | undefined

    const hasLocation = !isNaN(userLat) && !isNaN(userLng)
    const hasDest = !isNaN(destLat) && !isNaN(destLng)

    // Step 1: fetch ride schedules (no cross-schema join)
    let query = supabaseAdmin
      .from('ride_schedules')
      .select('*')
      .gte('trip_date', today)
      .order('trip_date', { ascending: true })
      .order('trip_time', { ascending: true })
      .limit(50)

    if (modeFilter === 'driver' || modeFilter === 'rider') {
      query = query.eq('mode', modeFilter)
    }

    const { data: schedules, error } = await query

    if (error) {
      next(error)
      return
    }

    if (!schedules || schedules.length === 0) {
      res.status(200).json({ rides: [] })
      return
    }

    // Filter out rides from today where the local clock has already passed
    // the trip time + a 60-minute grace window. We compare in the user's
    // local clock (taken from `client_now`) because trip_time is stored
    // tz-naive — comparing against server UTC produces wildly wrong deltas
    // (e.g. an 8h Pacific→UTC offset would drop every Pacific same-day post).
    const filteredSchedules = schedules.filter((s: Record<string, unknown>) => {
      const tripDate = s['trip_date'] as string
      const tripTime = s['trip_time'] as string
      const timeFlexible = s['time_flexible'] === true

      // If trip date is in the future, keep it
      if (tripDate > today) return true

      // Anytime posts for today stay visible all day — the whole point is no
      // specific hour, so there's no "past" to filter against.
      if (tripDate === today && timeFlexible) return true

      // If trip date is today, check if time has passed beyond grace period
      if (tripDate === today && tripTime) {
        // No client clock → can't reliably compare; keep the post (the
        // .gte('trip_date', today) already drops yesterdays).
        if (!clientNowParam) return true
        try {
          const rideDateTime = new Date(`${tripDate}T${tripTime}`)
          const clientNow = new Date(clientNowParam)
          if (isNaN(rideDateTime.getTime()) || isNaN(clientNow.getTime())) return true

          const timeDifferenceMinutes =
            (clientNow.getTime() - rideDateTime.getTime()) / (1000 * 60)

          // Keep if scheduled time is in the future OR within 60 minute grace period
          return timeDifferenceMinutes <= 60
        } catch {
          return true // Keep if date parsing fails
        }
      }

      return true
    })

    if (filteredSchedules.length === 0) {
      res.status(200).json({ rides: [] })
      return
    }

    // Step 2: fetch poster info from public.users
    const userIds = [...new Set(filteredSchedules.map((s: Record<string, unknown>) => s['user_id'] as string))]
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, full_name, avatar_url, rating_avg, is_driver')
      .in('id', userIds)

    const userMap = new Map(
      (users ?? []).map((u: Record<string, unknown>) => [u['id'] as string, u]),
    )

    // Step 3: if the user provided location data, resolve schedule addresses to coords
    // and compute a relevance score for sorting
    // We need coords for each schedule's origin. Since ride_schedules only store place_ids,
    // we look up any driver_routines for the same user as a proxy for location.
    // Otherwise we skip proximity scoring for that schedule.

    const routineCoords = new Map<string, { originLat: number; originLng: number; destLat: number; destLng: number; destBearing: number }>()

    if (hasLocation || hasDest) {
      // Fetch all routines for the posters to get their origin/destination coordinates
      const { data: routines } = await supabaseAdmin
        .from('driver_routines')
        .select('user_id, origin, destination, destination_bearing')
        .in('user_id', userIds)
        .eq('is_active', true)

      if (routines) {
        for (const r of routines as Array<{ user_id: string; origin: { coordinates: [number, number] }; destination: { coordinates: [number, number] }; destination_bearing: number }>) {
          // Use the first matching routine per user
          if (!routineCoords.has(r.user_id)) {
            routineCoords.set(r.user_id, {
              originLat: r.origin.coordinates[1],
              originLng: r.origin.coordinates[0],
              destLat: r.destination.coordinates[1],
              destLng: r.destination.coordinates[0],
              destBearing: r.destination_bearing,
            })
          }
        }
      }
    }

    // Step 4: check which schedules the current user already requested
    const userId = res.locals['userId'] as string
    const scheduleIds = filteredSchedules.map((s: Record<string, unknown>) => s['id'] as string)
    const requestedSet = new Set<string>()

    const rideStatusMap = new Map<string, { status: string; ride_id: string }>()

    if (userId && scheduleIds.length > 0) {
      const { data: userRides } = await supabaseAdmin
        .from('rides')
        .select('schedule_id, id, status')
        .in('schedule_id', scheduleIds)
        .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
        .not('status', 'in', '("cancelled","completed")')

      if (userRides) {
        for (const r of userRides as Array<{ schedule_id: string; id: string; status: string }>) {
          requestedSet.add(r.schedule_id)
          rideStatusMap.set(r.schedule_id, { status: r.status, ride_id: r.id })
        }
      }
    }

    // Build rides with optional relevance_score
    const rides = filteredSchedules.map((s: Record<string, unknown>) => {
      const uid = s['user_id'] as string
      const poster = userMap.get(uid) ?? null
      let relevanceScore = 0

      const coords = routineCoords.get(uid)

      // Proximity score: closer = higher score (max 40 points)
      if (hasLocation && coords) {
        const distM = haversineMetres(userLat, userLng, coords.originLat, coords.originLng)
        const distKm = distM / 1000
        // Within 15km gets full points, decays linearly to 0 at 100km
        relevanceScore += Math.max(0, 40 * (1 - distKm / 100))
      }

      // Bearing score: similar direction = higher score (max 30 points)
      if (hasDest && coords) {
        const userBearing = calculateBearing(userLat, userLng, destLat, destLng)
        const diff = bearingDifference(userBearing, coords.destBearing)
        // Within 60° gets full points, decays to 0 at 180°
        relevanceScore += Math.max(0, 30 * (1 - diff / 180))
      }

      // Time score: closer time = higher score (max 30 points)
      if (userTime) {
        const tripTime = s['trip_time'] as string
        const timeDiff = timeDifferenceMinutes(userTime, tripTime)
        // Within 30 min gets full points, decays to 0 at 180 min
        relevanceScore += Math.max(0, 30 * (1 - timeDiff / 180))
      }

      const schedId = s['id'] as string
      const rideInfo = rideStatusMap.get(schedId)
      return {
        ...s,
        poster,
        relevance_score: Math.round(relevanceScore),
        already_requested: requestedSet.has(schedId),
        ride_status: rideInfo?.status ?? null,
        ride_id: rideInfo?.ride_id ?? null,
        // Include driver's route coords for transit preview (if available)
        driver_origin_lat: coords?.originLat ?? null,
        driver_origin_lng: coords?.originLng ?? null,
        driver_dest_lat: coords?.destLat ?? null,
        driver_dest_lng: coords?.destLng ?? null,
      }
    })

    // Sort by relevance score (descending) if scoring was applied, else keep chronological
    if (hasLocation || hasDest || userTime) {
      rides.sort((a, b) => b.relevance_score - a.relevance_score)
    }

    res.status(200).json({ rides })
  },
)

interface NotifyBody {
  origin_place_id: string
  dest_place_id: string
  trip_date: string
  trip_time: string
  time_type: 'departure' | 'arrival'
  /** When true the poster is flexible on time — skip time-window matching. */
  time_flexible?: boolean
  mode: 'driver' | 'rider'
  origin_lat?: number
  origin_lng?: number
  dest_lat?: number
  dest_lng?: number
}

/**
 * Returns the angular difference between two bearings, normalised to [0, 180].
 */
function bearingDifference(a: number, b: number): number {
  const diff = Math.abs(((a - b + 540) % 360) - 180)
  return diff
}

/**
 * Returns the absolute difference in minutes between two HH:MM:SS time strings.
 */
function timeDifferenceMinutes(a: string, b: string): number {
  const toMin = (t: string): number => {
    const parts = t.split(':')
    return parseInt(parts[0] ?? '0', 10) * 60 + parseInt(parts[1] ?? '0', 10)
  }
  const diff = Math.abs(toMin(a) - toMin(b))
  return Math.min(diff, 1440 - diff) // handle wrap-around midnight
}

/**
 * Calculate bearing from point A to point B (degrees, [0, 360)).
 * Duplicated from src/lib/geo.ts to avoid cross-boundary import.
 */
function calculateBearing(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = Math.PI / 180
  const toDeg = 180 / Math.PI
  const φ1 = lat1 * toRad
  const φ2 = lat2 * toRad
  const Δλ = (lng2 - lng1) * toRad
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * toDeg) + 360) % 360
}

/**
 * POST /api/schedule/notify
 *
 * Called after a rider saves a schedule. Finds matching drivers and sends push.
 *
 * Matching strategy:
 *   Stage 3 — if a driver has a saved routine in `driver_routines`:
 *     1. destination_bearing within 60° of the rider's bearing
 *     2. Scheduled time matches within 30 minutes
 *
 *   Stage 2 fallback — for drivers without a saved routine:
 *     Use `nearby_active_drivers` RPC (15km radius)
 *
 * Combines both sets and sends FCM to all matched driver tokens.
 */
scheduleRouter.post(
  '/notify',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as NotifyBody
    // The JWT-authed user is the POSTER. Never push to themselves —
    // their own driver_routine matches their own bearing+time, which
    // would otherwise add their user_id to stage3DriverIds and ping
    // their own phone with "A driver has a trip…" right after they
    // posted. Bug reported 2026-04-28.
    const posterUserId = res.locals['userId'] as string

    if (!body.origin_place_id || !body.dest_place_id || !body.trip_date || !body.trip_time) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'origin_place_id, dest_place_id, trip_date, and trip_time are required' },
      })
      return
    }

    // Calculate rider's bearing if coordinates provided
    let riderBearing: number | null = null
    if (
      body.origin_lat != null && body.origin_lng != null &&
      body.dest_lat != null && body.dest_lng != null
    ) {
      riderBearing = calculateBearing(
        body.origin_lat, body.origin_lng,
        body.dest_lat, body.dest_lng,
      )
    }

    // ── Stage 3: query routines belonging to the OPPOSITE role ──────────
    //
    // Semantics: when a rider posts a needs-ride (mode='rider'), we
    // notify drivers whose routines fit. When a driver posts a trip
    // (mode='driver'), we notify riders whose routines fit. The
    // `driver_routines` table itself is mode-agnostic (it stores
    // everyone's routes); we filter by joining to `users.is_driver`.
    //
    // Bug surfaced 2026-04-28: prior version always queried for
    // drivers regardless of body.mode, so a driver posting a trip
    // got matched against other drivers (and themselves — see the
    // posterUserId guard).
    const targetIsDriver = body.mode === 'rider' // rider posts → match drivers

    const { data: routines, error: routineErr } = await supabaseAdmin
      .from('driver_routines')
      .select('user_id, destination_bearing, departure_time, arrival_time, users!inner(is_driver)')
      .eq('is_active', true)
      .eq('users.is_driver', targetIsDriver)

    if (routineErr) {
      next(routineErr)
      return
    }

    const stage3UserIds = new Set<string>()

    for (const routine of routines ?? []) {
      // Skip the poster's own routine — they shouldn't be matched
      // against their own post.
      if (routine.user_id === posterUserId) continue

      // Bearing check: only applies when rider bearing is available
      if (riderBearing !== null) {
        const diff = bearingDifference(routine.destination_bearing, riderBearing)
        if (diff > 60) continue
      }

      // Time check: scheduled time within 30 minutes. Skipped when the poster
      // is flexible on time — otherwise an "anytime" post would never match
      // any driver whose routine runs outside a 30-minute window of noon.
      if (!body.time_flexible) {
        const routineTime = routine.departure_time ?? routine.arrival_time
        if (!routineTime) continue

        const timeDiff = timeDifferenceMinutes(body.trip_time, routineTime)
        if (timeDiff > 30) continue
      }

      stage3UserIds.add(routine.user_id)
    }

    // ── Stage 2 fallback: nearby active drivers ─────────────────────────
    //
    // Only meaningful for rider-mode posts — driver-mode posts have
    // no equivalent "nearby riders" RPC, and the targets are riders
    // anyway. Stage 2 stays driver-side only.

    const stage2UserIds = new Set<string>()

    if (body.mode === 'rider' && body.origin_lat != null && body.origin_lng != null) {
      const { data: nearbyRows, error: nearbyErr } = await supabaseAdmin.rpc(
        'nearby_active_drivers',
        {
          origin_lng: body.origin_lng,
          origin_lat: body.origin_lat,
        },
      )

      if (!nearbyErr && Array.isArray(nearbyRows)) {
        for (const row of nearbyRows as Array<{ user_id: string }>) {
          // Skip the poster — same reason as Stage 3.
          if (row.user_id === posterUserId) continue
          // Only add Stage 2 users who don't already appear in Stage 3
          if (!stage3UserIds.has(row.user_id)) {
            stage2UserIds.add(row.user_id)
          }
        }
      }
    }

    // ── Combine and send notifications ──────────────────────────────────

    const allUserIds = [...stage3UserIds, ...stage2UserIds]

    if (allUserIds.length === 0) {
      res.status(200).json({
        notified: 0,
        stage3_count: 0,
        stage2_count: 0,
      })
      return
    }

    const { data: tokenRows } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .in('user_id', allUserIds)

    const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)

    // Body copy reads naturally on the recipient's side: a rider
    // gets "A driver has a trip…", a driver gets "A rider needs a
    // ride…". Without this branch the driver-mode push reads as the
    // poster's own role instead of "what's available to you".
    const recipientFacingActor = body.mode === 'driver' ? 'driver' : 'rider'
    const recipientFacingBody = body.mode === 'driver'
      ? `A driver has a trip on ${body.trip_date} — check TAGO.`
      : `A rider needs a ride on ${body.trip_date} — check TAGO.`

    const notifiedCount = await sendFcmPush(tokens, {
      title: 'Scheduled ride match',
      body: recipientFacingBody,
      data: {
        type: 'schedule_match',
        trip_date: body.trip_date,
        trip_time: body.trip_time,
        actor_role: recipientFacingActor,
      },
    })

    // Log for observability
    console.log(JSON.stringify({
      type: 'schedule_notify',
      poster_mode: body.mode,
      stage3_count: stage3UserIds.size,
      stage2_count: stage2UserIds.size,
      users_notified: notifiedCount,
    }))

    res.status(200).json({
      notified: notifiedCount,
      stage3_count: stage3UserIds.size,
      stage2_count: stage2UserIds.size,
    })
  },
)

// ── POST /api/schedule/request ───────────────────────────────────────────────
/**
 * Creates a ride from a ride_schedule board posting.
 *
 * The ride is created with status='requested' so the poster must accept.
 * Sends FCM push + Realtime broadcast to the poster. The requester
 * stays on a "waiting for response" state until the poster accepts/declines.
 */

interface ScheduleRequestBody {
  schedule_id: string
  origin_lat?: number
  origin_lng?: number
  origin_name?: string
  destination_lat?: number
  destination_lng?: number
  destination_name?: string
  destination_flexible?: boolean
  note?: string
  // Set when the rider explicitly chose "drop me at driver's destination"
  // in the confirm sheet. Server pre-confirms the dropoff so the driver
  // doesn't have to re-suggest the same endpoint in chat.
  dropoff_at_driver_destination?: boolean
  // Optional client-computed fare estimate (cents). When the rider's wallet
  // balance ≥ this estimate we let the request through even without a
  // saved card — Phase 3a wallet-first parity with /api/rides/request.
  estimated_fare_cents?: number
}

scheduleRouter.post(
  '/request',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const body = req.body as ScheduleRequestBody

    if (!body.schedule_id) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'schedule_id is required' },
      })
      return
    }

    // Fetch the schedule
    const { data: schedule, error: schedErr } = await supabaseAdmin
      .from('ride_schedules')
      .select('*')
      .eq('id', body.schedule_id)
      .single()

    if (schedErr || !schedule) {
      res.status(404).json({
        error: { code: 'SCHEDULE_NOT_FOUND', message: 'Schedule not found' },
      })
      return
    }

    // Reject if no seats available
    if (schedule.available_seats != null && schedule.available_seats <= 0) {
      res.status(409).json({
        error: { code: 'NO_SEATS', message: 'This ride is full — no seats available' },
      })
      return
    }

    // Reject if seats are locked (a ride already started for this schedule)
    if (schedule.seats_locked) {
      res.status(409).json({
        error: { code: 'SEATS_LOCKED', message: 'This ride has already started' },
      })
      return
    }

    // Cannot request your own posted ride
    if (schedule.user_id === userId) {
      res.status(400).json({
        error: { code: 'OWN_SCHEDULE', message: 'You cannot request your own posted ride' },
      })
      return
    }

    // Prevent duplicate requests — check if this user already has a non-cancelled ride for this schedule
    const { data: existingRides } = await supabaseAdmin
      .from('rides')
      .select('id, status')
      .eq('schedule_id', body.schedule_id)
      .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
      .not('status', 'in', '("cancelled","completed")')
      .limit(1)

    if (existingRides && existingRides.length > 0) {
      res.status(409).json({
        error: { code: 'DUPLICATE_REQUEST', message: 'You already have a pending request for this ride' },
      })
      return
    }

    // Determine rider and driver based on who posted what
    let riderId: string
    let driverId: string

    if (schedule.mode === 'driver') {
      // Poster is offering a ride → requester is the rider
      riderId = userId
      driverId = schedule.user_id
    } else {
      // Poster needs a ride → requester is offering to drive
      // BUG-050: Verify requester is actually a driver
      const { data: reqUser } = await supabaseAdmin
        .from('users')
        .select('is_driver')
        .eq('id', userId)
        .single()

      if (!reqUser?.is_driver) {
        res.status(403).json({
          error: { code: 'NOT_A_DRIVER', message: 'You must be a registered driver to offer rides' },
        })
        return
      }

      riderId = schedule.user_id
      driverId = userId
    }

    // Server-side card precondition on the rider. The charge runs after the
    // ride completes, so we refuse to create a ride whose rider has no card.
    // Two distinct cases — distinguished by error code so the client can react
    // correctly:
    //   NO_PAYMENT_METHOD       — the requester *is* the rider (driver-post)
    //                             and needs to add their own card; redirect.
    //   RIDER_NO_PAYMENT_METHOD — the requester is offering to drive a
    //                             rider-post whose poster has no card; do
    //                             NOT redirect the driver to /payment/add.
    //
    // Use the shared self-healing helper. The previous inline version
    // null-out'd the cached column when stripe.retrieve() failed for any
    // reason (including transient errors) which caused users with valid
    // saved cards to start seeing "Add a payment method" — the exact bug
    // that produced duplicate cards when they re-added.
    const { data: riderPaymentRow } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id, default_payment_method_id, wallet_balance')
      .eq('id', riderId)
      .single()

    let effectiveDefaultPm: string | null = null
    if (riderPaymentRow?.stripe_customer_id) {
      effectiveDefaultPm = await resolveAndPersistDefaultPm(
        riderId,
        riderPaymentRow.stripe_customer_id as string,
        (riderPaymentRow.default_payment_method_id as string | null) ?? null,
      )
    }

    // Wallet-first parity with /api/rides/request: allow the request through
    // when the rider's wallet alone covers the client-supplied fare estimate
    // — even without a card. Otherwise we still require a card on file
    // (the wallet may only partially cover, in which case the card is
    // needed for the shortfall). When the requester is the driver
    // (rider-posted board ride), we still gate on the rider's payment.
    const riderWalletCents = (riderPaymentRow?.wallet_balance as number | null) ?? 0
    const estimatedFareCents = body.estimated_fare_cents ?? 0
    const walletCoversEstimate = estimatedFareCents > 0 && riderWalletCents >= estimatedFareCents
    const hasCardOnFile = !!riderPaymentRow?.stripe_customer_id && !!effectiveDefaultPm

    if (!walletCoversEstimate && !hasCardOnFile) {
      const isSelf = riderId === userId
      res.status(400).json({
        error: {
          code: isSelf ? 'NO_PAYMENT_METHOD' : 'RIDER_NO_PAYMENT_METHOD',
          message: isSelf
            ? 'Add a payment method or top up your wallet before requesting a ride.'
            : 'This rider hasn’t set up payment yet — try a different post.',
        },
      })
      return
    }

    // Build origin GeoPoint. `ride.origin` represents the rider's pickup
    // location, NOT whichever party tapped "request". So when the rider is
    // the requester (driver posted), the requester's body coords are the
    // rider's pickup. When the driver is the requester (rider posted), the
    // requester's coords belong to the DRIVER and must be ignored — the
    // pickup comes from the poster (rider) via the routine/schedule fallback
    // below. Without this branch, ride.origin ends up at the driver's home,
    // and the chat's "Suggest Pickup" pin starts on the driver's address.
    let originGeo: { type: 'Point'; coordinates: [number, number] } | null = null

    if (schedule.mode === 'driver') {
      if (typeof body.origin_lat === 'number' && typeof body.origin_lng === 'number') {
        originGeo = { type: 'Point', coordinates: [body.origin_lng, body.origin_lat] }
      } else {
        // Fallback: requester's home_location from profile (requester is the rider here)
        const { data: reqProfile } = await supabaseAdmin
          .from('users')
          .select('home_location')
          .eq('id', userId)
          .single()
        if (reqProfile?.home_location) {
          const hl = reqProfile.home_location as { coordinates: [number, number] }
          originGeo = { type: 'Point', coordinates: hl.coordinates }
        }
      }
    }

    // Build destination GeoPoint from poster's routine when available.
    // If this lookup fails, continue with geocode fallbacks instead of failing the request.
    let destGeo: { type: 'Point'; coordinates: [number, number] } | null = null
    let posterRoutine: { origin?: { coordinates: [number, number] }; destination?: { coordinates: [number, number] } } | null = null

    try {
      const routineResp = await supabaseAdmin
        .from('driver_routines')
        .select('origin, destination')
        .eq('user_id', schedule.user_id)
        .eq('route_name', schedule.route_name)
        .eq('is_active', true)
        .limit(1)
        .single()

      posterRoutine = (routineResp.data as { origin?: { coordinates: [number, number] }; destination?: { coordinates: [number, number] } } | null) ?? null
    } catch {
      posterRoutine = null
    }

    if (posterRoutine?.destination) {
      const dest = posterRoutine.destination
      destGeo = { type: 'Point', coordinates: dest.coordinates }
    }

    // If still no origin, use poster's routine origin or forward-geocode the schedule address
    if (!originGeo) {
      if (posterRoutine?.origin) {
        const orig = posterRoutine.origin
        originGeo = { type: 'Point', coordinates: orig.coordinates }
      } else {
        const resolved = await forwardGeocode(schedule.origin_address as string)
        if (resolved) originGeo = { type: 'Point', coordinates: [resolved.lng, resolved.lat] }
      }
    }

    // If still no dest, forward-geocode the schedule dest address
    if (!destGeo) {
      const resolved = await forwardGeocode(schedule.dest_address as string)
      if (resolved) destGeo = { type: 'Point', coordinates: [resolved.lng, resolved.lat] }
    }

    // Final fallback — should rarely happen now
    if (!originGeo) {
      originGeo = { type: 'Point', coordinates: [0, 0] }
    }

    // Build requester destination from body fields
    let requesterDestGeo: { type: 'Point'; coordinates: [number, number] } | null = null
    if (typeof body.destination_lat === 'number' && typeof body.destination_lng === 'number') {
      requesterDestGeo = { type: 'Point', coordinates: [body.destination_lng, body.destination_lat] }
    }

    // Truncate note to 200 chars
    const requesterNote = body.note ? body.note.slice(0, 200) : null

    // Pre-confirm the dropoff when the rider explicitly chose "drop me at
    // driver's destination" — there's nothing to negotiate, the endpoint
    // is already agreed. Without this the chat starts with both dots
    // yellow, the driver gets pushed into Suggest Dropoff for an endpoint
    // they themselves posted, and the rider waits for a redundant accept.
    // Slice 9.5 (2026-04-30) — rider-posted rides also pre-confirm
    // both pickup AND dropoff at offer-accept time. Driver's act of
    // offering = implicit agreement to the rider's posted points;
    // both green from start, no friction. The chat keeps a "Change
    // pickup / dropoff" affordance so either party can re-negotiate
    // up until the ride flips to active. Reverses the prior 9.4
    // "two proposals" decision after Tarun's CTO review (re-suggest
    // post-confirm covers the change-of-mind case more cleanly).
    const isRiderPostedRide = schedule.mode === 'rider'
    const preConfirmDropoff = (
      body.dropoff_at_driver_destination === true || isRiderPostedRide
    ) && destGeo != null
    const dropoffPreconfirmFields: Record<string, unknown> = preConfirmDropoff
      ? { dropoff_point: destGeo, dropoff_confirmed: true }
      : {}

    // Slice 9.4 (2026-04-30) — pre-confirm pickup ONLY when the rider's
    // chosen pickup is at (or within ~50m of) the driver's posted
    // origin. Cases:
    //   • Same-spot pickup → no negotiation needed → pre-confirm,
    //     audit-trail `location_accepted` message inserted.
    //   • Custom pickup (rider asked to be picked up elsewhere) →
    //     stays unconfirmed and a `pickup_suggestion` message is
    //     inserted attributed to the rider, so the driver sees an
    //     Accept / Counter card in chat. Closes the case-3/4 gap
    //     surfaced by Tarun on 2026-04-30 ("driver auto-confirmed a
    //     pickup spot they never agreed to").
    //
    // Earlier behaviour (Slice 9.1.1) pre-confirmed pickup
    // unconditionally to keep chats clean; this revision restores
    // symmetry with dropoff: if the rider deviated from the posted
    // route, the driver gets a chance to Accept or Counter.
    const driverOriginGeo = posterRoutine?.origin
      ? { type: 'Point' as const, coordinates: posterRoutine.origin.coordinates }
      : null
    const pickupSameAsDriverOrigin = !!(originGeo && driverOriginGeo
      && haversineMetres(
        originGeo.coordinates[1], originGeo.coordinates[0],
        driverOriginGeo.coordinates[1], driverOriginGeo.coordinates[0],
      ) <= 50)
    // Pickup pre-confirm: same-spot match (driver-posted) OR rider-
    // posted (driver implicitly agrees to rider's posted pickup).
    const preConfirmPickup = originGeo != null && (
      (schedule.mode === 'driver' && pickupSameAsDriverOrigin)
      || isRiderPostedRide
    )
    const pickupPreconfirmFields: Record<string, unknown> = preConfirmPickup
      ? { pickup_point: originGeo, pickup_confirmed: true }
      : {}

    // Create ride with status='requested' — poster must accept before coordination
    const { data: ride, error: rideErr } = await supabaseAdmin
      .from('rides')
      .insert({
        rider_id: riderId,
        driver_id: driverId,
        origin: originGeo,
        // Same reasoning as origin coords: origin_name describes the rider's
        // pickup, so when the requester is the driver we must use the
        // schedule's address rather than the driver's pickup name.
        origin_name: schedule.mode === 'driver'
          ? (body.origin_name ?? null)
          : (schedule.origin_address ?? null),
        ...(destGeo ? { destination: destGeo } : {}),
        destination_name: schedule.dest_address,
        status: 'requested',
        schedule_id: schedule.id,
        trip_date: schedule.trip_date,
        trip_time: schedule.trip_time,
        // Mirror the parent schedule's time_flexible flag so the
        // reminder + expiry cron paths can branch correctly. Without
        // this the cron treats the '12:00:00' Anytime placeholder as
        // a literal trip time (migration 059).
        time_flexible: schedule.time_flexible === true,
        requester_destination: requesterDestGeo,
        requester_destination_name: body.destination_name ?? null,
        requester_note: requesterNote,
        destination_flexible: body.destination_flexible ?? false,
        ...dropoffPreconfirmFields,
        ...pickupPreconfirmFields,
      })
      .select('id')
      .single()

    if (rideErr || !ride) {
      next(rideErr ?? new Error('Failed to create ride'))
      return
    }

    // Slice I (2026-04-28) — the missing half of `0d2033c`. When the
    // dropoff was pre-confirmed at request time (rider chose "Drop
    // me at driver's destination"), insert a `location_accepted`
    // message so the chat opens with an audit-trail line explaining
    // the green dot. Mirrors the `messages` shape in
    // `POST /api/rides/:id/confirm-direct-dropoff` so the existing
    // chat renderers (web + iOS) handle it without any client work.
    if (preConfirmDropoff && destGeo) {
      const presetSenderId = userId  // the requester — rider on driver-post, driver on rider-post
      const dropoffName = schedule.dest_address ?? body.destination_name ?? null
      const { data: agreementMsg, error: msgErr } = await supabaseAdmin
        .from('messages')
        .insert({
          ride_id: ride.id,
          sender_id: presetSenderId,
          content: 'Dropoff agreed at the posted destination',
          type: 'location_accepted',
          meta: {
            location_type: 'dropoff',
            accepted_by: presetSenderId,
            lat: destGeo.coordinates[1],
            lng: destGeo.coordinates[0],
            name: dropoffName ?? undefined,
            direct_dropoff: true,
            pre_confirmed_at_request: true,
          },
        })
        .select('id, ride_id, sender_id, content, type, meta, created_at')
        .single()

      if (msgErr) {
        console.error('Failed to insert pre-confirm chat message:', msgErr.message)
      } else if (agreementMsg) {
        // Broadcast to chat channels so any open subscriber updates
        // immediately. The poster joins the chat after acceptance —
        // they'll see the message either via the realtime broadcast
        // or via the `messages` SELECT on chat-mount.
        void realtimeBroadcast(`chat:${ride.id}`, 'new_message', agreementMsg as Record<string, unknown>)
        void realtimeBroadcast(`chat-badge:${ride.id}`, 'new_message', agreementMsg as Record<string, unknown>)
      }
    }

    // Slice 9.1 (2026-04-30) — when the dropoff is NOT pre-confirmed
    // (rider chose a custom destination different from the driver's
    // posted destination), insert a `dropoff_suggestion` message
    // attributed to the requester so the chat opens with a real
    // proposal card the other party can Accept or Counter. Without
    // this both sides would see "Dropoff pending" in the action bar
    // with no proposal anywhere — surfaced 2026-04-30 by Tarun.
    //
    // Same shape PickupProposalCard / DropoffProposalCard already
    // render — `proposed_by` matches what `POST /api/rides/:id/propose-pickup`
    // and the transit-dropoff path already write, so the existing
    // chat renderers handle it without client work. Driver sees
    // Accept / Counter on the rider's senderID; rider sees their own
    // proposal without the buttons.
    if (!preConfirmDropoff && requesterDestGeo) {
      const proposerId = userId  // requester — rider on driver-post, driver on rider-post
      const dropoffName = body.destination_name ?? schedule.dest_address ?? 'the requested destination'
      const { data: dropoffMsg, error: dErr } = await supabaseAdmin
        .from('messages')
        .insert({
          ride_id: ride.id,
          sender_id: proposerId,
          content: `Drop-off at ${dropoffName}`,
          type: 'dropoff_suggestion',
          meta: {
            lat: requesterDestGeo.coordinates[1],
            lng: requesterDestGeo.coordinates[0],
            name: dropoffName,
            proposed_by: proposerId,
          },
        })
        .select('id, ride_id, sender_id, content, type, meta, created_at')
        .single()

      if (dErr) {
        console.error('Failed to insert dropoff_suggestion at request time:', dErr.message)
      } else if (dropoffMsg) {
        void realtimeBroadcast(`chat:${ride.id}`, 'new_message', dropoffMsg as Record<string, unknown>)
        void realtimeBroadcast(`chat-badge:${ride.id}`, 'new_message', dropoffMsg as Record<string, unknown>)
      }
    }

    // Slice 9.1.1 (2026-04-30) — pickup is pre-confirmed at request
    // time (see `preConfirmPickup` block above) instead of getting a
    // proposal card. Insert a `location_accepted` audit-trail message
    // so the chat opens with a green-pickup-dot indicator + a system
    // line explaining the agreement, mirroring the Slice I dropoff
    // pattern. If the driver wants to negotiate the pickup spot they
    // can still tap the "Suggest Pickup" chip in the chat action bar
    // — that uses the existing `propose-pickup` flow.
    if (preConfirmPickup && originGeo) {
      const presetSenderId = userId  // requester (rider)
      const pickupName = body.origin_name ?? 'the rider\'s requested pickup'
      const { data: pickupAck, error: pErr } = await supabaseAdmin
        .from('messages')
        .insert({
          ride_id: ride.id,
          sender_id: presetSenderId,
          content: 'Pickup agreed at the rider\'s requested point',
          type: 'location_accepted',
          meta: {
            location_type: 'pickup',
            accepted_by: presetSenderId,
            lat: originGeo.coordinates[1],
            lng: originGeo.coordinates[0],
            name: pickupName,
            pre_confirmed_at_request: true,
          },
        })
        .select('id, ride_id, sender_id, content, type, meta, created_at')
        .single()

      if (pErr) {
        console.error('Failed to insert pickup pre-confirm chat message:', pErr.message)
      } else if (pickupAck) {
        void realtimeBroadcast(`chat:${ride.id}`, 'new_message', pickupAck as Record<string, unknown>)
        void realtimeBroadcast(`chat-badge:${ride.id}`, 'new_message', pickupAck as Record<string, unknown>)
      }
    }

    // Slice 9.4 (2026-04-30) — custom-pickup case (rider asked to be
    // picked up at a different spot than the driver's posted origin).
    // Insert a `pickup_suggestion` message attributed to the rider so
    // the driver sees an Accept / Counter card in chat. Symmetric
    // with the dropoff_suggestion path. Skips when the pickup was
    // pre-confirmed (same-spot case handled above).
    if (!preConfirmPickup && originGeo && schedule.mode === 'driver') {
      const proposerId = userId  // requester (rider)
      const pickupName = body.origin_name ?? 'the rider\'s requested pickup'
      const { data: pickupMsg, error: pmErr } = await supabaseAdmin
        .from('messages')
        .insert({
          ride_id: ride.id,
          sender_id: proposerId,
          content: `Pickup at ${pickupName}`,
          type: 'pickup_suggestion',
          meta: {
            lat: originGeo.coordinates[1],
            lng: originGeo.coordinates[0],
            name: pickupName,
            proposed_by: proposerId,
          },
        })
        .select('id, ride_id, sender_id, content, type, meta, created_at')
        .single()

      if (pmErr) {
        console.error('Failed to insert pickup_suggestion at request time:', pmErr.message)
      } else if (pickupMsg) {
        void realtimeBroadcast(`chat:${ride.id}`, 'new_message', pickupMsg as Record<string, unknown>)
        void realtimeBroadcast(`chat-badge:${ride.id}`, 'new_message', pickupMsg as Record<string, unknown>)
      }
    }

    // Slice 9.5 (2026-04-30) — rider-posted rides now use the
    // pre-confirm path above (both pickup + dropoff auto-confirmed
    // via `preConfirmPickup`/`preConfirmDropoff` gates). The earlier
    // 9.4 "two proposals at offer-accept time" was reversed after
    // CTO review: auto-confirm + chat-level "Change pickup / dropoff"
    // affordance is cleaner than forcing two Accept taps up front.

    // Fetch requester's name for the notification
    const { data: requester } = await supabaseAdmin
      .from('users')
      .select('full_name')
      .eq('id', userId)
      .single()

    const requesterName = requester?.full_name ?? 'Someone'
    const actionLabel = schedule.mode === 'driver'
      ? `${requesterName} wants to join your ride`
      : `${requesterName} offered to drive you`

    // Broadcast via Realtime to poster (non-blocking)
    void realtimeBroadcast(`board:${schedule.user_id}`, 'board_request', {
      type: 'board_request',
      ride_id: ride.id,
      schedule_id: schedule.id,
      requester_name: requesterName,
      message: actionLabel,
      route: `${schedule.origin_address} → ${schedule.dest_address}`,
      trip_date: schedule.trip_date,
      trip_time: schedule.trip_time,
      requester_destination_name: body.destination_name ?? null,
      destination_flexible: body.destination_flexible ?? false,
      requester_note: requesterNote,
    })

    // Persist notification in the notifications table (non-blocking)
    const notifTitle = 'Ride Board Request'
    supabaseAdmin.from('notifications').insert({
      user_id: schedule.user_id,
      type: 'board_request',
      title: notifTitle,
      body: actionLabel,
      data: {
        ride_id: ride.id,
        schedule_id: schedule.id,
        requester_name: requesterName,
        route: `${schedule.origin_address} → ${schedule.dest_address}`,
        trip_date: schedule.trip_date,
        trip_time: schedule.trip_time,
        requester_destination_name: body.destination_name ?? null,
        destination_flexible: body.destination_flexible ?? false,
        requester_note: requesterNote,
      },
    }).then(({ error: notifErr }) => {
      if (notifErr) console.error('Failed to persist notification:', notifErr.message)
    })

    // Send FCM push notification to the poster
    const { data: tokenRows } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', schedule.user_id)

    const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)

    if (tokens.length > 0) {
      await sendFcmPush(tokens, {
        title: notifTitle,
        body: actionLabel,
        data: {
          type: 'board_request',
          ride_id: ride.id,
          schedule_id: schedule.id,
          requester_name: requesterName,
        },
        // iOS: surface Accept / Decline buttons on the lock-screen
        // banner. Category id matches `PushManager.boardRequestCategory`.
        category: 'BOARD_REQUEST',
      })
    }

    console.log(JSON.stringify({
      type: 'schedule_request',
      schedule_id: schedule.id,
      ride_id: ride.id,
      rider_id: riderId,
      driver_id: driverId,
      requester_id: userId,
    }))

    res.status(201).json({ ride_id: ride.id })
  },
)

// ── DELETE /api/schedule/:id ─────────────────────────────────────────────────
/**
 * Delete a ride schedule posting. Only the poster can delete.
 * Also cancels any 'requested' rides linked to this schedule.
 */
scheduleRouter.delete(
  '/:id',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const scheduleId = req.params['id'] as string

    // Fetch the schedule. Pull origin_place_id + trip_date so we can
    // detect routine-projected rows ('routine:{id}' prefix) and
    // tombstone the date on the parent routine — without that, the
    // next sync resurrects the row the user just deleted.
    const { data: schedule, error: fetchErr } = await supabaseAdmin
      .from('ride_schedules')
      .select('id, user_id, origin_place_id, trip_date')
      .eq('id', scheduleId)
      .single()

    if (fetchErr || !schedule) {
      res.status(404).json({
        error: { code: 'SCHEDULE_NOT_FOUND', message: 'Schedule not found' },
      })
      return
    }

    if (schedule.user_id !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You can only delete your own schedules' },
      })
      return
    }

    // Routine-projected rows carry origin_place_id = `routine:{id}`.
    // Append trip_date to that routine's skip_dates so the next
    // sync-routines run won't re-create this exact date. Migration
    // 057 added the column. Best-effort — DB error here only affects
    // the resurrection-prevention; the underlying delete still goes
    // through.
    const originPlaceID = schedule.origin_place_id as string | null
    const routineMatch = originPlaceID?.match(/^routine:([0-9a-f-]+)/i)
    if (routineMatch && schedule.trip_date) {
      const routineID = routineMatch[1]
      const tripDate = schedule.trip_date as string
      const { data: routineRow } = await supabaseAdmin
        .from('driver_routines')
        .select('skip_dates')
        .eq('id', routineID)
        .single()
      const existing = ((routineRow?.skip_dates as string[] | null) ?? [])
      if (!existing.includes(tripDate)) {
        const updated = [...existing, tripDate]
        const { error: skipErr } = await supabaseAdmin
          .from('driver_routines')
          .update({ skip_dates: updated })
          .eq('id', routineID)
        if (skipErr) {
          console.error('Failed to append routine skip_date:', skipErr.message)
        }
      }
    }

    // BUG-054: Cancel ALL non-completed, non-cancelled rides linked to this schedule
    const { data: linkedRides } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status')
      .eq('schedule_id', scheduleId)
      .not('status', 'in', '("cancelled","completed")')

    if (linkedRides && linkedRides.length > 0) {
      const rideIds = linkedRides.map((r: { id: string }) => r.id)
      await supabaseAdmin
        .from('rides')
        .update({ status: 'cancelled' })
        .in('id', rideIds)

      // Notify the other party for each cancelled ride
      for (const ride of linkedRides as Array<{ id: string; rider_id: string; driver_id: string; status: string }>) {
        const requesterId = ride.rider_id === userId ? ride.driver_id : ride.rider_id
        if (requesterId) {
          supabaseAdmin.from('notifications').insert({
            user_id: requesterId,
            type: 'board_declined',
            title: 'Ride Cancelled',
            body: 'The poster deleted their ride board posting.',
            data: { ride_id: ride.id },
          }).then(({ error: notifErr }) => {
            if (notifErr) console.error('Failed to persist cancel notification:', notifErr.message)
          })
          void realtimeBroadcast(`board:${requesterId}`, 'board_declined', { type: 'board_declined', ride_id: ride.id })
          void realtimeBroadcast(`myrides:${requesterId}`, 'ride_status_changed', { ride_id: ride.id, status: 'cancelled' })
        }
      }
    }

    // Delete the schedule
    const { error: deleteErr } = await supabaseAdmin
      .from('ride_schedules')
      .delete()
      .eq('id', scheduleId)

    if (deleteErr) {
      next(deleteErr)
      return
    }

    console.log(JSON.stringify({ type: 'schedule_delete', schedule_id: scheduleId, by: userId }))
    res.status(200).json({ deleted: true })
  },
)

// ── PATCH /api/schedule/accept-board ─────────────────────────────────────────
/**
 * Poster accepts a board ride request.
 *
 * Works for both cases:
 *   - Driver poster accepting a rider's request to join
 *   - Rider poster accepting a driver's offer to drive
 *
 * Sets status → 'accepted'. Does NOT overwrite rider_id or driver_id
 * (both are already set from the initial request). Broadcasts ride_accepted
 * to the requester and sends an FCM push.
 */
scheduleRouter.patch(
  '/accept-board',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const { ride_id: rideId } = req.body as { ride_id?: string }

    if (!rideId) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'ride_id is required' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status, destination_name, schedule_id, origin, origin_name')
      .eq('id', rideId)
      .single()

    if (fetchErr || !ride) {
      res.status(404).json({
        error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' },
      })
      return
    }

    // Verify caller is a participant
    if (ride.rider_id !== userId && ride.driver_id !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You are not a participant in this ride' },
      })
      return
    }

    // BUG-022: Verify caller is the original poster, not the requester.
    // The poster is the person who created the schedule. The requester is the
    // other party who sent the board request. Only the poster should accept.
    let sched: { user_id: string; seats_locked: boolean | null; dest_address: string | null } | null = null
    if (ride.schedule_id) {
      const { data: schedData } = await supabaseAdmin
        .from('ride_schedules')
        .select('user_id, seats_locked, dest_address')
        .eq('id', ride.schedule_id)
        .single()
      sched = schedData

      if (sched && sched.user_id !== userId) {
        res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Only the poster can accept board requests' },
        })
        return
      }

      if (sched?.seats_locked) {
        res.status(409).json({
          error: { code: 'SEATS_LOCKED', message: 'This ride has already started — no more riders can be accepted' },
        })
        return
      }
    }

    // BUG-052: Atomic update — only update if status is still 'requested'
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'coordinating' })
      .eq('id', rideId)
      .eq('status', 'requested')
      .select('id')

    if (updateErr) {
      next(updateErr)
      return
    }

    if (!updated || updated.length === 0) {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', expected 'requested'` },
      })
      return
    }

    // Write driver's destination from routine onto ride so DropoffSelection finds it
    if (ride.schedule_id && sched) {
      const { data: routine } = await supabaseAdmin
        .from('driver_routines')
        .select('destination')
        .eq('user_id', sched.user_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (routine?.destination) {
        void supabaseAdmin
          .from('rides')
          .update({
            driver_destination: routine.destination,
            driver_destination_name: sched.dest_address ?? null,
          })
          .eq('id', rideId)
      }
    }

    // Decrement available seats on the schedule.
    // Only auto-cancel remaining requests when seats reach 0 (multi-accept).
    // The .gt('available_seats', 0) guard prevents over-decrementing on concurrent accepts.
    if (ride.schedule_id) {
      const { data: seatSched } = await supabaseAdmin
        .from('ride_schedules')
        .select('available_seats')
        .eq('id', ride.schedule_id)
        .single()

      const seatsAfter = (seatSched?.available_seats != null && seatSched.available_seats > 0)
        ? seatSched.available_seats - 1
        : 0

      if (seatSched && seatSched.available_seats != null && seatSched.available_seats > 0) {
        await supabaseAdmin
          .from('ride_schedules')
          .update({ available_seats: seatsAfter })
          .eq('id', ride.schedule_id)
          .gt('available_seats', 0)
      }

      // Only auto-decline remaining requests when all seats are filled
      if (seatsAfter <= 0) {
        const { data: otherRides } = await supabaseAdmin
          .from('rides')
          .select('id, rider_id, driver_id')
          .eq('schedule_id', ride.schedule_id)
          .eq('status', 'requested')
          .neq('id', rideId)

        if (otherRides && otherRides.length > 0) {
          const otherIds = otherRides.map((r: { id: string }) => r.id)
          await supabaseAdmin
            .from('rides')
            .update({ status: 'cancelled' })
            .in('id', otherIds)

          // Notify each declined requester
          for (const other of otherRides as Array<{ id: string; rider_id: string; driver_id: string }>) {
            const declinedId = other.rider_id === userId ? other.driver_id : other.rider_id
            if (declinedId) {
              void realtimeBroadcast(`board:${declinedId}`, 'board_declined', { type: 'board_declined', ride_id: other.id })
              void realtimeBroadcast(`myrides:${declinedId}`, 'ride_status_changed', { ride_id: other.id, status: 'cancelled' })
              supabaseAdmin.from('notifications').insert({
                user_id: declinedId,
                type: 'board_declined',
                title: 'Request Declined',
                body: 'All seats are now filled. Try another ride on the board!',
                data: { ride_id: other.id },
              }).then(({ error: notifErr }) => {
                if (notifErr) console.error('Failed to persist auto-decline notification:', notifErr.message)
              })
              await sendBoardDeclinedPush(
                declinedId,
                other.id,
                'Request Declined',
                'All seats are now filled. Try another ride on the board!',
              )
            }
          }
        }
      }
    }

    // Mark the board_request notification as actioned so it doesn't show buttons again
    supabaseAdmin.from('notifications')
      .update({ type: 'board_request_actioned' })
      .eq('user_id', userId)
      .eq('type', 'board_request')
      .contains('data', { ride_id: rideId })
      .then(({ error: notifUpdateErr }) => {
        if (notifUpdateErr) console.error('Failed to mark notification actioned:', notifUpdateErr.message)
      })

    // Determine the requester (other party) to notify
    const requesterId = userId === ride.rider_id ? ride.driver_id : ride.rider_id
    if (!requesterId) {
      res.status(200).json({ ride_id: rideId, status: 'coordinating' })
      return
    }

    // Broadcast ride_accepted to requester via Realtime
    void realtimeBroadcast(`board:${requesterId}`, 'board_accepted', { type: 'board_accepted', ride_id: rideId })

    // Send FCM push + persistent notification to requester
    const { data: poster } = await supabaseAdmin
      .from('users')
      .select('full_name')
      .eq('id', userId)
      .single()

    const acceptTitle = 'Ride Accepted!'
    const acceptBody = `${poster?.full_name ?? 'Your match'} accepted — coordinate your ride now.`

    // Persist notification (non-blocking)
    if (requesterId) {
      supabaseAdmin.from('notifications').insert({
        user_id: requesterId,
        type: 'board_accepted',
        title: acceptTitle,
        body: acceptBody,
        data: { ride_id: rideId },
      }).then(({ error: notifErr }) => {
        if (notifErr) console.error('Failed to persist accept notification:', notifErr.message)
      })
    }

    const { data: tokenRows } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', requesterId)

    const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)
    if (tokens.length > 0) {
      await sendFcmPush(tokens, {
        title: acceptTitle,
        body: acceptBody,
        data: { type: 'board_accepted', ride_id: rideId },
      })
    }

    // Refresh both parties' MyRides pages
    if (requesterId) {
      void realtimeBroadcast(`myrides:${requesterId}`, 'ride_status_changed', { ride_id: rideId, status: 'coordinating' })
    }
    void realtimeBroadcast(`myrides:${userId}`, 'ride_status_changed', { ride_id: rideId, status: 'coordinating' })

    console.log(JSON.stringify({ type: 'board_accept', ride_id: rideId, accepted_by: userId }))
    res.status(200).json({ ride_id: rideId, status: 'coordinating' })
  },
)

// ── PATCH /api/schedule/decline-board ────────────────────────────────────────
/**
 * Poster declines a board ride request.
 * Sets status → 'cancelled'. Notifies the requester so they can try another.
 */
scheduleRouter.patch(
  '/decline-board',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const { ride_id: rideId } = req.body as { ride_id?: string }

    if (!rideId) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'ride_id is required' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status')
      .eq('id', rideId)
      .single()

    if (fetchErr || !ride) {
      res.status(404).json({
        error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' },
      })
      return
    }

    if (ride.rider_id !== userId && ride.driver_id !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You are not a participant in this ride' },
      })
      return
    }

    // BUG-052: Atomic update — only cancel if status is still 'requested'
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'cancelled' })
      .eq('id', rideId)
      .eq('status', 'requested')
      .select('id')

    if (updateErr) {
      next(updateErr)
      return
    }

    if (!updated || updated.length === 0) {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', expected 'requested'` },
      })
      return
    }

    // Mark the board_request notification as actioned
    supabaseAdmin.from('notifications')
      .update({ type: 'board_request_actioned' })
      .eq('user_id', userId)
      .eq('type', 'board_request')
      .contains('data', { ride_id: rideId })
      .then(({ error: notifUpdateErr }) => {
        if (notifUpdateErr) console.error('Failed to mark notification actioned:', notifUpdateErr.message)
      })

    // Notify the requester
    const requesterId = userId === ride.rider_id ? ride.driver_id : ride.rider_id
    if (requesterId) {
      // Persist decline notification (non-blocking)
      supabaseAdmin.from('notifications').insert({
        user_id: requesterId,
        type: 'board_declined',
        title: 'Request Declined',
        body: 'Your ride request was declined. Try another ride on the board!',
        data: { ride_id: rideId },
      }).then(({ error: notifErr }) => {
        if (notifErr) console.error('Failed to persist decline notification:', notifErr.message)
      })

      void realtimeBroadcast(`board:${requesterId}`, 'board_declined', { type: 'board_declined', ride_id: rideId })

      // Refresh requester's MyRides page
      void realtimeBroadcast(`myrides:${requesterId}`, 'ride_status_changed', { ride_id: rideId, status: 'cancelled' })

      await sendBoardDeclinedPush(
        requesterId,
        rideId,
        'Request Declined',
        'Your ride request was declined. Try another ride on the board!',
      )
    }

    // Refresh poster's own MyRides page
    void realtimeBroadcast(`myrides:${userId}`, 'ride_status_changed', { ride_id: rideId, status: 'cancelled' })

    console.log(JSON.stringify({ type: 'board_decline', ride_id: rideId, declined_by: userId }))
    res.status(200).json({ ride_id: rideId, status: 'cancelled' })
  },
)

// ── PATCH /api/schedule/withdraw-board ───────────────────────────────────────
/**
 * The ORIGINAL REQUESTER withdraws their own board request/offer before the
 * poster has accepted. Atomic: only cancels if status is still 'requested'.
 * Notifies the poster so their inbox clears.
 */
scheduleRouter.patch(
  '/withdraw-board',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const { ride_id: rideId } = req.body as { ride_id?: string }

    if (!rideId) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'ride_id is required' },
      })
      return
    }

    const { data: ride, error: fetchErr } = await supabaseAdmin
      .from('rides')
      .select('id, rider_id, driver_id, status, schedule_id')
      .eq('id', rideId)
      .single()

    if (fetchErr || !ride) {
      res.status(404).json({
        error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' },
      })
      return
    }

    if (ride.rider_id !== userId && ride.driver_id !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You are not a participant in this ride' },
      })
      return
    }

    // Determine the poster so we can verify the caller is the requester, not the poster.
    // The poster is whoever owns the schedule; they should use decline-board instead.
    let posterId: string | null = null
    if (ride.schedule_id) {
      const { data: schedule } = await supabaseAdmin
        .from('ride_schedules')
        .select('user_id')
        .eq('id', ride.schedule_id)
        .single()
      posterId = (schedule?.user_id as string | undefined) ?? null
    }

    if (posterId && posterId === userId) {
      res.status(400).json({
        error: { code: 'USE_DECLINE', message: 'Posters should use decline-board to reject requests' },
      })
      return
    }

    // Atomic cancel — only transitions if still 'requested'
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'cancelled' })
      .eq('id', rideId)
      .eq('status', 'requested')
      .select('id')

    if (updateErr) {
      next(updateErr)
      return
    }

    if (!updated || updated.length === 0) {
      res.status(409).json({
        error: { code: 'INVALID_STATUS', message: `Ride status is '${ride.status}', can only withdraw while 'requested'` },
      })
      return
    }

    // Notify the poster so their pending-request UI clears
    if (posterId) {
      // Flip the original board_request notification on the poster's
      // inbox to `board_request_actioned` so the Accept / Decline
      // buttons disappear (matches accept-board / decline-board paths).
      // Without this, the screenshot bug from 2026-04-28 returns:
      // a stale row keeps offering buttons for a ride that's already
      // cancelled, and tapping Accept hits a 4xx INVALID_STATUS.
      supabaseAdmin.from('notifications')
        .update({ type: 'board_request_actioned' })
        .eq('user_id', posterId)
        .eq('type', 'board_request')
        .contains('data', { ride_id: rideId })
        .then(({ error: flipErr }) => {
          if (flipErr) console.error('Failed to mark withdrawn board_request actioned:', flipErr.message)
        })

      // Resolve the withdrawer's display name so the inbox copy is
      // specific ("Test User 1 withdrew their ride request") instead
      // of the generic "The other party". Falls back gracefully.
      const { data: requester } = await supabaseAdmin
        .from('users')
        .select('full_name')
        .eq('id', userId)
        .single()
      const withdrawerName = (requester?.full_name as string | undefined) ?? 'The other party'

      supabaseAdmin.from('notifications').insert({
        user_id: posterId,
        type: 'board_withdrawn',
        title: 'Request Withdrawn',
        body: `${withdrawerName} withdrew their ride request.`,
        data: { ride_id: rideId, requester_name: withdrawerName },
      }).then(({ error: notifErr }) => {
        if (notifErr) console.error('Failed to persist withdraw notification:', notifErr.message)
      })

      void realtimeBroadcast(`board:${posterId}`, 'board_withdrawn', {
        type: 'board_withdrawn',
        ride_id: rideId,
        requester_name: withdrawerName,
      })
      void realtimeBroadcast(`myrides:${posterId}`, 'ride_status_changed', { ride_id: rideId, status: 'cancelled' })
    }

    void realtimeBroadcast(`myrides:${userId}`, 'ride_status_changed', { ride_id: rideId, status: 'cancelled' })

    console.log(JSON.stringify({ type: 'board_withdraw', ride_id: rideId, withdrawn_by: userId }))
    res.status(200).json({ ride_id: rideId, status: 'cancelled' })
  },
)

// ── PATCH /api/schedule/:id/seats ─────────────────────────────────────────────
/**
 * Poster updates available_seats on their own schedule.
 * Used by drivers to add/reduce seats from the board detail view.
 */
scheduleRouter.patch(
  '/:id/seats',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const scheduleId = req.params['id'] as string
    const { available_seats } = req.body as { available_seats?: number }

    if (typeof available_seats !== 'number' || available_seats < 0 || available_seats > 8 || !Number.isInteger(available_seats)) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'available_seats must be an integer between 0 and 8' },
      })
      return
    }

    const { data: sched, error: fetchErr } = await supabaseAdmin
      .from('ride_schedules')
      .select('user_id, seats_locked')
      .eq('id', scheduleId)
      .single()

    if (fetchErr || !sched) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Schedule not found' } })
      return
    }

    if (sched.user_id !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the poster can edit seats' } })
      return
    }

    if (sched.seats_locked) {
      res.status(409).json({ error: { code: 'SEATS_LOCKED', message: 'Cannot modify seats after ride has started' } })
      return
    }

    const { error: updateErr } = await supabaseAdmin
      .from('ride_schedules')
      .update({ available_seats })
      .eq('id', scheduleId)

    if (updateErr) { next(updateErr); return }

    res.status(200).json({ id: scheduleId, available_seats })
  },
)

// ── POST /api/schedule/sync-routines ──────────────────────────────────────────
/**
 * Ensures each active driver_routine has upcoming ride_schedule entries
 * for the next 7 days. Idempotent — skips dates that already have a row.
 *
 * Called when user opens "My Routines" or on app start.
 */
scheduleRouter.post(
  '/sync-routines',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const body = (req.body ?? {}) as { client_date?: string }

    // Fetch user's active routines. `skip_dates` is the per-routine
    // tombstone array (migration 057) — dates the user has opted out
    // of are excluded from projection so a deleted "Wednesday" doesn't
    // resurrect on the next sync.
    const { data: routines, error: routineErr } = await supabaseAdmin
      .from('driver_routines')
      .select('id, user_id, route_name, origin, destination, destination_bearing, direction_type, day_of_week, departure_time, arrival_time, origin_address, dest_address, skip_dates')
      .eq('user_id', userId)
      .eq('is_active', true)

    if (routineErr) {
      next(routineErr)
      return
    }

    if (!routines || routines.length === 0) {
      res.status(200).json({ synced: 0 })
      return
    }

    // Fetch user's mode from users table
    const { data: userRow } = await supabaseAdmin
      .from('users')
      .select('is_driver')
      .eq('id', userId)
      .single()

    const mode: 'driver' | 'rider' = userRow?.is_driver ? 'driver' : 'rider'

    // Anchor "today" to the user's local calendar date. We then do all date
    // math via the UTC- methods on a UTC-midnight Date, which makes the
    // arithmetic immune to whatever timezone the server happens to run in.
    // Fallback to server UTC for older clients that don't send client_date.
    let todayY: number, todayM: number, todayD: number
    if (body.client_date && /^\d{4}-\d{2}-\d{2}$/.test(body.client_date)) {
      const parts = body.client_date.split('-').map(Number) as [number, number, number]
      todayY = parts[0]; todayM = parts[1]; todayD = parts[2]
    } else {
      const utcNow = new Date()
      todayY = utcNow.getUTCFullYear()
      todayM = utcNow.getUTCMonth() + 1
      todayD = utcNow.getUTCDate()
    }
    const today = new Date(Date.UTC(todayY, todayM - 1, todayD))
    const todayStr = `${todayY}-${String(todayM).padStart(2, '0')}-${String(todayD).padStart(2, '0')}`
    const weekOut = new Date(today)
    weekOut.setUTCDate(today.getUTCDate() + 7)
    const weekOutStr = `${weekOut.getUTCFullYear()}-${String(weekOut.getUTCMonth() + 1).padStart(2, '0')}-${String(weekOut.getUTCDate()).padStart(2, '0')}`

    const { data: existingSchedules } = await supabaseAdmin
      .from('ride_schedules')
      .select('trip_date, trip_time, route_name')
      .eq('user_id', userId)
      .gte('trip_date', todayStr)
      .lte('trip_date', weekOutStr)

    // Build a set of "date|time|route" keys for dedup
    const existingKeys = new Set(
      (existingSchedules ?? []).map((s: Record<string, unknown>) =>
        `${s['trip_date'] as string}|${s['trip_time'] as string}|${s['route_name'] as string}`,
      ),
    )

    // For each routine, generate board entries for the next 7 days
    const inserts: Array<{
      user_id: string; mode: 'driver' | 'rider'; route_name: string;
      origin_place_id: string; origin_address: string;
      dest_place_id: string; dest_address: string;
      direction_type: 'one_way' | 'roundtrip'; trip_date: string;
      time_type: 'departure' | 'arrival'; trip_time: string;
    }> = []
    const todayDow = today.getUTCDay() // 0=Sun (UTC anchor matches the user's local date)

    for (const routine of routines as Array<{
      id: string; route_name: string; direction_type: string;
      day_of_week: number[]; departure_time: string | null; arrival_time: string | null;
      origin: { coordinates: [number, number] }; destination: { coordinates: [number, number] };
      origin_address: string | null; dest_address: string | null;
      skip_dates: string[] | null
    }>) {
      const skipSet = new Set(routine.skip_dates ?? [])
      const timeStr = routine.departure_time ?? routine.arrival_time ?? '08:00:00'
      const timeType: 'departure' | 'arrival' = routine.departure_time ? 'departure' : 'arrival'

      // Resolve addresses: use stored address, else reverse-geocode from coordinates
      let originAddr = routine.origin_address
      let destAddr = routine.dest_address

      if (!originAddr || !destAddr) {
        const originCoords = routine.origin?.coordinates
        const destCoords = routine.destination?.coordinates
        if (!originAddr && originCoords) {
          originAddr = await reverseGeocode(originCoords[1], originCoords[0])
        }
        if (!destAddr && destCoords) {
          destAddr = await reverseGeocode(destCoords[1], destCoords[0])
        }
        // Save resolved addresses back to the routine so future syncs skip geocoding
        if (originAddr || destAddr) {
          await supabaseAdmin
            .from('driver_routines')
            .update({
              ...(originAddr ? { origin_address: originAddr } : {}),
              ...(destAddr ? { dest_address: destAddr } : {}),
            })
            .eq('id', routine.id)
        }
      }

      originAddr = originAddr ?? routine.route_name
      destAddr = destAddr ?? routine.route_name

      for (const dow of routine.day_of_week) {
        // Calculate next occurrence of this day-of-week
        let daysUntil = dow - todayDow
        if (daysUntil < 0) daysUntil += 7
        if (daysUntil === 0) daysUntil = 7 // skip today, post for next week

        const nextDate = new Date(today)
        nextDate.setUTCDate(today.getUTCDate() + daysUntil)

        if (nextDate > weekOut) continue // only within 7 days

        const dateStr = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDate.getUTCDate()).padStart(2, '0')}`
        // Per-routine tombstone — user explicitly deleted this date.
        if (skipSet.has(dateStr)) continue
        const key = `${dateStr}|${timeStr}|${routine.route_name}`

        if (existingKeys.has(key)) continue // already exists
        existingKeys.add(key) // prevent duplicates within this batch

        inserts.push({
          user_id: userId,
          mode,
          route_name: routine.route_name,
          origin_place_id: `routine:${routine.id}`,
          origin_address: originAddr,
          dest_place_id: `routine:${routine.id}:dest`,
          dest_address: destAddr,
          direction_type: routine.direction_type as 'one_way' | 'roundtrip',
          trip_date: dateStr,
          time_type: timeType,
          trip_time: timeStr,
        })
      }
    }

    if (inserts.length > 0) {
      const { error: insertErr } = await supabaseAdmin
        .from('ride_schedules')
        .insert(inserts)

      if (insertErr) {
        console.error('Failed to sync routine schedules:', insertErr.message)
        next(insertErr)
        return
      }
    }

    console.log(JSON.stringify({ type: 'sync_routines', user_id: userId, synced: inserts.length }))
    res.status(200).json({ synced: inserts.length })
  },
)

// ── Check for upcoming scheduled rides and send reminders ──────────────────
// Called by PM2 cron every 5 minutes (no JWT required — internal use only)
scheduleRouter.get(
  '/check-reminders',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [reminders, expiry, missed, sync] = await Promise.all([
        checkUpcomingRides(),
        expireStaleRequests(),
        expireMissedRides(),
        syncAllRoutines(),
      ])
      res.json({ reminders, expiry, missed, sync })
    } catch (err) {
      next(err)
    }
  },
)
