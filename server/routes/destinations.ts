/**
 * V4 F6 — Explore (destinations) READ endpoints.
 *
 *   GET /api/destinations?kind=event|place  — live catalogue + per-card counts
 *   GET /api/destinations/:id               — detail + driver plans + waitlist
 *
 * All reads go through `supabaseAdmin`: the catalogue is public, and the
 * detail surfaces CROSS-PARTY data (a rider sees who's driving; a driver
 * sees who's waiting) which owner-only RLS would block (the F1 B.7
 * lesson). Phones are never returned here — connections happen via the
 * offer flow (later slices), and contact is released only post-accept.
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'

export const destinationsRouter = Router()

interface DestinationRow {
  id: string
  kind: string
  name: string
  slug: string
  description: string | null
  image_url: string | null
  city: string | null
  region: string | null
  event_date: string | null
  event_end_date: string | null
  status: string
  sort_priority: number
  latitude: number | null
  longitude: number | null
}

const DESTINATION_COLUMNS =
  'id, kind, name, slug, description, image_url, city, region, '
  + 'event_date, event_end_date, status, sort_priority'

// Card distance/fare needs lat/lng (generated columns from migration 121).
// Selected only by the list endpoint, with a graceful fallback so the
// endpoint keeps working before 121 is applied (coords just absent → the
// client hides distance).
const DESTINATION_COLUMNS_WITH_COORDS = `${DESTINATION_COLUMNS}, latitude, longitude`

/** Max faces shown in a card's "who's going" avatar stack. */
const GOING_SAMPLE = 5

// ── GET /api/destinations?kind= ──────────────────────────────────────────────
destinationsRouter.get('/', validateJwt, async (req: Request, res: Response) => {
  const kind = typeof req.query['kind'] === 'string' ? (req.query['kind'] as string) : null
  if (kind != null && kind !== 'event' && kind !== 'place') {
    res.status(400).json({ error: { code: 'INVALID_KIND', message: "kind must be 'event' or 'place'" } })
    return
  }

  const buildQuery = (columns: string) => {
    let query = supabaseAdmin
      .from('featured_destinations')
      .select(columns as never)
      .neq('status', 'archived')
      .order('sort_priority', { ascending: false })
      .order('event_date', { ascending: true, nullsFirst: false })
    if (kind != null) {
      query = query.eq('kind', kind)
    }
    return query
  }

  // Try with coords; if the generated columns aren't there yet
  // (pre-migration-121), fall back to the base columns.
  let { data, error } = await buildQuery(DESTINATION_COLUMNS_WITH_COORDS)
  if (error) {
    ({ data, error } = await buildQuery(DESTINATION_COLUMNS))
  }
  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to load destinations' } })
    return
  }
  const rows = (data ?? []) as unknown as DestinationRow[]
  const ids = rows.map((r) => r.id)

  // Per-card counts + a "who's going" sample. Waiting riders + active
  // driver plans, two cheap reads; counts in JS (the catalogue is small).
  // `goingUserIds` keeps insertion order (riders first, then drivers),
  // deduped, so the avatar stack is stable + has no repeats.
  const waitlistCounts = new Map<string, number>()
  const planCounts = new Map<string, number>()
  const goingUserIds = new Map<string, string[]>()
  const pushGoing = (destId: string, userId: string) => {
    const list = goingUserIds.get(destId) ?? []
    if (!list.includes(userId)) {
      list.push(userId)
      goingUserIds.set(destId, list)
    }
  }
  if (ids.length > 0) {
    const { data: wl } = await supabaseAdmin
      .from('destination_waitlist')
      .select('destination_id, rider_id')
      .in('destination_id', ids)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true })
    for (const row of (wl ?? []) as Array<{ destination_id: string; rider_id: string }>) {
      waitlistCounts.set(row.destination_id, (waitlistCounts.get(row.destination_id) ?? 0) + 1)
      pushGoing(row.destination_id, row.rider_id)
    }
    const { data: plans } = await supabaseAdmin
      .from('destination_driver_plans')
      .select('destination_id, driver_id')
      .in('destination_id', ids)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
    for (const row of (plans ?? []) as Array<{ destination_id: string; driver_id: string }>) {
      planCounts.set(row.destination_id, (planCounts.get(row.destination_id) ?? 0) + 1)
      pushGoing(row.destination_id, row.driver_id)
    }
  }

  // Resolve avatar/name for the capped sample of going-users in one read.
  const sampleIds = new Set<string>()
  for (const [, uids] of goingUserIds) {
    for (const uid of uids.slice(0, GOING_SAMPLE)) sampleIds.add(uid)
  }
  const profiles = new Map<string, { full_name: string | null; avatar_url: string | null }>()
  if (sampleIds.size > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, full_name, avatar_url')
      .in('id', [...sampleIds])
    for (const u of (users ?? []) as Array<{ id: string; full_name: string | null; avatar_url: string | null }>) {
      profiles.set(u.id, { full_name: u.full_name, avatar_url: u.avatar_url })
    }
  }

  const destinations = rows.map((r) => ({
    ...r,
    waitlist_count: waitlistCounts.get(r.id) ?? 0,
    driver_plan_count: planCounts.get(r.id) ?? 0,
    going: (goingUserIds.get(r.id) ?? [])
      .slice(0, GOING_SAMPLE)
      .map((uid) => profiles.get(uid))
      .filter((p): p is { full_name: string | null; avatar_url: string | null } => p != null),
  }))
  res.status(200).json({ destinations })
})

