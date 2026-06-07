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
import { estimateFareCentsBetween } from './rides.ts'
import { getOrCreateTripForRide } from '../lib/trips.ts'
import { sendFcmPush } from '../lib/fcm.ts'
import { realtimeBroadcast } from '../lib/realtimeBroadcast.ts'

/** Insert a chat message into a ride thread + broadcast it (best-effort). */
async function seedChatMessage(
  rideId: string,
  senderId: string,
  content: string,
  type: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('messages')
      .insert({ ride_id: rideId, sender_id: senderId, content, type, meta } as never)
      .select('id, ride_id, sender_id, content, type, meta, created_at')
      .single()
    if (data) {
      void realtimeBroadcast(`chat:${rideId}`, 'new_message', data as Record<string, unknown>)
      void realtimeBroadcast(`chat-badge:${rideId}`, 'new_message', data as Record<string, unknown>)
    }
  } catch (err) {
    console.error('[destinations] seedChatMessage failed:', (err as Error).message)
  }
}

/** Fire-and-forget FCM push to one user (best-effort). */
async function notifyUser(userId: string, payload: { title: string; body: string; data?: Record<string, string> }): Promise<void> {
  try {
    const { data } = await supabaseAdmin.from('push_tokens').select('token').eq('user_id', userId)
    const tokens = ((data ?? []) as Array<{ token: string }>).map((r) => r.token)
    if (tokens.length > 0) {
      await sendFcmPush(tokens, { title: payload.title, body: payload.body, data: payload.data ?? {} })
    }
  } catch (err) {
    console.error('[destinations] notify failed:', (err as Error).message)
  }
}

/** Persist an in-app notification row (the bell inbox). Best-effort. */
async function persistNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  try {
    await supabaseAdmin.from('notifications').insert({ user_id: userId, type, title, body, data } as never)
  } catch (err) {
    console.error('[destinations] notification insert failed:', (err as Error).message)
  }
}

/** In-app bell + FCM push together, for actionable/time-sensitive events. */
async function notifyUserDual(
  userId: string,
  type: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  await persistNotification(userId, type, title, body, data)
  await notifyUser(userId, { title, body, data })
}

/**
 * Lazy cleanup: release accepted offers whose outbound ride was cancelled.
 * The ride-cancel path doesn't revert destination state, so without this an
 * offer stays `accepted`, the rider's waitlist row stays `matched`, and the
 * seat is never freed — stranding the rider (can't rejoin, not in who's-going).
 * Frees the seat + clears the match. Mutates each reconciled offer's `status`
 * to `released` so the caller can exclude it.
 */
async function reconcileCancelledOffers(offers: Array<Record<string, unknown>>): Promise<void> {
  const accepted = offers.filter((o) => o['status'] === 'accepted' && typeof o['outbound_ride_id'] === 'string')
  if (accepted.length === 0) return
  const rideIds = accepted.map((o) => o['outbound_ride_id'] as string)
  const { data: rideRows } = await supabaseAdmin.from('rides').select('id, status').in('id', rideIds)
  const cancelled = new Set(
    ((rideRows ?? []) as Array<{ id: string; status: string }>)
      .filter((r) => r.status === 'cancelled')
      .map((r) => r.id),
  )
  for (const offer of accepted) {
    if (!cancelled.has(offer['outbound_ride_id'] as string)) continue
    const offerId = offer['id'] as string
    const planId = offer['driver_plan_id'] as string | null
    const wlId = offer['waitlist_id'] as string | null
    await supabaseAdmin
      .from('destination_offers')
      .update({ status: 'released', updated_at: new Date().toISOString() } as never)
      .eq('id', offerId)

    let groupSize = 1
    if (wlId != null) {
      const { data: wl } = await supabaseAdmin
        .from('destination_waitlist').select('group_size, status').eq('id', wlId).maybeSingle()
      const row = wl as { group_size: number; status: string } | null
      if (row) {
        groupSize = Math.max(1, row.group_size)
        if (row.status === 'matched') {
          await supabaseAdmin
            .from('destination_waitlist')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
            .eq('id', wlId)
        }
      }
    }
    if (planId != null) {
      const { data: pl } = await supabaseAdmin
        .from('destination_driver_plans').select('seats_total, seats_available').eq('id', planId).maybeSingle()
      const plan = pl as { seats_total: number; seats_available: number } | null
      if (plan) {
        const restored = Math.min(plan.seats_total, plan.seats_available + groupSize)
        await supabaseAdmin
          .from('destination_driver_plans')
          .update({ seats_available: restored, status: 'active', updated_at: new Date().toISOString() } as never)
          .eq('id', planId)
      }
    }
    offer['status'] = 'released'
  }
}

