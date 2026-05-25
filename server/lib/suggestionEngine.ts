/**
 * v1.3 Suggested Rides engine.
 *
 * BUILT ON TOP OF:
 *  - server/lib/transitSuggestions.ts (Google APIs + forward/reverse handoff)
 *  - server/lib/polyline.ts           (decoding + corridor projection)
 *  - server/lib/supabaseAdmin.ts      (service-role DB writes)
 *  - server/lib/fcm.ts                (push notifications)
 *
 * TRIGGER MODEL (user-specified, cost-optimized):
 *  Posts (one-off schedules) and routines fire scanForPost / scanForRoutine
 *  when written. The engine fans out per trip_date to opposite-role
 *  candidates that pass cheap PostGIS/haversine filters FIRST, so the
 *  expensive Google Routes/Places/Directions calls only fire for pairs
 *  that genuinely need transit-handoff resolution.
 *
 * 6-FILTER STACK (cheapest → most expensive):
 *  1. Date bucket  ─ skip dates with 0 opposite-role candidates  (SQL)
 *  2. Bbox overlap ─ skip cross-region pairs                    (haversine, $0)
 *  3. Bearing gate ─ keep forward (±90°) OR reverse (~180°±60°) (haversine, $0)
 *  4. Direct-match short-circuit ─ both endpoints within 10km
 *     of driver's start/end → classify as direct without API    (haversine, $0)
 *  5. Memoization ─ skip if pair already scored                 (DB lookup, $0)
 *  6. Polyline proximity ─ require driver's polyline within 75km
 *     of both rider endpoints                                   (PostGIS, $0)
 *
 * SCORING:
 *  Direct matches score 0..1 from (time × 0.45 + bearing × 0.30 + proximity × 0.25).
 *  Transit/reverse handoffs score 0.45..0.75 (handoff classification caps below
 *  most directs by design — direct matches always win when both exist).
 *
 * The existing /api/schedule/board/search endpoint is left untouched. This
 * engine reuses the same pure helpers but writes its own persistence path.
 */

import { supabaseAdmin } from './supabaseAdmin.ts'
import {
  computeTransitDropoffSuggestions,
  computeTransitPickupSuggestions,
  type TransitDropoffSuggestion,
} from './transitSuggestions.ts'
import {
  decodePolyline,
  haversineMetres,
  projectPointOntoPolyline,
  type LatLng,
} from './polyline.ts'
import { sendFcmPush } from './fcm.ts'

// ─────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────

const WINDOW_DAYS_AHEAD = 14
const TOP_N_PER_SCAN = 5
const MAX_CANDIDATES_PER_SCAN = 50

const BBOX_TOLERANCE_M = 100_000
// Bearing was a hard filter in Phase A.0; demoted to a scoring signal
// only on 2026-05-25 after we identified the 90°-120° dead-zone bug
// (two students going to UC Davis campus from opposite sides of Davis
// would be silently dropped). See the bearing comment in matchPair.
const DIRECT_MATCH_RADIUS_M = 10_000
const POLYLINE_PROXIMITY_M = 75_000
const ROUTE_CORRIDOR_M = 2_000

// Time was a hard filter at 30 min in Phase A.0; demoted to a scoring
// signal only on 2026-05-25 (same root cause as the bearing dead zone:
// for a discovery surface like Suggested Rides, hard time-filtering
// silently kills valid matches users WANT to see). The decay window
// below controls how aggressively distant-time matches lose score —
// closer pairs score higher, distant pairs score lower but still
// appear in the tab.
const TIME_SCORE_DECAY_MIN = 180  // timeScore reaches 0 at 180 min apart
const INSTANT_PUSH_RELEVANCE = 0.7

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

type Role = 'rider' | 'driver'
type MatchType = 'same_day_forward' | 'routine_recurring' | 'reverse_trip'
type MatchClassification = 'direct' | 'transit_dropoff' | 'transit_pickup'

interface Post {
  source_table: 'ride_schedules' | 'rider_routines' | 'driver_routines'
  source_id: string
  user_id: string
  role: Role
  origin_lat: number
  origin_lng: number
  dest_lat: number
  dest_lng: number
  trip_date: string             // YYYY-MM-DD (for routines: an expanded covered date)
  trip_time: string | null      // HH:MM[:SS]
  time_flexible: boolean
  route_polyline: string | null
  bearing: number               // 0..360
}

interface MatchSignals {
  classification: MatchClassification
  bearing_diff_deg: number
  time_diff_min: number | null
  origin_distance_m: number
  dest_distance_m: number
  corridor_origin_m?: number
  corridor_dest_m?: number
  // Transit-handoff details (transit_dropoff + transit_pickup only).
  // Drives the medium-density card in the Suggested tab — walk +
  // transit + ride leg breakdown without leg-cost estimates.
  handoff_total_minutes?: number
  handoff_station_name?: string
  handoff_station_address?: string
  handoff_walk_minutes?: number
  handoff_transit_minutes?: number
  handoff_ride_minutes?: number
  handoff_transit_line?: string
  handoff_transit_type?: string                  // e.g. 'BUS', 'HEAVY_RAIL'
}

interface SuggestionCandidate {
  rider_user_id: string
  driver_user_id: string
  rider_schedule_id: string | null
  driver_schedule_id: string | null
  rider_routine_id: string | null
  driver_routine_id: string | null
  trip_date: string
  match_type: MatchType
  relevance_score: number
  match_signals: MatchSignals
}