// ── GET /api/destinations/:id ────────────────────────────────────────────────
destinationsRouter.get('/:id', validateJwt, async (req: Request, res: Response) => {
  const id = req.params['id'] as string
  if (!id) {
    res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'Destination id is required' } })
    return
  }

  const { data: destRaw } = await supabaseAdmin
    .from('featured_destinations')
    .select(DESTINATION_COLUMNS as never)
    .eq('id', id)
    .neq('status', 'archived')
    .single()
  if (!destRaw) {
    res.status(404).json({ error: { code: 'DESTINATION_NOT_FOUND', message: 'Destination not found' } })
    return
  }
  const destination = destRaw as unknown as DestinationRow

  // Active driver plans + the driver's public profile (no phone).
  const { data: planRows } = await supabaseAdmin
    .from('destination_driver_plans')
    .select('id, driver_id, outbound_date, outbound_time, wants_return, return_date, return_time, seats_available, note')
    .eq('destination_id', id)
    .eq('status', 'active')
    .gte('seats_available', 1)
    .order('outbound_date', { ascending: true })
  const plans = (planRows ?? []) as Array<Record<string, unknown>>

  // Waiting riders + their public profile (no phone). The count drives
  // the "N going" badge; the rows power avatars on the detail.
  const { data: waitRows } = await supabaseAdmin
    .from('destination_waitlist')
    .select('id, rider_id, desired_date, wants_return, travel_mode, group_size')
    .eq('destination_id', id)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
  const waitlist = (waitRows ?? []) as Array<Record<string, unknown>>

  // Resolve all referenced user profiles in one read.
  const userIds = [...new Set([
    ...plans.map((p) => p['driver_id'] as string),
    ...waitlist.map((w) => w['rider_id'] as string),
  ])]
  const profiles = new Map<string, { full_name: string | null; avatar_url: string | null; rating_avg: number | null }>()
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, full_name, avatar_url, rating_avg')
      .in('id', userIds)
    for (const u of (users ?? []) as Array<{ id: string; full_name: string | null; avatar_url: string | null; rating_avg: number | null }>) {
      profiles.set(u.id, { full_name: u.full_name, avatar_url: u.avatar_url, rating_avg: u.rating_avg })
    }
  }

  // The viewer's own waitlist entry (if any) — drives the "You're on the
  // waitlist" state + Leave button on the detail. Excludes cancelled rows.
  const userId = res.locals['userId'] as string
  const { data: myRow } = await supabaseAdmin
    .from('destination_waitlist')
    .select(WAITLIST_ENTRY_COLUMNS as never)
    .eq('destination_id', id)
    .eq('rider_id', userId)
    .neq('status', 'cancelled')
    .maybeSingle()

  // The viewer's own active driver plan (if any) — drives the "Your trip"
  // edit/cancel card + hides "I'm driving".
  const { data: myPlan } = await supabaseAdmin
    .from('destination_driver_plans')
    .select(DRIVER_PLAN_COLUMNS as never)
    .eq('destination_id', id)
    .eq('driver_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  res.status(200).json({
    destination,
    driver_plans: plans.map((p) => ({
      ...p,
      driver: profiles.get(p['driver_id'] as string) ?? null,
    })),
    waitlist: {
      count: waitlist.length,
      riders: waitlist.map((w) => ({
        ...w,
        rider: profiles.get(w['rider_id'] as string) ?? null,
      })),
    },
    my_waitlist_entry: myRow ?? null,
    my_driver_plan: myPlan ?? null,
  })
})