/** GeoJSON Point for a PostGIS geometry column — [lng, lat]. */
function geoPoint(lat: number, lng: number): { type: 'Point'; coordinates: [number, number] } {
  return { type: 'Point', coordinates: [lng, lat] }
}

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
    .select('id, rider_id, desired_date, wants_return, travel_mode, group_size, date_flexibility')
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
  // Only a `waiting` entry means "on the waitlist". A `matched` row (the
  // rider already got a ride) must NOT show the waitlist card — that's the
  // stale "You're on the waitlist / can't leave" bug.
  const { data: myRow } = await supabaseAdmin
    .from('destination_waitlist')
    .select(WAITLIST_ENTRY_COLUMNS as never)
    .eq('destination_id', id)
    .eq('rider_id', userId)
    .eq('status', 'waiting')
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

  // Offers involving the viewer (pending requests/offers + accepted matches),
  // each tagged with the viewer's role + the counterpart's profile.
  const { data: offerRows } = await supabaseAdmin
    .from('destination_offers')
    .select(OFFER_COLUMNS as never)
    .eq('destination_id', id)
    .in('status', ['pending', 'accepted'])
    .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
  const offers = (offerRows ?? []) as Array<Record<string, unknown>>

  // Reconcile stale matches (lazy cleanup): if an accepted offer's outbound
  // ride was cancelled, the ride-cancel path doesn't touch destination
  // state — so the offer is stuck `accepted`, the rider's waitlist row stuck
  // `matched`, and the seat never freed. Release it here so the rider can
  // rejoin and the seat reopens.
  await reconcileCancelledOffers(offers)
  const activeOffers = offers.filter((o) => o['status'] === 'pending' || o['status'] === 'accepted')

  const offerUserIds = [...new Set(activeOffers.map((o) => (o['driver_id'] === userId ? o['rider_id'] : o['driver_id']) as string))]
  const offerProfiles = new Map<string, { full_name: string | null; avatar_url: string | null; rating_avg: number | null }>()
  if (offerUserIds.length > 0) {
    const { data: ou } = await supabaseAdmin
      .from('users')
      .select('id, full_name, avatar_url, rating_avg')
      .in('id', offerUserIds)
    for (const u of (ou ?? []) as Array<{ id: string; full_name: string | null; avatar_url: string | null; rating_avg: number | null }>) {
      offerProfiles.set(u.id, { full_name: u.full_name, avatar_url: u.avatar_url, rating_avg: u.rating_avg })
    }
  }
  const myOffers = activeOffers.map((o) => {
    const counterpartId = (o['driver_id'] === userId ? o['rider_id'] : o['driver_id']) as string
    return {
      ...o,
      viewer_role: o['driver_id'] === userId ? 'driver' : 'rider',
      counterpart: offerProfiles.get(counterpartId) ?? null,
    }
  })

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
    my_offers: myOffers,
  })
})

// ── Waitlist join / leave (A.5) ───────────────────────────────────────────────

const WAITLIST_ENTRY_COLUMNS =
  'id, destination_id, desired_date, desired_time, wants_return, return_date, '
  + 'return_time, travel_mode, group_size, companion_a_id, companion_b_id, note, status, '
  + 'date_flexibility'