interface RideScheduleRow {
  id: string
  user_id: string
  mode: 'rider' | 'driver'
  trip_date: string
  trip_time: string | null
  origin_lat: number | null
  origin_lng: number | null
  dest_lat: number | null
  dest_lng: number | null
  route_polyline: string | null
}

interface RoutineRow {
  id: string
  user_id: string
  day_of_week: number[]
  departure_time: string | null
  arrival_time: string | null
  is_active: boolean
  end_date: string | null
  route_polyline: string | null
}

// ─────────────────────────────────────────────────────────────────────
// Tiny helpers
// ─────────────────────────────────────────────────────────────────────

function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180
  const toDeg = 180 / Math.PI
  const phi1 = lat1 * toRad
  const phi2 = lat2 * toRad
  const dLam = (lng2 - lng1) * toRad
  const y = Math.sin(dLam) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam)
  return ((Math.atan2(y, x) * toDeg) + 360) % 360
}

function bearingDifference(b1: number, b2: number): number {
  const diff = Math.abs(b1 - b2) % 360
  return diff > 180 ? 360 - diff : diff
}

function timeDifferenceMinutes(t1: string, t2: string): number {
  const parse = (t: string): number => {
    const parts = t.split(':').map(Number)
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
  }
  return Math.abs(parse(t1) - parse(t2))
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0]!
}

function dateNDaysFromNow(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]!
}

function dayOfWeekFor(date: string): number {
  // Use noon UTC to dodge timezone-boundary edge cases.
  return new Date(date + 'T12:00:00Z').getUTCDay()
}