// ── Waitlist join / leave (A.5) ───────────────────────────────────────────────

const WAITLIST_ENTRY_COLUMNS =
  'id, destination_id, desired_date, desired_time, wants_return, return_date, '
  + 'return_time, travel_mode, group_size, companion_a_id, companion_b_id, note, status'

const TRAVEL_MODES = ['together', 'own_thing', 'one_way'] as const

interface WaitlistBody {
  desired_date?: unknown
  desired_time?: unknown
  wants_return?: unknown
  return_date?: unknown
  return_time?: unknown
  travel_mode?: unknown
  group_size?: unknown
  companion_a_id?: unknown
  companion_b_id?: unknown
  note?: unknown
}

/** Narrow an optional string field; returns undefined for missing/blank. */
function optString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') return value.length > 0 ? value : null
  return undefined
}

// POST /api/destinations/:id/waitlist — join (upsert; one row per rider).
destinationsRouter.post('/:id/waitlist', validateJwt, async (req: Request, res: Response) => {
  const riderId = res.locals['userId'] as string
  const destinationId = req.params['id'] as string
  if (!destinationId) {
    res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'Destination id is required' } })
    return
  }
  const body = (req.body ?? {}) as WaitlistBody

  // Destination must exist and not be archived.
  const { data: dest } = await supabaseAdmin
    .from('featured_destinations')
    .select('id')
    .eq('id', destinationId)
    .neq('status', 'archived')
    .maybeSingle()
  if (!dest) {
    res.status(404).json({ error: { code: 'DESTINATION_NOT_FOUND', message: 'Destination not found' } })
    return
  }

  // travel_mode — default 'together'.
  const travelMode = typeof body.travel_mode === 'string' ? body.travel_mode : 'together'
  if (!(TRAVEL_MODES as readonly string[]).includes(travelMode)) {
    res.status(400).json({ error: { code: 'INVALID_TRAVEL_MODE', message: 'Invalid travel mode' } })
    return
  }
  const wantsReturn = body.wants_return === true

  // Companions — owned by the rider (mirror the rides.ts check). Group size
  // must cover the rider + every attached companion.
  const companionIds = [...new Set(
    [body.companion_a_id, body.companion_b_id]
      .filter((v): v is string => typeof v === 'string' && v.length > 0),
  )].slice(0, 2)
  if (companionIds.length > 0) {
    const { data: companionRows } = await supabaseAdmin
      .from('companions')
      .select('id, user_id')
      .in('id', companionIds)
    const rows = (companionRows ?? []) as Array<{ id: string; user_id: string }>
    const ownedAll = rows.length === companionIds.length
      && companionIds.every((cid) => rows.some((r) => r.id === cid && r.user_id === riderId))
    if (!ownedAll) {
      res.status(404).json({ error: { code: 'COMPANION_NOT_FOUND', message: "We couldn't find that companion on your profile." } })
      return
    }
  }

  // group_size — default = rider + companions; clamp 1..5; must seat the party.
  const minSeats = 1 + companionIds.length
  let groupSize = typeof body.group_size === 'number' ? Math.trunc(body.group_size) : minSeats
  if (!Number.isFinite(groupSize) || groupSize < minSeats) groupSize = minSeats
  if (groupSize < 1 || groupSize > 5) {
    res.status(400).json({ error: { code: 'INVALID_GROUP_SIZE', message: 'Group size must be between 1 and 5' } })
    return
  }

  const note = optString(body.note)
  if (note != null && note.length > 500) {
    res.status(400).json({ error: { code: 'INVALID_NOTE', message: 'Note is too long' } })
    return
  }

  const row = {
    destination_id: destinationId,
    rider_id: riderId,
    desired_date: optString(body.desired_date) ?? null,
    desired_time: optString(body.desired_time) ?? null,
    wants_return: wantsReturn,
    return_date: wantsReturn ? (optString(body.return_date) ?? null) : null,
    return_time: wantsReturn ? (optString(body.return_time) ?? null) : null,
    travel_mode: travelMode,
    group_size: groupSize,
    companion_a_id: companionIds[0] ?? null,
    companion_b_id: companionIds[1] ?? null,
    note: note ?? null,
    status: 'waiting',
    updated_at: new Date().toISOString(),
  }

  // Upsert on the (destination_id, rider_id) unique key — re-joining after a
  // cancel revives the same row as 'waiting'.
  const { data: saved, error: saveErr } = await supabaseAdmin
    .from('destination_waitlist')
    .upsert(row as never, { onConflict: 'destination_id,rider_id' })
    .select(WAITLIST_ENTRY_COLUMNS as never)
    .single()
  if (saveErr || !saved) {
    res.status(400).json({ error: { code: 'WAITLIST_SAVE_FAILED', message: 'Could not join the waitlist' } })
    return
  }

  // NOTE: notifying drivers-going is deferred to A.4/C.4 — no driver plans
  // exist for any destination yet, so there is no one to notify.
  res.status(200).json({ waitlist_entry: saved })
})