const TRAVEL_MODES = ['together', 'own_thing', 'one_way'] as const
const DATE_FLEXIBILITIES = ['exact', 'weekends', 'any'] as const

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
  date_flexibility?: unknown
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
  // Date flexibility — 'weekends'/'any' leave desired_date NULL.
  const dateFlexibility = typeof body.date_flexibility === 'string' ? body.date_flexibility : 'exact'
  if (!(DATE_FLEXIBILITIES as readonly string[]).includes(dateFlexibility)) {
    res.status(400).json({ error: { code: 'INVALID_FLEXIBILITY', message: 'Invalid date flexibility' } })
    return
  }
  const isExactDate = dateFlexibility === 'exact'
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
    desired_date: isExactDate ? (optString(body.desired_date) ?? null) : null,
    desired_time: isExactDate ? (optString(body.desired_time) ?? null) : null,
    wants_return: wantsReturn,
    return_date: isExactDate && wantsReturn ? (optString(body.return_date) ?? null) : null,
    return_time: isExactDate && wantsReturn ? (optString(body.return_time) ?? null) : null,
    travel_mode: travelMode,
    date_flexibility: dateFlexibility,
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

// ── Offers: connect rider ↔ driver, accept → rides (A.6) ──────────────────────

const OFFER_COLUMNS =
  'id, destination_id, driver_plan_id, waitlist_id, driver_id, rider_id, '
  + 'initiated_by, note, status, outbound_ride_id, return_ride_id'

interface OfferBody {
  driver_plan_id?: unknown
  waitlist_id?: unknown
  note?: unknown
  companion_a_id?: unknown
  companion_b_id?: unknown
  desired_date?: unknown
}

