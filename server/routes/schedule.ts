import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { recordApiCall } from '../lib/apiUsage.ts'
import { sendFcmPush } from '../lib/fcm.ts'
import { sendNoPushFallbackEmail } from '../lib/noPushFallbackEmail.ts'
import { validateJwt } from '../middleware/auth.ts'
import { adminAuth } from '../middleware/adminAuth.ts'
import { realtimeBroadcast } from '../lib/realtimeBroadcast.ts'
import { haversineMetres, decodePolyline, projectPointOntoPolyline, type LatLng } from '../lib/polyline.ts'
import { scanForPost } from '../lib/suggestionEngine.ts'
import { computeTransitDropoffSuggestions, computeTransitPickupSuggestions, fetchDrivingRoute, type TransitOption } from '../lib/transitSuggestions.ts'
import { checkUpcomingRides, expireMissedRides, expirePendingBoardOffers, expireStaleRequests, syncAllRoutines } from '../lib/scheduledReminders.ts'
import { resolveAndPersistDefaultPm } from './payment.ts'
import { estimateFareCentsBetween } from './rides.ts'

export const scheduleRouter = Router()

// ── Notification body formatters ──────────────────────────────────────────
//
// 2026-05-18 Slice 3 — unified copy pattern across all Ride Board
// notifications: title carries the narrative ("X wants to drive you"),
// body carries route + date (+ price for offers). Same shape on both
// sides so the inbox reads consistently regardless of which role the
// user is in. Helper lives at module scope so both `board_request`
// and `board_offer` emit sites share one source.
function formatTripDateForBody(iso: string | null | undefined): string {
  if (!iso) return ''
  // Schedule.trip_date is `YYYY-MM-DD` (TIMESTAMP without time zone
  // semantics). Anchor at UTC so "2026-05-19" stays May 19 instead
  // of slipping a day on the device's local clock.
  const date = new Date(`${iso}T00:00:00Z`)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function joinBodyParts(parts: Array<string | null | undefined>): string {
  return parts.filter((s): s is string => typeof s === 'string' && s.length > 0).join(' · ')
}

// ── BoardOfferAccept context helpers ───────────────────────────────────────
//
// Both used by `GET /board/schedule/:scheduleId/offers`. Hoisted to
// module scope so they're testable independently of the request
// pipeline.

interface ScheduleContextRow {
  id: string
  origin_address: string | null
  origin_lat: number | null
  origin_lng: number | null
  dest_address: string | null
  dest_lat: number | null
  dest_lng: number | null
  trip_date: string
  trip_time: string
  time_flexible: boolean | null
}

/// Shape the schedule row into the `posted` block iOS / web consume
/// on `BoardOfferAcceptPage`. Echoed back so the rider knows which
/// of their posts this offer targets + so the page can render
/// "matches your posted spot" diff badges.
function buildPostedBlock(schedule: ScheduleContextRow) {
  return {
    pickup_name: schedule.origin_address,
    pickup_lat: schedule.origin_lat,
    pickup_lng: schedule.origin_lng,
    dropoff_name: schedule.dest_address,
    dropoff_lat: schedule.dest_lat,
    dropoff_lng: schedule.dest_lng,
    trip_date: schedule.trip_date,
    trip_time: schedule.trip_time,
    time_flexible: schedule.time_flexible === true,
  }
}

/// When there are no pending offers, figure out WHY so iOS can
/// render specific copy on the empty state instead of a generic
/// "may have withdrawn / you accepted a different offer."
async function computeNoOffersReason(
  scheduleId: string,
  riderUserId: string,
  schedule: ScheduleContextRow,
): Promise<{
  code: 'you_accepted' | 'trip_passed' | 'all_released' | 'no_offers'
  acceptedRideId: string | null
}> {
  // (a) Did the rider already accept an offer on this schedule?
  //     `rides.schedule_id` (mig 017) is the backreference — the
  //     accepted offer now has `ride_id` set + `schedule_id` null
  //     per the CHECK constraint, so we can't backreference via
  //     ride_offers. The rides row is authoritative.
  const { data: acceptedRide } = await supabaseAdmin
    .from('rides')
    .select('id')
    .eq('schedule_id', scheduleId)
    .eq('rider_id', riderUserId)
    .not('status', 'in', '("cancelled")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (acceptedRide?.id) {
    return { code: 'you_accepted', acceptedRideId: acceptedRide.id as string }
  }

  // (b) Has the trip time passed? Rider can't act on stale offers.
  //     Use the schedule's local-clock trip_date+trip_time vs now;
  //     anytime (time_flexible) trips count as valid through EOD.
  if (isSchedulePast(schedule)) {
    return { code: 'trip_passed', acceptedRideId: null }
  }

  // (c) Were there offers that got released (declined / sibling-
  //     accepted / expired)? Anything besides pending counts.
  const { data: releasedOffers } = await supabaseAdmin
    .from('ride_offers')
    .select('id' as never)
    .eq('schedule_id' as never, scheduleId)
    .neq('status', 'pending')
    .limit(1)
  if (releasedOffers && releasedOffers.length > 0) {
    return { code: 'all_released', acceptedRideId: null }
  }

  // (d) No offer was ever made on this schedule.
  return { code: 'no_offers', acceptedRideId: null }
}

/// True when the schedule's trip_date+trip_time is now in the past
/// (anytime trips are valid through end-of-day on their trip_date).
/// Mirrors the gating in `scheduledReminders.expireStaleRequests` so
/// the rider's empty state and the cron's auto-expiry agree.
function isSchedulePast(schedule: ScheduleContextRow): boolean {
  const today = new Date()
  // YYYY-MM-DD comparison in local time
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  if (schedule.trip_date > todayDate) return false
  if (schedule.trip_date < todayDate) return true
  // Same date — flex trips valid all day; specific times must not
  // yet have arrived.
  if (schedule.time_flexible === true) return false
  const [hh, mm] = (schedule.trip_time || '00:00:00').split(':')
  const tripMinutes = (Number(hh) || 0) * 60 + (Number(mm) || 0)
  const nowMinutes = today.getHours() * 60 + today.getMinutes()
  return nowMinutes >= tripMinutes
}

// ── Reverse geocode helper ──────────────────────────────────────────────────
interface GeocodeResponse {
  results?: Array<{ formatted_address?: string }>
  status?: string
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = process.env['GOOGLE_MAPS_KEY']
  if (!key) return 'Unknown'
  try {
    void recordApiCall('gmaps_geocoding')
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
    void recordApiCall('gmaps_geocoding')
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

// haversineMetres is imported from `../lib/polyline.ts` at the top
// of this file. The local copy that lived here got removed once the
// shared lib version landed (it was duplicate code that triggered a
// TS2440 import-conflict on Vercel build).

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
    // 2026-05-17 (Slice A4) — added rating_count + payment-method
    // signals so the board card can show trust badges on rider posts
    // (e.g. ✓ Payment ready / ★ 4.8 (12)). Drivers browsing the board
    // use these to filter out riders who may stall after acceptance.
    const userIds = [...new Set(filteredSchedules.map((s: Record<string, unknown>) => s['user_id'] as string))]
    const { data: users } = await supabaseAdmin
      .from('users')
      .select(
        'id, full_name, avatar_url, rating_avg, rating_count, is_driver, '
        + 'stripe_customer_id, default_payment_method_id, wallet_balance, '
        + 'has_accessibility_needs, accessibility_profile' as never,
      )
      .in('id', userIds)

    type PosterRow = {
      id: string
      full_name: string | null
      avatar_url: string | null
      rating_avg: number | null
      rating_count: number | null
      is_driver: boolean | null
      stripe_customer_id: string | null
      default_payment_method_id: string | null
      wallet_balance: number | null
      // v1.2 F5.2 — accessibility flags for the board card ♿
      // "Mobility aid access" pill. `has_accessibility_needs` is the
      // top-level toggle (users.has_accessibility_needs); the JSONB
      // sub-state (accessibility_profile.needs_wheelchair) is only
      // meaningful when the top flag is true. iOS gates the pill on
      // BOTH being true, but we compute the AND server-side so the
      // wire format stays a simple bool.
      has_accessibility_needs: boolean | null
      accessibility_profile: { needs_wheelchair?: boolean } | null
    }
    const userMap = new Map(
      ((users ?? []) as unknown as PosterRow[]).map((u) => {
        const hasCard =
          (u.stripe_customer_id != null && u.stripe_customer_id.length > 0)
          && (u.default_payment_method_id != null && u.default_payment_method_id.length > 0)
        const walletHasFunds = (u.wallet_balance ?? 0) > 0
        const hasAccess = u.has_accessibility_needs === true
        const needsWheelchair = hasAccess && u.accessibility_profile?.needs_wheelchair === true
        return [
          u.id,
          {
            id: u.id,
            full_name: u.full_name,
            avatar_url: u.avatar_url,
            rating_avg: u.rating_avg,
            rating_count: u.rating_count ?? 0,
            is_driver: u.is_driver ?? false,
            // Trust signals consumed by the iOS RideBoardCard. Don't
            // leak the raw stripe IDs or wallet balance.
            has_payment_method: hasCard || walletHasFunds,
            // v1.2 F5.2 — accessibility flags surfaced for the
            // RideBoardCard mobility-aid pill.
            has_accessibility_needs: hasAccess,
            needs_wheelchair: needsWheelchair,
          },
        ]
      }),
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

      // 2026-05-17 — Phase A driver-side offer flow creates a
      // ride_offers row, not a rides row. Without this query, the
      // board card's CTA stays "Offer to Drive" after the driver
      // sends an offer (no rides row yet → already_requested=false).
      // Treat a pending ride_offer from this user as
      // already_requested so the iOS / web UI flips to "Offer Sent".
      const { data: userOffers } = await supabaseAdmin
        .from('ride_offers')
        .select('schedule_id' as never)
        .in('schedule_id' as never, scheduleIds)
        .eq('driver_id', userId)
        .eq('status', 'pending')

      if (userOffers) {
        for (const o of userOffers as unknown as Array<{ schedule_id: string }>) {
          if (o.schedule_id) requestedSet.add(o.schedule_id)
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

/**
 * GET /api/schedule/my-posts
 *
 * Phase B of the Ride Board redesign (2026-05-17). Returns the JWT
 * user's currently-published ride board content in two buckets the
 * Rides tab can render as separate sections:
 *
 *   - `schedules`: their own `ride_schedules` rows for trip_date
 *     >= today (past posts are noise; once a post's date is gone
 *     the user can't act on it). Only `pending` posts — anything
 *     that's already matched / cancelled / completed lives in
 *     `/api/rides/active` already, so showing it here too would
 *     duplicate the same row across two sections.
 *
 *   - `routines`: their own `driver_routines` rows where
 *     `is_active = true`. Includes both the live (no end_date or
 *     end_date >= today) AND paused-but-active routines. Past-end-
 *     date routines are filtered out so the "manage" view stays
 *     useful.
 *
 * Powers `RidesTabPage`'s new "Posted, awaiting match" + "Routines"
 * sections + the "My posts" icon on `RideBoardHomePage` that
 * jumps the user straight to them.
 */
scheduleRouter.get(
  '/my-posts',
  validateJwt,
  async (_req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const today = new Date().toISOString().slice(0, 10)

    try {
      // `ride_schedules` has no status column — the "post is still
      // pending" semantic is derived client-side by checking whether
      // an active `rides` row references this schedule_id. Server
      // just returns every future-dated post; iOS' Rides tab dedupes
      // against the Active section so a matched schedule doesn't
      // surface in both. Past posts are dropped here because the
      // user can't act on them.
      const [schedulesResult, routinesResult] = await Promise.all([
        supabaseAdmin
          .from('ride_schedules')
          .select('*')
          .eq('user_id', userId)
          .gte('trip_date', today)
          .order('trip_date', { ascending: true })
          .order('trip_time', { ascending: true })
          .limit(100),
        supabaseAdmin
          .from('driver_routines')
          .select('*')
          .eq('user_id', userId)
          .eq('is_active', true)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      if (schedulesResult.error) { next(schedulesResult.error); return }
      if (routinesResult.error) { next(routinesResult.error); return }

      res.status(200).json({
        schedules: schedulesResult.data ?? [],
        routines: routinesResult.data ?? [],
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/schedule/:id/compute-route
 *
 * Phase C Slice C2 (2026-05-17). Resolves the schedule's origin +
 * destination via Google Routes API and stores the polyline + cached
 * coords on the row. Called by iOS as a fire-and-forget right after
 * the schedule is inserted (Slice C3); the smart-search endpoint
 * (Slice C5) reads these columns to match riders against routes
 * whose path actually passes through the rider's origin/destination
 * — not just routes whose endpoints happen to be close.
 *
 * Idempotent — re-callable to refresh after a place change. We
 * always re-compute; caching is the Routes API's job, not ours,
 * and we want fresh polylines if the post was edited.
 *
 * Errors:
 *   400 INVALID_PARAMS — bad/missing schedule id
 *   403 FORBIDDEN — caller isn't the schedule owner
 *   404 SCHEDULE_NOT_FOUND
 *   502 ROUTES_API_ERROR — Google upstream failed
 *   404 NO_ROUTE — Google returned no routes for these places
 */
/**
 * Result of `computeAndPersistRouteFor` — discriminated union so
 * the caller can render single-row, single-batch, and batch-summary
 * responses without re-parsing error strings.
 */
type ComputeRouteResult =
  | {
      ok: true
      polyline: string
      originLat: number
      originLng: number
      destLat: number
      destLng: number
      distanceMetres: number
    }
  | { ok: false; code: 'NO_PLACES' | 'ROUTES_API_ERROR' | 'NO_ROUTE' | 'DB_ERROR' | 'CONFIG_ERROR'; message: string }

/**
 * Core compute-route logic, factored out so both the per-schedule
 * endpoint and the admin batch backfill (Slice C7) can share the
 * same code path. Does NOT check JWT / ownership — the caller is
 * responsible for that gating before invoking.
 *
 * Persists the polyline + cached coords to the row via WKT POINT
 * (PostGIS implicit ST_GeomFromText, SRID 4326). Idempotent: calling
 * twice just re-writes the same values.
 */
async function computeAndPersistRouteFor(
  scheduleId: string,
  originPlaceId: string | null,
  destPlaceId: string | null,
): Promise<ComputeRouteResult> {
  if (!originPlaceId || !destPlaceId) {
    return { ok: false, code: 'NO_PLACES', message: 'Schedule has no origin or destination place_id' }
  }

  const apiKey = process.env['GOOGLE_MAPS_KEY']
  if (!apiKey) {
    return { ok: false, code: 'CONFIG_ERROR', message: 'Google Maps API key not configured' }
  }

  try {
    const reqBody = {
      origin: { placeId: originPlaceId },
      destination: { placeId: destPlaceId },
      travelMode: 'DRIVE',
      computeAlternativeRoutes: false,
      languageCode: 'en-US',
    }

    void recordApiCall('gmaps_routes')
    const resp = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation',
        },
        body: JSON.stringify(reqBody),
      },
    )

    if (!resp.ok) {
      const errText = await resp.text()
      console.error('[compute-route] Routes API error:', resp.status, errText)
      return { ok: false, code: 'ROUTES_API_ERROR', message: `Routes API returned ${resp.status}` }
    }

    type RoutesResponse = {
      routes?: Array<{
        distanceMeters?: number
        polyline?: { encodedPolyline?: string }
        legs?: Array<{
          startLocation?: { latLng?: { latitude?: number; longitude?: number } }
          endLocation?: { latLng?: { latitude?: number; longitude?: number } }
        }>
      }>
    }
    const data = (await resp.json()) as RoutesResponse
    const route = data.routes?.[0]
    const polyline = route?.polyline?.encodedPolyline
    const firstLeg = route?.legs?.[0]
    const lastLeg = route?.legs?.[route.legs.length - 1]
    const startLatLng = firstLeg?.startLocation?.latLng
    const endLatLng = lastLeg?.endLocation?.latLng

    if (
      !polyline
      || startLatLng?.latitude == null || startLatLng?.longitude == null
      || endLatLng?.latitude == null || endLatLng?.longitude == null
    ) {
      return { ok: false, code: 'NO_ROUTE', message: 'Google returned no usable route for this schedule' }
    }

    const originPoint = `POINT(${startLatLng.longitude} ${startLatLng.latitude})`
    const destPoint = `POINT(${endLatLng.longitude} ${endLatLng.latitude})`

    const { error: updateErr } = await supabaseAdmin
      .from('ride_schedules')
      .update({
        route_polyline: polyline,
        route_origin_geo: originPoint,
        route_destination_geo: destPoint,
      } as never)
      .eq('id', scheduleId)

    if (updateErr) {
      console.error('[compute-route] update failed:', updateErr.message)
      return { ok: false, code: 'DB_ERROR', message: updateErr.message }
    }

    return {
      ok: true,
      polyline,
      originLat: startLatLng.latitude,
      originLng: startLatLng.longitude,
      destLat: endLatLng.latitude,
      destLng: endLatLng.longitude,
      distanceMetres: route.distanceMeters ?? 0,
    }
  } catch (err) {
    console.error('[compute-route] Error:', err)
    return { ok: false, code: 'ROUTES_API_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }
  }
}

scheduleRouter.post(
  '/:id/compute-route',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const scheduleId = String(req.params['id'] ?? '')

    if (!scheduleId) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'schedule id required' } })
      return
    }

    // Pull origin/dest place ids from the row + verify ownership
    const { data: schedule, error: schedErr } = await supabaseAdmin
      .from('ride_schedules')
      .select('id, user_id, origin_place_id, dest_place_id, origin_address, dest_address')
      .eq('id', scheduleId)
      .single()

    if (schedErr || !schedule) {
      res.status(404).json({ error: { code: 'SCHEDULE_NOT_FOUND', message: 'Schedule not found' } })
      return
    }

    if (schedule.user_id !== userId) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You can only compute routes for your own schedules' },
      })
      return
    }

    try {
      const result = await computeAndPersistRouteFor(
        scheduleId,
        schedule.origin_place_id as string | null,
        schedule.dest_place_id as string | null,
      )

      // v1.3 Suggested Rides — ALWAYS fire scanForPost, even when the
      // Google enrichment failed. Since 2026-05-25 iOS posts the
      // route_polyline directly at insert time (via MapKit + the
      // validate-polyline endpoint), so the suggestion engine has
      // what it needs even when Google's place-ID call fails
      // (which it always does for iOS's apple:NNN IDs). Without this
      // line, suggestions never land for iOS-originated schedules.
      void scanForPost(scheduleId).catch((err: unknown) => {
        console.error('[compute-route] scanForPost failed:', err)
      })

      if (!result.ok) {
        const httpStatus =
          result.code === 'NO_PLACES' ? 400 :
          result.code === 'CONFIG_ERROR' ? 500 :
          result.code === 'NO_ROUTE' ? 404 :
          result.code === 'DB_ERROR' ? 500 :
          502  // ROUTES_API_ERROR
        res.status(httpStatus).json({ error: { code: result.code, message: result.message } })
        return
      }

      console.log(
        `[compute-route] schedule=${scheduleId.slice(0, 8)}… origin=(${result.originLat.toFixed(4)},${result.originLng.toFixed(4)}) dest=(${result.destLat.toFixed(4)},${result.destLng.toFixed(4)}) polyline=${result.polyline.length}chars`,
      )

      res.status(200).json({
        polyline: result.polyline,
        origin_lat: result.originLat,
        origin_lng: result.originLng,
        destination_lat: result.destLat,
        destination_lng: result.destLng,
        distance_metres: result.distanceMetres,
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/schedule/admin/backfill-polylines
 *
 * Phase C Slice C7 (2026-05-17). Admin-only one-shot tool to
 * retrofit `route_polyline` + `route_*_geo` onto schedules that
 * pre-date Slice C2 (or where compute-route fire-and-forget
 * silently failed). Without this, older posts never surface in
 * smart-search direct/handoff matches — only the endpoint-distance
 * fallback path, which defeats the upgrade.
 *
 * Body (optional):
 *   - limit (default 50, max 200) — how many to process per call
 *   - include_past (default false) — also backfill trips whose
 *     date is in the past (useful when seeding historical data,
 *     pointless for live matching)
 *
 * Rate limit: 200ms between Routes API calls so we don't trip
 * Google's per-second quota. Run repeatedly until `remaining=0`.
 *
 * Returns: { total, succeeded, failed, skipped, remaining,
 *           errors: [{ id, code, message }] }
 */
scheduleRouter.post(
  '/admin/backfill-polylines',
  validateJwt,
  adminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { limit?: unknown; include_past?: unknown }
      const limit = typeof body.limit === 'number' && body.limit > 0
        ? Math.min(Math.floor(body.limit), 200)
        : 50
      const includePast = body.include_past === true

      const today = new Date().toISOString().slice(0, 10)

      // Select schedules missing a polyline. Order by trip_date DESC
      // so we backfill the most-recent (highest-impact) rows first
      // — those are the ones a rider could actually book.
      let query = supabaseAdmin
        .from('ride_schedules')
        .select('id, origin_place_id, dest_place_id, trip_date', { count: 'exact' })
        .is('route_polyline', null)
        .eq('mode', 'driver')
        .order('trip_date', { ascending: false })
        .limit(limit)

      if (!includePast) {
        query = query.gte('trip_date', today)
      }

      const { data: rows, count, error: selectErr } = await query
      if (selectErr) {
        next(selectErr)
        return
      }

      const total = rows?.length ?? 0
      let succeeded = 0
      let failed = 0
      let skipped = 0
      const errors: Array<{ id: string; code: string; message: string }> = []

      for (const row of (rows ?? []) as Array<{
        id: string
        origin_place_id: string | null
        dest_place_id: string | null
      }>) {
        if (!row.origin_place_id || !row.dest_place_id) {
          skipped++
          continue
        }
        const result = await computeAndPersistRouteFor(
          row.id,
          row.origin_place_id,
          row.dest_place_id,
        )
        if (result.ok) {
          succeeded++
        } else {
          failed++
          errors.push({ id: row.id, code: result.code, message: result.message })
        }
        // 200ms throttle — Routes API tolerates 50 QPS but we don't
        // need to push it; this keeps the batch friendly for both
        // Google and our own server.
        await new Promise((r) => setTimeout(r, 200))
      }

      const remaining = Math.max(0, (count ?? total) - total)
      console.log(
        `[backfill-polylines] processed=${total} ok=${succeeded} fail=${failed} skip=${skipped} remaining=${remaining}`,
      )

      res.status(200).json({
        total,
        succeeded,
        failed,
        skipped,
        remaining,
        errors: errors.slice(0, 25),  // truncate noisy responses
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/schedule/board/search
 *
 * Phase B Slice B1 (2026-05-17). Smart geo-match search for the
 * Ride Board. Rider supplies their origin + destination + date and
 * gets back a RANKED list of driver-posted schedules whose route
 * matches.
 *
 * For v1 this uses endpoint-match scoring: distance from rider's
 * origin to driver's origin + distance from rider's dest to
 * driver's dest. Bearing alignment + time proximity feed into the
 * rank. Intermediate-stop matching (rider's points lie ALONG the
 * driver's straight line, not at the endpoints) is intentionally
 * out of scope — it's a B1.5 upgrade once we have signal on how
 * much intermediate-stop demand we actually see.
 *
 * Body:
 *   - origin_lat, origin_lng (required) — rider's starting point
 *   - destination_lat, destination_lng (required) — rider's destination
 *   - trip_date (required, YYYY-MM-DD)
 *   - trip_time (optional, HH:MM:SS) — drives time-proximity scoring
 *   - radius_km (optional, default 10) — max endpoint distance
 *   - mode (optional, default 'driver') — defaults to driver-posted
 *     schedules since that's the search use-case (rider looking for
 *     someone heading their way). Can be 'rider' for the inverse.
 *
 * Returns: { results: [ScheduledRide-shaped + relevance_score] }
 * sorted by score desc, capped at 20 entries.
 */
scheduleRouter.post(
  '/board/search',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body ?? {}) as {
      origin_lat?: unknown
      origin_lng?: unknown
      destination_lat?: unknown
      destination_lng?: unknown
      trip_date?: unknown
      trip_time?: unknown
      radius_km?: unknown
      mode?: unknown
    }

    const oLat = typeof body.origin_lat === 'number' ? body.origin_lat : null
    const oLng = typeof body.origin_lng === 'number' ? body.origin_lng : null
    const dLat = typeof body.destination_lat === 'number' ? body.destination_lat : null
    const dLng = typeof body.destination_lng === 'number' ? body.destination_lng : null
    const tripDate = typeof body.trip_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.trip_date)
      ? body.trip_date
      : null
    const tripTime = typeof body.trip_time === 'string' ? body.trip_time : null
    const radiusKm = typeof body.radius_km === 'number' && body.radius_km > 0
      ? Math.min(body.radius_km, 100)
      : 10
    // 2026-05-17 Phase 2 — accept both directions:
    //   mode='driver' (default, legacy): rider searches for driver
    //     posts whose route covers them
    //   mode='rider': driver searches for rider posts whose (o, d)
    //     overlaps with the driver's intended route
    const mode: 'driver' | 'rider' = body.mode === 'rider' ? 'rider' : 'driver'

    if (oLat == null || oLng == null || dLat == null || dLng == null || tripDate == null) {
      res.status(400).json({
        error: {
          code: 'INVALID_BODY',
          message: 'origin_lat, origin_lng, destination_lat, destination_lng, and trip_date (YYYY-MM-DD) are required',
        },
      })
      return
    }

    // Rider's intended bearing — for direction-alignment scoring on
    // the endpoint-distance fallback path. Polyline-matched schedules
    // don't need it (the polyline IS the direction).
    const userBearing = calculateBearing(oLat, oLng, dLat, dLng)

    // Driver-side smart search forks here. Same scoring math as
    // rider-side but with the polyline-vs-passenger roles inverted.
    if (mode === 'rider') {
      await runDriverSideSearch({
        api: req,
        res,
        next,
        oLat, oLng, dLat, dLng,
        tripDate, tripTime,
        userBearing,
      })
      return
    }

    // ── Phase C Slice C5 tuning constants ──────────────────────────
    // ROUTE_CORRIDOR_METRES — how far a rider point can be from the
    //   driver's polyline and still count as "on the route." 2km is
    //   ~3 min driver detour — generous enough to catch students
    //   whose pickup is a few blocks off the main highway but tight
    //   enough that random across-town requests don't match.
    // HANDOFF_MAX_PRECHECK_METRES — cheap geometric pre-filter for
    //   the expensive transit-suggestion API call. If rider's dest
    //   is more than this far from the polyline's closest approach,
    //   no transit handoff is viable and we skip the API call.
    //   2026-05-21 v1.2.1 S1 — bumped from 30km → 75km. 30km was
    //   tuned for early Davis-area tests and silently dropped
    //   legitimate Bay Area cross-corridor matches (e.g. Davis→SF
    //   rider × Davis→San Jose driver where the I-680 polyline
    //   sits ~30km from SF). 75km is the actual ceiling for
    //   reasonable transit legs (BART end-to-end ~70km, Caltrain
    //   SF↔San Jose ~80km). MAX_HANDOFF_CANDIDATES caps cost.
    // TIME_WINDOW_MINUTES — hard exclusion when the rider provides a
    //   trip_time.
    // PICKUP_RADIUS_METRES / DROPOFF_RADIUS_METRES — accept rider
    //   origin/destination as a valid pickup/drop when it's near the
    //   driver's endpoint (within the same town), even if it doesn't
    //   sit on the polyline corridor itself.
    // MAX_HANDOFF_CANDIDATES — hard cap on how many drivers we
    //   invoke the (expensive) transit-suggestion engine for. Keeps
    //   per-search Google API spend predictable.
    const ROUTE_CORRIDOR_METRES = 2_000
    const HANDOFF_MAX_PRECHECK_METRES = 75_000
    const TIME_WINDOW_MINUTES = 120
    const PICKUP_RADIUS_METRES = 10_000
    const DROPOFF_RADIUS_METRES = 10_000
    const MAX_HANDOFF_CANDIDATES = 5
    // BOARDS_TOO_LATE_FRACTION — when the rider's pickup projects
    //   onto the driver's polyline ABOVE this fraction (i.e. they
    //   board near the end of the driver's trip), no meaningful
    //   transit-handoff station can exist after that point. Without
    //   this gate, the engine cheerfully returns a station at
    //   fractionAlong < pickup, which would require the driver to
    //   BACKTRACK after dropping the rider — geometrically absurd.
    //   Reported by Tarun 2026-05-18: a Davis→Roseville rider was
    //   matched against an Elk Grove → UC Davis driver and offered
    //   a Sacramento-area drop, even though the rider boards in
    //   Davis (after the polyline has already passed Sacramento).
    const BOARDS_TOO_LATE_FRACTION = 0.85
    const radiusMetres = radiusKm * 1000

    // Step 1: candidate schedules for the requested date.
    const { data: schedules, error: schedErr } = await supabaseAdmin
      .from('ride_schedules')
      .select('*')
      .eq('mode', 'driver')
      .eq('trip_date', tripDate)
      .order('trip_time', { ascending: true })
      .limit(200)

    if (schedErr) {
      next(schedErr)
      return
    }
    if (!schedules || schedules.length === 0) {
      res.status(200).json({ results: [] })
      return
    }

    // Step 2: pull poster info (rating + payment-ready badges +
    // v1.2 F5.2 accessibility flags for the ♿ "Mobility aid access"
    // pill).
    const userIds = [...new Set(schedules.map((s: Record<string, unknown>) => s['user_id'] as string))]
    const { data: posterRows } = await supabaseAdmin
      .from('users')
      .select(
        'id, full_name, avatar_url, rating_avg, rating_count, is_driver, '
        + 'stripe_customer_id, default_payment_method_id, wallet_balance, '
        + 'has_accessibility_needs, accessibility_profile' as never,
      )
      .in('id', userIds)

    type PosterRow = {
      id: string
      full_name: string | null
      avatar_url: string | null
      rating_avg: number | null
      rating_count: number | null
      is_driver: boolean | null
      stripe_customer_id: string | null
      default_payment_method_id: string | null
      wallet_balance: number | null
      has_accessibility_needs: boolean | null
      accessibility_profile: { needs_wheelchair?: boolean } | null
    }
    const posterMap = new Map(
      ((posterRows ?? []) as unknown as PosterRow[]).map((u) => {
        const hasAccess = u.has_accessibility_needs === true
        const needsWheelchair = hasAccess && u.accessibility_profile?.needs_wheelchair === true
        return [
          u.id,
          {
            id: u.id,
            full_name: u.full_name,
            avatar_url: u.avatar_url,
            rating_avg: u.rating_avg,
            rating_count: u.rating_count ?? 0,
            is_driver: u.is_driver ?? false,
            has_payment_method:
              (!!u.stripe_customer_id && !!u.default_payment_method_id)
              || ((u.wallet_balance ?? 0) > 0),
            has_accessibility_needs: hasAccess,
            needs_wheelchair: needsWheelchair,
          },
        ]
      }),
    )

    // Step 3: pull driver_routines as a fallback endpoint source for
    // schedules whose route_polyline/route_*_geo haven't been
    // populated yet (iOS-projected rows that ship coords but not
    // polyline; pre-Slice-C2 rows; compute-route failures).
    const { data: routines } = await supabaseAdmin
      .from('driver_routines')
      .select('user_id, origin, destination, destination_bearing, route_polyline')
      .in('user_id', userIds)
      .eq('is_active', true)

    type RoutineRow = {
      user_id: string
      origin: { coordinates: [number, number] } | null
      destination: { coordinates: [number, number] } | null
      destination_bearing: number | null
      route_polyline: string | null
    }
    const routineMap = new Map<string, {
      originLat: number
      originLng: number
      destLat: number
      destLng: number
      destBearing: number
      polyline: string | null
    }>()
    for (const r of (routines ?? []) as RoutineRow[]) {
      if (!r.origin || !r.destination) continue
      if (routineMap.has(r.user_id)) continue
      routineMap.set(r.user_id, {
        originLat: r.origin.coordinates[1],
        originLng: r.origin.coordinates[0],
        destLat: r.destination.coordinates[1],
        destLng: r.destination.coordinates[0],
        destBearing: r.destination_bearing ?? userBearing,
        polyline: r.route_polyline,
      })
    }

    // Step 4: score + filter — polyline-first, with endpoint-distance
    // as a backwards-compat fallback.
    // 2026-05-21 v1.2.1 S2.1 — added 'reverse_transit_handoff'.
    // Same response shape as 'transit_handoff' but the rider's
    // journey is inverted: rider takes transit FROM their pickup
    // TO a station along the driver's route, meets driver there,
    // continues to driver's destination together. Used when rider's
    // pickup is off-route but their destination IS on it (e.g.
    // SF→Davis rider × San Jose→Davis driver). iOS uses the
    // `direction` field on `HandoffInfo` to disambiguate copy +
    // map rendering.
    type MatchType = 'direct' | 'transit_handoff' | 'reverse_transit_handoff' | 'endpoint'
    /// Real transit-handoff info populated by
    /// `computeTransitDropoffSuggestions` (the same engine that powers
    /// instant-ride dropoff suggestions). Carries actual transit
    /// timing returned by Google Directions API rather than a
    /// guess based on haversine distance.
    ///
    /// 2026-05-21 v1.2.1 S2.1 — `direction` discriminates forward
    /// (driver drops rider at station, rider takes transit to dest)
    /// from reverse (rider takes transit to station, driver picks
    /// rider up, continues to dest). The field semantics shift
    /// slightly per direction (see TransitDropoffSuggestion comments
    /// in transitSuggestions.ts).
    type HandoffInfo = {
      station_name: string
      station_place_id: string
      station_address: string
      station_lat: number
      station_lng: number
      walk_to_station_minutes: number
      transit_to_dest_minutes: number
      total_rider_minutes: number
      transit_option: TransitOption | null
      direction: 'forward' | 'reverse'
    }
    type ScoredSchedule = {
      schedule: Record<string, unknown>
      driverOriginLat: number
      driverOriginLng: number
      driverDestLat: number
      driverDestLng: number
      match_type: MatchType
      relevance_score: number
      time_diff_minutes: number
      // Direct / handoff fields
      corridor_origin_metres: number | null
      corridor_dest_metres: number | null
      transit_handoff: HandoffInfo | null
      // Endpoint-fallback fields (also populated for direct as a
      // useful diagnostic — distance to driver's endpoints)
      origin_distance_metres: number
      dest_distance_metres: number
      bearing_diff_degrees: number
      created_at: string
    }
    const scored: ScoredSchedule[] = []
    /// Candidates that look like plausible transit handoffs after
    /// the cheap pre-check. Resolved into `scored` in a second pass
    /// that invokes `computeTransitDropoffSuggestions` (1-2 Places
    /// + per-station Directions API calls). Capped to top-N to keep
    /// per-search spend bounded.
    type PendingHandoff = {
      schedule: Record<string, unknown>
      driverOriginLat: number
      driverOriginLng: number
      driverDestLat: number
      driverDestLng: number
      polyline: string
      effectivePickupFrac: number
      originOnCorridor: boolean
      originProjMetres: number
      originToDriverOriginM: number
      destProjMetres: number
      timeMatch: number
      driverRating: number
      timeDiff: number
      bearingDiff: number
      createdAt: string
      plausibilityScore: number
    }
    const pendingHandoffs: PendingHandoff[] = []
    // 2026-05-21 v1.2.1 S2.1 — reverse-handoff candidates: rider's
    // PICKUP is off-route but their DESTINATION is on-route (or
    // near-end). Resolved into `scored` by a separate pass-3 loop
    // that invokes `computeTransitPickupSuggestions`.
    type PendingReverseHandoff = {
      schedule: Record<string, unknown>
      driverOriginLat: number
      driverOriginLng: number
      driverDestLat: number
      driverDestLng: number
      polyline: string
      // For reverse handoff, drop must be reachable; pickup must NOT
      // be on the corridor (otherwise we'd take the direct path).
      // The rider's pickup-to-polyline distance acts as the
      // plausibility-score signal (closer = shorter transit leg).
      destOnCorridor: boolean
      pickupProjMetres: number  // distance from rider pickup to driver polyline (the transit-leg-length proxy)
      destProjMetres: number
      destToDriverDestM: number
      timeMatch: number
      driverRating: number
      timeDiff: number
      bearingDiff: number
      createdAt: string
      plausibilityScore: number
    }
    const pendingReverseHandoffs: PendingReverseHandoff[] = []
    let polylineHits = 0

    for (const s of schedules as Array<Record<string, unknown>>) {
      const uid = s['user_id'] as string

      // C4.5 hard filter — full posts are dropped. `available_seats`
      // is set to 0 by the driver via PATCH /:id/seats when they
      // close a slot manually; we don't want to show those.
      // NULL means the driver never set a seat count (older posts,
      // or a one-time post where the picker wasn't touched) — treat
      // those as "unspecified, allow" rather than "0, reject."
      const availableSeats = s['available_seats'] as number | null
      if (availableSeats != null && availableSeats <= 0) continue

      // Resolve driver endpoint coords. Prefer the cached
      // route_*_geo columns (populated by compute-route), fall back
      // to the active driver_routine. If neither has coords we
      // can't score this schedule at all.
      let dOriginLat: number | null = null
      let dOriginLng: number | null = null
      let dDestLat: number | null = null
      let dDestLng: number | null = null

      const originGeo = s['route_origin_geo'] as { coordinates?: [number, number] } | null
      const destGeo = s['route_destination_geo'] as { coordinates?: [number, number] } | null
      if (originGeo?.coordinates && destGeo?.coordinates) {
        dOriginLng = originGeo.coordinates[0]
        dOriginLat = originGeo.coordinates[1]
        dDestLng = destGeo.coordinates[0]
        dDestLat = destGeo.coordinates[1]
      } else {
        const fromRoutine = routineMap.get(uid)
        if (fromRoutine) {
          dOriginLat = fromRoutine.originLat
          dOriginLng = fromRoutine.originLng
          dDestLat = fromRoutine.destLat
          dDestLng = fromRoutine.destLng
        }
      }
      if (dOriginLat == null || dOriginLng == null || dDestLat == null || dDestLng == null) continue

      const driverBearing = calculateBearing(dOriginLat, dOriginLng, dDestLat, dDestLng)
      const bearingDiff = bearingDifference(userBearing, driverBearing)

      // Time-window hard filter — C4.5 ask. Only enforced when the
      // rider provided a trip_time; without one we can't reason
      // about closeness, and excluding everything would defeat the
      // open-ended search.
      const sTripTime = (s['trip_time'] as string | null) ?? null
      const timeDiff = sTripTime && tripTime ? timeDifferenceMinutes(tripTime, sTripTime) : 0
      if (tripTime && timeDiff > TIME_WINDOW_MINUTES) continue

      const ratingAvg = posterMap.get(uid)?.rating_avg ?? 0
      const driverRating = ratingAvg / 5
      const timeMatch = tripTime ? Math.max(0, 1 - timeDiff / 180) : 0
      const createdAt = (s['created_at'] as string | null) ?? ''

      // Polyline source priority: schedule row (set by compute-route
      // when the post was made) → driver_routines (set when the
      // recurring routine was created with B2's polyline fetch).
      // Covers iOS-projected routine rows that ship coords but no
      // polyline; the cron-projection rows from syncAllRoutines
      // now ship both.
      const scheduleEncoded = (s['route_polyline'] as string | null) ?? null
      const encoded = scheduleEncoded ?? routineMap.get(uid)?.polyline ?? null

      // ─── POLYLINE PATH (preferred) ─────────────────────────────
      if (encoded) {
        polylineHits++
        const line = decodePolyline(encoded)
        if (line.length < 2) {
          // Pathological polyline — fall through to endpoint logic.
        } else {
          const origProj = projectPointOntoPolyline({ lat: oLat, lng: oLng }, line)
          const destProj = projectPointOntoPolyline({ lat: dLat, lng: dLng }, line)
          // Distance to the driver's posted endpoints — used to
          // accept "rider lives near where the driver starts" /
          // "rider's destination is near where the driver ends"
          // as valid pickups/drops even when the actual polyline
          // doesn't pass within the corridor (e.g. carpool buddies
          // in the same town whose homes are off the driver's
          // optimal route).
          const originToDriverOriginM = haversineMetres(oLat, oLng, dOriginLat, dOriginLng)
          const destToDriverDestM = haversineMetres(dLat, dLng, dDestLat, dDestLng)
          const originOnCorridor = origProj.distanceM <= ROUTE_CORRIDOR_METRES
          const originNearStart = originToDriverOriginM <= PICKUP_RADIUS_METRES
          const destOnCorridor = destProj.distanceM <= ROUTE_CORRIDOR_METRES
          const destNearEnd = destToDriverDestM <= DROPOFF_RADIUS_METRES
          // "Effective" pickup fraction-along for ordering checks:
          // if the rider isn't actually on the polyline (near-start
          // pickup), they board at the start, so use frac=0.
          const effectivePickupFrac = originOnCorridor ? origProj.fractionAlong : 0

          // ── Direct match: pickup AND drop are both reachable
          //    (on corridor OR near-endpoint) and ordering holds.
          if (
            (originOnCorridor || originNearStart) &&
            (destOnCorridor || destNearEnd) &&
            effectivePickupFrac < (destOnCorridor ? destProj.fractionAlong : 1)
          ) {
            // Score: how close the rider's pickup/drop are to the
            // route. For on-corridor points use the polyline-distance;
            // for near-endpoint pickups/drops use the endpoint
            // distance scaled by PICKUP/DROPOFF radius (a 1km
            // near-start pickup should score similar to a 1km on-
            // corridor pickup). Take the BEST of the two scales.
            const originFit = originOnCorridor
              ? Math.max(0, 1 - origProj.distanceM / ROUTE_CORRIDOR_METRES)
              : Math.max(0, 1 - originToDriverOriginM / PICKUP_RADIUS_METRES)
            const destFit = destOnCorridor
              ? Math.max(0, 1 - destProj.distanceM / ROUTE_CORRIDOR_METRES)
              : Math.max(0, 1 - destToDriverDestM / DROPOFF_RADIUS_METRES)
            const corridorFit = (originFit + destFit) / 2
            // Direct matches get a +20 base bump so any direct
            // result outranks any handoff result — handoffs are a
            // last-resort suggestion, not a substitute.
            const score = 20 + (corridorFit * 0.7 + timeMatch * 0.2 + driverRating * 0.1) * 80

            scored.push({
              schedule: s,
              driverOriginLat: dOriginLat,
              driverOriginLng: dOriginLng,
              driverDestLat: dDestLat,
              driverDestLng: dDestLng,
              match_type: 'direct',
              relevance_score: Math.round(score),
              time_diff_minutes: Math.round(timeDiff),
              corridor_origin_metres: Math.round(
                originOnCorridor ? origProj.distanceM : originToDriverOriginM,
              ),
              corridor_dest_metres: Math.round(
                destOnCorridor ? destProj.distanceM : destToDriverDestM,
              ),
              transit_handoff: null,
              origin_distance_metres: Math.round(
                haversineMetres(oLat, oLng, dOriginLat, dOriginLng),
              ),
              dest_distance_metres: Math.round(
                haversineMetres(dLat, dLng, dDestLat, dDestLng),
              ),
              bearing_diff_degrees: Math.round(bearingDiff),
              created_at: createdAt,
            })
            continue
          }

          // ── Transit handoff PRE-CHECK (cheap, no API call): defer
          //    actual transit suggestion to a second pass that only
          //    runs for the top-N candidates. The pre-check just
          //    decides whether handoff is *plausible* — pickup is
          //    reachable, dest is off-route, AND the polyline
          //    passes reasonably close to the dest (within
          //    HANDOFF_MAX_PRECHECK_METRES) so transit could
          //    realistically bridge the gap.
          if (
            (originOnCorridor || originNearStart) &&
            !destOnCorridor && !destNearEnd &&
            destProj.distanceM <= HANDOFF_MAX_PRECHECK_METRES &&
            // Rider must not board so late on the polyline that no
            // station downstream of them can be a meaningful drop.
            // See `BOARDS_TOO_LATE_FRACTION` comment.
            effectivePickupFrac <= BOARDS_TOO_LATE_FRACTION
          ) {
            const pickupFit = originOnCorridor
              ? Math.max(0, 1 - origProj.distanceM / ROUTE_CORRIDOR_METRES)
              : Math.max(0, 1 - originToDriverOriginM / PICKUP_RADIUS_METRES)
            // Score how plausible the handoff is so we can rank
            // and cap the pool of drivers we pay API calls for.
            // Lower destProj.distanceM = the polyline gets closer
            // to the rider's destination = transit leg is shorter.
            const destProximity = Math.max(0, 1 - destProj.distanceM / HANDOFF_MAX_PRECHECK_METRES)
            const plausibilityScore =
              (pickupFit * 0.4 + destProximity * 0.4 + timeMatch * 0.1 + driverRating * 0.1) * 20

            pendingHandoffs.push({
              schedule: s,
              driverOriginLat: dOriginLat,
              driverOriginLng: dOriginLng,
              driverDestLat: dDestLat,
              driverDestLng: dDestLng,
              polyline: encoded,
              effectivePickupFrac,
              originOnCorridor,
              originProjMetres: origProj.distanceM,
              originToDriverOriginM,
              destProjMetres: destProj.distanceM,
              timeMatch,
              driverRating,
              timeDiff,
              bearingDiff,
              createdAt,
              plausibilityScore,
            })
            continue
          }

          // ── Reverse-handoff PRE-CHECK (v1.2.1 S2.1) ─────────────
          // Mirror of forward handoff: rider's DROP is reachable
          // (on corridor or near-end) but their PICKUP is NOT, AND
          // the polyline gets close enough to the rider's pickup
          // that transit could realistically bridge the gap.
          //
          // Real-world case: SF→Davis rider × San Jose→Davis driver.
          // Rider's drop (Davis) = driver's destination (near-end).
          // Rider's pickup (SF) sits ~30km from the San Jose→Davis
          // polyline (which passes through Oakland). Rider takes
          // BART SF→MacArthur → driver picks up at MacArthur →
          // rides to Davis together.
          if (
            (destOnCorridor || destNearEnd) &&
            !originOnCorridor && !originNearStart &&
            origProj.distanceM <= HANDOFF_MAX_PRECHECK_METRES
          ) {
            const destFit = destOnCorridor
              ? Math.max(0, 1 - destProj.distanceM / ROUTE_CORRIDOR_METRES)
              : Math.max(0, 1 - destToDriverDestM / DROPOFF_RADIUS_METRES)
            // Closer rider pickup to polyline = shorter transit leg
            // = higher plausibility. Same scoring shape as forward
            // handoff so both compete fairly for the top-N slots.
            const pickupProximity = Math.max(0, 1 - origProj.distanceM / HANDOFF_MAX_PRECHECK_METRES)
            const plausibilityScore =
              (destFit * 0.4 + pickupProximity * 0.4 + timeMatch * 0.1 + driverRating * 0.1) * 20

            pendingReverseHandoffs.push({
              schedule: s,
              driverOriginLat: dOriginLat,
              driverOriginLng: dOriginLng,
              driverDestLat: dDestLat,
              driverDestLng: dDestLng,
              polyline: encoded,
              destOnCorridor,
              pickupProjMetres: origProj.distanceM,
              destProjMetres: destProj.distanceM,
              destToDriverDestM,
              timeMatch,
              driverRating,
              timeDiff,
              bearingDiff,
              createdAt,
              plausibilityScore,
            })
            continue
          }

          // Polyline available but neither direct nor handoff
          // plausible — polyline is authoritative; no fallback.
          // 2026-05-21 v1.2.1 S1 — log the WHY so future debugging
          // doesn't require manually re-tracing the algorithm.
          // The Davis→SF / Davis→San Jose handoff failure that
          // motivated this patch was invisible because this branch
          // silently `continue`d with no record of which gate
          // (corridor / handoff-precheck / boards-too-late) fired.
          {
            const reasons: string[] = []
            if (!originOnCorridor && !originNearStart) {
              reasons.push(`origin ${Math.round(origProj.distanceM)}m off route (corridor ${ROUTE_CORRIDOR_METRES}m, near-start ${PICKUP_RADIUS_METRES}m, dist-to-start ${Math.round(originToDriverOriginM)}m)`)
            }
            if (!destOnCorridor && !destNearEnd) {
              if (destProj.distanceM > HANDOFF_MAX_PRECHECK_METRES) {
                reasons.push(`dest ${Math.round(destProj.distanceM)}m off route, exceeds handoff cap ${HANDOFF_MAX_PRECHECK_METRES}m`)
              } else {
                reasons.push(`dest ${Math.round(destProj.distanceM)}m off route (within handoff cap but other gate blocked)`)
              }
            }
            if (effectivePickupFrac > BOARDS_TOO_LATE_FRACTION) {
              reasons.push(`pickup_frac ${effectivePickupFrac.toFixed(2)} > ${BOARDS_TOO_LATE_FRACTION} (boards too late)`)
            }
            console.log(`[board/search] rider-side rejected schedule ${(s['id'] as string).slice(0, 8)}…: ${reasons.join('; ')}`)
          }
          continue
        }
      }

      // ─── ENDPOINT FALLBACK (pre-Slice-C2 rows) ─────────────────
      const originDistM = haversineMetres(oLat, oLng, dOriginLat, dOriginLng)
      const destDistM = haversineMetres(dLat, dLng, dDestLat, dDestLng)

      if (originDistM > radiusMetres || destDistM > radiusMetres) continue
      if (bearingDiff > 90) continue

      const routeFit = Math.max(0, 1 - (originDistM + destDistM) / (2 * radiusMetres))
      // Endpoint matches score in the same band as handoffs (capped
      // ≤20) since they're a coarse approximation. A direct
      // polyline match will always win when one exists for the
      // same trip.
      const score = (routeFit * 0.7 + timeMatch * 0.2 + driverRating * 0.1) * 20

      scored.push({
        schedule: s,
        driverOriginLat: dOriginLat,
        driverOriginLng: dOriginLng,
        driverDestLat: dDestLat,
        driverDestLng: dDestLng,
        match_type: 'endpoint',
        relevance_score: Math.round(score),
        time_diff_minutes: Math.round(timeDiff),
        corridor_origin_metres: null,
        corridor_dest_metres: null,
        transit_handoff: null,
        origin_distance_metres: Math.round(originDistM),
        dest_distance_metres: Math.round(destDistM),
        bearing_diff_degrees: Math.round(bearingDiff),
        created_at: createdAt,
      })
    }

    if (schedules.length > 0 && polylineHits === 0) {
      // C4.5 ask — surface when compute-route is silently failing
      // across the board. Hitting endpoint-fallback for every
      // candidate means smart-search isn't actually smart yet for
      // this date; check the compute-route logs.
      console.warn(`[board/search] WARNING: 0 of ${schedules.length} candidates on ${tripDate} have a polyline — every match is endpoint-fallback. Check compute-route success rate.`)
    }

    // ── Pass 2: Transit handoff resolution ─────────────────────────
    // For the top-N plausibility-ranked handoff candidates, invoke
    // the real transit engine (same one driving instant-ride
    // dropoff suggestions). Returns ACTUAL transit timing from the
    // Google Directions API — replaces the v1's static-station
    // haversine guess that was producing misleading UX (e.g.
    // suggesting Caltrain for SFO when BART is the actual route).
    const apiKey = process.env['GOOGLE_MAPS_KEY']
    if (pendingHandoffs.length > 0 && apiKey) {
      pendingHandoffs.sort((a, b) => b.plausibilityScore - a.plausibilityScore)
      const toResolve = pendingHandoffs.slice(0, MAX_HANDOFF_CANDIDATES)
      const skipped = pendingHandoffs.length - toResolve.length
      if (skipped > 0) {
        console.log(`[board/search] capped handoff resolution: processing ${toResolve.length} of ${pendingHandoffs.length} plausible candidates`)
      }

      const resolved = await Promise.all(toResolve.map(async (ph) => {
        try {
          const { suggestions } = await computeTransitDropoffSuggestions(
            ph.driverOriginLat, ph.driverOriginLng,
            ph.driverDestLat, ph.driverDestLng,
            dLat, dLng,
            apiKey,
            ph.polyline,
          )
          if (suggestions.length === 0) return null
          // 2026-05-18 — ordering check. The engine returns stations
          // that are geographically close to the rider's destination
          // along the driver's polyline, but it doesn't know about
          // the rider's pickup. We must reject any station whose
          // fractionAlong is < rider's effective pickup fraction —
          // otherwise the driver would have to backtrack from the
          // rider's pickup to drop them at the suggested station.
          // Re-decode the polyline once + project each candidate.
          const line = decodePolyline(ph.polyline)
          const orderedCandidates = suggestions.filter((sug) => {
            const proj = projectPointOntoPolyline(
              { lat: sug.station_lat, lng: sug.station_lng },
              line,
            )
            return proj.fractionAlong >= ph.effectivePickupFrac
          })
          if (orderedCandidates.length === 0) {
            console.log(`[board/search] handoff rejected (no station after rider's pickup) for schedule ${(ph.schedule['id'] as string).slice(0, 8)}… pickup_frac=${ph.effectivePickupFrac.toFixed(2)}`)
            return null
          }
          const best = orderedCandidates[0]
          // Plausibility score is in the 0-20 band (handoff cap);
          // direct matches hold the 20-100 band so handoffs can't
          // outrank a real direct match.
          return {
            ph,
            handoff: best,
            score: Math.round(ph.plausibilityScore),
          }
        } catch (err) {
          console.error(`[board/search] handoff resolution failed for schedule ${(ph.schedule['id'] as string).slice(0, 8)}…:`, err instanceof Error ? err.message : err)
          return null
        }
      }))

      for (const r of resolved) {
        if (!r) continue
        const { ph, handoff, score } = r
        scored.push({
          schedule: ph.schedule,
          driverOriginLat: ph.driverOriginLat,
          driverOriginLng: ph.driverOriginLng,
          driverDestLat: ph.driverDestLat,
          driverDestLng: ph.driverDestLng,
          match_type: 'transit_handoff',
          relevance_score: score,
          time_diff_minutes: Math.round(ph.timeDiff),
          corridor_origin_metres: Math.round(
            ph.originOnCorridor ? ph.originProjMetres : ph.originToDriverOriginM,
          ),
          corridor_dest_metres: null,
          transit_handoff: {
            station_name: handoff.station_name,
            station_place_id: handoff.station_place_id,
            station_address: handoff.station_address,
            station_lat: handoff.station_lat,
            station_lng: handoff.station_lng,
            walk_to_station_minutes: handoff.walk_to_station_minutes,
            transit_to_dest_minutes: handoff.transit_to_dest_minutes,
            total_rider_minutes: handoff.total_rider_minutes,
            transit_option: handoff.transit_options[0] ?? null,
            direction: 'forward',
          },
          origin_distance_metres: Math.round(
            haversineMetres(oLat, oLng, ph.driverOriginLat, ph.driverOriginLng),
          ),
          dest_distance_metres: Math.round(
            haversineMetres(dLat, dLng, handoff.station_lat, handoff.station_lng),
          ),
          bearing_diff_degrees: Math.round(ph.bearingDiff),
          created_at: ph.createdAt,
        })
      }
    } else if (pendingHandoffs.length > 0 && !apiKey) {
      console.warn(`[board/search] ${pendingHandoffs.length} plausible handoff candidates but GOOGLE_MAPS_KEY not set — skipping transit resolution`)
    }

    // ── Pass 3 — Reverse-handoff resolution (v1.2.1 S2.1) ───────
    // Mirror of pass 2. Each pending reverse handoff invokes
    // `computeTransitPickupSuggestions` to find a station along the
    // driver's polyline that the rider can reach via transit from
    // their pickup. Same MAX_HANDOFF_CANDIDATES cap so reverse
    // handoffs don't crowd out forward ones — both compete for the
    // same top-N slots after sorting by plausibility.
    if (pendingReverseHandoffs.length > 0 && apiKey) {
      pendingReverseHandoffs.sort((a, b) => b.plausibilityScore - a.plausibilityScore)
      const toResolveRev = pendingReverseHandoffs.slice(0, MAX_HANDOFF_CANDIDATES)
      const skipped = pendingReverseHandoffs.length - toResolveRev.length
      if (skipped > 0) {
        console.log(`[board/search] capped REVERSE handoff resolution: processing ${toResolveRev.length} of ${pendingReverseHandoffs.length} plausible candidates`)
      }

      const resolvedReverse = await Promise.all(toResolveRev.map(async (ph) => {
        try {
          const { suggestions } = await computeTransitPickupSuggestions(
            ph.driverOriginLat, ph.driverOriginLng,
            ph.driverDestLat, ph.driverDestLng,
            oLat, oLng,  // rider's PICKUP — the off-route point we bridge with transit
            apiKey,
            ph.polyline,
          )
          if (suggestions.length === 0) return null
          // For reverse handoff, the station must be DOWNSTREAM of
          // the rider's pickup-projection on the polyline — otherwise
          // the driver would have to backtrack after picking up the
          // rider. Also must be BEFORE the rider's destination
          // (which is at frac ~1 since destOnCorridor || destNearEnd).
          // Geometrically, valid station frac is roughly [0, 0.95].
          const line = decodePolyline(ph.polyline)
          const orderedCandidates = suggestions.filter((sug) => {
            const proj = projectPointOntoPolyline(
              { lat: sug.station_lat, lng: sug.station_lng },
              line,
            )
            return proj.fractionAlong <= 0.95
          })
          if (orderedCandidates.length === 0) {
            console.log(`[board/search] REVERSE handoff rejected (no station before rider's destination) for schedule ${(ph.schedule['id'] as string).slice(0, 8)}…`)
            return null
          }
          const best = orderedCandidates[0]
          return {
            ph,
            handoff: best,
            score: Math.round(ph.plausibilityScore),
          }
        } catch (err) {
          console.error(`[board/search] REVERSE handoff resolution failed for schedule ${(ph.schedule['id'] as string).slice(0, 8)}…:`, err instanceof Error ? err.message : err)
          return null
        }
      }))

      for (const r of resolvedReverse) {
        if (!r) continue
        const { ph, handoff, score } = r
        scored.push({
          schedule: ph.schedule,
          driverOriginLat: ph.driverOriginLat,
          driverOriginLng: ph.driverOriginLng,
          driverDestLat: ph.driverDestLat,
          driverDestLng: ph.driverDestLng,
          match_type: 'reverse_transit_handoff',
          relevance_score: score,
          time_diff_minutes: Math.round(ph.timeDiff),
          corridor_origin_metres: Math.round(ph.pickupProjMetres),
          corridor_dest_metres: ph.destOnCorridor
            ? Math.round(ph.destProjMetres)
            : Math.round(ph.destToDriverDestM),
          transit_handoff: {
            station_name: handoff.station_name,
            station_place_id: handoff.station_place_id,
            station_address: handoff.station_address,
            station_lat: handoff.station_lat,
            station_lng: handoff.station_lng,
            walk_to_station_minutes: handoff.walk_to_station_minutes,
            transit_to_dest_minutes: handoff.transit_to_dest_minutes,
            total_rider_minutes: handoff.total_rider_minutes,
            transit_option: handoff.transit_options[0] ?? null,
            direction: 'reverse',
          },
          origin_distance_metres: Math.round(
            haversineMetres(oLat, oLng, handoff.station_lat, handoff.station_lng),
          ),
          dest_distance_metres: Math.round(
            haversineMetres(dLat, dLng, ph.driverDestLat, ph.driverDestLng),
          ),
          bearing_diff_degrees: Math.round(ph.bearingDiff),
          created_at: ph.createdAt,
        })
      }
    } else if (pendingReverseHandoffs.length > 0 && !apiKey) {
      console.warn(`[board/search] ${pendingReverseHandoffs.length} plausible REVERSE handoff candidates but GOOGLE_MAPS_KEY not set — skipping transit resolution`)
    }

    // De-dupe by user_id — keep the highest-scoring entry per
    // poster. Without this a driver with three Davis→SF schedules
    // for the same day shows up three times on the rider's screen.
    const bestByUser = new Map<string, ScoredSchedule>()
    for (const entry of scored) {
      const uid = entry.schedule['user_id'] as string
      const prev = bestByUser.get(uid)
      if (!prev || entry.relevance_score > prev.relevance_score) {
        bestByUser.set(uid, entry)
      }
    }
    const deduped = [...bestByUser.values()]

    // Sort by score desc, deterministic tiebreaker by created_at
    // ASC (older posts win when scores tie — gives first-posters
    // a fair shot at visibility before the next refresh).
    deduped.sort((a, b) => {
      if (b.relevance_score !== a.relevance_score) {
        return b.relevance_score - a.relevance_score
      }
      return a.created_at.localeCompare(b.created_at)
    })
    const top = deduped.slice(0, 20)

    const results = top.map((entry) => {
      const s = entry.schedule
      const poster = posterMap.get(s['user_id'] as string) ?? null
      return {
        ...s,
        poster,
        relevance_score: entry.relevance_score,
        match_type: entry.match_type,
        origin_distance_metres: entry.origin_distance_metres,
        dest_distance_metres: entry.dest_distance_metres,
        bearing_diff_degrees: entry.bearing_diff_degrees,
        time_diff_minutes: entry.time_diff_minutes,
        corridor_origin_metres: entry.corridor_origin_metres,
        corridor_dest_metres: entry.corridor_dest_metres,
        transit_handoff: entry.transit_handoff,
        driver_origin_lat: entry.driverOriginLat,
        driver_origin_lng: entry.driverOriginLng,
        driver_dest_lat: entry.driverDestLat,
        driver_dest_lng: entry.driverDestLng,
      }
    })

    const directCount = top.filter((r) => r.match_type === 'direct').length
    const handoffCount = top.filter((r) => r.match_type === 'transit_handoff').length
    const endpointCount = top.filter((r) => r.match_type === 'endpoint').length
    console.log(`[board/search] rider ${(res.locals['userId'] as string).slice(0, 8)}… (${oLat.toFixed(3)},${oLng.toFixed(3)})→(${dLat.toFixed(3)},${dLng.toFixed(3)}) on ${tripDate} → ${results.length} of ${schedules.length} candidates (direct=${directCount} handoff=${handoffCount} endpoint=${endpointCount}, ${polylineHits} with polyline)`)
    res.status(200).json({ results })
  },
)

/**
 * Driver-side smart search (Phase 2, 2026-05-17).
 *
 * Inverted complement to the rider-side path in `/board/search`:
 * the driver gives their (origin, dest, date); we compute the
 * driver's intended polyline once via Google Routes API, then
 * project each rider post's (o, d) onto it to find matches.
 *
 * The geometric primitives are identical to the rider-side loop —
 * we just swap which polyline + which points we project. Direct
 * match means the rider's pickup AND drop both sit on the driver's
 * route (in order). Transit handoff means rider's pickup is on the
 * route but their destination isn't, and we surface a station the
 * driver could drop them at with a real transit leg (same
 * `computeTransitDropoffSuggestions` engine).
 *
 * Returns the same response shape as rider-side so iOS decoders
 * don't need to branch on mode. `match_type` semantics shift
 * slightly — "Drop + transit" now means "you can drop this rider
 * at X, they finish on transit" rather than "the driver will drop
 * you there." The UI copy ("Drop + transit") works for both.
 */
async function runDriverSideSearch(args: {
  api: Request
  res: Response
  next: NextFunction
  oLat: number
  oLng: number
  dLat: number
  dLng: number
  tripDate: string
  tripTime: string | null
  userBearing: number
}): Promise<void> {
  const { res, next, oLat, oLng, dLat, dLng, tripDate, tripTime, userBearing } = args
  const apiKey = process.env['GOOGLE_MAPS_KEY']
  if (!apiKey) {
    res.status(500).json({
      error: { code: 'CONFIG_ERROR', message: 'Google Maps API key not configured' },
    })
    return
  }

  // 1. Compute driver's intended polyline. Single Routes API call
  //    per search, shared across all candidates.
  const queryRoute = await fetchDrivingRoute(oLat, oLng, dLat, dLng, apiKey)
  if (!queryRoute?.polyline) {
    res.status(404).json({
      error: {
        code: 'NO_ROUTE',
        message: 'Could not compute a driving route from your origin to your destination.',
      },
    })
    return
  }
  const queryLine: LatLng[] = decodePolyline(queryRoute.polyline)

  // Same tuning constants as the rider-side path. Kept in sync so
  // both directions match the same UX guarantees.
  // 2026-05-21 v1.2.1 S1 — HANDOFF_MAX_PRECHECK_METRES bumped 30km → 75km;
  // see comment on rider-side path for full rationale.
  const ROUTE_CORRIDOR_METRES = 2_000
  const HANDOFF_MAX_PRECHECK_METRES = 75_000
  const TIME_WINDOW_MINUTES = 120
  const PICKUP_RADIUS_METRES = 10_000
  const DROPOFF_RADIUS_METRES = 10_000
  const MAX_HANDOFF_CANDIDATES = 5

  // 2. Pull rider candidates for the date.
  const { data: riderPosts, error: riderErr } = await supabaseAdmin
    .from('ride_schedules')
    .select('*')
    .eq('mode', 'rider')
    .eq('trip_date', tripDate)
    .order('trip_time', { ascending: true })
    .limit(200)

  if (riderErr) { next(riderErr); return }
  if (!riderPosts || riderPosts.length === 0) {
    res.status(200).json({ results: [] })
    return
  }

  // 3. Poster info for trust badges (same shape as rider-side).
  // v1.2 F5.2 — also pulls accessibility flags for the ♿ pill.
  const userIds = [...new Set(riderPosts.map((s: Record<string, unknown>) => s['user_id'] as string))]
  const { data: posterRows } = await supabaseAdmin
    .from('users')
    .select(
      'id, full_name, avatar_url, rating_avg, rating_count, is_driver, '
      + 'stripe_customer_id, default_payment_method_id, wallet_balance, '
      + 'has_accessibility_needs, accessibility_profile' as never,
    )
    .in('id', userIds)

  type PosterRow = {
    id: string
    full_name: string | null
    avatar_url: string | null
    rating_avg: number | null
    rating_count: number | null
    is_driver: boolean | null
    stripe_customer_id: string | null
    default_payment_method_id: string | null
    wallet_balance: number | null
    has_accessibility_needs: boolean | null
    accessibility_profile: { needs_wheelchair?: boolean } | null
  }
  const posterMap = new Map(
    ((posterRows ?? []) as unknown as PosterRow[]).map((u) => {
      const hasAccess = u.has_accessibility_needs === true
      const needsWheelchair = hasAccess && u.accessibility_profile?.needs_wheelchair === true
      return [
        u.id,
        {
          id: u.id,
          full_name: u.full_name,
          avatar_url: u.avatar_url,
          rating_avg: u.rating_avg,
          rating_count: u.rating_count ?? 0,
          is_driver: u.is_driver ?? false,
          has_payment_method:
            (!!u.stripe_customer_id && !!u.default_payment_method_id)
            || ((u.wallet_balance ?? 0) > 0),
          has_accessibility_needs: hasAccess,
          needs_wheelchair: needsWheelchair,
        },
      ]
    }),
  )

  // 4. Score loop — INVERTED. Project rider candidate's (o, d) onto
  //    the DRIVER'S query polyline.
  // 2026-05-21 v1.2.1 S2.1 — added 'reverse_transit_handoff'. See
  // rider-side path for full rationale (line ~1183).
  type MatchType = 'direct' | 'transit_handoff' | 'reverse_transit_handoff'
  type HandoffInfo = {
    station_name: string
    station_place_id: string
    station_address: string
    station_lat: number
    station_lng: number
    walk_to_station_minutes: number
    transit_to_dest_minutes: number
    total_rider_minutes: number
    transit_option: TransitOption | null
    direction: 'forward' | 'reverse'
  }
  type ScoredRider = {
    schedule: Record<string, unknown>
    match_type: MatchType
    relevance_score: number
    time_diff_minutes: number
    corridor_origin_metres: number | null
    corridor_dest_metres: number | null
    transit_handoff: HandoffInfo | null
    origin_distance_metres: number
    dest_distance_metres: number
    bearing_diff_degrees: number
    created_at: string
  }
  type PendingRiderHandoff = {
    schedule: Record<string, unknown>
    riderPickupLat: number
    riderPickupLng: number
    riderDropLat: number
    riderDropLng: number
    effectivePickupFrac: number
    originOnCorridor: boolean
    originProjMetres: number
    originToDriverOriginM: number
    destProjMetres: number
    timeMatch: number
    driverRating: number
    timeDiff: number
    bearingDiff: number
    createdAt: string
    plausibilityScore: number
  }
  const scored: ScoredRider[] = []
  const pendingHandoffs: PendingRiderHandoff[] = []
  // 2026-05-21 v1.2.1 S2.1 — reverse-handoff candidates: rider's
  // DROP is reachable (on corridor or near-end) but their PICKUP is
  // off-route. Rider takes transit from their pickup to a station
  // along the driver's polyline, then rides with driver to dest.
  type PendingRiderReverseHandoff = {
    schedule: Record<string, unknown>
    riderPickupLat: number
    riderPickupLng: number
    riderDropLat: number
    riderDropLng: number
    destOnCorridor: boolean
    pickupProjMetres: number
    destProjMetres: number
    destToDriverDestM: number
    timeMatch: number
    driverRating: number
    timeDiff: number
    bearingDiff: number
    createdAt: string
    plausibilityScore: number
  }
  const pendingReverseHandoffs: PendingRiderReverseHandoff[] = []

  for (const s of riderPosts as Array<Record<string, unknown>>) {
    const uid = s['user_id'] as string

    // Resolve rider candidate's pickup/drop coords. Prefer the
    // explicit lat/lng columns (set by iOS post flow) then fall
    // back to the cached PostGIS geometry columns.
    const originGeo = s['route_origin_geo'] as { coordinates?: [number, number] } | null
    const destGeo = s['route_destination_geo'] as { coordinates?: [number, number] } | null
    const riderPickupLat = (s['origin_lat'] as number | null)
      ?? originGeo?.coordinates?.[1] ?? null
    const riderPickupLng = (s['origin_lng'] as number | null)
      ?? originGeo?.coordinates?.[0] ?? null
    const riderDropLat = (s['dest_lat'] as number | null)
      ?? destGeo?.coordinates?.[1] ?? null
    const riderDropLng = (s['dest_lng'] as number | null)
      ?? destGeo?.coordinates?.[0] ?? null
    if (riderPickupLat == null || riderPickupLng == null
      || riderDropLat == null || riderDropLng == null) continue

    // Bearing alignment (rider's intended direction vs driver's).
    const riderBearing = calculateBearing(riderPickupLat, riderPickupLng, riderDropLat, riderDropLng)
    const bearingDiff = bearingDifference(userBearing, riderBearing)

    // Time window hard filter — when the driver passes a time,
    // exclude rider posts more than ±2h off it.
    const sTripTime = (s['trip_time'] as string | null) ?? null
    const timeDiff = sTripTime && tripTime
      ? timeDifferenceMinutes(tripTime, sTripTime)
      : 0
    if (tripTime && timeDiff > TIME_WINDOW_MINUTES) continue

    const ratingAvg = posterMap.get(uid)?.rating_avg ?? 0
    const driverRating = ratingAvg / 5  // re-used field name; means "poster rating"
    const timeMatch = tripTime ? Math.max(0, 1 - timeDiff / 180) : 0
    const createdAt = (s['created_at'] as string | null) ?? ''

    // Project rider's points onto driver's query polyline.
    const pickupProj = projectPointOntoPolyline({ lat: riderPickupLat, lng: riderPickupLng }, queryLine)
    const dropProj = projectPointOntoPolyline({ lat: riderDropLat, lng: riderDropLng }, queryLine)
    const pickupToDriverOriginM = haversineMetres(riderPickupLat, riderPickupLng, oLat, oLng)
    const dropToDriverDestM = haversineMetres(riderDropLat, riderDropLng, dLat, dLng)
    const originOnCorridor = pickupProj.distanceM <= ROUTE_CORRIDOR_METRES
    const originNearStart = pickupToDriverOriginM <= PICKUP_RADIUS_METRES
    const destOnCorridor = dropProj.distanceM <= ROUTE_CORRIDOR_METRES
    const destNearEnd = dropToDriverDestM <= DROPOFF_RADIUS_METRES
    const effectivePickupFrac = originOnCorridor ? pickupProj.fractionAlong : 0

    // Direct match — driver can carry the rider end-to-end.
    if (
      (originOnCorridor || originNearStart) &&
      (destOnCorridor || destNearEnd) &&
      effectivePickupFrac < (destOnCorridor ? dropProj.fractionAlong : 1)
    ) {
      const originFit = originOnCorridor
        ? Math.max(0, 1 - pickupProj.distanceM / ROUTE_CORRIDOR_METRES)
        : Math.max(0, 1 - pickupToDriverOriginM / PICKUP_RADIUS_METRES)
      const destFit = destOnCorridor
        ? Math.max(0, 1 - dropProj.distanceM / ROUTE_CORRIDOR_METRES)
        : Math.max(0, 1 - dropToDriverDestM / DROPOFF_RADIUS_METRES)
      const corridorFit = (originFit + destFit) / 2
      const score = 20 + (corridorFit * 0.7 + timeMatch * 0.2 + driverRating * 0.1) * 80

      scored.push({
        schedule: s,
        match_type: 'direct',
        relevance_score: Math.round(score),
        time_diff_minutes: Math.round(timeDiff),
        corridor_origin_metres: Math.round(
          originOnCorridor ? pickupProj.distanceM : pickupToDriverOriginM,
        ),
        corridor_dest_metres: Math.round(
          destOnCorridor ? dropProj.distanceM : dropToDriverDestM,
        ),
        transit_handoff: null,
        origin_distance_metres: Math.round(pickupToDriverOriginM),
        dest_distance_metres: Math.round(dropToDriverDestM),
        bearing_diff_degrees: Math.round(bearingDiff),
        created_at: createdAt,
      })
      continue
    }

    // Transit handoff pre-check — pickup reachable AND dest off
    // route AND polyline gets close enough to dest to be plausible.
    // Also reject when the rider boards so late that no downstream
    // station could possibly help (see `BOARDS_TOO_LATE_FRACTION`
    // on the rider-side path; same logic mirrored here).
    const handoffEligible =
      (originOnCorridor || originNearStart) &&
      !destOnCorridor && !destNearEnd &&
      dropProj.distanceM <= HANDOFF_MAX_PRECHECK_METRES &&
      effectivePickupFrac <= 0.85
    if (handoffEligible) {
      const pickupFit = originOnCorridor
        ? Math.max(0, 1 - pickupProj.distanceM / ROUTE_CORRIDOR_METRES)
        : Math.max(0, 1 - pickupToDriverOriginM / PICKUP_RADIUS_METRES)
      const destProximity = Math.max(0, 1 - dropProj.distanceM / HANDOFF_MAX_PRECHECK_METRES)
      const plausibilityScore =
        (pickupFit * 0.4 + destProximity * 0.4 + timeMatch * 0.1 + driverRating * 0.1) * 20

      pendingHandoffs.push({
        schedule: s,
        riderPickupLat,
        riderPickupLng,
        riderDropLat,
        riderDropLng,
        effectivePickupFrac,
        originOnCorridor,
        originProjMetres: pickupProj.distanceM,
        originToDriverOriginM: pickupToDriverOriginM,
        destProjMetres: dropProj.distanceM,
        timeMatch,
        driverRating,
        timeDiff,
        bearingDiff,
        createdAt,
        plausibilityScore,
      })
      continue
    }

    // ── Reverse-handoff pre-check (v1.2.1 S2.1) ─────────────────
    // Driver-side mirror of the rider-side reverse-handoff branch.
    // The rider candidate's DROP is reachable but their PICKUP is
    // off-route. Rider takes transit from pickup → station along
    // driver's polyline → meets driver, rides together to dest.
    const reverseHandoffEligible =
      (destOnCorridor || destNearEnd) &&
      !originOnCorridor && !originNearStart &&
      pickupProj.distanceM <= HANDOFF_MAX_PRECHECK_METRES
    if (reverseHandoffEligible) {
      const destFit = destOnCorridor
        ? Math.max(0, 1 - dropProj.distanceM / ROUTE_CORRIDOR_METRES)
        : Math.max(0, 1 - dropToDriverDestM / DROPOFF_RADIUS_METRES)
      const pickupProximity = Math.max(0, 1 - pickupProj.distanceM / HANDOFF_MAX_PRECHECK_METRES)
      const plausibilityScore =
        (destFit * 0.4 + pickupProximity * 0.4 + timeMatch * 0.1 + driverRating * 0.1) * 20

      pendingReverseHandoffs.push({
        schedule: s,
        riderPickupLat,
        riderPickupLng,
        riderDropLat,
        riderDropLng,
        destOnCorridor,
        pickupProjMetres: pickupProj.distanceM,
        destProjMetres: dropProj.distanceM,
        destToDriverDestM: dropToDriverDestM,
        timeMatch,
        driverRating,
        timeDiff,
        bearingDiff,
        createdAt,
        plausibilityScore,
      })
    } else {
      // 2026-05-21 v1.2.1 S1 — log silent rejections for driver-side
      // path symmetry (rider-side already logs at line ~1444).
      // Without this, the Davis→SF rider × Davis→San Jose driver
      // case (and its 4 sibling cross-corridor cases) disappear
      // with no trace.
      const reasons: string[] = []
      if (!originOnCorridor && !originNearStart) {
        reasons.push(`rider pickup ${Math.round(pickupProj.distanceM)}m off route (corridor ${ROUTE_CORRIDOR_METRES}m, near-start ${PICKUP_RADIUS_METRES}m, dist-to-start ${Math.round(pickupToDriverOriginM)}m)`)
      }
      if (!destOnCorridor && !destNearEnd) {
        if (dropProj.distanceM > HANDOFF_MAX_PRECHECK_METRES) {
          reasons.push(`rider drop ${Math.round(dropProj.distanceM)}m off route, exceeds handoff cap ${HANDOFF_MAX_PRECHECK_METRES}m`)
        } else {
          reasons.push(`rider drop ${Math.round(dropProj.distanceM)}m off route (within handoff cap; other gate blocked)`)
        }
      }
      if (effectivePickupFrac > 0.85) {
        reasons.push(`pickup_frac ${effectivePickupFrac.toFixed(2)} > 0.85 (rider boards too late for any downstream station)`)
      }
      console.log(`[board/search:driver] rejected rider schedule ${(s['id'] as string).slice(0, 8)}…: ${reasons.join('; ')}`)
    }
  }

  // Pass 2 — resolve handoffs through the real transit engine
  // (same engine the rider-side uses). Driver's query is the
  // origin→dest pair; rider's drop is the final destination we
  // need transit suggestions for.
  if (pendingHandoffs.length > 0) {
    pendingHandoffs.sort((a, b) => b.plausibilityScore - a.plausibilityScore)
    const toResolve = pendingHandoffs.slice(0, MAX_HANDOFF_CANDIDATES)
    const skipped = pendingHandoffs.length - toResolve.length
    if (skipped > 0) {
      console.log(`[board/search:driver] capped handoff resolution: processing ${toResolve.length} of ${pendingHandoffs.length} plausible candidates`)
    }

    const resolved = await Promise.all(toResolve.map(async (ph) => {
      try {
        const { suggestions } = await computeTransitDropoffSuggestions(
          oLat, oLng,
          dLat, dLng,
          ph.riderDropLat, ph.riderDropLng,
          apiKey,
          queryRoute.polyline,
        )
        if (suggestions.length === 0) return null
        // Ordering check — same as rider-side path. Reject any
        // suggestion whose fraction-along is before the rider's
        // pickup; otherwise the driver would need to backtrack.
        const orderedCandidates = suggestions.filter((sug) => {
          const proj = projectPointOntoPolyline(
            { lat: sug.station_lat, lng: sug.station_lng },
            queryLine,
          )
          return proj.fractionAlong >= ph.effectivePickupFrac
        })
        if (orderedCandidates.length === 0) {
          console.log(`[board/search:driver] handoff rejected (no station after rider's pickup) for schedule ${(ph.schedule['id'] as string).slice(0, 8)}… pickup_frac=${ph.effectivePickupFrac.toFixed(2)}`)
          return null
        }
        const best = orderedCandidates[0]
        return {
          ph,
          handoff: best,
          score: Math.round(ph.plausibilityScore),
        }
      } catch (err) {
        console.error(`[board/search:driver] handoff resolution failed for schedule ${(ph.schedule['id'] as string).slice(0, 8)}…:`, err instanceof Error ? err.message : err)
        return null
      }
    }))

    for (const r of resolved) {
      if (!r) continue
      const { ph, handoff, score } = r
      scored.push({
        schedule: ph.schedule,
        match_type: 'transit_handoff',
        relevance_score: score,
        time_diff_minutes: Math.round(ph.timeDiff),
        corridor_origin_metres: Math.round(
          ph.originOnCorridor ? ph.originProjMetres : ph.originToDriverOriginM,
        ),
        corridor_dest_metres: null,
        transit_handoff: {
          station_name: handoff.station_name,
          station_place_id: handoff.station_place_id,
          station_address: handoff.station_address,
          station_lat: handoff.station_lat,
          station_lng: handoff.station_lng,
          walk_to_station_minutes: handoff.walk_to_station_minutes,
          transit_to_dest_minutes: handoff.transit_to_dest_minutes,
          total_rider_minutes: handoff.total_rider_minutes,
          transit_option: handoff.transit_options[0] ?? null,
          direction: 'forward',
        },
        origin_distance_metres: Math.round(
          haversineMetres(ph.riderPickupLat, ph.riderPickupLng, oLat, oLng),
        ),
        dest_distance_metres: Math.round(
          haversineMetres(ph.riderDropLat, ph.riderDropLng, handoff.station_lat, handoff.station_lng),
        ),
        bearing_diff_degrees: Math.round(ph.bearingDiff),
        created_at: ph.createdAt,
      })
    }
  }

  // ── Pass 3 — Reverse-handoff resolution (v1.2.1 S2.1) ─────────
  // Mirror of pass 2. Rider's PICKUP is the off-route point; transit
  // engine finds stations on driver's polyline that the rider can
  // reach from their pickup.
  if (pendingReverseHandoffs.length > 0) {
    pendingReverseHandoffs.sort((a, b) => b.plausibilityScore - a.plausibilityScore)
    const toResolveRev = pendingReverseHandoffs.slice(0, MAX_HANDOFF_CANDIDATES)
    const skipped = pendingReverseHandoffs.length - toResolveRev.length
    if (skipped > 0) {
      console.log(`[board/search:driver] capped REVERSE handoff resolution: processing ${toResolveRev.length} of ${pendingReverseHandoffs.length} plausible candidates`)
    }

    const resolvedRev = await Promise.all(toResolveRev.map(async (ph) => {
      try {
        const { suggestions } = await computeTransitPickupSuggestions(
          oLat, oLng,
          dLat, dLng,
          ph.riderPickupLat, ph.riderPickupLng,
          apiKey,
          queryRoute.polyline,
        )
        if (suggestions.length === 0) return null
        // For reverse handoff, station must be BEFORE rider's drop
        // on the polyline (frac < 1) — otherwise driver would
        // already be past where the rider needs to get off.
        const orderedCandidates = suggestions.filter((sug) => {
          const proj = projectPointOntoPolyline(
            { lat: sug.station_lat, lng: sug.station_lng },
            queryLine,
          )
          return proj.fractionAlong <= 0.95
        })
        if (orderedCandidates.length === 0) {
          console.log(`[board/search:driver] REVERSE handoff rejected (no station before rider's destination) for schedule ${(ph.schedule['id'] as string).slice(0, 8)}…`)
          return null
        }
        const best = orderedCandidates[0]
        return { ph, handoff: best, score: Math.round(ph.plausibilityScore) }
      } catch (err) {
        console.error(`[board/search:driver] REVERSE handoff resolution failed for schedule ${(ph.schedule['id'] as string).slice(0, 8)}…:`, err instanceof Error ? err.message : err)
        return null
      }
    }))

    for (const r of resolvedRev) {
      if (!r) continue
      const { ph, handoff, score } = r
      scored.push({
        schedule: ph.schedule,
        match_type: 'reverse_transit_handoff',
        relevance_score: score,
        time_diff_minutes: Math.round(ph.timeDiff),
        corridor_origin_metres: Math.round(ph.pickupProjMetres),
        corridor_dest_metres: ph.destOnCorridor
          ? Math.round(ph.destProjMetres)
          : Math.round(ph.destToDriverDestM),
        transit_handoff: {
          station_name: handoff.station_name,
          station_place_id: handoff.station_place_id,
          station_address: handoff.station_address,
          station_lat: handoff.station_lat,
          station_lng: handoff.station_lng,
          walk_to_station_minutes: handoff.walk_to_station_minutes,
          // For reverse: transit FROM rider's pickup TO station.
          transit_to_dest_minutes: handoff.transit_to_dest_minutes,
          total_rider_minutes: handoff.total_rider_minutes,
          transit_option: handoff.transit_options[0] ?? null,
          direction: 'reverse',
        },
        origin_distance_metres: Math.round(
          haversineMetres(ph.riderPickupLat, ph.riderPickupLng, handoff.station_lat, handoff.station_lng),
        ),
        dest_distance_metres: Math.round(
          haversineMetres(ph.riderDropLat, ph.riderDropLng, dLat, dLng),
        ),
        bearing_diff_degrees: Math.round(ph.bearingDiff),
        created_at: ph.createdAt,
      })
    }
  }

  // De-dupe by user_id, sort by score with created_at tiebreaker,
  // top 20.
  const bestByUser = new Map<string, ScoredRider>()
  for (const entry of scored) {
    const uid = entry.schedule['user_id'] as string
    const prev = bestByUser.get(uid)
    if (!prev || entry.relevance_score > prev.relevance_score) {
      bestByUser.set(uid, entry)
    }
  }
  const deduped = [...bestByUser.values()]
  deduped.sort((a, b) => {
    if (b.relevance_score !== a.relevance_score) {
      return b.relevance_score - a.relevance_score
    }
    return a.created_at.localeCompare(b.created_at)
  })
  const top = deduped.slice(0, 20)

  const results = top.map((entry) => {
    const s = entry.schedule
    const poster = posterMap.get(s['user_id'] as string) ?? null
    return {
      ...s,
      poster,
      relevance_score: entry.relevance_score,
      match_type: entry.match_type,
      origin_distance_metres: entry.origin_distance_metres,
      dest_distance_metres: entry.dest_distance_metres,
      bearing_diff_degrees: entry.bearing_diff_degrees,
      time_diff_minutes: entry.time_diff_minutes,
      corridor_origin_metres: entry.corridor_origin_metres,
      corridor_dest_metres: entry.corridor_dest_metres,
      transit_handoff: entry.transit_handoff,
      driver_origin_lat: oLat,
      driver_origin_lng: oLng,
      driver_dest_lat: dLat,
      driver_dest_lng: dLng,
    }
  })

  const directCount = top.filter((r) => r.match_type === 'direct').length
  const handoffCount = top.filter((r) => r.match_type === 'transit_handoff').length
  console.log(`[board/search:driver] driver ${(res.locals['userId'] as string).slice(0, 8)}… (${oLat.toFixed(3)},${oLng.toFixed(3)})→(${dLat.toFixed(3)},${dLng.toFixed(3)}) on ${tripDate} → ${results.length} of ${riderPosts.length} rider posts (direct=${directCount} handoff=${handoffCount})`)
  res.status(200).json({ results })
}

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

    // `end_date` filter (audit B3, 2026-05-13): drop routines whose
    // user-set end date is already in the past. `is.null OR gte today`
    // covers open-ended routines + still-current ones; expired routines
    // are quietly skipped so a "summer carpool" doesn't keep generating
    // FCM noise in the fall.
    const todayDateString = new Date().toISOString().split('T')[0] ?? ''
    const { data: routines, error: routineErr } = await supabaseAdmin
      .from('driver_routines')
      .select('user_id, destination_bearing, departure_time, arrival_time, end_date, users!inner(is_driver)')
      .eq('is_active', true)
      .eq('users.is_driver', targetIsDriver)
      .or(`end_date.is.null,end_date.gte.${todayDateString}`)

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

    // 2026-05-06 — request-time `dropoff_suggestion` insert removed.
    // The chat doesn't open until the driver accepts; once they do,
    // the dropoff proposal card comes from the driver's
    // DropoffSelectionPage transit pick (accept-board flow). Pre-
    // inserting at request time produced a stale rider-attributed
    // proposal that cluttered the chat once the driver added their
    // own. Single source of truth = driver's pick, surfaced
    // contextually when chat actually opens.

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

    // 2026-05-06 — request-time `pickup_suggestion` insert removed.
    // The pickup proposal card now appears in chat at phase
    // transition: either when the driver accepts a pre-confirmed-
    // dropoff ride (accept-board) or when the dropoff is confirmed
    // and Step 2 begins (accept-location). Both paths insert the
    // same payload below. Pre-inserting at request time produced
    // an out-of-order chat where the rider's pickup proposal sat
    // above the driver's later dropoff proposal, forcing the user
    // to scroll up to act on pickup after dropoff agreement.

    // Slice 9.5 (2026-04-30) — rider-posted rides now use the
    // pre-confirm path above (both pickup + dropoff auto-confirmed
    // via `preConfirmPickup`/`preConfirmDropoff` gates). The earlier
    // 9.4 "two proposals at offer-accept time" was reversed after
    // CTO review: auto-confirm + chat-level "Change pickup / dropoff"
    // affordance is cleaner than forcing two Accept taps up front.

    // Fetch requester's name + avatar for the notification.
    // 2026-05-18 Slice 1 — added `avatar_url` so the driver's inbox
    // row can render the requester's photo (parity with the rider's
    // board_offer row which already carries `driver_avatar_url`).
    const { data: requester } = await supabaseAdmin
      .from('users')
      .select('full_name, avatar_url')
      .eq('id', userId)
      .single()

    const requesterName = requester?.full_name ?? 'Someone'
    const requesterAvatarURL = (requester?.avatar_url as string | null) ?? ''
    const actionLabel = schedule.mode === 'driver'
      ? `${requesterName} wants to join your ride`
      : `${requesterName} offered to drive you`

    // Broadcast via Realtime to poster (non-blocking)
    void realtimeBroadcast(`board:${schedule.user_id}`, 'board_request', {
      type: 'board_request',
      ride_id: ride.id,
      schedule_id: schedule.id,
      requester_name: requesterName,
      requester_avatar_url: requesterAvatarURL,
      message: actionLabel,
      route: `${schedule.origin_address} → ${schedule.dest_address}`,
      trip_date: schedule.trip_date,
      trip_time: schedule.trip_time,
      requester_destination_name: body.destination_name ?? null,
      destination_flexible: body.destination_flexible ?? false,
      requester_note: requesterNote,
    })

    // 2026-05-18 Slice 3 — unified copy pattern across board flows:
    // title = narrative ("X wants to join your ride"); body = route +
    // date. Was: title = "Ride Board Request" (category label) +
    // body = actionLabel (narrative). The category-label title felt
    // generic on the lock screen ("Ride Board Request" tells you
    // nothing); the narrative reads much faster at a glance.
    const requestRouteStr = `${schedule.origin_address} → ${schedule.dest_address}`
    const requestDateStr = formatTripDateForBody(schedule.trip_date as string | null | undefined)
    const requestBody = joinBodyParts([requestRouteStr, requestDateStr])

    // Persist notification in the notifications table (non-blocking)
    supabaseAdmin.from('notifications').insert({
      user_id: schedule.user_id,
      type: 'board_request',
      title: actionLabel,
      body: requestBody,
      data: {
        ride_id: ride.id,
        schedule_id: schedule.id,
        requester_name: requesterName,
        requester_avatar_url: requesterAvatarURL,
        route: requestRouteStr,
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
        title: actionLabel,
        body: requestBody,
        data: {
          type: 'board_request',
          ride_id: ride.id,
          schedule_id: schedule.id,
          requester_name: requesterName,
          requester_avatar_url: requesterAvatarURL,
        },
        // iOS: surface Accept / Decline buttons on the lock-screen
        // banner. Category id matches `PushManager.boardRequestCategory`.
        category: 'BOARD_REQUEST',
      })
    } else {
      // 2026-05-23 — Email fallback for posters without push tokens.
      // Without this, a driver who posted a trip but doesn't have
      // the app installed silently misses every rider request and
      // thinks their post got no traction. Fire-and-forget; helper
      // handles all failure modes internally.
      void sendNoPushFallbackEmail({
        recipientUserId: schedule.user_id as string,
        eventKind: 'board_request',
        routeStr: requestRouteStr,
        tripDate: (schedule.trip_date as string | null) ?? null,
        tripTime: (schedule.trip_time as string | null) ?? null,
        actorName: requesterName,
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

    // Fetch the schedule. Pull origin_place_id + trip_date + trip_time +
    // route_name so we can detect routine-projected rows and tombstone
    // the date on the parent routine — without that, the next sync
    // resurrects the row the user just deleted.
    //
    // Two routine-projection origins exist:
    //   (a) server projection (cron + per-user) uses
    //       origin_place_id = `routine:{id}` — direct match below.
    //   (b) iOS / web submission-time projection (before audit 068
    //       landed) wrote the REAL Google place_id. For those rows the
    //       prefix doesn't match, so we fall back to looking up a
    //       matching routine by (user_id, route_name, day_of_week,
    //       time) and tombstone via routine.id. Without this fallback,
    //       deleting a legacy client-projected row let it resurrect
    //       on the next cron pass.
    const { data: schedule, error: fetchErr } = await supabaseAdmin
      .from('ride_schedules')
      .select('id, user_id, origin_place_id, trip_date, trip_time, route_name')
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

    // Resolve the parent routine (if any) so we can append the
    // deleted date to skip_dates and prevent the next sync from
    // resurrecting the row. Best-effort — DB errors here only affect
    // resurrection-prevention; the underlying delete still goes
    // through.
    const originPlaceID = schedule.origin_place_id as string | null
    const tripDate = schedule.trip_date as string | null
    const tripTime = schedule.trip_time as string | null
    const routeName = schedule.route_name as string | null

    let parentRoutineID: string | null = null
    const routineMatch = originPlaceID?.match(/^routine:([0-9a-f-]+)/i)
    if (routineMatch) {
      parentRoutineID = routineMatch[1] ?? null
    } else if (tripDate && tripTime && routeName) {
      // Fallback path (audit B1, 2026-05-13): legacy client-projected
      // rows used the real Google place_id. Match the parent routine
      // by (user_id, route_name, day_of_week contains trip_date's DOW,
      // time matches departure_time OR arrival_time). At most one
      // routine should match — if multiple do, tombstone the first
      // one (better than nothing; users would only have duplicates
      // here by manually creating two identical routines).
      const tripDoW = new Date(`${tripDate}T00:00:00Z`).getUTCDay()
      const { data: candidates } = await supabaseAdmin
        .from('driver_routines')
        .select('id, day_of_week, departure_time, arrival_time')
        .eq('user_id', userId)
        .eq('route_name', routeName)
        .eq('is_active', true)
      const match = (candidates ?? []).find((r) => {
        const dows = (r['day_of_week'] as number[] | null) ?? []
        if (!dows.includes(tripDoW)) return false
        const dep = r['departure_time'] as string | null
        const arr = r['arrival_time'] as string | null
        return dep === tripTime || arr === tripTime
      })
      parentRoutineID = (match?.['id'] as string | undefined) ?? null
    }

    if (parentRoutineID && tripDate) {
      const { data: routineRow } = await supabaseAdmin
        .from('driver_routines')
        .select('skip_dates')
        .eq('id', parentRoutineID)
        .single()
      const existing = ((routineRow?.skip_dates as string[] | null) ?? [])
      if (!existing.includes(tripDate)) {
        const updated = [...existing, tripDate]
        const { error: skipErr } = await supabaseAdmin
          .from('driver_routines')
          .update({ skip_dates: updated })
          .eq('id', parentRoutineID)
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
      .select('id, rider_id, driver_id, status, destination_name, schedule_id, origin, origin_name, dropoff_confirmed, pickup_confirmed')
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

    // 2026-05-06 — when the chat is opening with dropoff ALREADY
    // pre-confirmed (rider chose driver's destination at request
    // time), insert the rider's pickup_suggestion now so Step 2
    // has its proposal card. The Option B DropoffSelectionPage
    // path is skipped in this branch (no dropoff to negotiate),
    // so without this insert the chat would open at .pickup phase
    // with no card to act on. Gated on the rider having a custom
    // pickup (origin coord exists, pickup not pre-confirmed) —
    // when both pickup and dropoff were pre-confirmed at request
    // time, no proposal is needed at all and chat opens fully
    // confirmed.
    if (ride.dropoff_confirmed && !ride.pickup_confirmed && ride.origin) {
      const proposerId = ride.rider_id
      const pickupCoords = (ride.origin as { coordinates: [number, number] }).coordinates
      const pickupName = ride.origin_name ?? 'the rider\'s requested pickup'
      const { data: pickupMsg, error: pmErr } = await supabaseAdmin
        .from('messages')
        .insert({
          ride_id: rideId,
          sender_id: proposerId,
          content: `Pickup at ${pickupName}`,
          type: 'pickup_suggestion',
          meta: {
            lat: pickupCoords[1],
            lng: pickupCoords[0],
            name: pickupName,
            proposed_by: proposerId,
          },
        })
        .select('id, ride_id, sender_id, content, type, meta, created_at')
        .single()

      if (pmErr) {
        console.error('Failed to insert pickup_suggestion at accept-board:', pmErr.message)
      } else if (pickupMsg) {
        void realtimeBroadcast(`chat:${rideId}`, 'new_message', pickupMsg as Record<string, unknown>)
        void realtimeBroadcast(`chat-badge:${rideId}`, 'new_message', pickupMsg as Record<string, unknown>)
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
    // 2026-05-05 PR 2 — body extended with optional `reason`. Older
    // iOS clients still send `{ ride_id }` only; the destructure
    // below is compatible with both shapes.
    const { ride_id: rideId, reason } = req.body as {
      ride_id?: string
      reason?: string
    }

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

    // 2026-05-05 PR 2 — log analytics row when the user picked a
    // reason on the iOS BoardDeclineReasonSheet. The
    // `driver_decline_reasons` table predates the board flow (created
    // in migration 064 for instant-ride snooze + reason capture) but
    // its column shape — `driver_id` (FK to users.id), ride_id,
    // reason, snooze_minutes — is generic enough to hold board
    // declines without a new migration. `driver_id` here means
    // "user_id of the decliner" regardless of role; future migration
    // can rename / add a `decline_context` enum if rider-side board
    // declines need to be split out for analytics.
    //
    // Skip-the-sheet path ("Just decline" toolbar action) sends no
    // reason and we don't insert anything — keeps the table clean
    // of a forced "unspecified" row that would skew analytics.
    if (reason) {
      void supabaseAdmin
        .from('driver_decline_reasons')
        .insert({
          driver_id: userId,
          ride_id: rideId,
          reason,
          snooze_minutes: null,
        })
        .then(({ error: reasonErr }) => {
          if (reasonErr) {
            console.warn(
              `[board_decline] Failed to log decline reason for user ${userId}: ${reasonErr.message}`,
            )
          }
        })
    }

    console.log(
      JSON.stringify({
        type: 'board_decline',
        ride_id: rideId,
        declined_by: userId,
        reason: reason ?? null,
      }),
    )
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
    //
    // `end_date` filter (audit B3, 2026-05-13): drop routines whose
    // user-set last date has already passed. NULL end_date = open-ended.
    const todayForFilter = (
      body.client_date && /^\d{4}-\d{2}-\d{2}$/.test(body.client_date)
    ) ? body.client_date : (new Date().toISOString().split('T')[0] ?? '')
    const { data: routines, error: routineErr } = await supabaseAdmin
      .from('driver_routines')
      .select('id, user_id, route_name, origin, destination, destination_bearing, direction_type, day_of_week, departure_time, arrival_time, origin_address, dest_address, skip_dates, end_date')
      .eq('user_id', userId)
      .eq('is_active', true)
      .or(`end_date.is.null,end_date.gte.${todayForFilter}`)

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

// ────────────────────────────────────────────────────────────────────────────
// BOARD OFFERS — driver-initiated offers on rider-posted board entries
// ────────────────────────────────────────────────────────────────────────────
//
// Slice A1 of the Ride Board redesign (2026-05-16, see
// `docs/BOARD_REDESIGN_PLAN.md`). Allows a driver to offer on a
// rider-posted board entry BEFORE the rider has set up payment —
// the old `POST /api/schedule/request` path 4xx'd with
// `RIDER_NO_PAYMENT_METHOD` in that case, which created a chicken-
// and-egg problem: riders wouldn't add a card before getting an
// offer, but couldn't get an offer until they'd added one.
//
// This new flow stores the offer in `ride_offers` with
// `schedule_id` set + `ride_id = NULL` (see migration 072). The
// `rides` row is only materialised when the rider accepts via the
// new `POST /api/schedule/board/offers/:id/accept` route, at which
// point we DO require the rider to have a card / wallet (Slice A2).

/**
 * POST /api/schedule/board/offers
 *
 * Driver expresses interest in a rider-posted board entry. Body:
 *
 * {
 *   schedule_id: UUID,                  // ride_schedules.id (mode='rider')
 *   vehicle_id?: UUID,                  // driver's vehicle; defaults to default
 *   proposed_pickup_lat: number,
 *   proposed_pickup_lng: number,
 *   proposed_pickup_name?: string,
 *   proposed_dropoff_lat: number,
 *   proposed_dropoff_lng: number,
 *   proposed_dropoff_name?: string,
 *   proposed_fare_cents: number,
 *   proposed_eta_minutes?: number,
 * }
 *
 * Side effects:
 *   - Upserts into `ride_offers` on (schedule_id, driver_id) — re-offering
 *     updates the proposed_* fields rather than creating duplicates.
 *   - Sends FCM push to the schedule owner (the rider) with
 *     `type='board_offer'` so they're nudged to open the inbox + add
 *     a payment method if they don't have one yet.
 *
 * Returns: { offer_id, status: 'pending', created_at }
 *
 * Error codes:
 *   - 400 INVALID_BODY         missing required fields
 *   - 403 NOT_A_DRIVER         requester isn't is_driver=true
 *   - 403 OWN_POST             driver is the schedule owner
 *   - 404 SCHEDULE_NOT_FOUND   schedule_id doesn't exist
 *   - 409 WRONG_MODE           schedule.mode !== 'rider'
 */
scheduleRouter.post(
  '/board/offers',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const body = (req.body ?? {}) as {
      schedule_id?: unknown
      vehicle_id?: unknown
      proposed_pickup_lat?: unknown
      proposed_pickup_lng?: unknown
      proposed_pickup_name?: unknown
      proposed_dropoff_lat?: unknown
      proposed_dropoff_lng?: unknown
      proposed_dropoff_name?: unknown
      proposed_fare_cents?: unknown
      proposed_eta_minutes?: unknown
      // 2026-05-17 — transit hand-off context. When the driver
      // proposed dropping the rider at a transit station instead of
      // their posted destination, these carry the line + time
      // breakdown so the rider sees the full journey on accept.
      proposed_transit_line_name?: unknown
      proposed_transit_walk_minutes?: unknown
      proposed_transit_to_dest_minutes?: unknown
      proposed_transit_total_minutes?: unknown
    }

    // ── Validate body ──────────────────────────────────────────────────
    // Only `schedule_id` is hard-required. The proposed_* fields are
    // OPTIONAL — when the driver hasn't entered exact terms (the
    // typical "tap Offer to drive on a rider's post" flow), the
    // server falls back to:
    //   - pickup point: geocode of the schedule's origin_address
    //   - dropoff point: geocode of the schedule's dest_address
    //   - fare: NULL (rider's BoardOfferAcceptPage shows "Fare TBD")
    // This keeps the driver-side UI dead-simple (one tap → offer sent)
    // and lets future iterations layer custom terms on top.
    const scheduleId = typeof body.schedule_id === 'string' ? body.schedule_id : null
    const pickupLat = typeof body.proposed_pickup_lat === 'number' ? body.proposed_pickup_lat : null
    const pickupLng = typeof body.proposed_pickup_lng === 'number' ? body.proposed_pickup_lng : null
    const dropoffLat = typeof body.proposed_dropoff_lat === 'number' ? body.proposed_dropoff_lat : null
    const dropoffLng = typeof body.proposed_dropoff_lng === 'number' ? body.proposed_dropoff_lng : null
    const fareCents = typeof body.proposed_fare_cents === 'number' ? Math.round(body.proposed_fare_cents) : null

    if (!scheduleId) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'schedule_id is required' },
      })
      return
    }

    const vehicleId = typeof body.vehicle_id === 'string' ? body.vehicle_id : null
    const pickupName = typeof body.proposed_pickup_name === 'string' ? body.proposed_pickup_name.slice(0, 200) : null
    const dropoffName = typeof body.proposed_dropoff_name === 'string' ? body.proposed_dropoff_name.slice(0, 200) : null
    const etaMinutes = typeof body.proposed_eta_minutes === 'number' ? Math.round(body.proposed_eta_minutes) : null
    const transitLineName = typeof body.proposed_transit_line_name === 'string'
      ? body.proposed_transit_line_name.slice(0, 80) : null
    const transitWalkMinutes = typeof body.proposed_transit_walk_minutes === 'number'
      ? Math.max(0, Math.round(body.proposed_transit_walk_minutes)) : null
    const transitToDestMinutes = typeof body.proposed_transit_to_dest_minutes === 'number'
      ? Math.max(0, Math.round(body.proposed_transit_to_dest_minutes)) : null
    const transitTotalMinutes = typeof body.proposed_transit_total_minutes === 'number'
      ? Math.max(0, Math.round(body.proposed_transit_total_minutes)) : null

    // ── Fetch schedule + verify it's rider-posted ──────────────────────
    // Also fetch schedule's posted coords so we can fall back when
    // the driver didn't override AND so the system-fare estimate
    // below can run even on a "blank" offer that defaults to the
    // rider's posted endpoints.
    const { data: scheduleRaw, error: schedErr } = await supabaseAdmin
      .from('ride_schedules')
      .select('id, user_id, mode, origin_address, dest_address, trip_date, trip_time, origin_lat, origin_lng, dest_lat, dest_lng' as never)
      .eq('id', scheduleId)
      .single() as { data: {
        id: string
        user_id: string
        mode: 'driver' | 'rider'
        origin_address: string | null
        dest_address: string | null
        trip_date: string
        trip_time: string
        origin_lat: number | null
        origin_lng: number | null
        dest_lat: number | null
        dest_lng: number | null
      } | null; error: unknown }
    const schedule = scheduleRaw

    if (schedErr || !schedule) {
      res.status(404).json({
        error: { code: 'SCHEDULE_NOT_FOUND', message: 'That ride post no longer exists' },
      })
      return
    }

    if (schedule.mode !== 'rider') {
      res.status(409).json({
        error: {
          code: 'WRONG_MODE',
          message: 'This endpoint is only for offering on rider-posted board entries. For driver-posted seats, use /api/schedule/request.',
        },
      })
      return
    }

    if (schedule.user_id === userId) {
      res.status(403).json({
        error: { code: 'OWN_POST', message: "You can't offer on your own ride post" },
      })
      return
    }

    // ── Verify requester is a driver ───────────────────────────────────
    const { data: driverRow } = await supabaseAdmin
      .from('users')
      .select('id, is_driver, full_name, avatar_url, rating_avg, rating_count')
      .eq('id', userId)
      .single()

    if (!driverRow?.is_driver) {
      res.status(403).json({
        error: { code: 'NOT_A_DRIVER', message: 'You must be a registered driver to offer rides' },
      })
      return
    }

    // ── Verify the optional vehicle_id belongs to this driver ─────────
    let resolvedVehicleId: string | null = vehicleId
    if (vehicleId) {
      const { data: vehicleRow } = await supabaseAdmin
        .from('vehicles')
        .select('id, user_id')
        .eq('id', vehicleId)
        .single()
      if (!vehicleRow || vehicleRow.user_id !== userId) {
        res.status(403).json({
          error: { code: 'VEHICLE_NOT_OWNED', message: "That vehicle isn't yours" },
        })
        return
      }
    } else {
      // 2026-05-18 — fall back to the driver's primary vehicle.
      // Prefer one marked `is_active=true` (the driver's selected
      // car), but if NONE are active fall through to ANY vehicle so
      // an "active flag forgot to flip" situation doesn't ship an
      // offer with no vehicle attached (the rider's accept page
      // would then hide the vehicle line entirely and the rider has
      // no idea what car to look for). Vehicles table has no
      // created_at column, so order by id deterministically for
      // tie-breaking (first vehicle the driver registered).
      const { data: activeVehicle } = await supabaseAdmin
        .from('vehicles')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (activeVehicle?.id) {
        resolvedVehicleId = activeVehicle.id as string
      } else {
        const { data: anyVehicle } = await supabaseAdmin
          .from('vehicles')
          .select('id')
          .eq('user_id', userId)
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle()
        resolvedVehicleId = (anyVehicle?.id as string | undefined) ?? null
      }
    }

    // ── Compute system fare estimate ──────────────────────────────────
    // Always populate `estimated_fare_cents` regardless of whether the
    // driver set an explicit `proposed_fare_cents`. Rider UI shows it
    // as "Estimated $X" when fare is unset ("Confirm in chat"), so the
    // rider never has to wonder what ballpark they're agreeing to.
    // Uses whichever coords resolve: driver's proposed > schedule's
    // posted. If neither side has coords (legacy post), the estimate
    // stays NULL and the UI hides the row.
    const effectivePickupLat = pickupLat ?? schedule.origin_lat
    const effectivePickupLng = pickupLng ?? schedule.origin_lng
    const effectiveDropoffLat = dropoffLat ?? schedule.dest_lat
    const effectiveDropoffLng = dropoffLng ?? schedule.dest_lng
    let estimatedFareCents: number | null = null
    if (
      effectivePickupLat != null && effectivePickupLng != null
      && effectiveDropoffLat != null && effectiveDropoffLng != null
    ) {
      try {
        estimatedFareCents = await estimateFareCentsBetween(
          effectivePickupLat, effectivePickupLng,
          effectiveDropoffLat, effectiveDropoffLng,
        )
      } catch (err) {
        // Fare estimate is best-effort — if Google Routes / EIA is
        // down, ship the offer without it. Rider just sees "Confirm
        // in chat" (the existing fallback).
        console.warn('[board/offers] fare estimate failed:', err instanceof Error ? err.message : String(err))
      }
    }

    // ── Upsert the offer ───────────────────────────────────────────────
    // ON CONFLICT on the partial-unique index (schedule_id, driver_id)
    // means re-offering refreshes the proposed_* terms rather than
    // creating a duplicate row.
    //
    // Coords: only set the point if the driver supplied lat/lng.
    // Otherwise leave NULL and the rider's BoardOfferAcceptPage falls
    // back to the schedule's posted origin/dest addresses (which it
    // already shows from the schedule join in the list endpoint).
    // Names default to the schedule's addresses so the rider always
    // sees something readable on the offer card.
    const upsertPayload: Record<string, unknown> = {
      schedule_id: scheduleId,
      driver_id: userId,
      ride_id: null,
      vehicle_id: resolvedVehicleId,
      status: 'pending',
      proposed_pickup_name: pickupName ?? (schedule.origin_address as string | null) ?? null,
      proposed_dropoff_name: dropoffName ?? (schedule.dest_address as string | null) ?? null,
      proposed_fare_cents: fareCents,
      proposed_eta_minutes: etaMinutes,
      estimated_fare_cents: estimatedFareCents,
      proposed_transit_line_name: transitLineName,
      proposed_transit_walk_minutes: transitWalkMinutes,
      proposed_transit_to_dest_minutes: transitToDestMinutes,
      proposed_transit_total_minutes: transitTotalMinutes,
    }
    if (pickupLat != null && pickupLng != null) {
      upsertPayload['proposed_pickup_point'] = `POINT(${pickupLng} ${pickupLat})`
    }
    if (dropoffLat != null && dropoffLng != null) {
      upsertPayload['proposed_dropoff_point'] = `POINT(${dropoffLng} ${dropoffLat})`
    }

    // Cast as `never` because the generated `Database` type hasn't yet
    // been regenerated to include migration 072's nullable `ride_id` +
    // new `schedule_id` / `proposed_*` columns. Same pattern as the
    // `notification_preferences` insert in `lib/fcm.ts`. The DB
    // validates via the `ride_offers_target_check` CHECK constraint
    // either way, so casting here is type-only, not runtime risk.
    const { data: offerRow, error: upsertErr } = await supabaseAdmin
      .from('ride_offers')
      .upsert(upsertPayload as never, { onConflict: 'schedule_id,driver_id' })
      .select('id, status, created_at')
      .single()

    if (upsertErr || !offerRow) {
      console.error('[board/offers] upsert failed:', upsertErr?.message)
      next(upsertErr ?? new Error('Upsert returned no row'))
      return
    }

    // ── Push notification + persistent inbox row for the rider ───────
    // Best-effort — don't block the response if either path fails.
    //
    // The inbox INSERT is critical: without it, a rider who dismisses
    // the system push (or accidentally closes BoardOfferAcceptPage)
    // has no way back to the offer — it only existed as an ephemeral
    // banner. Persisting to `notifications` means tapping the
    // notification bell surfaces a row whose `data.offer_id` re-opens
    // the same page. Bug fix 2026-05-17 reported by Tarun.
    const driverName = (driverRow.full_name as string | null)?.trim() || 'A driver'
    const routeStr = `${schedule.origin_address ?? 'Pickup'} → ${schedule.dest_address ?? 'Dropoff'}`
    const fareStr = fareCents != null ? `~$${(fareCents / 100).toFixed(0)}` : 'Confirm fare'
    // 2026-05-18 Slice 1 — added `route`, `trip_date`, `trip_time`,
    // `origin_address`, `dest_address` for parity with board_request's
    // notification payload. iOS NotificationRow uses these to render a
    // structured second line (route + date) on board_offer rows
    // matching the look of board_request rows. Slice 2 wires the
    // render; Slice 1 ships the data forward-compatibly (older
    // clients ignore unknown string fields).
    const notifData: Record<string, string> = {
      type: 'board_offer',
      schedule_id: scheduleId,
      offer_id: offerRow.id as string,
      driver_id: userId,
      driver_name: driverName,
      driver_avatar_url: (driverRow.avatar_url as string | null) ?? '',
      proposed_fare_cents: fareCents != null ? String(fareCents) : '',
      route: routeStr,
      trip_date: (schedule.trip_date as string | null) ?? '',
      trip_time: (schedule.trip_time as string | null) ?? '',
      origin_address: (schedule.origin_address as string | null) ?? '',
      dest_address: (schedule.dest_address as string | null) ?? '',
    }
    const notifTitle = `${driverName} wants to drive you`
    // 2026-05-18 Slice 3 — body now includes trip date alongside
    // route + fare, matching the route+date pattern board_request
    // adopts in the same slice. Order: route → date → fare (most
    // identifying to most operational, left-to-right). The fare
    // copy switches from "Fare on accept" → "Confirm fare" with a
    // `~$` prefix on real numbers, so the rider sees an estimate
    // sigil instead of a firm-price impression on the lock screen.
    const offerDateStr = formatTripDateForBody(schedule.trip_date as string | null | undefined)
    const notifBody = joinBodyParts([routeStr, offerDateStr, fareStr])

    void (async () => {
      // 1. Persistent inbox row (tap-to-reopen surface)
      try {
        const { error: notifErr } = await supabaseAdmin
          .from('notifications')
          .insert({
            user_id: schedule.user_id,
            type: 'board_offer',
            title: notifTitle,
            body: notifBody,
            data: notifData,
          })
        if (notifErr) {
          console.error('[board/offers] notif insert failed:', notifErr.message)
        }
      } catch (err) {
        console.error('[board/offers] notif insert threw:', err instanceof Error ? err.message : String(err))
      }

      // 2. APNs/FCM push (ephemeral banner)
      try {
        const { data: tokenRows } = await supabaseAdmin
          .from('push_tokens')
          .select('token')
          .eq('user_id', schedule.user_id)
        const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)
        if (tokens.length > 0) {
          await sendFcmPush(tokens, {
            title: notifTitle,
            body: notifBody,
            data: notifData,
            // 2026-05-18 Slice 4 — `BOARD_OFFER` category trips the
            // `time-sensitive` interruption gate in lib/fcm.ts so
            // the push breaks through DND / Sleep / Driving Focus
            // (parity with board_request, which is also time-
            // sensitive). The category placeholder is unregistered
            // on iOS until Slice 6 wires `UNNotificationCategory`
            // actions; iOS gracefully shows a regular banner with
            // no action buttons in the meantime.
            category: 'BOARD_OFFER',
          })
        } else {
          // 2026-05-23 — Email fallback for posters without push
          // tokens. Without this, a rider who posted a trip but
          // doesn't have the app installed silently misses every
          // driver offer. Fire-and-forget; helper handles all
          // failure modes internally.
          void sendNoPushFallbackEmail({
            recipientUserId: schedule.user_id as string,
            eventKind: 'board_offer',
            routeStr,
            tripDate: (schedule.trip_date as string | null) ?? null,
            tripTime: (schedule.trip_time as string | null) ?? null,
            actorName: driverName,
          })
        }
      } catch (pushErr) {
        console.error('[board/offers] push failed:', pushErr instanceof Error ? pushErr.message : String(pushErr))
      }
    })()

    console.log(`[board/offers] driver=${userId.slice(0, 8)}… offer on schedule=${scheduleId.slice(0, 8)}… fare=${fareStr}`)
    res.status(201).json({
      offer_id: offerRow.id,
      status: offerRow.status,
      created_at: offerRow.created_at,
    })
  },
)

/**
 * GET /api/schedule/board/schedule/:scheduleId/offers
 *
 * Slice A2 (2026-05-16). Rider lists pending offers on their own
 * board post. Returns each offer's driver info, vehicle, proposed
 * pickup/dropoff/fare/ETA so the rider can compare and pick.
 *
 * Authorization: caller must be the schedule's owner. We enforce
 * this both via RLS (policy from migration 072) and an explicit
 * 403 check so the error message is friendlier than RLS's silent
 * empty-array response.
 *
 * Returns: { offers: [...] } sorted by proposed_fare_cents ASC
 * (cheapest first — most riders care about price first; route fit
 * is identical across offers since they all match the same schedule
 * endpoints). Tiebreaker: created_at ASC so older offers don't get
 * starved.
 */
scheduleRouter.get(
  '/board/schedule/:scheduleId/offers',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const scheduleId = String(req.params['scheduleId'] ?? '')

    if (!scheduleId) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'scheduleId required' } })
      return
    }

    // Verify caller owns the schedule (friendlier than RLS 200-empty)
    //
    // 2026-05-17 — also select the schedule's posted addresses + coords
    // so the response can carry both the "what the rider posted" AND
    // "what the driver proposed" sides. BoardOfferAcceptPage uses the
    // pair to render diff badges: "✓ matches your posted pickup" when
    // the driver kept the rider's posted spot, vs "Driver proposed:
    // <addr> (you posted <orig>)" when they didn't.
    const { data: schedule, error: schedErr } = await supabaseAdmin
      .from('ride_schedules')
      .select('id, user_id, mode, origin_address, dest_address, origin_lat, origin_lng, dest_lat, dest_lng, trip_date, trip_time, time_flexible' as never)
      .eq('id', scheduleId)
      .single() as { data: {
        id: string
        user_id: string
        mode: 'driver' | 'rider'
        origin_address: string | null
        dest_address: string | null
        origin_lat: number | null
        origin_lng: number | null
        dest_lat: number | null
        dest_lng: number | null
        trip_date: string
        trip_time: string
        time_flexible: boolean | null
      } | null; error: unknown }

    if (schedErr || !schedule) {
      res.status(404).json({ error: { code: 'SCHEDULE_NOT_FOUND', message: 'Schedule not found' } })
      return
    }

    if (schedule.user_id !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only view offers on your own posts' } })
      return
    }

    // 2026-05-17 — refactored from a PostgREST FK-shorthand join
    // (`driver:driver_id (...)`) that returned a 4xx with no clear
    // error to iOS. Manual 3-query fetch is more reliable, more
    // debuggable, and matches the pattern other routes use.
    //
    // Also include proposed_pickup_point + proposed_dropoff_point so
    // BoardOfferAcceptPage can compute "does this proposal match
    // what I posted?" (proximity check) instead of relying on name
    // string equality (fragile across whitespace + truncation).
    type OfferRow = {
      id: string
      status: string
      created_at: string
      driver_id: string
      vehicle_id: string | null
      proposed_pickup_name: string | null
      proposed_dropoff_name: string | null
      proposed_pickup_point: { type: 'Point'; coordinates: [number, number] } | null
      proposed_dropoff_point: { type: 'Point'; coordinates: [number, number] } | null
      proposed_fare_cents: number | null
      proposed_eta_minutes: number | null
      estimated_fare_cents: number | null
      proposed_transit_line_name: string | null
      proposed_transit_walk_minutes: number | null
      proposed_transit_to_dest_minutes: number | null
      proposed_transit_total_minutes: number | null
    }
    const { data: rawOffers, error: offersErr } = await supabaseAdmin
      .from('ride_offers')
      .select(
        'id, status, created_at, driver_id, vehicle_id, proposed_pickup_name, proposed_dropoff_name, proposed_pickup_point, proposed_dropoff_point, proposed_fare_cents, proposed_eta_minutes, estimated_fare_cents, proposed_transit_line_name, proposed_transit_walk_minutes, proposed_transit_to_dest_minutes, proposed_transit_total_minutes' as never
      )
      .eq('schedule_id' as never, scheduleId)
      .eq('status', 'pending')
      .order('proposed_fare_cents', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })

    if (offersErr) {
      console.error('[board/offers:list] offers query failed:', offersErr.message)
      next(offersErr)
      return
    }

    const offerRows = (rawOffers as unknown) as OfferRow[] | null
    if (!offerRows || offerRows.length === 0) {
      // 2026-05-17 — instead of dropping the rider on a generic
      // "Offer no longer available" page, look up WHY there are no
      // pending offers so iOS can render specific context:
      //   - "you_accepted"      → rider already accepted an offer
      //                           (rides row exists with this
      //                           schedule_id + rider_id)
      //   - "trip_passed"       → schedule's trip_date+trip_time is
      //                           in the past (caller missed the
      //                           window; rider didn't act on it)
      //   - "all_released"      → offers existed and got released
      //                           (declined / sibling-accepted /
      //                           expired). No accepted ride.
      //   - "no_offers"         → no offer was ever made on this
      //                           schedule (rider opened it cold)
      const reason = await computeNoOffersReason(
        scheduleId,
        userId,
        schedule,
      )
      res.status(200).json({
        offers: [],
        posted: buildPostedBlock(schedule),
        no_offers_reason: reason.code,
        accepted_ride_id: reason.acceptedRideId ?? null,
      })
      return
    }

    // Pull drivers + vehicles in parallel
    const driverIds = Array.from(new Set(offerRows.map((o) => o.driver_id)))
    const vehicleIds = Array.from(
      new Set(offerRows.map((o) => o.vehicle_id).filter((v): v is string => v != null)),
    )
    // 2026-05-18 — driver-fallback vehicle lookup. Legacy offers in
    // the DB have `vehicle_id=null` because the CreateBoardOffer
    // fallback used `.order('created_at')` which 4xx'd silently on
    // the `vehicles` table (no `created_at` column). For those rows
    // (and any future ones where the driver hasn't picked a
    // vehicle), look up the driver's primary vehicle by user_id so
    // the rider's accept page can still render "what car am I
    // looking for." `is_active=true` preferred (driver's selected
    // car); falls through to any vehicle so a "forgot to flip the
    // active flag" doesn't ship a blank vehicle row.
    const driverIdsForVehicleFallback = Array.from(new Set(
      offerRows.filter((o) => o.vehicle_id == null).map((o) => o.driver_id),
    ))

    const [driversResp, vehiclesResp, fallbackVehiclesResp] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('id, full_name, avatar_url, rating_avg, rating_count')
        .in('id', driverIds),
      vehicleIds.length > 0
        ? supabaseAdmin
            .from('vehicles')
            .select('id, make, model, year, color, plate')
            .in('id', vehicleIds)
        : Promise.resolve({ data: [], error: null }),
      driverIdsForVehicleFallback.length > 0
        ? supabaseAdmin
            .from('vehicles')
            .select('id, user_id, make, model, year, color, plate, is_active')
            .in('user_id', driverIdsForVehicleFallback)
            .order('is_active', { ascending: false })
            .order('id', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ])

    if (driversResp.error) {
      console.error('[board/offers:list] drivers query failed:', driversResp.error.message)
      next(driversResp.error)
      return
    }
    if (vehiclesResp.error) {
      console.error('[board/offers:list] vehicles query failed:', vehiclesResp.error.message)
      next(vehiclesResp.error)
      return
    }
    if (fallbackVehiclesResp.error) {
      console.error('[board/offers:list] fallback vehicles query failed:', fallbackVehiclesResp.error.message)
      // Non-fatal — the rider sees no vehicle row instead of broken page
    }

    type DriverRow = {
      id: string
      full_name: string | null
      avatar_url: string | null
      rating_avg: number | null
      rating_count: number | null
    }
    type VehicleRow = {
      id: string
      make: string | null
      model: string | null
      year: number | null
      color: string | null
      plate: string | null
    }
    type FallbackVehicleRow = VehicleRow & {
      user_id: string
      is_active: boolean
    }
    const driverMap = new Map(
      ((driversResp.data ?? []) as DriverRow[]).map((d) => [d.id, d]),
    )
    const vehicleMap = new Map(
      ((vehiclesResp.data ?? []) as VehicleRow[]).map((v) => [v.id, v]),
    )
    // Build the user_id → primary vehicle map. Sorted is_active
    // DESC + id ASC, so the first vehicle we see per user is the
    // preferred one. Subsequent vehicles for the same user are
    // ignored.
    const driverPrimaryVehicleMap = new Map<string, VehicleRow>()
    for (const v of ((fallbackVehiclesResp.data ?? []) as FallbackVehicleRow[])) {
      if (!driverPrimaryVehicleMap.has(v.user_id)) {
        driverPrimaryVehicleMap.set(v.user_id, {
          id: v.id,
          make: v.make,
          model: v.model,
          year: v.year,
          color: v.color,
          plate: v.plate,
        })
      }
    }

    const offers = offerRows.map((o) => ({
      id: o.id,
      status: o.status,
      created_at: o.created_at,
      proposed_pickup_name: o.proposed_pickup_name,
      proposed_dropoff_name: o.proposed_dropoff_name,
      proposed_pickup_lat: o.proposed_pickup_point?.coordinates[1] ?? null,
      proposed_pickup_lng: o.proposed_pickup_point?.coordinates[0] ?? null,
      proposed_dropoff_lat: o.proposed_dropoff_point?.coordinates[1] ?? null,
      proposed_dropoff_lng: o.proposed_dropoff_point?.coordinates[0] ?? null,
      proposed_fare_cents: o.proposed_fare_cents,
      proposed_eta_minutes: o.proposed_eta_minutes,
      estimated_fare_cents: o.estimated_fare_cents,
      proposed_transit_line_name: o.proposed_transit_line_name,
      proposed_transit_walk_minutes: o.proposed_transit_walk_minutes,
      proposed_transit_to_dest_minutes: o.proposed_transit_to_dest_minutes,
      proposed_transit_total_minutes: o.proposed_transit_total_minutes,
      driver: driverMap.get(o.driver_id) ?? {
        id: o.driver_id,
        full_name: null,
        avatar_url: null,
        rating_avg: null,
        rating_count: null,
      },
      vehicle: o.vehicle_id
        ? (vehicleMap.get(o.vehicle_id) ?? null)
        : (driverPrimaryVehicleMap.get(o.driver_id) ?? null),
    }))

    res.status(200).json({ offers, posted: buildPostedBlock(schedule) })
  },
)

/**
 * POST /api/schedule/board/offers/:offerId/accept
 *
 * Slice A2 (2026-05-16). Rider accepts a specific offer on their
 * own board post. Materialises the `rides` row, flips this offer to
 * `selected`, flips sibling pending offers to `released`, and pushes
 * notifications to all affected drivers.
 *
 * The payment gate fires HERE — not at post time. If the rider has
 * no card / insufficient wallet, returns 400 NO_PAYMENT_METHOD so
 * the iOS client can surface AddCardSheet inline. Once card is
 * added, client retries this endpoint.
 *
 * Race conditions:
 *   - Offer already released (driver withdrew, or another offer was
 *     accepted on this schedule first) → 409 ALREADY_RELEASED.
 *   - Schedule already has a 'selected' offer → 409 ALREADY_MATCHED.
 *
 * Returns: { ride_id, offer_id, status: 'selected' }
 */
scheduleRouter.post(
  '/board/offers/:offerId/accept',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const offerId = String(req.params['offerId'] ?? '')

    if (!offerId) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'offerId required' } })
      return
    }

    // ── Load the offer + verify it's a board offer in pending state ────
    // Cast the result: Supabase generated types don't yet know about
    // migration 072's new columns (`schedule_id`, `proposed_*`). Same
    // pattern as the upsert in Slice A1.
    type BoardOfferRow = {
      id: string
      ride_id: string | null
      schedule_id: string | null
      driver_id: string
      vehicle_id: string | null
      status: 'pending' | 'selected' | 'standby' | 'released'
      proposed_pickup_point: { type: 'Point'; coordinates: [number, number] } | null
      proposed_pickup_name: string | null
      proposed_dropoff_point: { type: 'Point'; coordinates: [number, number] } | null
      proposed_dropoff_name: string | null
      proposed_fare_cents: number | null
      proposed_eta_minutes: number | null
      // 2026-05-18 — pulled in so the dropoff chat card can render
      // the rich `transit_dropoff_suggestion` variant when the
      // offer was a hand-off (driver drops at a station, rider
      // continues by transit). Nil for direct drops.
      proposed_transit_line_name: string | null
      proposed_transit_walk_minutes: number | null
      proposed_transit_to_dest_minutes: number | null
      proposed_transit_total_minutes: number | null
    }
    const { data: offerRaw, error: offerErr } = await supabaseAdmin
      .from('ride_offers')
      .select(`
        id,
        ride_id,
        schedule_id,
        driver_id,
        vehicle_id,
        status,
        proposed_pickup_point,
        proposed_pickup_name,
        proposed_dropoff_point,
        proposed_dropoff_name,
        proposed_fare_cents,
        proposed_eta_minutes,
        proposed_transit_line_name,
        proposed_transit_walk_minutes,
        proposed_transit_to_dest_minutes,
        proposed_transit_total_minutes
      ` as never)
      .eq('id', offerId)
      .single()
    const offer = (offerRaw as unknown) as BoardOfferRow | null

    if (offerErr || !offer) {
      res.status(404).json({ error: { code: 'OFFER_NOT_FOUND', message: 'Offer not found' } })
      return
    }

    if (offer.ride_id != null || offer.schedule_id == null) {
      res.status(400).json({
        error: { code: 'NOT_A_BOARD_OFFER', message: 'This endpoint only handles board offers (schedule-attached)' },
      })
      return
    }

    if (offer.status !== 'pending') {
      res.status(409).json({
        error: { code: 'ALREADY_RELEASED', message: `Offer is already ${offer.status}` },
      })
      return
    }

    // ── Verify the schedule is the caller's + still open ───────────────
    // 2026-05-17 bug fix — also select origin_lat/lng + dest_lat/lng so
    // we can fall back to the rider's POSTED pickup/dropoff when the
    // driver's offer didn't override them (which is the common case —
    // most drivers tap "Offer to Drive" without specifying custom
    // pickup coords). Without these the rides INSERT below tries to
    // pass `origin: null` and Postgres rejects with NOT NULL violation
    // (migration 002 declares `rides.origin GEOMETRY NOT NULL`),
    // crashing every accept with a 500.
    type ScheduleRow = {
      id: string
      user_id: string
      mode: 'driver' | 'rider'
      trip_date: string
      trip_time: string
      time_flexible: boolean | null
      origin_address: string | null
      dest_address: string | null
      origin_lat: number | null
      origin_lng: number | null
      dest_lat: number | null
      dest_lng: number | null
    }
    const { data: schedRaw, error: schedErr } = await supabaseAdmin
      .from('ride_schedules')
      .select('id, user_id, mode, trip_date, trip_time, time_flexible, origin_address, dest_address, origin_lat, origin_lng, dest_lat, dest_lng' as never)
      .eq('id', offer.schedule_id)
      .single()
    const schedule = (schedRaw as unknown) as ScheduleRow | null

    if (schedErr || !schedule) {
      res.status(404).json({ error: { code: 'SCHEDULE_NOT_FOUND', message: 'Schedule not found' } })
      return
    }

    if (schedule.user_id !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the rider who posted can accept offers' } })
      return
    }

    // Block if another offer on this schedule is already 'selected' (race)
    const { data: alreadySelected } = await supabaseAdmin
      .from('ride_offers')
      .select('id')
      .eq('schedule_id', offer.schedule_id)
      .eq('status', 'selected')
      .limit(1)
      .maybeSingle()

    if (alreadySelected) {
      res.status(409).json({
        error: { code: 'ALREADY_MATCHED', message: 'You already accepted another offer for this ride' },
      })
      return
    }

    // ── Payment gate ───────────────────────────────────────────────────
    // Rider must have a card OR a wallet balance ≥ proposed fare.
    const proposedFareCents = (offer.proposed_fare_cents as number | null) ?? 0
    const { data: riderPaymentRow } = await supabaseAdmin
      .from('users')
      .select('stripe_customer_id, default_payment_method_id, wallet_balance')
      .eq('id', userId)
      .single()

    let effectiveDefaultPm: string | null = null
    if (riderPaymentRow?.stripe_customer_id) {
      effectiveDefaultPm = await resolveAndPersistDefaultPm(
        userId,
        riderPaymentRow.stripe_customer_id as string,
        (riderPaymentRow.default_payment_method_id as string | null) ?? null,
      )
    }
    const walletCents = (riderPaymentRow?.wallet_balance as number | null) ?? 0
    const hasCard = !!riderPaymentRow?.stripe_customer_id && !!effectiveDefaultPm
    const walletCovers = proposedFareCents > 0 && walletCents >= proposedFareCents

    if (!hasCard && !walletCovers) {
      res.status(400).json({
        error: {
          code: 'NO_PAYMENT_METHOD',
          message: 'Add a payment method or top up your wallet to accept this offer.',
        },
      })
      return
    }

    // ── Materialise the ride row ──────────────────────────────────────
    // Both pickup + dropoff are pre-confirmed because the driver's
    // offer terms ARE the agreed pickup/dropoff (rider accepting =
    // agreeing to those exact points).
    //
    // 2026-05-17 bug fix — `rides.origin` is GEOMETRY NOT NULL. When
    // the offer didn't carry custom pickup coords (the default — most
    // drivers just tap "Offer to Drive"), fall back to the rider's
    // posted origin coords from the schedule. Same for the dropoff
    // side, plus the name fields. If even the schedule has no coords
    // (legacy pre-migration-048 row), surface a clear 400 instead of
    // letting Postgres crash with a NOT NULL violation that bubbles
    // up to iOS as an opaque "Network error".
    type GeoPoint = { type: 'Point'; coordinates: [number, number] }
    const proposedPickupGeo = offer.proposed_pickup_point as GeoPoint | null
    const proposedDropoffGeo = offer.proposed_dropoff_point as GeoPoint | null

    const finalPickupGeo: GeoPoint | null =
      proposedPickupGeo
      ?? (schedule.origin_lat != null && schedule.origin_lng != null
        ? { type: 'Point', coordinates: [schedule.origin_lng, schedule.origin_lat] }
        : null)
    const finalDropoffGeo: GeoPoint | null =
      proposedDropoffGeo
      ?? (schedule.dest_lat != null && schedule.dest_lng != null
        ? { type: 'Point', coordinates: [schedule.dest_lng, schedule.dest_lat] }
        : null)

    if (!finalPickupGeo) {
      console.error(
        `[board/offers:accept] no pickup coords — offer=${offerId.slice(0, 8)}… schedule=${schedule.id.slice(0, 8)}… (offer.proposed_pickup_point=null AND schedule.origin_lat/lng=null)`,
      )
      res.status(400).json({
        error: {
          code: 'MISSING_PICKUP',
          message: "Driver's offer didn't include pickup coordinates and the original post has none either. Ask the driver to re-offer with a pickup, or repost with a recognisable address.",
        },
      })
      return
    }

    const finalPickupName = offer.proposed_pickup_name ?? schedule.origin_address ?? null
    const finalDropoffName = offer.proposed_dropoff_name ?? schedule.dest_address ?? null

    // 2026-05-18 — switched to the negotiate-in-chat model. Rider
    // accepting the offer commits to THIS DRIVER but the proposed
    // pickup + dropoff land in chat as `pickup_suggestion` /
    // `dropoff_suggestion` cards that BOTH sides must explicitly
    // accept to flip the corresponding `*_confirmed` flag. Closes
    // Tarun's 2026-05-18 feedback that the old auto-confirm flow
    // opened a blank chat with no context — now the chat has two
    // visible proposal cards immediately on accept, mirroring the
    // existing instant-ride pickup-edit / dropoff-edit UX.
    const { data: ride, error: rideErr } = await supabaseAdmin
      .from('rides')
      .insert({
        rider_id: userId,
        driver_id: offer.driver_id,
        vehicle_id: offer.vehicle_id,
        origin: finalPickupGeo,
        origin_name: finalPickupName,
        destination: finalDropoffGeo,
        destination_name: finalDropoffName,
        status: 'accepted',
        schedule_id: schedule.id,
        trip_date: schedule.trip_date,
        trip_time: schedule.trip_time,
        time_flexible: schedule.time_flexible === true,
        fare_cents: proposedFareCents,
        payment_status: 'pending',
        pickup_point: finalPickupGeo,
        pickup_confirmed: false,
        dropoff_point: finalDropoffGeo,
        dropoff_confirmed: false,
      } as never)
      .select('id, status')
      .single()

    if (rideErr || !ride) {
      console.error('[board/offers:accept] ride insert failed:', rideErr?.message)
      next(rideErr ?? new Error('Failed to create ride'))
      return
    }

    // ── Seed chat with the driver's DROPOFF proposal ──────────────────
    //
    // 2026-05-18 — sequential reveal: insert ONLY the dropoff card
    // here. The pickup_suggestion gets auto-inserted by
    // `POST /api/rides/:id/accept-location` (rides.ts:3087) when the
    // rider accepts the dropoff — same machinery instant rides use
    // for the dropoff-first → pickup-second negotiation flow. This
    // matches the existing chat pattern + avoids cluttering chat
    // with two proposal cards the rider has to digest at once.
    //
    // Card variant:
    //   * Transit hand-off (offer carries `proposed_transit_*` data)
    //     → `transit_dropoff_suggestion` so the rich
    //     `TransitDropoffProposalCard` renders with station +
    //     transit-line + walk/ride/total minutes + map.
    //   * Direct drop (driver's dest matches rider's posted dest)
    //     → basic `dropoff_suggestion` (PickupProposalCard's twin).
    //
    // The accept-location endpoint will use this ride's `schedule_id`
    // to know this came from a board offer + use `driver_id` as the
    // pickup_suggestion's sender (vs the default rider_id) so the
    // chat correctly attributes "Driver proposed pickup" instead of
    // "Rider's requested pickup."
    //
    // Best-effort: failures here log but don't unwind the ride
    // creation. The chat is the UX surface — without the card the
    // rider would see a blank window, which is the bug we're fixing.
    const dropoffCoords = finalDropoffGeo?.coordinates ?? null
    if (dropoffCoords) {
      const isTransitHandoff = (offer.proposed_transit_line_name != null && offer.proposed_transit_line_name !== '')
        || (offer.proposed_transit_total_minutes != null && offer.proposed_transit_total_minutes > 0)

      if (isTransitHandoff) {
        const lineName = offer.proposed_transit_line_name ?? 'Transit'
        const transitMsgResp = await supabaseAdmin
          .from('messages')
          .insert({
            ride_id: ride.id as string,
            sender_id: offer.driver_id,
            content: `Suggested transit dropoff: ${finalDropoffName ?? lineName}`,
            type: 'transit_dropoff_suggestion',
            meta: {
              // Station the driver will drop the rider at
              station_name: finalDropoffName ?? 'Transit station',
              station_lat: dropoffCoords[1],
              station_lng: dropoffCoords[0],
              station_place_id: null,
              // station_address is non-optional on the iOS
              // TransitDropoffSuggestion decoder — emit a string
              // even when we don't have a separate address line,
              // else the whole chat message decode throws.
              station_address: finalDropoffName ?? 'Transit station',
              // Single transit option distilled from the offer's line
              // name; existing card renders a list so wrap in an array.
              // `type: bus` keeps the SF Symbol mapping happy if iOS
              // doesn't know the specific operator (BART/Caltrain
              // mappings live client-side).
              //
              // walk_minutes + total_minutes are NON-OPTIONAL on the
              // iOS `TransitOption` Decodable — omitting them throws
              // a decode error that drops the whole chat message.
              // Use the offer's walk+total values (already validated
              // non-negative in CreateBoardOffer).
              transit_options: [{
                type: 'bus',
                icon: 'tram.fill',
                line_name: lineName,
                departure_stop: finalDropoffName ?? null,
                arrival_stop: schedule.dest_address ?? null,
                duration_minutes: offer.proposed_transit_to_dest_minutes ?? 0,
                walk_minutes: offer.proposed_transit_walk_minutes ?? 0,
                total_minutes: offer.proposed_transit_total_minutes ?? 0,
              }],
              walk_to_station_minutes: offer.proposed_transit_walk_minutes ?? 0,
              transit_to_dest_minutes: offer.proposed_transit_to_dest_minutes ?? 0,
              total_rider_minutes: offer.proposed_transit_total_minutes ?? 0,
              full_transit_minutes: offer.proposed_transit_total_minutes ?? null,
              ride_with_driver_minutes: null,
              ride_distance_km: null,
              rider_progress_pct: null,
              transit_polyline: null,
              proposed_by: offer.driver_id,
              // Rider's full journey context — pickup + final dest so
              // the card's mini-map can render all three pins.
              pickup_lat: finalPickupGeo.coordinates[1],
              pickup_lng: finalPickupGeo.coordinates[0],
              rider_dest_lat: schedule.dest_lat,
              rider_dest_lng: schedule.dest_lng,
              rider_dest_name: schedule.dest_address,
              driver_dest_lat: null,
              driver_dest_lng: null,
              driver_dest_name: null,
              driver_route_polyline: null,
              fare_cents: proposedFareCents > 0 ? proposedFareCents : null,
            },
          })
          .select('id, ride_id, sender_id, content, type, meta, created_at')
          .single()
        if (transitMsgResp.error) {
          console.error(
            '[board/offers:accept] transit_dropoff_suggestion insert failed:',
            transitMsgResp.error.message,
          )
        } else if (transitMsgResp.data) {
          // Realtime broadcast so a driver already in the chat sees
          // the card pop in (mirrors how rides.ts handles
          // dropoff_suggestion / transit_dropoff_suggestion inserts).
          void realtimeBroadcast(`chat:${ride.id as string}`, 'new_message', transitMsgResp.data as unknown as Record<string, unknown>)
          void realtimeBroadcast(`chat-badge:${ride.id as string}`, 'new_message', transitMsgResp.data as unknown as Record<string, unknown>)
        }
      } else {
        const dropoffMsgResp = await supabaseAdmin
          .from('messages')
          .insert({
            ride_id: ride.id as string,
            sender_id: offer.driver_id,
            content: 'Suggested dropoff point',
            type: 'dropoff_suggestion',
            meta: {
              lat: dropoffCoords[1],
              lng: dropoffCoords[0],
              name: finalDropoffName,
              proposed_by: offer.driver_id,
              fare_cents: proposedFareCents > 0 ? proposedFareCents : null,
            },
          })
          .select('id, ride_id, sender_id, content, type, meta, created_at')
          .single()
        if (dropoffMsgResp.error) {
          console.error(
            '[board/offers:accept] dropoff_suggestion insert failed:',
            dropoffMsgResp.error.message,
          )
        } else if (dropoffMsgResp.data) {
          void realtimeBroadcast(`chat:${ride.id as string}`, 'new_message', dropoffMsgResp.data as unknown as Record<string, unknown>)
          void realtimeBroadcast(`chat-badge:${ride.id as string}`, 'new_message', dropoffMsgResp.data as unknown as Record<string, unknown>)
        }
      }
    }

    // ── Flip this offer to selected, sibling offers to released ────────
    // 2026-05-17 bug fix — also null `schedule_id` here. The
    // `ride_offers_target_check` CHECK constraint (migration 072)
    // requires EXACTLY ONE of (ride_id, schedule_id) to be non-null.
    // Setting `ride_id` without nulling `schedule_id` silently
    // violates the CHECK → Postgres rejects the UPDATE → offer
    // stays in `pending` server-side. The rides row was already
    // inserted, so iOS navigates to messaging happily, but the
    // dangling pending offer pollutes future loadOffers calls and
    // can be re-accepted. Null both together = clean transition
    // from "board offer pointing at a schedule" to "instant-flow
    // offer pointing at the materialized ride."
    const { error: acceptUpdateErr } = await supabaseAdmin
      .from('ride_offers')
      .update({ status: 'selected', ride_id: ride.id, schedule_id: null } as never)
      .eq('id', offerId)
    if (acceptUpdateErr) {
      console.error(
        '[board/offers:accept] offer status flip failed:',
        acceptUpdateErr.message,
      )
      // Surface to the caller — the rides row already inserted but
      // the offer didn't transition. Better to fail loud now than
      // ship a half-applied state that breaks future taps.
      next(acceptUpdateErr)
      return
    }

    // Sibling offers: same schedule, still pending → released
    const { data: siblingOffers } = await supabaseAdmin
      .from('ride_offers')
      .select('id, driver_id')
      .eq('schedule_id', offer.schedule_id)
      .eq('status', 'pending')
      .neq('id', offerId)

    if (siblingOffers && siblingOffers.length > 0) {
      const siblingIds = siblingOffers.map((s: { id: string }) => s.id)
      await supabaseAdmin
        .from('ride_offers')
        .update({ status: 'released' } as never)
        .in('id', siblingIds)
    }

    // ── Push notifications ─────────────────────────────────────────────
    // Best-effort. Don't block the response.
    const routeStr = `${schedule.origin_address ?? 'Pickup'} → ${schedule.dest_address ?? 'Dropoff'}`
    const fareStr = `$${(proposedFareCents / 100).toFixed(0)}`

    void (async () => {
      // Notify chosen driver: offer accepted
      try {
        const { data: driverTokens } = await supabaseAdmin
          .from('push_tokens')
          .select('token')
          .eq('user_id', offer.driver_id)
        const tokens = (driverTokens ?? []).map((t: { token: string }) => t.token)
        if (tokens.length > 0) {
          await sendFcmPush(tokens, {
            title: 'Your offer was accepted',
            body: `${routeStr} · ${fareStr}`,
            data: {
              type: 'board_offer_accepted',
              ride_id: ride.id as string,
              schedule_id: schedule.id as string,
              offer_id: offerId,
            },
          })
        }
      } catch (err) {
        console.error('[board/offers:accept] driver-push failed:', err instanceof Error ? err.message : String(err))
      }

      // Notify sibling drivers: released
      if (siblingOffers && siblingOffers.length > 0) {
        for (const sib of siblingOffers as { id: string; driver_id: string }[]) {
          try {
            const { data: sibTokens } = await supabaseAdmin
              .from('push_tokens')
              .select('token')
              .eq('user_id', sib.driver_id)
            const tokens = (sibTokens ?? []).map((t: { token: string }) => t.token)
            if (tokens.length > 0) {
              await sendFcmPush(tokens, {
                title: 'Ride filled by another driver',
                body: 'The rider chose a different offer.',
                data: {
                  type: 'board_offer_released',
                  schedule_id: schedule.id as string,
                  offer_id: sib.id,
                },
              })
            }
          } catch (err) {
            console.error('[board/offers:accept] sibling-push failed:', err instanceof Error ? err.message : String(err))
          }
        }
      }
    })()

    console.log(`[board/offers:accept] rider=${userId.slice(0, 8)}… accepted offer=${offerId.slice(0, 8)}… ride=${(ride.id as string).slice(0, 8)}… released=${siblingOffers?.length ?? 0}`)
    res.status(200).json({
      ride_id: ride.id,
      offer_id: offerId,
      status: 'selected',
    })
  },
)