// DELETE /api/destinations/:id/waitlist — leave (mark cancelled, keep history).
destinationsRouter.delete('/:id/waitlist', validateJwt, async (req: Request, res: Response) => {
  const riderId = res.locals['userId'] as string
  const destinationId = req.params['id'] as string
  if (!destinationId) {
    res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'Destination id is required' } })
    return
  }
  const { error: delErr } = await supabaseAdmin
    .from('destination_waitlist')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
    .eq('destination_id', destinationId)
    .eq('rider_id', riderId)
    .neq('status', 'matched')
  if (delErr) {
    res.status(400).json({ error: { code: 'WAITLIST_LEAVE_FAILED', message: 'Could not leave the waitlist' } })
    return
  }
  res.status(200).json({ ok: true })
})

// ── Driver plan: "I'm driving" (A.4) ──────────────────────────────────────────

const DRIVER_PLAN_COLUMNS =
  'id, destination_id, driver_id, outbound_date, outbound_time, wants_return, '
  + 'return_date, return_time, seats_total, seats_available, note, status, '
  + 'board_schedule_id, origin_lat, origin_lng, origin_address, origin_place_id'

interface DriverPlanBody {
  outbound_date?: unknown
  outbound_time?: unknown
  wants_return?: unknown
  return_date?: unknown
  return_time?: unknown
  seats_total?: unknown
  note?: unknown
  origin_lat?: unknown
  origin_lng?: unknown
  origin_address?: unknown
  origin_place_id?: unknown
}