// POST /api/destinations/:id/offer — create an offer (both directions):
//   • rider-initiated "Join this trip": body has driver_plan_id (+ optional
//     companions); we upsert the rider's waitlist entry to hold their party.
//   • driver-initiated "Offer a seat": body has waitlist_id; the driver must
//     have an active plan here.
destinationsRouter.post('/:id/offer', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const destinationId = req.params['id'] as string
  const body = (req.body ?? {}) as OfferBody
  const note = optString(body.note) ?? null
  const driverPlanId = optString(body.driver_plan_id)
  const waitlistId = optString(body.waitlist_id)

  if (driverPlanId == null && waitlistId == null) {
    res.status(400).json({ error: { code: 'INVALID_BODY', message: 'driver_plan_id or waitlist_id required' } })
    return
  }

  let initiatedBy: 'rider' | 'driver'
  let driverId: string
  let riderId: string
  let planId: string
  let linkedWaitlistId: string | null = null

  if (driverPlanId != null) {
    // Rider-initiated join request against a specific plan.
    const { data: planRow } = await supabaseAdmin
      .from('destination_driver_plans')
      .select('id, driver_id, status, seats_available')
      .eq('id', driverPlanId)
      .maybeSingle()
    const plan = planRow as { id: string; driver_id: string; status: string; seats_available: number } | null
    if (!plan || plan.status !== 'active') {
      res.status(404).json({ error: { code: 'PLAN_NOT_FOUND', message: 'Trip not found' } })
      return
    }
    if (plan.driver_id === userId) {
      res.status(400).json({ error: { code: 'OWN_PLAN', message: "You can't join your own trip." } })
      return
    }
    if (plan.seats_available < 1) {
      res.status(409).json({ error: { code: 'PLAN_FULL', message: 'This trip is full.' } })
      return
    }
    initiatedBy = 'rider'
    driverId = plan.driver_id
    riderId = userId
    planId = plan.id

    // Hold the rider's party on a waitlist entry (companions live there).
    const companionIds = [...new Set(
      [body.companion_a_id, body.companion_b_id].filter((v): v is string => typeof v === 'string' && v.length > 0),
    )].slice(0, 2)
    const { data: wl } = await supabaseAdmin
      .from('destination_waitlist')
      .upsert({
        destination_id: destinationId,
        rider_id: userId,
        desired_date: optString(body.desired_date) ?? null,
        date_flexibility: 'exact',
        travel_mode: 'together',
        group_size: 1 + companionIds.length,
        companion_a_id: companionIds[0] ?? null,
        companion_b_id: companionIds[1] ?? null,
        status: 'waiting',
        updated_at: new Date().toISOString(),
      } as never, { onConflict: 'destination_id,rider_id' })
      .select('id')
      .single()
    linkedWaitlistId = (wl as { id: string } | null)?.id ?? null
  } else {
    // Driver-initiated offer to a waitlisted rider.
    const { data: wlRow } = await supabaseAdmin
      .from('destination_waitlist')
      .select('id, rider_id, status')
      .eq('id', waitlistId as string)
      .maybeSingle()
    const wl = wlRow as { id: string; rider_id: string; status: string } | null
    if (!wl || wl.status === 'cancelled') {
      res.status(404).json({ error: { code: 'WAITLIST_NOT_FOUND', message: 'That rider is no longer waiting.' } })
      return
    }
    const { data: planRow } = await supabaseAdmin
      .from('destination_driver_plans')
      .select('id, seats_available')
      .eq('destination_id', destinationId)
      .eq('driver_id', userId)
      .eq('status', 'active')
      .maybeSingle()
    const plan = planRow as { id: string; seats_available: number } | null
    if (!plan) {
      res.status(400).json({ error: { code: 'NO_PLAN', message: 'Post a trip before offering seats.' } })
      return
    }
    if (plan.seats_available < 1) {
      res.status(409).json({ error: { code: 'PLAN_FULL', message: 'Your trip is full.' } })
      return
    }
    initiatedBy = 'driver'
    driverId = userId
    riderId = wl.rider_id
    planId = plan.id
    linkedWaitlistId = wl.id
  }

  // No duplicate pending offer for the same (plan, rider).
  const { data: existing } = await supabaseAdmin
    .from('destination_offers')
    .select('id')
    .eq('driver_plan_id', planId)
    .eq('rider_id', riderId)
    .eq('status', 'pending')
    .maybeSingle()
  if (existing) {
    res.status(409).json({ error: { code: 'OFFER_EXISTS', message: 'There is already a pending request here.' } })
    return
  }

  const { data: offer, error: offerErr } = await supabaseAdmin
    .from('destination_offers')
    .insert({
      destination_id: destinationId,
      driver_plan_id: planId,
      waitlist_id: linkedWaitlistId,
      driver_id: driverId,
      rider_id: riderId,
      initiated_by: initiatedBy,
      note,
      status: 'pending',
    } as never)
    .select(OFFER_COLUMNS as never)
    .single()
  if (offerErr || !offer) {
    res.status(400).json({ error: { code: 'OFFER_FAILED', message: 'Could not send your request.' } })
    return
  }

  // Notify the counterparty — actionable (Accept/Decline), so bell + push.
  const target = initiatedBy === 'rider' ? driverId : riderId
  await notifyUserDual(
    target,
    'destination_offer',
    initiatedBy === 'rider' ? 'New ride request' : 'A driver offered you a seat',
    initiatedBy === 'rider' ? 'Someone wants to join your trip.' : 'Open Explore to accept.',
    { type: 'destination_offer', destination_id: destinationId, offer_id: (offer as { id: string }).id },
  )

  res.status(200).json({ offer })
})