function expiresAtFor(tripDate: string): string {
  // One-day grace after the trip date so a same-day match can still
  // be acted on the next morning before the purge runs.
  const d = new Date(tripDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

// ─────────────────────────────────────────────────────────────────────
// Filter Layer 2: bounding box overlap
// ─────────────────────────────────────────────────────────────────────

function postsBoundingBoxOverlap(a: Post, b: Post): boolean {
  const aMinLat = Math.min(a.origin_lat, a.dest_lat)
  const aMaxLat = Math.max(a.origin_lat, a.dest_lat)
  const aMinLng = Math.min(a.origin_lng, a.dest_lng)
  const aMaxLng = Math.max(a.origin_lng, a.dest_lng)
  const bMinLat = Math.min(b.origin_lat, b.dest_lat)
  const bMaxLat = Math.max(b.origin_lat, b.dest_lat)
  const bMinLng = Math.min(b.origin_lng, b.dest_lng)
  const bMaxLng = Math.max(b.origin_lng, b.dest_lng)

  const tolDegLat = BBOX_TOLERANCE_M / 111_320
  const midLat = (aMinLat + aMaxLat + bMinLat + bMaxLat) / 4
  const tolDegLng = BBOX_TOLERANCE_M / Math.max(1, 111_320 * Math.cos(midLat * Math.PI / 180))

  if (aMaxLat + tolDegLat < bMinLat) return false
  if (aMinLat - tolDegLat > bMaxLat) return false
  if (aMaxLng + tolDegLng < bMinLng) return false
  if (aMinLng - tolDegLng > bMaxLng) return false
  return true
}

// ─────────────────────────────────────────────────────────────────────
// Rejection observability
// ─────────────────────────────────────────────────────────────────────

/// Rejection observability — each filter that drops a pair fires
/// one line so we can grep `[suggestionEngine] reject` and audit
/// what's being filtered out. Cheap (one console.log per rejection;
/// rejections happen at low volume because the candidate fetch is
/// already date+role-scoped).
function logReject(rider: Post, driver: Post, reason: string): void {
  const r = `${rider.source_table}/${rider.source_id.slice(0, 8)}`
  const d = `${driver.source_table}/${driver.source_id.slice(0, 8)}`
  console.log(`[suggestionEngine] reject ${reason} rider=${r} driver=${d} date=${rider.trip_date}`)
}

// ─────────────────────────────────────────────────────────────────────
// Filter Layer 4: cheap direct-match short-circuit
// ─────────────────────────────────────────────────────────────────────

function obviousDirectMatch(rider: Post, driver: Post): {
  isDirect: boolean
  originDistanceM: number
  destDistanceM: number
} {
  const originDist = haversineMetres(rider.origin_lat, rider.origin_lng, driver.origin_lat, driver.origin_lng)
  const destDist = haversineMetres(rider.dest_lat, rider.dest_lng, driver.dest_lat, driver.dest_lng)
  return {
    isDirect: originDist <= DIRECT_MATCH_RADIUS_M && destDist <= DIRECT_MATCH_RADIUS_M,
    originDistanceM: originDist,
    destDistanceM: destDist,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Filter Layer 5: memoization — skip pairs already scored
// ─────────────────────────────────────────────────────────────────────

async function suggestionAlreadyExists(candidate: SuggestionCandidate): Promise<boolean> {
  const riderKey = candidate.rider_schedule_id ?? candidate.rider_routine_id
  const driverKey = candidate.driver_schedule_id ?? candidate.driver_routine_id
  if (!riderKey || !driverKey) return false

  let query = supabaseAdmin
    .from('ride_suggestions')
    .select('id')
    .eq('trip_date', candidate.trip_date)
    .limit(1)

  if (candidate.rider_schedule_id) {
    query = query.eq('rider_schedule_id', candidate.rider_schedule_id)
  } else if (candidate.rider_routine_id) {
    query = query.eq('rider_routine_id', candidate.rider_routine_id)
  }
  if (candidate.driver_schedule_id) {
    query = query.eq('driver_schedule_id', candidate.driver_schedule_id)
  } else if (candidate.driver_routine_id) {
    query = query.eq('driver_routine_id', candidate.driver_routine_id)
  }

  const { data, error } = await query
  if (error) return false
  return (data?.length ?? 0) > 0
}

// ─────────────────────────────────────────────────────────────────────
// Filter Layer 6: polyline proximity gate
// ─────────────────────────────────────────────────────────────────────

function polylinePassesNearEndpoints(polyline: LatLng[], rider: Post): boolean {
  if (polyline.length === 0) return false
  const originProj = projectPointOntoPolyline({ lat: rider.origin_lat, lng: rider.origin_lng }, polyline)
  const destProj = projectPointOntoPolyline({ lat: rider.dest_lat, lng: rider.dest_lng }, polyline)
  return originProj.distanceM <= POLYLINE_PROXIMITY_M && destProj.distanceM <= POLYLINE_PROXIMITY_M
}

// ─────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────

function scoreDirect(signals: MatchSignals): number {
  // Time decay extended from 60 to 180 min (TIME_SCORE_DECAY_MIN)
  // so a 60-min apart match still contributes ~0.67 instead of 0
  // (the old 60-min decay made anything beyond 60 score effectively
  // zero on time, which combined with the now-removed hard time
  // filter would have hidden most matches in low-density data).
  const timeScore = signals.time_diff_min === null
    ? 0.5
    : Math.max(0, 1 - signals.time_diff_min / TIME_SCORE_DECAY_MIN)
  const bearingScore = Math.max(0, 1 - signals.bearing_diff_deg / 90)
  const proximityScore = Math.max(0,
    1 - (signals.origin_distance_m + signals.dest_distance_m) / (2 * DIRECT_MATCH_RADIUS_M),
  )
  return Math.min(1, 0.45 * timeScore + 0.30 * bearingScore + 0.25 * proximityScore)
}

function scoreTransit(handoff: TransitDropoffSuggestion, isPickupHandoff: boolean): number {
  // Transit-pickup matches (rider transits TO driver's route) are
  // anchored slightly lower than transit-dropoff matches because
  // they require the rider to commit to transit BEFORE the driver
  // shows up, which is operationally harder.
  const totalMin = handoff.total_rider_minutes ?? 60
  const decay = Math.max(0, 1 - totalMin / 120)
  const base = isPickupHandoff ? 0.45 : 0.55
  return Math.min(0.75, base + decay * 0.20)
}

// ─────────────────────────────────────────────────────────────────────
// Match function (the workhorse)
// ─────────────────────────────────────────────────────────────────────

async function matchPair(
  rider: Post,
  driver: Post,
): Promise<SuggestionCandidate | null> {
  // Don't match against self.
  if (rider.user_id === driver.user_id) return null

  // Time diff is now a SCORING signal only (hard filter removed
  // 2026-05-25, same rationale as the bearing demotion). Distant-time
  // pairs still reach matchPair and produce rows with low scores;
  // they appear in the Suggested tab but don't push. Closer-time
  // pairs score high enough to push instantly.
  let timeDiffMin: number | null = null
  if (rider.trip_time && driver.trip_time && !rider.time_flexible && !driver.time_flexible) {
    timeDiffMin = timeDifferenceMinutes(rider.trip_time, driver.trip_time)
  }

  // Layer 2 — bbox overlap.
  if (!postsBoundingBoxOverlap(rider, driver)) {
    logReject(rider, driver, 'bbox_overlap')
    return null
  }

  // Layer 3 — bearing is NOT a hard filter (removed 2026-05-25 after
  // user-CTO review). The original 90°/120° dead zone was killing
  // valid matches like "two students going to UC Davis campus from
  // opposite sides of Davis" (bearings ~105° apart). The polyline
  // proximity check (Layer 6) + corridor projection inside matchPair
  // are strictly more accurate than bearing alignment. Bearing stays
  // as a SCORING signal only (`bearingScore` weighted 0.30 in
  // `scoreDirect`), so badly-aligned pairs naturally rank lower
  // without being silently dropped.
  //
  // True opposite-direction reverse-trip pairs (Phase D scope) are
  // still naturally rejected here because their `originProj.fractionAlong`
  // ends up GREATER than `destProj.fractionAlong` (rider's drop on
  // driver's polyline comes BEFORE pickup = wrong order), failing the
  // direct-match branch + falling through to null.
  const bearingDiff = bearingDifference(rider.bearing, driver.bearing)
  const direct = obviousDirectMatch(rider, driver)

  // Layer 4 — direct-match short-circuit.
  if (direct.isDirect) {
    const signals: MatchSignals = {
      classification: 'direct',
      bearing_diff_deg: bearingDiff,
      time_diff_min: timeDiffMin,
      origin_distance_m: direct.originDistanceM,
      dest_distance_m: direct.destDistanceM,
    }
    return {
      rider_user_id: rider.user_id,
      driver_user_id: driver.user_id,
      rider_schedule_id: rider.source_table === 'ride_schedules' ? rider.source_id : null,
      driver_schedule_id: driver.source_table === 'ride_schedules' ? driver.source_id : null,
      rider_routine_id: rider.source_table === 'rider_routines' ? rider.source_id : null,
      driver_routine_id: driver.source_table === 'driver_routines' ? driver.source_id : null,
      trip_date: rider.trip_date,
      match_type: rider.source_table.includes('routine') || driver.source_table.includes('routine')
        ? 'routine_recurring' : 'same_day_forward',
      relevance_score: scoreDirect(signals),
      match_signals: signals,
    }
  }

  // For everything else we need the driver's polyline. If it isn't
  // pre-computed (web posts without compute-route, routines without
  // a polyline), fall back to scoring this as a weaker direct match
  // when the endpoints are at least in the same neighbourhood.
  if (!driver.route_polyline) {
    if (direct.originDistanceM > 30_000 || direct.destDistanceM > 30_000) {
      logReject(rider, driver, `no_polyline_endpoints_too_far(${Math.round(direct.originDistanceM)}m,${Math.round(direct.destDistanceM)}m)`)
      return null
    }
    if (direct.originDistanceM <= 30_000 && direct.destDistanceM <= 30_000) {
      const signals: MatchSignals = {
        classification: 'direct',
        bearing_diff_deg: bearingDiff,
        time_diff_min: timeDiffMin,
        origin_distance_m: direct.originDistanceM,
        dest_distance_m: direct.destDistanceM,
      }
      // Soft cap because we couldn't verify the route.
      const score = scoreDirect(signals) * 0.7
      return {
        rider_user_id: rider.user_id,
        driver_user_id: driver.user_id,
        rider_schedule_id: rider.source_table === 'ride_schedules' ? rider.source_id : null,
        driver_schedule_id: driver.source_table === 'ride_schedules' ? driver.source_id : null,
        rider_routine_id: rider.source_table === 'rider_routines' ? rider.source_id : null,
        driver_routine_id: driver.source_table === 'driver_routines' ? driver.source_id : null,
        trip_date: rider.trip_date,
        match_type: rider.source_table.includes('routine') || driver.source_table.includes('routine')
          ? 'routine_recurring' : 'same_day_forward',
        relevance_score: score,
        match_signals: signals,
      }
    }
    return null
  }

  const polyline = decodePolyline(driver.route_polyline)

  // Layer 6 — polyline proximity gate.
  if (!polylinePassesNearEndpoints(polyline, rider)) {
    logReject(rider, driver, 'polyline_proximity')
    return null
  }

  // Now decide: direct (both on/near route), forward handoff (origin
  // on route, dest off), or reverse handoff (dest on route, origin off).
  const originProj = projectPointOntoPolyline({ lat: rider.origin_lat, lng: rider.origin_lng }, polyline)
  const destProj = projectPointOntoPolyline({ lat: rider.dest_lat, lng: rider.dest_lng }, polyline)
  const pickupOnRoute = originProj.distanceM <= ROUTE_CORRIDOR_M
  const pickupNearStart = direct.originDistanceM <= DIRECT_MATCH_RADIUS_M
  const dropoffOnRoute = destProj.distanceM <= ROUTE_CORRIDOR_M
  const dropoffNearEnd = direct.destDistanceM <= DIRECT_MATCH_RADIUS_M

  // Direct route match.
  if ((pickupOnRoute || pickupNearStart)
      && (dropoffOnRoute || dropoffNearEnd)
      && originProj.fractionAlong < destProj.fractionAlong) {
    const signals: MatchSignals = {
      classification: 'direct',
      bearing_diff_deg: bearingDiff,
      time_diff_min: timeDiffMin,
      origin_distance_m: direct.originDistanceM,
      dest_distance_m: direct.destDistanceM,
      corridor_origin_m: originProj.distanceM,
      corridor_dest_m: destProj.distanceM,
    }
    return {
      rider_user_id: rider.user_id,
      driver_user_id: driver.user_id,
      rider_schedule_id: rider.source_table === 'ride_schedules' ? rider.source_id : null,
      driver_schedule_id: driver.source_table === 'ride_schedules' ? driver.source_id : null,
      rider_routine_id: rider.source_table === 'rider_routines' ? rider.source_id : null,
      driver_routine_id: driver.source_table === 'driver_routines' ? driver.source_id : null,
      trip_date: rider.trip_date,
      match_type: rider.source_table.includes('routine') || driver.source_table.includes('routine')
        ? 'routine_recurring' : 'same_day_forward',
      relevance_score: scoreDirect(signals),
      match_signals: signals,
    }
  }

  const apiKey = process.env['GOOGLE_MAPS_KEY']
  if (!apiKey) return null

  const apiKeyCheck = process.env['GOOGLE_MAPS_KEY']
  if (!apiKeyCheck) {
    logReject(rider, driver, 'no_google_api_key')
  }

  // Transit-dropoff handoff — driver drops rider at a transit station
  // near route, rider transits the rest of the way to their destination.
  if ((pickupOnRoute || pickupNearStart) && !dropoffOnRoute && !dropoffNearEnd) {
    const handoffResult = await computeTransitDropoffSuggestions(
      driver.origin_lat, driver.origin_lng,
      driver.dest_lat, driver.dest_lng,
      rider.dest_lat, rider.dest_lng,
      apiKey,
      driver.route_polyline,
    )
    const handoffs = handoffResult.suggestions
    if (handoffs.length === 0) return null
    const best = handoffs[0]!
    const bestOption = best.transit_options[0]
    const signals: MatchSignals = {
      classification: 'transit_dropoff',
      bearing_diff_deg: bearingDiff,
      time_diff_min: timeDiffMin,
      origin_distance_m: direct.originDistanceM,
      dest_distance_m: direct.destDistanceM,
      corridor_origin_m: originProj.distanceM,
      corridor_dest_m: destProj.distanceM,
      handoff_total_minutes: best.total_rider_minutes,
      handoff_station_name: best.station_name,
      handoff_station_address: best.station_address,
      handoff_walk_minutes: best.walk_to_station_minutes,
      handoff_transit_minutes: best.transit_to_dest_minutes,
      handoff_ride_minutes: best.ride_with_driver_minutes,
      ...(bestOption?.line_name ? { handoff_transit_line: bestOption.line_name } : {}),
      ...(bestOption?.type ? { handoff_transit_type: bestOption.type } : {}),
    }
    return {
      rider_user_id: rider.user_id,
      driver_user_id: driver.user_id,
      rider_schedule_id: rider.source_table === 'ride_schedules' ? rider.source_id : null,
      driver_schedule_id: driver.source_table === 'ride_schedules' ? driver.source_id : null,
      rider_routine_id: rider.source_table === 'rider_routines' ? rider.source_id : null,
      driver_routine_id: driver.source_table === 'driver_routines' ? driver.source_id : null,
      trip_date: rider.trip_date,
      match_type: 'same_day_forward',
      relevance_score: scoreTransit(best, false),
      match_signals: signals,
    }
  }

  // Transit-pickup handoff — rider's destination is on/near driver's
  // route, but pickup is off-route. Rider transits TO a station on
  // driver's route, joins driver there for the longer leg. Still a
  // same-direction match (rider + driver both going A→B-ish); the
  // smart-search engine calls this "reverse handoff" (v1.2.1 S2.1)
  // but it is NOT an opposite-direction match. True opposite-direction
  // return-trip matching is Phase D.
  if (!pickupOnRoute && !pickupNearStart && (dropoffOnRoute || dropoffNearEnd)) {
    const handoffResult = await computeTransitPickupSuggestions(
      driver.origin_lat, driver.origin_lng,
      driver.dest_lat, driver.dest_lng,
      rider.origin_lat, rider.origin_lng,
      apiKey,
      driver.route_polyline,
    )
    const handoffs = handoffResult.suggestions
    if (handoffs.length === 0) return null
    const best = handoffs[0]!
    const bestOption = best.transit_options[0]
    const signals: MatchSignals = {
      classification: 'transit_pickup',
      bearing_diff_deg: bearingDiff,
      time_diff_min: timeDiffMin,
      origin_distance_m: direct.originDistanceM,
      dest_distance_m: direct.destDistanceM,
      corridor_origin_m: originProj.distanceM,
      corridor_dest_m: destProj.distanceM,
      handoff_total_minutes: best.total_rider_minutes,
      handoff_station_name: best.station_name,
      handoff_station_address: best.station_address,
      handoff_walk_minutes: best.walk_to_station_minutes,
      handoff_transit_minutes: best.transit_to_dest_minutes,
      handoff_ride_minutes: best.ride_with_driver_minutes,
      ...(bestOption?.line_name ? { handoff_transit_line: bestOption.line_name } : {}),
      ...(bestOption?.type ? { handoff_transit_type: bestOption.type } : {}),
    }
    return {
      rider_user_id: rider.user_id,
      driver_user_id: driver.user_id,
      rider_schedule_id: rider.source_table === 'ride_schedules' ? rider.source_id : null,
      driver_schedule_id: driver.source_table === 'ride_schedules' ? driver.source_id : null,
      rider_routine_id: rider.source_table === 'rider_routines' ? rider.source_id : null,
      driver_routine_id: driver.source_table === 'driver_routines' ? driver.source_id : null,
      trip_date: rider.trip_date,
      match_type: rider.source_table.includes('routine') || driver.source_table.includes('routine')
        ? 'routine_recurring' : 'same_day_forward',
      relevance_score: scoreTransit(best, true),
      match_signals: signals,
    }
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────
// Candidate fetching
// ─────────────────────────────────────────────────────────────────────

async function fetchOppositeRoleCandidates(seed: Post): Promise<Post[]> {
  const oppositeRole: Role = seed.role === 'rider' ? 'driver' : 'rider'
  const candidates: Post[] = []

  // 1. Opposite-role one-off schedules on the same trip_date.
  const { data: schedRows, error: schedErr } = await supabaseAdmin
    .from('ride_schedules')
    .select('id, user_id, mode, trip_date, trip_time, origin_lat, origin_lng, dest_lat, dest_lng, route_polyline')
    .eq('mode', oppositeRole)
    .eq('trip_date', seed.trip_date)
    .neq('user_id', seed.user_id)
    .not('origin_lat', 'is', null)
    .not('dest_lat', 'is', null)
    .limit(MAX_CANDIDATES_PER_SCAN)

  if (!schedErr && schedRows) {
    for (const row of schedRows as unknown as RideScheduleRow[]) {
      if (row.origin_lat == null || row.origin_lng == null || row.dest_lat == null || row.dest_lng == null) continue
      candidates.push({
        source_table: 'ride_schedules',
        source_id: row.id,
        user_id: row.user_id,
        role: oppositeRole,
        origin_lat: row.origin_lat,
        origin_lng: row.origin_lng,
        dest_lat: row.dest_lat,
        dest_lng: row.dest_lng,
        trip_date: seed.trip_date,
        trip_time: row.trip_time,
        time_flexible: false,
        route_polyline: row.route_polyline,
        bearing: calculateBearing(row.origin_lat, row.origin_lng, row.dest_lat, row.dest_lng),
      })
    }
  }

  // 2. Opposite-role routines whose day_of_week covers seed.trip_date.
  const dow = dayOfWeekFor(seed.trip_date)
  const routineTable = oppositeRole === 'driver' ? 'driver_routines' : 'rider_routines'
  const { data: routineRows, error: routineErr } = await supabaseAdmin
    .from(routineTable)
    .select('id, user_id, day_of_week, departure_time, arrival_time, is_active, end_date, route_polyline, origin, destination')
    .eq('is_active', true)
    .contains('day_of_week', [dow])
    .neq('user_id', seed.user_id)
    .or(`end_date.is.null,end_date.gte.${seed.trip_date}`)
    .limit(MAX_CANDIDATES_PER_SCAN)

  if (!routineErr && routineRows) {
    for (const raw of routineRows as unknown as Array<RoutineRow & {
      origin: { coordinates?: [number, number] } | null
      destination: { coordinates?: [number, number] } | null
    }>) {
      const oLng = raw.origin?.coordinates?.[0]
      const oLat = raw.origin?.coordinates?.[1]
      const dLng = raw.destination?.coordinates?.[0]
      const dLat = raw.destination?.coordinates?.[1]
      if (oLng == null || oLat == null || dLng == null || dLat == null) continue
      candidates.push({
        source_table: routineTable as 'driver_routines' | 'rider_routines',
        source_id: raw.id,
        user_id: raw.user_id,
        role: oppositeRole,
        origin_lat: oLat,
        origin_lng: oLng,
        dest_lat: dLat,
        dest_lng: dLng,
        trip_date: seed.trip_date,
        trip_time: raw.departure_time ?? raw.arrival_time,
        time_flexible: false,
        route_polyline: raw.route_polyline,
        bearing: calculateBearing(oLat, oLng, dLat, dLng),
      })
    }
  }

  return candidates.slice(0, MAX_CANDIDATES_PER_SCAN)
}

// ─────────────────────────────────────────────────────────────────────
// UPSERT
// ─────────────────────────────────────────────────────────────────────

async function persistSuggestions(
  candidates: SuggestionCandidate[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0
  let skipped = 0
  for (const c of candidates) {
    // Layer 5 — memoization.
    if (await suggestionAlreadyExists(c)) { skipped += 1; continue }

    const { error } = await supabaseAdmin
      .from('ride_suggestions')
      .insert({
        rider_user_id: c.rider_user_id,
        driver_user_id: c.driver_user_id,
        rider_schedule_id: c.rider_schedule_id,
        driver_schedule_id: c.driver_schedule_id,
        rider_routine_id: c.rider_routine_id,
        driver_routine_id: c.driver_routine_id,
        trip_date: c.trip_date,
        match_type: c.match_type,
        relevance_score: c.relevance_score,
        match_signals: c.match_signals,
        expires_at: expiresAtFor(c.trip_date),
      } as never)

    if (error) {
      // 23505 = unique-violation: another scan already wrote this pair
      // for this date. Safe to ignore.
      if (!error.message.includes('23505') && !error.message.toLowerCase().includes('duplicate')) {
        console.error('[suggestionEngine] insert failed:', error.message)
      }
      skipped += 1
    } else {
      inserted += 1
    }
  }
  return { inserted, skipped }
}

// ─────────────────────────────────────────────────────────────────────
// Public API: scan-for-post (the on-write entry point)
// ─────────────────────────────────────────────────────────────────────

export async function scanForPost(scheduleId: string): Promise<{ inserted: number; skipped: number }> {
  const { data: row, error } = await supabaseAdmin
    .from('ride_schedules')
    .select('id, user_id, mode, trip_date, trip_time, origin_lat, origin_lng, dest_lat, dest_lng, route_polyline')
    .eq('id', scheduleId)
    .maybeSingle()

  if (error || !row) return { inserted: 0, skipped: 0 }
  const r = row as unknown as RideScheduleRow

  // Window guard: ignore posts beyond the look-ahead horizon.
  if (r.trip_date < todayISO() || r.trip_date > dateNDaysFromNow(WINDOW_DAYS_AHEAD)) {
    return { inserted: 0, skipped: 0 }
  }
  if (r.origin_lat == null || r.origin_lng == null || r.dest_lat == null || r.dest_lng == null) {
    return { inserted: 0, skipped: 0 }
  }

  const seed: Post = {
    source_table: 'ride_schedules',
    source_id: r.id,
    user_id: r.user_id,
    role: r.mode,
    origin_lat: r.origin_lat,
    origin_lng: r.origin_lng,
    dest_lat: r.dest_lat,
    dest_lng: r.dest_lng,
    trip_date: r.trip_date,
    trip_time: r.trip_time,
    time_flexible: false,
    route_polyline: r.route_polyline,
    bearing: calculateBearing(r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng),
  }

  return scanSeedAgainstWorld(seed)
}

export async function scanForRoutine(
  routineId: string,
  role: Role,
): Promise<{ inserted: number; skipped: number }> {
  const table = role === 'driver' ? 'driver_routines' : 'rider_routines'
  const { data: row, error } = await supabaseAdmin
    .from(table)
    .select('id, user_id, day_of_week, departure_time, arrival_time, is_active, end_date, route_polyline, origin, destination')
    .eq('id', routineId)
    .maybeSingle()

  if (error || !row) return { inserted: 0, skipped: 0 }
  const r = row as unknown as RoutineRow & {
    origin: { coordinates?: [number, number] } | null
    destination: { coordinates?: [number, number] } | null
  }
  if (!r.is_active) return { inserted: 0, skipped: 0 }

  const oLng = r.origin?.coordinates?.[0]
  const oLat = r.origin?.coordinates?.[1]
  const dLng = r.destination?.coordinates?.[0]
  const dLat = r.destination?.coordinates?.[1]
  if (oLng == null || oLat == null || dLng == null || dLat == null) return { inserted: 0, skipped: 0 }

  let totalInserted = 0
  let totalSkipped = 0

  // Expand routine to its covered dates in the window.
  for (let day = 0; day <= WINDOW_DAYS_AHEAD; day += 1) {
    const date = dateNDaysFromNow(day)
    if (r.end_date && date > r.end_date) break
    const dow = dayOfWeekFor(date)
    if (!r.day_of_week.includes(dow)) continue

    const seed: Post = {
      source_table: table as 'driver_routines' | 'rider_routines',
      source_id: r.id,
      user_id: r.user_id,
      role,
      origin_lat: oLat,
      origin_lng: oLng,
      dest_lat: dLat,
      dest_lng: dLng,
      trip_date: date,
      trip_time: r.departure_time ?? r.arrival_time,
      time_flexible: false,
      route_polyline: r.route_polyline,
      bearing: calculateBearing(oLat, oLng, dLat, dLng),
    }
    const result = await scanSeedAgainstWorld(seed)
    totalInserted += result.inserted
    totalSkipped += result.skipped
  }

  return { inserted: totalInserted, skipped: totalSkipped }
}

async function scanSeedAgainstWorld(seed: Post): Promise<{ inserted: number; skipped: number }> {
  const candidates = await fetchOppositeRoleCandidates(seed)
  if (candidates.length === 0) return { inserted: 0, skipped: 0 }

  const matches: SuggestionCandidate[] = []
  for (const candidate of candidates) {
    const rider = seed.role === 'rider' ? seed : candidate
    const driver = seed.role === 'driver' ? seed : candidate
    const result = await matchPair(rider, driver)
    if (result) matches.push(result)
  }

  matches.sort((a, b) => b.relevance_score - a.relevance_score)
  return persistSuggestions(matches.slice(0, TOP_N_PER_SCAN))
}

// ─────────────────────────────────────────────────────────────────────
// Public API: cron backstops
// ─────────────────────────────────────────────────────────────────────

export async function runSuggestionBackstopScan(): Promise<{ scanned: number; inserted: number }> {
  // Last hour's schedule + routine writes that may have missed the on-
  // write trigger (driver_routines have no server-side endpoint to
  // hook into; web/iOS insert them directly. This cron is their only
  // scan path until/unless we move driver-routines CRUD server-side).
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  let scanned = 0
  let inserted = 0

  // 1. Recent schedules.
  const { data: schedRows } = await supabaseAdmin
    .from('ride_schedules')
    .select('id')
    .gte('created_at', cutoff)
    .gte('trip_date', todayISO())
    .lte('trip_date', dateNDaysFromNow(WINDOW_DAYS_AHEAD))
    .limit(100)

  for (const row of (schedRows ?? []) as Array<{ id: string }>) {
    const result = await scanForPost(row.id)
    scanned += 1
    inserted += result.inserted
  }

  // 2. Recent driver routines.
  const { data: driverRoutineRows } = await supabaseAdmin
    .from('driver_routines')
    .select('id')
    .gte('created_at', cutoff)
    .eq('is_active', true)
    .limit(100)

  for (const row of (driverRoutineRows ?? []) as Array<{ id: string }>) {
    const result = await scanForRoutine(row.id, 'driver')
    scanned += 1
    inserted += result.inserted
  }

  // 3. Recent rider routines.
  const { data: riderRoutineRows } = await supabaseAdmin
    .from('rider_routines')
    .select('id')
    .gte('created_at', cutoff)
    .eq('is_active', true)
    .limit(100)

  for (const row of (riderRoutineRows ?? []) as Array<{ id: string }>) {
    const result = await scanForRoutine(row.id, 'rider')
    scanned += 1
    inserted += result.inserted
  }

  return { scanned, inserted }
}

export async function expireStaleSuggestions(): Promise<{ deleted: number }> {
  let totalDeleted = 0

  // 1. Pass-the-trip-date expiry — driven by the row's own expires_at
  //    column (trip_date + 1 day grace).
  const { data: expired, error: expireErr } = await supabaseAdmin
    .from('ride_suggestions')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('id')

  if (expireErr) {
    console.error('[suggestionEngine] expire-by-date failed:', expireErr.message)
  } else {
    totalDeleted += expired?.length ?? 0
  }

  // 2. Routine-state cleanup (added 2026-05-25). When a routine is
  //    deactivated (is_active=false) or its end_date passes, any
  //    suggestions still referencing it become stale — the user sees
  //    "match for your Mon-Wed-Fri routine" for a routine they turned
  //    off. ON DELETE CASCADE only fires on actual routine deletes,
  //    not state flips, so we explicitly purge here.
  //
  //    Strategy: collect inactive/past-end routine IDs from both
  //    rider_routines + driver_routines, then DELETE FROM
  //    ride_suggestions WHERE rider_routine_id IN (...) OR
  //    driver_routine_id IN (...).
  const today = todayISO()
  const inactiveRiderRoutineIds = await fetchInactiveRoutineIds('rider_routines', today)
  const inactiveDriverRoutineIds = await fetchInactiveRoutineIds('driver_routines', today)

  if (inactiveRiderRoutineIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('ride_suggestions')
      .delete()
      .in('rider_routine_id', inactiveRiderRoutineIds)
      .select('id')
    if (error) {
      console.error('[suggestionEngine] expire-by-rider-routine failed:', error.message)
    } else {
      totalDeleted += data?.length ?? 0
    }
  }

  if (inactiveDriverRoutineIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('ride_suggestions')
      .delete()
      .in('driver_routine_id', inactiveDriverRoutineIds)
      .select('id')
    if (error) {
      console.error('[suggestionEngine] expire-by-driver-routine failed:', error.message)
    } else {
      totalDeleted += data?.length ?? 0
    }
  }

  return { deleted: totalDeleted }
}

/// Helper for `expireStaleSuggestions` — returns IDs of routines that
/// are either explicitly deactivated (is_active=false) or whose
/// end_date has passed. Bounded to 500 to keep the IN list reasonable;
/// any overflow gets caught on the next cron tick.
async function fetchInactiveRoutineIds(
  table: 'rider_routines' | 'driver_routines',
  today: string,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('id')
    .or(`is_active.eq.false,end_date.lt.${today}`)
    .limit(500)
  if (error) {
    console.error(`[suggestionEngine] fetchInactive(${table}) failed:`, error.message)
    return []
  }
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

// ─────────────────────────────────────────────────────────────────────
// Public API: notification dispatch
// ─────────────────────────────────────────────────────────────────────
//
// Push policy:
//  - relevance > 0.7 OR trip_date = today → instant push (per side)
//  - everything else → defer to Phase E's 7am daily digest cron
//  - never push if notified_via_instant=true (the live Stage 1/2/3 loop
//    already covered this user)
//  - per-side: only push the side whose notified_at is null AND status='new'

interface DispatchableRow {
  id: string
  rider_user_id: string
  driver_user_id: string
  trip_date: string
  relevance_score: number
  rider_status: string
  driver_status: string
  rider_notified_at: string | null
  driver_notified_at: string | null
  notified_via_instant: boolean
  match_signals: MatchSignals
}

export async function dispatchSuggestionNotifications(): Promise<{ pushed: number; deferred: number }> {
  const today = todayISO()
  const { data: rows, error } = await supabaseAdmin
    .from('ride_suggestions')
    .select('id, rider_user_id, driver_user_id, trip_date, relevance_score, rider_status, driver_status, rider_notified_at, driver_notified_at, notified_via_instant, match_signals')
    .gte('trip_date', today)
    .or('rider_notified_at.is.null,driver_notified_at.is.null')
    .eq('notified_via_instant', false)
    .limit(200)

  if (error) {
    console.error('[suggestionEngine] dispatch fetch failed:', error.message)
    return { pushed: 0, deferred: 0 }
  }

  let pushed = 0
  let deferred = 0

  for (const r of (rows ?? []) as unknown as DispatchableRow[]) {
    const isInstantWorthy = r.relevance_score >= INSTANT_PUSH_RELEVANCE || r.trip_date === today
    if (!isInstantWorthy) { deferred += 1; continue }

    const pushTitle = r.trip_date === today
      ? 'A ride match for today'
      : 'A ride match for an upcoming trip'

    // Rider side.
    if (r.rider_status === 'new' && r.rider_notified_at === null) {
      const ok = await pushToUser(
        r.rider_user_id,
        pushTitle,
        'Tap to see the suggested ride',
        { type: 'suggested_match', suggestion_id: r.id, side: 'rider' },
      )
      if (ok) {
        await supabaseAdmin
          .from('ride_suggestions')
          .update({ rider_notified_at: new Date().toISOString() } as never)
          .eq('id', r.id)
        pushed += 1
      }
    }

    // Driver side.
    if (r.driver_status === 'new' && r.driver_notified_at === null) {
      const ok = await pushToUser(
        r.driver_user_id,
        pushTitle,
        'Tap to see the suggested ride',
        { type: 'suggested_match', suggestion_id: r.id, side: 'driver' },
      )
      if (ok) {
        await supabaseAdmin
          .from('ride_suggestions')
          .update({ driver_notified_at: new Date().toISOString() } as never)
          .eq('id', r.id)
        pushed += 1
      }
    }
  }

  return { pushed, deferred }
}

async function pushToUser(
  userId: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<boolean> {
  const { data: tokenRows } = await supabaseAdmin
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId)

  const tokens = (tokenRows ?? []).map((r: { token: string }) => r.token)
  if (tokens.length === 0) return false

  try {
    await sendFcmPush(tokens, { title, body, data }, 'suggestions')
    return true
  } catch (err) {
    console.error('[suggestionEngine] push failed:', err)
    return false
  }
}