// POST /api/destinations/:id/driver-plan — a driver posts a trip + cross-posts
// it to the ride board (best-effort).
destinationsRouter.post('/:id/driver-plan', validateJwt, async (req: Request, res: Response) => {
  const driverId = res.locals['userId'] as string
  const destinationId = req.params['id'] as string
  if (!destinationId) {
    res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'Destination id is required' } })
    return
  }
  const body = (req.body ?? {}) as DriverPlanBody

  // Destination must exist + not be archived; pull name + coords for the post.
  const { data: dest } = await supabaseAdmin
    .from('featured_destinations')
    .select('id, name, latitude, longitude')
    .eq('id', destinationId)
    .neq('status', 'archived')
    .maybeSingle()
  if (!dest) {
    res.status(404).json({ error: { code: 'DESTINATION_NOT_FOUND', message: 'Destination not found' } })
    return
  }
  const destination = dest as { id: string; name: string; latitude: number | null; longitude: number | null }

  // One active plan per driver per destination — block a duplicate post
  // (the UI hides "I'm driving" when a plan exists, this is the backstop).
  const { data: dupe } = await supabaseAdmin
    .from('destination_driver_plans')
    .select('id')
    .eq('destination_id', destinationId)
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .maybeSingle()
  if (dupe) {
    res.status(409).json({ error: { code: 'PLAN_EXISTS', message: "You've already posted a trip here — edit it instead." } })
    return
  }

  const outboundDate = optString(body.outbound_date)
  if (outboundDate == null) {
    res.status(400).json({ error: { code: 'INVALID_DATE', message: 'Outbound date is required' } })
    return
  }
  const wantsReturn = body.wants_return === true
  let seatsTotal = typeof body.seats_total === 'number' ? Math.trunc(body.seats_total) : 1
  if (!Number.isFinite(seatsTotal) || seatsTotal < 1) seatsTotal = 1
  if (seatsTotal > 8) seatsTotal = 8

  const note = optString(body.note)
  if (note != null && note.length > 500) {
    res.status(400).json({ error: { code: 'INVALID_NOTE', message: 'Note is too long' } })
    return
  }

  const originLat = typeof body.origin_lat === 'number' ? body.origin_lat : null
  const originLng = typeof body.origin_lng === 'number' ? body.origin_lng : null
  const originAddress = optString(body.origin_address) ?? null
  const originPlaceID = optString(body.origin_place_id) ?? null
  const outboundTime = optString(body.outbound_time) ?? null

  // 1. Cross-post to the ride board (best-effort — the plan is the primary
  //    artifact; if the board insert fails we still create the plan).
  let boardScheduleID: string | null = null
  {
    const boardPost = {
      user_id: driverId,
      mode: 'driver',
      route_name: destination.name,
      origin_place_id: originPlaceID ?? `driver:${driverId}`,
      dest_place_id: `destination:${destinationId}`,
      origin_address: originAddress ?? 'Driver location',
      dest_address: destination.name,
      direction_type: 'one_way',
      trip_date: outboundDate,
      time_type: 'departure',
      trip_time: outboundTime ?? '12:00:00',
      time_flexible: false,
      available_seats: seatsTotal,
      note: note ?? null,
      origin_lat: originLat,
      origin_lng: originLng,
      dest_lat: destination.latitude,
      dest_lng: destination.longitude,
      route_polyline: null,
      polyline_source: null,
    }
    const { data: post, error: postErr } = await supabaseAdmin
      .from('ride_schedules')
      .insert(boardPost as never)
      .select('id')
      .single()
    if (postErr) {
      console.error('[destinations] board cross-post failed:', postErr.message)
    } else {
      boardScheduleID = (post as { id: string }).id
    }
  }

  // 2. Create the driver plan.
  const planRow = {
    destination_id: destinationId,
    driver_id: driverId,
    outbound_date: outboundDate,
    outbound_time: outboundTime,
    wants_return: wantsReturn,
    return_date: wantsReturn ? (optString(body.return_date) ?? null) : null,
    return_time: wantsReturn ? (optString(body.return_time) ?? null) : null,
    seats_total: seatsTotal,
    seats_available: seatsTotal,
    note: note ?? null,
    status: 'active',
    board_schedule_id: boardScheduleID,
    origin_lat: originLat,
    origin_lng: originLng,
    origin_address: originAddress,
    origin_place_id: originPlaceID,
    updated_at: new Date().toISOString(),
  }
  const { data: plan, error: planErr } = await supabaseAdmin
    .from('destination_driver_plans')
    .insert(planRow as never)
    .select(DRIVER_PLAN_COLUMNS as never)
    .single()
  if (planErr || !plan) {
    res.status(400).json({ error: { code: 'PLAN_SAVE_FAILED', message: 'Could not post your trip' } })
    return
  }

  res.status(200).json({ driver_plan: plan })
})