// POST /api/destinations/:id/offer/:offerId/accept — counterparty accepts →
// create outbound (+ return) rides, seed chat, decrement seats, mark matched.
destinationsRouter.post('/:id/offer/:offerId/accept', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const destinationId = req.params['id'] as string
  const offerId = req.params['offerId'] as string

  const { data: offerRow } = await supabaseAdmin
    .from('destination_offers')
    .select(OFFER_COLUMNS as never)
    .eq('id', offerId)
    .maybeSingle()
  const offer = offerRow as {
    id: string; driver_plan_id: string | null; waitlist_id: string | null
    driver_id: string; rider_id: string; initiated_by: string; status: string
  } | null
  if (!offer || offer.status !== 'pending') {
    res.status(404).json({ error: { code: 'OFFER_NOT_FOUND', message: 'Request not found.' } })
    return
  }
  // The accepter is the COUNTERPARTY (rider-initiated → driver accepts; vice versa).
  const accepterShouldBe = offer.initiated_by === 'rider' ? offer.driver_id : offer.rider_id
  if (userId !== accepterShouldBe) {
    res.status(403).json({ error: { code: 'NOT_YOURS', message: 'You can\'t accept this request.' } })
    return
  }

  // Load the plan (origin + dates + seats) and the destination (dropoff).
  const { data: planRow } = await supabaseAdmin
    .from('destination_driver_plans')
    .select('id, driver_id, outbound_date, outbound_time, wants_return, return_date, return_time, seats_available, status, origin_lat, origin_lng, origin_address')
    .eq('id', offer.driver_plan_id as string)
    .maybeSingle()
  const plan = planRow as {
    id: string; driver_id: string; outbound_date: string; outbound_time: string | null
    wants_return: boolean; return_date: string | null; return_time: string | null
    seats_available: number; status: string
    origin_lat: number | null; origin_lng: number | null; origin_address: string | null
  } | null
  if (!plan || plan.status !== 'active') {
    res.status(409).json({ error: { code: 'PLAN_GONE', message: 'This trip is no longer available.' } })
    return
  }

  const { data: destRow } = await supabaseAdmin
    .from('featured_destinations')
    .select('id, name, latitude, longitude')
    .eq('id', destinationId)
    .maybeSingle()
  const dest = destRow as { id: string; name: string; latitude: number | null; longitude: number | null } | null
  if (!dest) {
    res.status(404).json({ error: { code: 'DESTINATION_NOT_FOUND', message: 'Destination not found' } })
    return
  }

  // Rider's party (companions) from the linked waitlist entry.
  let companionAId: string | null = null
  let companionBId: string | null = null
  let seatsNeeded = 1
  if (offer.waitlist_id) {
    const { data: wlRow } = await supabaseAdmin
      .from('destination_waitlist')
      .select('companion_a_id, companion_b_id, group_size')
      .eq('id', offer.waitlist_id)
      .maybeSingle()
    const wl = wlRow as { companion_a_id: string | null; companion_b_id: string | null; group_size: number } | null
    if (wl) {
      companionAId = wl.companion_a_id
      companionBId = wl.companion_b_id
      seatsNeeded = Math.max(1, wl.group_size)
    }
  }
  if (plan.seats_available < seatsNeeded) {
    res.status(409).json({ error: { code: 'NOT_ENOUGH_SEATS', message: 'Not enough seats left for this party.' } })
    return
  }

  const originLat = plan.origin_lat
  const originLng = plan.origin_lng
  const destLat = dest.latitude
  const destLng = dest.longitude
  if (originLat == null || originLng == null || destLat == null || destLng == null) {
    res.status(400).json({ error: { code: 'MISSING_COORDS', message: 'Trip is missing location data.' } })
    return
  }

  // Create a ride leg (mirrors the board-offer → ride conversion).
  const makeRide = async (
    oLat: number, oLng: number, oName: string,
    dLat: number, dLng: number, dName: string,
    tripDate: string, tripTime: string | null,
  ): Promise<string | null> => {
    const fareCents = await estimateFareCentsBetween(oLat, oLng, dLat, dLng)
    const { data: ride, error: rideErr } = await supabaseAdmin
      .from('rides')
      .insert({
        rider_id: offer.rider_id,
        driver_id: offer.driver_id,
        origin: geoPoint(oLat, oLng),
        origin_name: oName,
        destination: geoPoint(dLat, dLng),
        destination_name: dName,
        status: 'accepted',
        trip_date: tripDate,
        trip_time: tripTime,
        fare_cents: fareCents,
        payment_status: 'pending',
        pickup_point: geoPoint(oLat, oLng),
        pickup_confirmed: false,
        dropoff_point: geoPoint(dLat, dLng),
        dropoff_confirmed: true,
        companion_a_id: companionAId,
        companion_b_id: companionBId,
      } as never)
      .select('id')
      .single()
    if (rideErr || !ride) {
      console.error('[destinations/offer:accept] ride insert failed:', rideErr?.message)
      return null
    }
    const rideId = (ride as { id: string }).id
    await getOrCreateTripForRide(rideId)
    // Seed chat so the thread isn't empty.
    await seedChatMessage(
      rideId, offer.driver_id,
      `You're set for ${dName}! Use this chat to sort out pickup and timing.`,
      'text',
    )
    return rideId
  }

  const destName = dest.name
  const originName = plan.origin_address ?? 'Driver location'
  const outboundRideId = await makeRide(originLat, originLng, originName, destLat, destLng, destName, plan.outbound_date, plan.outbound_time)
  if (!outboundRideId) {
    res.status(400).json({ error: { code: 'RIDE_FAILED', message: 'Could not create the ride.' } })
    return
  }
  // NOTE: the RETURN ride is intentionally NOT created here. A round trip
  // creates only the outbound leg at match; the return leg + its
  // coordinator card are created later (Trip Stepper Stage 4 — "plan
  // return", after the outbound is completed + paid). Creating both up
  // front produced two simultaneous "Coordinating" rides for one trip.

  // Decrement seats; mark full at zero.
  const newSeats = Math.max(0, plan.seats_available - seatsNeeded)
  await supabaseAdmin
    .from('destination_driver_plans')
    .update({ seats_available: newSeats, status: newSeats === 0 ? 'full' : 'active', updated_at: new Date().toISOString() } as never)
    .eq('id', plan.id)

  // Mark the rider's waitlist entry matched.
  if (offer.waitlist_id) {
    await supabaseAdmin
      .from('destination_waitlist')
      .update({ status: 'matched', updated_at: new Date().toISOString() } as never)
      .eq('id', offer.waitlist_id)
  }

  // Flip the offer (return_ride_id stays null until Stage 4).
  await supabaseAdmin
    .from('destination_offers')
    .update({ status: 'accepted', outbound_ride_id: outboundRideId, return_ride_id: null, updated_at: new Date().toISOString() } as never)
    .eq('id', offer.id)

  // Notify the other party — a match opens a ride/chat, so bell + push.
  const notifyTarget = userId === offer.driver_id ? offer.rider_id : offer.driver_id
  await notifyUserDual(
    notifyTarget,
    'destination_matched',
    "You're matched!",
    `Your trip to ${destName} is set — open the ride to chat.`,
    { type: 'destination_matched', ride_id: outboundRideId, destination_id: destinationId, destination_name: destName },
  )

  res.status(200).json({ outbound_ride_id: outboundRideId, return_ride_id: null })
})