/**
 * POST /api/schedule/board/offers/:offerId/decline
 *
 * Slice A2 (2026-05-16). Rider declines a specific offer. Flips
 * that one offer to 'released'; doesn't touch sibling offers (they
 * remain pending, rider can still accept any of them). Pushes to
 * the declined driver.
 *
 * Returns: 200 OK { status: 'released' }
 */
scheduleRouter.post(
  '/board/offers/:offerId/decline',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals['userId'] as string
    const offerId = String(req.params['offerId'] ?? '')
    // 2026-05-18 Slice 9 — optional reason captured by the iOS
    // `BoardDeclineReasonSheet`. Mirrors the driver-side
    // `/decline-board` analytics shape: writes to the existing
    // `driver_decline_reasons` table (its `driver_id` column is
    // generic "decliner_id"; the table predates the role split —
    // see 064_driver_snooze.sql + the driver-side comment around
    // line 3360). Skip-the-sheet path sends no reason and we
    // intentionally skip the insert.
    const body = (req.body as { reason?: unknown } | undefined) ?? {}
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 200)
      : null

    if (!offerId) {
      res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'offerId required' } })
      return
    }

    // Same casting workaround as accept — see Slice A2 comment above.
    type DeclineOfferRow = {
      id: string
      schedule_id: string | null
      driver_id: string
      status: 'pending' | 'selected' | 'standby' | 'released'
      ride_id: string | null
    }
    const { data: offerRaw, error: offerErr } = await supabaseAdmin
      .from('ride_offers')
      .select('id, schedule_id, driver_id, status, ride_id' as never)
      .eq('id', offerId)
      .single()
    const offer = (offerRaw as unknown) as DeclineOfferRow | null

    if (offerErr || !offer) {
      res.status(404).json({ error: { code: 'OFFER_NOT_FOUND', message: 'Offer not found' } })
      return
    }

    if (offer.ride_id != null || offer.schedule_id == null) {
      res.status(400).json({
        error: { code: 'NOT_A_BOARD_OFFER', message: 'This endpoint only handles board offers' },
      })
      return
    }

    if (offer.status !== 'pending') {
      res.status(409).json({
        error: { code: 'ALREADY_RELEASED', message: `Offer is already ${offer.status}` },
      })
      return
    }

    const { data: schedule } = await supabaseAdmin
      .from('ride_schedules')
      .select('user_id')
      .eq('id', offer.schedule_id)
      .single()

    if (!schedule || schedule.user_id !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the rider can decline offers' } })
      return
    }

    const { error: updateErr } = await supabaseAdmin
      .from('ride_offers')
      .update({ status: 'released' } as never)
      .eq('id', offerId)

    if (updateErr) {
      next(updateErr)
      return
    }

    void (async () => {
      try {
        const { data: driverTokens } = await supabaseAdmin
          .from('push_tokens')
          .select('token')
          .eq('user_id', offer.driver_id)
        const tokens = (driverTokens ?? []).map((t: { token: string }) => t.token)
        if (tokens.length > 0) {
          await sendFcmPush(tokens, {
            title: 'Offer declined',
            body: 'The rider went with a different option.',
            data: {
              type: 'board_offer_declined',
              schedule_id: offer.schedule_id as string,
              offer_id: offerId,
            },
          })
        }
      } catch (err) {
        console.error('[board/offers:decline] push failed:', err instanceof Error ? err.message : String(err))
      }
    })()

    // 2026-05-18 Slice 9 — persist analytics row only when the
    // rider picked a reason on the sheet (same gate the driver-side
    // /decline-board uses). ride_id is null because board offers
    // are pre-ride (no `rides` row exists until accept fires).
    if (reason) {
      void supabaseAdmin
        .from('driver_decline_reasons')
        .insert({
          driver_id: userId,
          ride_id: null,
          reason,
          snooze_minutes: null,
        })
        .then(({ error: reasonErr }) => {
          if (reasonErr) {
            console.warn(
              `[board/offers:decline] Failed to log reason for user ${userId}: ${reasonErr.message}`,
            )
          }
        })
    }

    console.log(
      `[board/offers:decline] rider=${userId.slice(0, 8)}… declined offer=${offerId.slice(0, 8)}… reason=${reason ?? 'null'}`,
    )
    res.status(200).json({ status: 'released' })
  },
)

// ── Check for upcoming scheduled rides and send reminders ──────────────────
// Called by PM2 cron every 5 minutes (no JWT required — internal use only)
scheduleRouter.get(
  '/check-reminders',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [reminders, expiry, missed, sync, offerExpiry] = await Promise.all([
        checkUpcomingRides(),
        expireStaleRequests(),
        expireMissedRides(),
        syncAllRoutines(),
        expirePendingBoardOffers(),
      ])
      res.json({ reminders, expiry, missed, sync, offerExpiry })
    } catch (err) {
      next(err)
    }
  },
)