// PATCH /api/destinations/:id/driver-plan/:planId — edit own trip.
destinationsRouter.patch('/:id/driver-plan/:planId', validateJwt, async (req: Request, res: Response) => {
  const driverId = res.locals['userId'] as string
  const planId = req.params['planId'] as string
  const body = (req.body ?? {}) as DriverPlanBody

  // Owner check — the plan must exist + belong to the caller.
  const { data: existing } = await supabaseAdmin
    .from('destination_driver_plans')
    .select('id, driver_id, board_schedule_id, seats_total, seats_available')
    .eq('id', planId)
    .maybeSingle()
  const plan = existing as
    | { id: string; driver_id: string; board_schedule_id: string | null; seats_total: number; seats_available: number }
    | null
  if (!plan || plan.driver_id !== driverId) {
    res.status(404).json({ error: { code: 'PLAN_NOT_FOUND', message: 'Trip not found' } })
    return
  }

  const outboundDate = optString(body.outbound_date)
  if (outboundDate == null) {
    res.status(400).json({ error: { code: 'INVALID_DATE', message: 'Outbound date is required' } })
    return
  }
  const wantsReturn = body.wants_return === true
  let seatsTotal = typeof body.seats_total === 'number' ? Math.trunc(body.seats_total) : plan.seats_total
  if (!Number.isFinite(seatsTotal) || seatsTotal < 1) seatsTotal = 1
  if (seatsTotal > 8) seatsTotal = 8
  // No matching exists yet (A.6), so available tracks total. When offers
  // land this becomes seatsTotal - bookedSeats.
  const seatsBooked = plan.seats_total - plan.seats_available
  const seatsAvailable = Math.max(0, seatsTotal - seatsBooked)
  const note = optString(body.note)
  if (note != null && note.length > 500) {
    res.status(400).json({ error: { code: 'INVALID_NOTE', message: 'Note is too long' } })
    return
  }
  const originLat = typeof body.origin_lat === 'number' ? body.origin_lat : null
  const originLng = typeof body.origin_lng === 'number' ? body.origin_lng : null
  const originAddress = optString(body.origin_address) ?? null
  const originPlaceID = optString(body.origin_place_id) ?? null
  const outboundTime = optString(body.outbound_time) ?? null

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('destination_driver_plans')
    .update({
      outbound_date: outboundDate,
      outbound_time: outboundTime,
      wants_return: wantsReturn,
      return_date: wantsReturn ? (optString(body.return_date) ?? null) : null,
      return_time: wantsReturn ? (optString(body.return_time) ?? null) : null,
      seats_total: seatsTotal,
      seats_available: seatsAvailable,
      note: note ?? null,
      origin_lat: originLat,
      origin_lng: originLng,
      origin_address: originAddress,
      origin_place_id: originPlaceID,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', planId)
    .select(DRIVER_PLAN_COLUMNS as never)
    .single()
  if (updErr || !updated) {
    res.status(400).json({ error: { code: 'PLAN_UPDATE_FAILED', message: 'Could not update your trip' } })
    return
  }

  // Keep the linked board post in sync (best-effort).
  if (plan.board_schedule_id) {
    await supabaseAdmin
      .from('ride_schedules')
      .update({
        trip_date: outboundDate,
        trip_time: outboundTime ?? '12:00:00',
        available_seats: seatsTotal,
        note: note ?? null,
        origin_lat: originLat,
        origin_lng: originLng,
        origin_address: originAddress ?? 'Driver location',
        origin_place_id: originPlaceID ?? `driver:${driverId}`,
      } as never)
      .eq('id', plan.board_schedule_id)
  }

  res.status(200).json({ driver_plan: updated })
})

// DELETE /api/destinations/:id/driver-plan/:planId — cancel own trip.
destinationsRouter.delete('/:id/driver-plan/:planId', validateJwt, async (req: Request, res: Response) => {
  const driverId = res.locals['userId'] as string
  const planId = req.params['planId'] as string

  const { data: existing } = await supabaseAdmin
    .from('destination_driver_plans')
    .select('id, driver_id, board_schedule_id')
    .eq('id', planId)
    .maybeSingle()
  const plan = existing as { id: string; driver_id: string; board_schedule_id: string | null } | null
  if (!plan || plan.driver_id !== driverId) {
    res.status(404).json({ error: { code: 'PLAN_NOT_FOUND', message: 'Trip not found' } })
    return
  }

  const { error: cancelErr } = await supabaseAdmin
    .from('destination_driver_plans')
    .update({ status: 'cancelled', seats_available: 0, updated_at: new Date().toISOString() } as never)
    .eq('id', planId)
  if (cancelErr) {
    res.status(400).json({ error: { code: 'PLAN_CANCEL_FAILED', message: 'Could not cancel your trip' } })
    return
  }
  // Remove the board cross-post too (best-effort).
  if (plan.board_schedule_id) {
    await supabaseAdmin.from('ride_schedules').delete().eq('id', plan.board_schedule_id)
  }
  // NOTE: re-opening matched riders to interest lands with A.6 (no matches exist yet).
  res.status(200).json({ ok: true })
})