// POST /api/destinations/:id/offer/:offerId/decline — either party drops a pending offer.
destinationsRouter.post('/:id/offer/:offerId/decline', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const offerId = req.params['offerId'] as string
  const { data: offerRow } = await supabaseAdmin
    .from('destination_offers')
    .select('id, driver_id, rider_id, status')
    .eq('id', offerId)
    .maybeSingle()
  const offer = offerRow as { id: string; driver_id: string; rider_id: string; status: string } | null
  if (!offer || offer.status !== 'pending') {
    res.status(404).json({ error: { code: 'OFFER_NOT_FOUND', message: 'Request not found.' } })
    return
  }
  if (userId !== offer.driver_id && userId !== offer.rider_id) {
    res.status(403).json({ error: { code: 'NOT_YOURS', message: 'Not your request.' } })
    return
  }
  await supabaseAdmin
    .from('destination_offers')
    .update({ status: 'declined', updated_at: new Date().toISOString() } as never)
    .eq('id', offerId)

  // Tell the other party — informational only (bell, no push).
  const other = userId === offer.driver_id ? offer.rider_id : offer.driver_id
  await persistNotification(
    other,
    'destination_declined',
    'Request declined',
    'Your Explore ride request was declined.',
    { type: 'destination_declined', destination_id: req.params['id'] as string },
  )
  res.status(200).json({ ok: true })
})

// ── Return coordination (TT.1) — in the existing ride chat ────────────────────

/** Find the destination offer whose outbound leg is this ride. */
async function offerForOutboundRide(rideId: string): Promise<
  { id: string; driver_id: string; rider_id: string; return_ride_id: string | null; destination_id: string } | null
> {
  const { data } = await supabaseAdmin
    .from('destination_offers')
    .select('id, driver_id, rider_id, return_ride_id, destination_id')
    .eq('outbound_ride_id', rideId)
    .eq('status', 'accepted')
    .maybeSingle()
  return (data as { id: string; driver_id: string; rider_id: string; return_ride_id: string | null; destination_id: string } | null) ?? null
}

// POST /api/destinations/return/:rideId/propose — driver refines the return plan.
destinationsRouter.post('/return/:rideId/propose', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const rideId = req.params['rideId'] as string
  const body = (req.body ?? {}) as { return_date?: unknown; return_time?: unknown; meet_spot?: unknown }
  const offer = await offerForOutboundRide(rideId)
  if (!offer) {
    res.status(404).json({ error: { code: 'TRIP_NOT_FOUND', message: 'Trip not found' } })
    return
  }
  if (offer.driver_id !== userId) {
    res.status(403).json({ error: { code: 'NOT_DRIVER', message: 'Only the driver can plan the return.' } })
    return
  }
  const { data: dest } = await supabaseAdmin
    .from('featured_destinations').select('name').eq('id', offer.destination_id).maybeSingle()
  const destName = (dest as { name: string } | null)?.name ?? 'the destination'
  const meetSpot = optString(body.meet_spot) ?? null
  await seedChatMessage(rideId, userId, `Return trip from ${destName}`, 'return_proposal', {
    return_ride_id: offer.return_ride_id,
    return_date: optString(body.return_date) ?? null,
    return_time: optString(body.return_time) ?? null,
    meet_spot: meetSpot,
    destination_name: destName,
    status: 'proposed',
  })
  await notifyUserDual(
    offer.rider_id,
    'destination_return',
    'Return plan updated',
    meetSpot != null ? `Heading back from ${destName} — meet at ${meetSpot}.` : `Your driver updated the return from ${destName}.`,
    { type: 'destination_return', ride_id: rideId },
  )
  res.status(200).json({ ok: true })
})

// POST /api/destinations/return/:rideId/confirm — rider confirms the return plan.
destinationsRouter.post('/return/:rideId/confirm', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const rideId = req.params['rideId'] as string
  const offer = await offerForOutboundRide(rideId)
  if (!offer) {
    res.status(404).json({ error: { code: 'TRIP_NOT_FOUND', message: 'Trip not found' } })
    return
  }
  if (offer.rider_id !== userId) {
    res.status(403).json({ error: { code: 'NOT_RIDER', message: 'Only the rider can confirm.' } })
    return
  }
  await seedChatMessage(rideId, userId, "I'm ready for the return trip", 'return_confirmed', {})
  await persistNotification(
    offer.driver_id,
    'destination_return',
    'Rider confirmed the return',
    'Your rider is ready for the return trip.',
    { type: 'destination_return', ride_id: rideId },
  )
  res.status(200).json({ ok: true })
})
