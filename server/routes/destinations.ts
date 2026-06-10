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
import { estimateFareCentsBetween, companionFareCentsFor, caregiverFareCentsFor, tripDayLabel, rideStartableToday } from './rides.ts'
import { getOrCreateTripForRide, getOrCreatePlanLegTrip } from '../lib/trips.ts'
import { computeProjectedSplit, type FareSplit } from '../lib/fareSplit.ts'
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
  // Fetch BOTH legs' statuses — a cancelled outbound (trip never happened) and
  // a cancelled return (trip's over) both conclude the offer.
  const rideIds = accepted
    .flatMap((o) => [o['outbound_ride_id'], o['return_ride_id']])
    .filter((v): v is string => typeof v === 'string')
  const { data: rideRows } = await supabaseAdmin.from('rides').select('id, status').in('id', rideIds)
  const cancelled = new Set(
    ((rideRows ?? []) as Array<{ id: string; status: string }>)
      .filter((r) => r.status === 'cancelled')
      .map((r) => r.id),
  )
  for (const offer of accepted) {
    const outboundCancelled = cancelled.has(offer['outbound_ride_id'] as string)
    const retId = offer['return_ride_id']
    const returnCancelled = typeof retId === 'string' && cancelled.has(retId)
    if (!outboundCancelled && !returnCancelled) continue
    const offerId = offer['id'] as string
    const planId = offer['driver_plan_id'] as string | null
    const wlId = offer['waitlist_id'] as string | null
    await supabaseAdmin
      .from('destination_offers')
      .update({ status: 'released', updated_at: new Date().toISOString() } as never)
      .eq('id', offerId)
    offer['status'] = 'released'

    // Only an OUTBOUND cancel frees the seat + reverts the waitlist (the trip
    // never happened). A return-only cancel leaves the seat consumed — the
    // outbound already used it — so just releasing the offer is enough.
    if (!outboundCancelled) continue

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
  }
}

/** "2026-06-29" → "Jun 29" (tz-safe — parses the wall-clock date parts). */
function shortDateLabel(iso: string): string {
  const parts = iso.split('-').map((s) => Number(s))
  const month = parts[1] ?? 1
  const day = parts[2] ?? 1
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[month - 1] ?? ''} ${day}`.trim()
}

/**
 * Build the ride-board destination + note for a driver's event trip. The
 * board card's destination is the real PLACE (city, region) — not the event
 * name — so riders see where the trip actually goes; the event name + an
 * auto-summary lead the note so the post reads clearly even with no driver
 * note. Shared by the create + edit handlers.
 */
function buildBoardPostMeta(
  dest: { name: string; city: string | null; region: string | null },
  seatsTotal: number,
  wantsReturn: boolean,
  returnDate: string | null,
  driverNote: string | null,
): { destAddress: string; note: string } {
  const placeLabel = [dest.city, dest.region].filter((v) => v != null && v !== '').join(', ')
  const destAddress = placeLabel !== '' ? placeLabel : dest.name
  const parts: string[] = [`Driving to ${dest.name}${placeLabel !== '' ? ` (${placeLabel})` : ''}.`]
  parts.push(`${seatsTotal} seat${seatsTotal === 1 ? '' : 's'} available.`)
  if (wantsReturn) {
    parts.push(returnDate != null
      ? `Round trip — heading back ${shortDateLabel(returnDate)}.`
      : 'Round trip — riding back together.')
  }
  let note = parts.join(' ')
  if (driverNote != null && driverNote !== '') note = `${driverNote}\n\n${note}`
  return { destAddress, note: note.slice(0, 500) }
}

/** GeoJSON Point for a PostGIS geometry column — [lng, lat]. */
function geoPoint(lat: number, lng: number): { type: 'Point'; coordinates: [number, number] } {
  return { type: 'Point', coordinates: [lng, lat] }
}

/** Live-refresh signal for anyone viewing a destination's detail page
 *  (waitlist join/leave, offer create/accept/decline, driver plan). */
function broadcastDestinationChanged(destinationId: string): void {
  void realtimeBroadcast(`destination:${destinationId}`, 'changed', {})
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
  event_time: string | null
  event_end_time: string | null
  event_url: string | null
  status: string
  sort_priority: number
  latitude: number | null
  longitude: number | null
}

const DESTINATION_COLUMNS =
  'id, kind, name, slug, description, image_url, city, region, '
  + 'event_date, event_end_date, status, sort_priority'

// The list endpoint also wants lat/lng (migration 121) + event times
// (migration 124). Kept out of the base columns + selected with a graceful
// fallback so the endpoint keeps working before those migrations are applied
// (coords/times just absent → the client hides them).
const DESTINATION_COLUMNS_WITH_COORDS =
  `${DESTINATION_COLUMNS}, latitude, longitude, event_time, event_end_time, event_url`

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
    .select('id, driver_id, outbound_date, outbound_time, wants_return, return_date, return_time, seats_available, note, origin_lat, origin_lng, origin_address, outbound_trip_id, return_trip_id')
    .eq('destination_id', id)
    .eq('status', 'active')
    .gte('seats_available', 1)
    .order('outbound_date', { ascending: true })
  const plans = (planRows ?? []) as Array<Record<string, unknown>>

  // V4 F6 — riders already committed to each plan's shared drive, so the
  // join sheet can show the projected split ("you'd split with N"). One
  // batched query across every plan's leg trips; trip ids stay server-side.
  const legTripIds = [...new Set(plans
    .flatMap((p) => [p['outbound_trip_id'], p['return_trip_id']])
    .filter((v): v is string => typeof v === 'string'))]
  const ridersByTrip = new Map<string, Set<string>>()
  if (legTripIds.length > 0) {
    const { data: legRides } = await supabaseAdmin
      .from('rides').select('trip_id, rider_id')
      .in('trip_id', legTripIds)
      .in('status', ['accepted', 'coordinating', 'active', 'completed'])
    for (const r of (legRides ?? []) as Array<{ trip_id: string; rider_id: string }>) {
      const set = ridersByTrip.get(r.trip_id) ?? new Set<string>()
      set.add(r.rider_id)
      ridersByTrip.set(r.trip_id, set)
    }
  }
  const ridersSharing = (p: Record<string, unknown>, column: string): number => {
    const tripId = p[column]
    if (typeof tripId !== 'string') return 0
    return ridersByTrip.get(tripId)?.size ?? 0
  }

  // Waiting riders + their public profile (no phone). The count drives
  // the "N going" badge; the rows power avatars on the detail.
  const { data: waitRows } = await supabaseAdmin
    .from('destination_waitlist')
    .select('id, rider_id, desired_date, desired_time, wants_return, return_date, return_time, travel_mode, group_size, date_flexibility, note, companion_a_id, companion_b_id, caregiver_id, pickup_address, pickup_lat, pickup_lng')
    .eq('destination_id', id)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
  const waitlist = (waitRows ?? []) as Array<Record<string, unknown>>

  // Resolve all referenced user profiles in one read.
  const userIds = [...new Set([
    ...plans.map((p) => p['driver_id'] as string),
    ...waitlist.map((w) => w['rider_id'] as string),
  ])]
  // Public profile snippet (no phone) + the accessibility signal a driver
  // needs: a top-level "has needs" flag (drives the badge) and whether they
  // use a wheelchair (vehicle-capability relevance). The free-text
  // accessibility notes are intentionally NOT exposed on the public detail.
  type PartyProfile = {
    full_name: string | null; avatar_url: string | null; rating_avg: number | null
    has_accessibility_needs: boolean; needs_wheelchair: boolean
  }
  const profiles = new Map<string, PartyProfile>()
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, full_name, avatar_url, rating_avg, has_accessibility_needs, accessibility_profile')
      .in('id', userIds)
    for (const u of (users ?? []) as Array<{
      id: string; full_name: string | null; avatar_url: string | null; rating_avg: number | null
      has_accessibility_needs: boolean | null; accessibility_profile: { needs_wheelchair?: boolean } | null
    }>) {
      profiles.set(u.id, {
        full_name: u.full_name, avatar_url: u.avatar_url, rating_avg: u.rating_avg,
        has_accessibility_needs: u.has_accessibility_needs === true,
        needs_wheelchair: u.accessibility_profile?.needs_wheelchair === true,
      })
    }
  }

  // Each waiting rider's companions (name + relationship + avatar, NO phone)
  // so the trip-details sheet can show who's coming. Batched across all rows.
  const companionIds = [...new Set(waitlist.flatMap((w) =>
    [w['companion_a_id'], w['companion_b_id']].filter((v): v is string => typeof v === 'string')))]
  type CompanionSnippet = { id: string; name: string | null; relationship: string | null; avatar_url: string | null }
  const companionProfiles = new Map<string, CompanionSnippet>()
  if (companionIds.length > 0) {
    const { data: comps } = await supabaseAdmin
      .from('companions')
      .select('id, name, relationship, avatar_url')
      .in('id', companionIds)
    for (const c of (comps ?? []) as CompanionSnippet[]) {
      companionProfiles.set(c.id, c)
    }
  }

  // Each waiting rider's caregiver (name + relationship + avatar, NO phone)
  // so the trip-details sheet can show them alongside companions.
  const caregiverIds = [...new Set(waitlist
    .map((w) => w['caregiver_id'])
    .filter((v): v is string => typeof v === 'string'))]
  const caregiverProfiles = new Map<string, CompanionSnippet>()
  if (caregiverIds.length > 0) {
    const { data: cgs } = await supabaseAdmin
      .from('caregivers')
      .select('id, name, relationship, avatar_url')
      .in('id', caregiverIds)
    for (const c of (cgs ?? []) as CompanionSnippet[]) {
      caregiverProfiles.set(c.id, c)
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
  const { data: myPlanRow } = await supabaseAdmin
    .from('destination_driver_plans')
    .select(DRIVER_PLAN_COLUMNS as never)
    .eq('destination_id', id)
    .eq('driver_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  // V4 F6 — committed-rider counts on the driver's OWN plan power the
  // "Manage riders (N)" entry to the multi-rider trip screen. Computed
  // directly (a full plan drops out of the public list above, so its trips
  // may be missing from ridersByTrip).
  let myPlan: Record<string, unknown> | null = myPlanRow as Record<string, unknown> | null
  if (myPlan) {
    const planId = myPlan['id'] as string
    const [outLeg, retLeg] = await Promise.all([
      ridersOnPlanLeg(planId, 'outbound'),
      ridersOnPlanLeg(planId, 'return'),
    ])
    myPlan = {
      ...myPlan,
      riders_sharing: outLeg.riderIds.length,
      riders_sharing_return: retLeg.riderIds.length,
    }
  }

  // Is the viewer a registered driver? Rider pickups are exposed to any
  // driver (so they can judge a request / decide whether to drive this
  // event), not only one who's already posted a plan here.
  const { data: viewerRow } = await supabaseAdmin
    .from('users').select('is_driver').eq('id', userId).maybeSingle()
  const viewerIsDriver = (viewerRow as { is_driver: boolean | null } | null)?.is_driver === true

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

  // The rider's pickup address is exposed only to drivers (see viewerIsDriver
  // above) — so they can judge the route — not to every viewer.
  res.status(200).json({
    destination,
    driver_plans: plans.map((p) => ({
      ...p,
      driver: profiles.get(p['driver_id'] as string) ?? null,
      // Committed riders on each shared drive (split denominators). The
      // raw trip ids are internal — strip them from the public payload.
      riders_sharing: ridersSharing(p, 'outbound_trip_id'),
      riders_sharing_return: ridersSharing(p, 'return_trip_id'),
      outbound_trip_id: undefined,
      return_trip_id: undefined,
    })),
    waitlist: {
      count: waitlist.length,
      riders: waitlist.map((w) => ({
        ...w,
        rider: profiles.get(w['rider_id'] as string) ?? null,
        companions: [w['companion_a_id'], w['companion_b_id']]
          .filter((v): v is string => typeof v === 'string')
          .map((cid) => companionProfiles.get(cid))
          .filter((c): c is CompanionSnippet => c != null),
        caregiver: typeof w['caregiver_id'] === 'string'
          ? (caregiverProfiles.get(w['caregiver_id']) ?? null)
          : null,
        // Gated: drivers only (overrides the `...w` spread for non-drivers).
        // Coords power the near-me / city filters on the show-all list.
        pickup_address: viewerIsDriver ? (w['pickup_address'] ?? null) : null,
        pickup_lat: viewerIsDriver ? (w['pickup_lat'] ?? null) : null,
        pickup_lng: viewerIsDriver ? (w['pickup_lng'] ?? null) : null,
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
  caregiver_id?: unknown
  pickup_lat?: unknown
  pickup_lng?: unknown
  pickup_address?: unknown
  note?: unknown
  date_flexibility?: unknown
}

/** A rider's chosen pickup (home→event) / drop-off (own_thing) point. */
function readPickup(body: { pickup_lat?: unknown; pickup_lng?: unknown; pickup_address?: unknown }): {
  pickup_lat: number | null; pickup_lng: number | null; pickup_address: string | null
} {
  const lat = typeof body.pickup_lat === 'number' ? body.pickup_lat : null
  const lng = typeof body.pickup_lng === 'number' ? body.pickup_lng : null
  // Only keep the address when we have real coords to anchor it.
  return {
    pickup_lat: lat,
    pickup_lng: lng,
    pickup_address: (lat != null && lng != null) ? (optString(body.pickup_address) ?? null) : null,
  }
}

/** Narrow an optional string field; returns undefined for missing/blank. */
function optString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') return value.length > 0 ? value : null
  return undefined
}

/** Straight-line km between two points (for the coarse fare tier). */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number): number => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

interface FareBreakdown { base_cents: number; companion_cents: number; caregiver_cents: number; total_cents: number }

/**
 * Estimated fare for a destination trip + its party add-ons, so every
 * surface (request review, join sheet) can show the same total. Base is the
 * road-distance fare; the seat-fee tiers use a 1.3× road-corrected
 * straight-line distance (mirrors the iOS preview). The real fees re-settle
 * from GPS distance at ride end.
 */
async function estimatePartyFare(
  oLat: number, oLng: number, dLat: number, dLng: number,
  companionCount: number, hasCaregiver: boolean,
): Promise<FareBreakdown> {
  const base = await estimateFareCentsBetween(oLat, oLng, dLat, dLng)
  const km = haversineKm(oLat, oLng, dLat, dLng) * 1.3
  const companion = Math.max(0, companionCount) * companionFareCentsFor(km)
  const caregiver = hasCaregiver ? caregiverFareCentsFor(km) : 0
  return { base_cents: base, companion_cents: companion, caregiver_cents: caregiver, total_cents: base + companion + caregiver }
}

/**
 * V4 F6 — riders currently committed to a plan leg's SHARED drive (the trip
 * grouped by getOrCreatePlanLegTrip). Drives both the split denominator and
 * the fare-change notifications. Returns the leg trip id + distinct rider ids
 * (empty if the leg has no trip yet — i.e. nobody has accepted that leg).
 */
async function ridersOnPlanLeg(
  planId: string, leg: 'outbound' | 'return',
): Promise<{ tripId: string | null; riderIds: string[]; rideIdByRider: Map<string, string> }> {
  const column = leg === 'return' ? 'return_trip_id' : 'outbound_trip_id'
  const { data: planRow } = await supabaseAdmin
    .from('destination_driver_plans').select(column).eq('id', planId).maybeSingle()
  const tripId = (planRow as Record<string, unknown> | null)?.[column] as string | null
  if (!tripId) return { tripId: null, riderIds: [], rideIdByRider: new Map() }
  const { data: rideRows } = await supabaseAdmin
    .from('rides').select('id, rider_id')
    .eq('trip_id', tripId)
    .in('status', ['accepted', 'coordinating', 'active', 'completed'])
  // rider → their ride on this leg, so notifications can deep-link the chat.
  const rideIdByRider = new Map<string, string>()
  for (const r of (rideRows ?? []) as Array<{ id: string; rider_id: string }>) {
    if (!rideIdByRider.has(r.rider_id)) rideIdByRider.set(r.rider_id, r.id)
  }
  return { tripId, riderIds: [...rideIdByRider.keys()], rideIdByRider }
}

/** Verify a caregiver id belongs to the rider (mirror the companion check). */
async function caregiverOwnedBy(caregiverId: string, riderId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('caregivers')
    .select('id, user_id')
    .eq('id', caregiverId)
    .maybeSingle()
  const row = data as { id: string; user_id: string } | null
  return row != null && row.user_id === riderId
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

  // Caregiver — optional, owned by the rider (mirror the companion check).
  const caregiverId = optString(body.caregiver_id) ?? null
  if (caregiverId != null && !(await caregiverOwnedBy(caregiverId, riderId))) {
    res.status(404).json({ error: { code: 'CAREGIVER_NOT_FOUND', message: "We couldn't find that caregiver on your profile." } })
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
    caregiver_id: caregiverId,
    ...readPickup(body),
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

  broadcastDestinationChanged(destinationId)
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
  broadcastDestinationChanged(destinationId)
  res.status(200).json({ ok: true })
})

// ── Driver plan: "I'm driving" (A.4) ──────────────────────────────────────────

// V4 F6 — outbound/return trip ids are exposed here ONLY because every
// DRIVER_PLAN_COLUMNS read returns the driver their OWN plan (my_driver_plan
// + plan create/edit). The public plans list strips them (see the detail
// endpoint). The iOS driver uses them to open the multi-rider trip screen.
const DRIVER_PLAN_COLUMNS =
  'id, destination_id, driver_id, outbound_date, outbound_time, wants_return, '
  + 'return_date, return_time, seats_total, seats_available, note, status, '
  + 'board_schedule_id, origin_lat, origin_lng, origin_address, origin_place_id, '
  + 'outbound_trip_id, return_trip_id'

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

  // Destination must exist + not be archived; pull name + place + coords.
  const { data: dest } = await supabaseAdmin
    .from('featured_destinations')
    .select('id, name, city, region, latitude, longitude')
    .eq('id', destinationId)
    .neq('status', 'archived')
    .maybeSingle()
  if (!dest) {
    res.status(404).json({ error: { code: 'DESTINATION_NOT_FOUND', message: 'Destination not found' } })
    return
  }
  const destination = dest as {
    id: string; name: string; city: string | null; region: string | null
    latitude: number | null; longitude: number | null
  }

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
  //
  const { destAddress, note: boardNote } = buildBoardPostMeta(
    destination, seatsTotal, wantsReturn, optString(body.return_date) ?? null, note ?? null,
  )

  let boardScheduleID: string | null = null
  {
    const boardPost = {
      user_id: driverId,
      mode: 'driver',
      route_name: destination.name,
      origin_place_id: originPlaceID ?? `driver:${driverId}`,
      dest_place_id: `destination:${destinationId}`,
      origin_address: originAddress ?? 'Driver location',
      dest_address: destAddress,
      direction_type: 'one_way',
      trip_date: outboundDate,
      time_type: 'departure',
      trip_time: outboundTime ?? '12:00:00',
      time_flexible: false,
      available_seats: seatsTotal,
      note: boardNote,
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

  broadcastDestinationChanged(destinationId)
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

  // Keep the linked board post in sync (best-effort) — including the real
  // place as the destination + the regenerated auto-note (so an edit doesn't
  // wipe it back to a bare driver note).
  if (plan.board_schedule_id) {
    const { data: destRow } = await supabaseAdmin
      .from('featured_destinations')
      .select('name, city, region')
      .eq('id', req.params['id'] as string)
      .maybeSingle()
    const dest = destRow as { name: string; city: string | null; region: string | null } | null
    const meta = dest != null
      ? buildBoardPostMeta(dest, seatsTotal, wantsReturn, wantsReturn ? (optString(body.return_date) ?? null) : null, note ?? null)
      : null
    await supabaseAdmin
      .from('ride_schedules')
      .update({
        trip_date: outboundDate,
        trip_time: outboundTime ?? '12:00:00',
        available_seats: seatsTotal,
        note: meta?.note ?? note ?? null,
        ...(meta != null ? { dest_address: meta.destAddress } : {}),
        origin_lat: originLat,
        origin_lng: originLng,
        origin_address: originAddress ?? 'Driver location',
        origin_place_id: originPlaceID ?? `driver:${driverId}`,
      } as never)
      .eq('id', plan.board_schedule_id)
  }

  broadcastDestinationChanged(req.params['id'] as string)
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
  broadcastDestinationChanged(req.params['id'] as string)
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
  caregiver_id?: unknown
  pickup_lat?: unknown
  pickup_lng?: unknown
  pickup_address?: unknown
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

    // Hold the rider's party on a waitlist entry (companions + caregiver
    // live there so they travel into the matched ride at accept).
    const companionIds = [...new Set(
      [body.companion_a_id, body.companion_b_id].filter((v): v is string => typeof v === 'string' && v.length > 0),
    )].slice(0, 2)
    const caregiverId = optString(body.caregiver_id) ?? null
    if (caregiverId != null && !(await caregiverOwnedBy(caregiverId, userId))) {
      res.status(404).json({ error: { code: 'CAREGIVER_NOT_FOUND', message: "We couldn't find that caregiver on your profile." } })
      return
    }
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
        caregiver_id: caregiverId,
        ...readPickup(body),
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

  // Accessibility-aware copy for an incoming RIDE REQUEST (rider → driver):
  // let the driver know up front if the rider uses a wheelchair / brings a
  // caregiver, so they can gauge vehicle fit before opening.
  let accessibilitySuffix = ''
  if (initiatedBy === 'rider') {
    const { data: riderRow } = await supabaseAdmin
      .from('users').select('accessibility_profile').eq('id', riderId).maybeSingle()
    const profile = (riderRow as { accessibility_profile: { needs_wheelchair?: boolean } | null } | null)?.accessibility_profile
    let hasCaregiver = false
    if (linkedWaitlistId != null) {
      const { data: wlc } = await supabaseAdmin
        .from('destination_waitlist').select('caregiver_id').eq('id', linkedWaitlistId).maybeSingle()
      hasCaregiver = (wlc as { caregiver_id: string | null } | null)?.caregiver_id != null
    }
    const bits: string[] = []
    if (profile?.needs_wheelchair === true) bits.push('uses a wheelchair')
    if (hasCaregiver) bits.push('bringing a caregiver')
    if (bits.length > 0) accessibilitySuffix = ` — ${bits.join(', ')}`
  }

  // Notify the counterparty — actionable (Accept/Decline), so bell + push.
  const target = initiatedBy === 'rider' ? driverId : riderId
  const newOfferId = (offer as { id: string }).id
  await notifyUserDual(
    target,
    'destination_offer',
    initiatedBy === 'rider' ? 'New ride request' : 'A driver offered you a seat',
    initiatedBy === 'rider' ? `Someone wants to join your trip.${accessibilitySuffix}` : 'Open Explore to accept.',
    { type: 'destination_offer', destination_id: destinationId, offer_id: newOfferId },
  )
  // Phase 3b — live in-app banner: broadcast on the recipient's Explore
  // channel so the app surfaces the incoming offer immediately (Accept /
  // Decline) instead of only via the bell / push.
  void realtimeBroadcast(`explore:${target}`, 'destination_offer', {
    offer_id: newOfferId,
    destination_id: destinationId,
  })

  broadcastDestinationChanged(destinationId)
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

  // Rider's party (companions) + chosen travel_mode from the linked waitlist
  // entry. travel_mode decides how many legs this carpool has:
  //   together → outbound (home→event) now, return composed later (Stage 4)
  //   one_way  → outbound (home→event) only, no return ever
  //   own_thing→ return (event→home) only — the rider gets to the event their
  //              own way, so the SINGLE leg we create here heads HOME.
  let companionAId: string | null = null
  let companionBId: string | null = null
  let caregiverId: string | null = null
  let pickupLat: number | null = null
  let pickupLng: number | null = null
  let pickupName: string | null = null
  let seatsNeeded = 1
  let travelMode: 'together' | 'own_thing' | 'one_way' = 'together'
  if (offer.waitlist_id) {
    const { data: wlRow } = await supabaseAdmin
      .from('destination_waitlist')
      .select('companion_a_id, companion_b_id, caregiver_id, group_size, travel_mode, pickup_lat, pickup_lng, pickup_address')
      .eq('id', offer.waitlist_id)
      .maybeSingle()
    const wl = wlRow as {
      companion_a_id: string | null; companion_b_id: string | null
      caregiver_id: string | null; group_size: number; travel_mode: string | null
      pickup_lat: number | null; pickup_lng: number | null; pickup_address: string | null
    } | null
    if (wl) {
      companionAId = wl.companion_a_id
      companionBId = wl.companion_b_id
      caregiverId = wl.caregiver_id
      pickupLat = wl.pickup_lat
      pickupLng = wl.pickup_lng
      pickupName = wl.pickup_address
      seatsNeeded = Math.max(1, wl.group_size)
      if (wl.travel_mode === 'own_thing' || wl.travel_mode === 'one_way') {
        travelMode = wl.travel_mode
      }
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
    // The carpool's CONTEXT (the event name) for the seed chat line. For an
    // own_thing leg dName is "Home", which would read wrong — pass the event
    // name explicitly. Defaults to the drop-off name for outbound legs.
    contextName: string = dName,
    // True once the pickup is a real, rider-chosen point (home→event with a
    // provided pickup) so nav has a confirmed target. own_thing keeps it
    // false — the pickup is the event, where the meetup spot is sorted in chat.
    pickupConfirmed: boolean = false,
    // V4 F6 — the SHARED leg trip every rider on this drive links to, so the
    // segment cost-split fires (multi-rider event carpool). Eager-linked at
    // insert; null only if grouping failed (we fall back to a per-ride trip).
    sharedTripId: string | null = null,
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
        pickup_confirmed: pickupConfirmed,
        dropoff_point: geoPoint(dLat, dLng),
        dropoff_confirmed: true,
        companion_a_id: companionAId,
        companion_b_id: companionBId,
        // Carry the rider's caregiver onto the ride so the end-of-ride
        // handler charges the caregiver seat fee (was silently dropped —
        // an accessibility rider matched via Explore lost their caregiver).
        caregiver_id: caregiverId,
        // Eager-link to the shared leg trip so multiple riders on this drive
        // converge on ONE trips row (segment split). getOrCreateTripForRide
        // below is now only the fallback for a failed grouping.
        trip_id: sharedTripId,
      } as never)
      .select('id')
      .single()
    if (rideErr || !ride) {
      console.error('[destinations/offer:accept] ride insert failed:', rideErr?.message)
      return null
    }
    const rideId = (ride as { id: string }).id
    // Fallback only: if grouping failed (sharedTripId null) ensure the ride
    // still has a parent trip. When sharedTripId is set this is a no-op
    // (getOrCreateTripForRide returns the existing trip_id).
    await getOrCreateTripForRide(rideId)
    // Seed chat so the thread isn't empty. V4 F6 5A — context-aware: when
    // the rider already set a pickup, "sort out pickup" contradicted the
    // confirmed state two lines above it. Anchor the message in the trip
    // DATE instead, since matched event trips can sit for weeks.
    const dayLabel = tripDayLabel(tripDate)
    const seedText = pickupConfirmed
      ? `You're set for ${contextName} on ${dayLabel}! Pickup's locked in — `
        + 'use this chat for anything before the trip. The QR works on trip day.'
      : `You're set for ${contextName} on ${dayLabel}! Use this chat to sort out `
        + 'the exact meetup spot and timing.'
    // 5B.1 (Tarun) — a SYSTEM watermark, not a message "sent by the driver".
    // Unknown types render as centered system lines on both clients.
    await seedChatMessage(rideId, offer.driver_id, seedText, 'trip_note')
    return rideId
  }

  const destName = dest.name
  const originName = plan.origin_address ?? 'Driver location'
  // The rider's chosen end-point (pickup for home→event, drop-off for
  // own_thing). Falls back to the driver's origin for legacy rows / riders
  // who skipped it — the old behaviour, coordinated in chat.
  const hasRiderPoint = pickupLat != null && pickupLng != null
  const riderLat = hasRiderPoint ? pickupLat as number : originLat
  const riderLng = hasRiderPoint ? pickupLng as number : originLng
  const riderName = pickupName ?? originName
  // ONE leg primitive, composed by travel_mode. The single leg always lives in
  // offer.outbound_ride_id (the "primary ride" ~10 downstream sites read to
  // open chat / notify), regardless of which direction it points.
  // V4 F6 — resolve the SHARED trip this rider's leg joins so multiple riders
  // on one drive split the fare. own_thing rides home (return drive); together
  // / one_way ride out (outbound drive). First accept mints the trip; later
  // accepts reuse it. A grouping failure is non-fatal — makeRide falls back to
  // a per-ride trip (single-rider fare), matching the old behaviour.
  const legForTrip: 'outbound' | 'return' = travelMode === 'own_thing' ? 'return' : 'outbound'
  const legTrip = await getOrCreatePlanLegTrip(plan.id, legForTrip, offer.driver_id)
  if (legTrip.error) {
    console.error('[destinations/offer:accept] leg trip grouping failed:', legTrip.error)
  }
  const sharedTripId = legTrip.tripId || null

  let outboundRideId: string | null
  if (travelMode === 'own_thing') {
    // Return-only carpool: the rider gets to the event their own way and rides
    // HOME with the driver. The single leg is event → the rider's drop-off
    // (their home), on the return date/time. Pickup = event (sorted in chat).
    outboundRideId = await makeRide(
      destLat, destLng, destName,
      riderLat, riderLng, riderName,
      plan.return_date ?? plan.outbound_date, plan.return_time,
      destName, // contextName = the event, not "Home"
      false,
      sharedTripId,
    )
  } else {
    // together / one_way: the single leg is the rider's pickup → event on the
    // outbound date/time. For `together` the return leg is composed later
    // (Stage 4); for `one_way` there is never a return. Pickup is confirmed
    // when the rider actually provided one (so driver nav has a real target).
    outboundRideId = await makeRide(
      riderLat, riderLng, riderName,
      destLat, destLng, destName,
      plan.outbound_date, plan.outbound_time,
      destName,
      hasRiderPoint,
      sharedTripId,
    )
  }
  if (!outboundRideId) {
    res.status(400).json({ error: { code: 'RIDE_FAILED', message: 'Could not create the ride.' } })
    return
  }
  // NOTE: the RETURN ride is intentionally NOT created here. A `together` round
  // trip creates only the outbound leg at match; the return leg + its
  // coordinator card are created later (Trip Stepper Stage 4 — "plan return",
  // after the outbound is completed + paid). Creating both up front produced
  // two simultaneous "Coordinating" rides for one trip. own_thing / one_way
  // are single-leg and never compose a second ride (return_ride_id stays null
  // forever).

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

  // V4 F6 — fare-change education. A new rider joining the shared drive lowers
  // every existing rider's split share and grows the driver's cost coverage.
  // Tell them, so the moving price feels understood instead of suspicious.
  // Only fires once 2+ riders share the leg (the first accept has nobody to
  // tell). Non-fatal — a notify failure must not fail the accept.
  try {
    const { riderIds: onLeg, rideIdByRider } = await ridersOnPlanLeg(plan.id, legForTrip)
    if (onLeg.length >= 2) {
      const { data: nrRow } = await supabaseAdmin
        .from('users').select('full_name').eq('id', offer.rider_id).maybeSingle()
      const newRiderName = (nrRow as { full_name: string | null } | null)?.full_name ?? 'Someone'
      // Existing co-riders (exclude the one who just joined — they got matched).
      for (const coRiderId of onLeg.filter((id) => id !== offer.rider_id)) {
        // ride_id deep-links the bell row to this co-rider's own ride chat.
        const coRide = rideIdByRider.get(coRiderId)
        await notifyUserDual(
          coRiderId,
          'destination_fare_changed',
          'Your share just went down',
          `${newRiderName} joined your ride to ${destName} — ${onLeg.length} of you are sharing now, `
            + 'so your estimated share dropped. The final fare comes from the real distance driven.',
          {
            type: 'destination_fare_changed',
            destination_id: destinationId,
            destination_name: destName,
            ...(coRide ? { ride_id: coRide } : {}),
          },
        )
      }
      // The driver: more riders = more of their gas + time covered (they
      // keep 100%). trip_id lands the bell/push tap on the multi-rider
      // trip screen.
      await notifyUserDual(
        offer.driver_id,
        'destination_fare_changed',
        `Now covering ${onLeg.length} riders`,
        `${newRiderName} joined your trip to ${destName} — you're covering ${onLeg.length} riders now. `
          + 'You keep 100%; this covers your gas + time.',
        {
          type: 'destination_fare_changed',
          destination_id: destinationId,
          destination_name: destName,
          ...(sharedTripId ? { trip_id: sharedTripId } : {}),
        },
      )
    }
  } catch (err) {
    console.error('[destinations/offer:accept] fare-change notify failed:', (err as Error).message)
  }

  broadcastDestinationChanged(destinationId)
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
  broadcastDestinationChanged(req.params['id'] as string)
  res.status(200).json({ ok: true })
})

// ── Request a place/event (A.3) ───────────────────────────────────────────────

/** "Lake Tahoe!" → "lake-tahoe" (slug) ; "  lake  tahoe " → "lake tahoe" (norm). */
function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200)
}

/**
 * Notify everyone who requested/voted for a destination that it's now live.
 * Called by the admin promotion flow (admin makes the poster, then promotes).
 * `normalizedName` matches the `destination_requests` voters.
 */
export async function notifyRequestersForPromotion(
  destinationId: string,
  destinationName: string,
  normalizedName: string,
): Promise<void> {
  const { data } = await supabaseAdmin
    .from('destination_requests').select('user_id').eq('normalized_name', normalizedName)
  const voters = [...new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))]
  for (const userId of voters) {
    await notifyUserDual(
      userId,
      'destination_promoted',
      'A spot you wanted is live! 🎉',
      `${destinationName} is now in Explore — find a ride.`,
      { type: 'destination_promoted', destination_id: destinationId },
    )
  }
}

// POST /api/destinations/request — submit a place/event request; aggregate
// demand by normalized name; auto-promote to the live catalogue at ≥5
// distinct requesters.
destinationsRouter.post('/request', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const body = (req.body ?? {}) as { kind?: unknown; requested_name?: unknown; note?: unknown; target_date?: unknown }

  const kind = body.kind === 'event' ? 'event' : body.kind === 'place' ? 'place' : null
  const requestedName = optString(body.requested_name)
  if (kind == null) {
    res.status(400).json({ error: { code: 'INVALID_KIND', message: "kind must be 'event' or 'place'" } })
    return
  }
  if (requestedName == null || requestedName.length > 160) {
    res.status(400).json({ error: { code: 'INVALID_NAME', message: 'Enter a name (1–160 chars).' } })
    return
  }
  const normalized = requestedName.toLowerCase().trim()
  const note = optString(body.note)
  if (note != null && note.length > 500) {
    res.status(400).json({ error: { code: 'INVALID_NOTE', message: 'Note is too long' } })
    return
  }
  const targetDate = kind === 'event' ? (optString(body.target_date) ?? null) : null

  const { error: insErr } = await supabaseAdmin
    .from('destination_requests')
    .upsert({
      user_id: userId,
      kind,
      requested_name: requestedName,
      normalized_name: normalized,
      note: note ?? null,
      target_date: targetDate,
    } as never, { onConflict: 'user_id,normalized_name' })
  if (insErr) {
    res.status(400).json({ error: { code: 'REQUEST_FAILED', message: 'Could not submit your request.' } })
    return
  }

  // Already in the catalogue? (slug match) — then it's not a "request".
  const slug = slugify(requestedName)
  const { data: existing } = await supabaseAdmin
    .from('featured_destinations').select('id').eq('slug', slug).maybeSingle()

  // Demand = distinct requesters (UNIQUE(user,normalized) → one row each).
  // No auto-promote — the admin reviews demand + makes the poster, then
  // promotes from the admin panel (which calls notifyRequestersForPromotion).
  const { count } = await supabaseAdmin
    .from('destination_requests')
    .select('id', { count: 'exact', head: true })
    .eq('normalized_name', normalized)

  res.status(200).json({ demand_count: count ?? 0, already_live: existing != null })
})

// GET /api/destinations/requests — the "Requested" section: pending
// requested spots aggregated by name, with demand counts + whether the
// viewer already voted. Excludes ones already in the live catalogue.
destinationsRouter.get('/requests/list', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const kindFilter = typeof req.query['kind'] === 'string' ? (req.query['kind'] as string) : null

  let query = supabaseAdmin
    .from('destination_requests')
    .select('user_id, kind, requested_name, normalized_name, target_date, created_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (kindFilter === 'event' || kindFilter === 'place') {
    query = query.eq('kind', kindFilter)
  }
  const { data } = await query
  const rows = (data ?? []) as Array<{
    user_id: string; kind: string; requested_name: string
    normalized_name: string; target_date: string | null; created_at: string
  }>

  // Exclude anything already live (slug match).
  const { data: live } = await supabaseAdmin.from('featured_destinations').select('slug')
  const liveSlugs = new Set(((live ?? []) as Array<{ slug: string }>).map((d) => d.slug))

  const agg = new Map<string, {
    normalized_name: string; name: string; kind: string
    count: number; voters: Set<string>; viewer_voted: boolean; target_date: string | null
  }>()
  for (const r of rows) {
    if (liveSlugs.has(slugify(r.requested_name))) continue
    const existing = agg.get(r.normalized_name)
    if (existing) {
      existing.voters.add(r.user_id)
      if (r.user_id === userId) existing.viewer_voted = true
    } else {
      agg.set(r.normalized_name, {
        normalized_name: r.normalized_name,
        name: r.requested_name, // newest (rows ordered desc)
        kind: r.kind,
        count: 0,
        voters: new Set([r.user_id]),
        viewer_voted: r.user_id === userId,
        target_date: r.target_date,
      })
    }
  }
  const requests = [...agg.values()]
    .map((a) => ({
      normalized_name: a.normalized_name,
      name: a.name,
      kind: a.kind,
      count: a.voters.size,
      viewer_voted: a.viewer_voted,
      target_date: a.target_date,
    }))
    .sort((lhs, rhs) => rhs.count - lhs.count)

  res.status(200).json({ requests })
})

// ── My trips (Rides-tab surface) ──────────────────────────────────────────────

// GET /api/destinations/my-trips — the viewer's matched destination trips
// that aren't fully finished, so the Rides tab can show them (the outbound
// ride leaves /api/rides/active once completed, but the trip continues).
destinationsRouter.get('/my-trips/list', validateJwt, async (_req: Request, res: Response) => {
  const userId = res.locals['userId'] as string

  const { data: offerRows } = await supabaseAdmin
    .from('destination_offers')
    .select('id, driver_plan_id, destination_id, driver_id, rider_id, outbound_ride_id, return_ride_id')
    .eq('status', 'accepted')
    .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
  const offers = (offerRows ?? []) as Array<{
    id: string; driver_plan_id: string | null; destination_id: string
    driver_id: string; rider_id: string; outbound_ride_id: string | null; return_ride_id: string | null
  }>
  if (offers.length === 0) {
    res.status(200).json({ trips: [] })
    return
  }

  // Resolve plans (round-trip), destinations, ride statuses, counterparts.
  const planIds = [...new Set(offers.map((o) => o.driver_plan_id).filter((v): v is string => v != null))]
  const destIds = [...new Set(offers.map((o) => o.destination_id))]
  const rideIds = offers.flatMap((o) => [o.outbound_ride_id, o.return_ride_id]).filter((v): v is string => v != null)
  const cpIds = [...new Set(offers.map((o) => (o.driver_id === userId ? o.rider_id : o.driver_id)))]

  const [{ data: plans }, { data: dests }, { data: rides }, { data: cps }] = await Promise.all([
    supabaseAdmin.from('destination_driver_plans').select('id, wants_return').in('id', planIds.length ? planIds : ['x']),
    supabaseAdmin.from('featured_destinations').select('id, name, image_url').in('id', destIds),
    supabaseAdmin.from('rides').select('id, status, payment_status').in('id', rideIds.length ? rideIds : ['x']),
    supabaseAdmin.from('users').select('id, full_name, avatar_url').in('id', cpIds),
  ])
  const planMap = new Map((plans ?? []).map((p: { id: string; wants_return: boolean }) => [p.id, p.wants_return]))
  const destMap = new Map((dests ?? []).map((d: { id: string; name: string; image_url: string | null }) => [d.id, d]))
  const rideMap = new Map((rides ?? []).map((r: { id: string; status: string; payment_status: string | null }) => [r.id, r]))
  const cpMap = new Map((cps ?? []).map((u: { id: string; full_name: string | null; avatar_url: string | null }) => [u.id, u]))

  const ACTIVE_STATUSES = ['requested', 'accepted', 'coordinating', 'active']
  const trips = offers.map((o) => {
    const roundTrip = o.driver_plan_id ? (planMap.get(o.driver_plan_id) ?? false) : false
    const out = o.outbound_ride_id ? rideMap.get(o.outbound_ride_id) : undefined
    const ret = o.return_ride_id ? rideMap.get(o.return_ride_id) : undefined
    const outDone = out?.status === 'completed' && out.payment_status === 'paid'
    const retDone = ret?.status === 'completed' && ret.payment_status === 'paid'
    // A cancelled return resolves the round trip too (the ride home is off),
    // so the trip is done and should drop off the home "ride home" banner.
    const retResolved = retDone || ret?.status === 'cancelled'
    const fullyDone = outDone && (!roundTrip || retResolved)
    // A leg currently in the active list already shows in the standard
    // Rides "Active" section — only surface the trip here to fill the GAP
    // (between legs / completed-unpaid) so we never duplicate a card.
    const hasActiveLeg = (out != null && ACTIVE_STATUSES.includes(out.status))
      || (ret != null && ACTIVE_STATUSES.includes(ret.status))
    return { o, roundTrip, fullyDone, hasActiveLeg }
  }).filter((t) => !t.fullyDone && !t.hasActiveLeg && t.o.outbound_ride_id != null).map((t) => {
    const cpId = t.o.driver_id === userId ? t.o.rider_id : t.o.driver_id
    const dest = destMap.get(t.o.destination_id)
    return {
      offer_id: t.o.id,
      ride_id: t.o.outbound_ride_id,
      role: t.o.driver_id === userId ? 'driver' : 'rider',
      destination_name: dest?.name ?? 'Trip',
      destination_image_url: dest?.image_url ?? null,
      counterpart: cpMap.get(cpId) ?? null,
    }
  })

  res.status(200).json({ trips })
})

// ── Offer detail (Phase 1 — Event Request page) ───────────────────────────────

// GET /api/destinations/offer/:offerId — everything the EventRequestPage
// needs, reachable straight from a notification (no destination load).
destinationsRouter.get('/offer/:offerId', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const offerId = req.params['offerId'] as string

  const { data: offerRow } = await supabaseAdmin
    .from('destination_offers')
    .select(OFFER_COLUMNS as never)
    .eq('id', offerId)
    .maybeSingle()
  const offer = offerRow as {
    id: string; driver_plan_id: string | null; waitlist_id: string | null
    destination_id: string; driver_id: string; rider_id: string
    initiated_by: string; note: string | null; status: string
    outbound_ride_id: string | null; return_ride_id: string | null
  } | null
  if (!offer || (offer.driver_id !== userId && offer.rider_id !== userId)) {
    res.status(404).json({ error: { code: 'OFFER_NOT_FOUND', message: 'Request not found.' } })
    return
  }

  const counterpartId = offer.driver_id === userId ? offer.rider_id : offer.driver_id
  const { data: cpRaw } = await supabaseAdmin
    .from('users')
    .select('full_name, avatar_url, rating_avg, has_accessibility_needs, accessibility_profile')
    .eq('id', counterpartId).maybeSingle()
  const cpUser = cpRaw as {
    full_name: string | null; avatar_url: string | null; rating_avg: number | null
    has_accessibility_needs: boolean | null; accessibility_profile: { needs_wheelchair?: boolean } | null
  } | null
  // Public profile snippet for the request page — accessibility flag (badge)
  // but never the free-text notes.
  const cpRow = cpUser == null ? null : {
    full_name: cpUser.full_name,
    avatar_url: cpUser.avatar_url,
    rating_avg: cpUser.rating_avg,
    has_accessibility_needs: cpUser.has_accessibility_needs === true,
    needs_wheelchair: cpUser.accessibility_profile?.needs_wheelchair === true,
  }

  const { data: destRow } = await supabaseAdmin
    .from('featured_destinations')
    .select('name, image_url, city, region, latitude, longitude')
    .eq('id', offer.destination_id).maybeSingle()
  const dest = destRow as {
    name: string; image_url: string | null; city: string | null
    region: string | null; latitude: number | null; longitude: number | null
  } | null

  const { data: planRow } = await supabaseAdmin
    .from('destination_driver_plans')
    .select('outbound_date, outbound_time, wants_return, return_date, return_time, '
      + 'seats_available, origin_lat, origin_lng, origin_address')
    .eq('id', offer.driver_plan_id as string).maybeSingle()
  const plan = planRow as {
    origin_lat: number | null; origin_lng: number | null; origin_address: string | null
  } | null

  // Party + companions + caregiver. Driver-initiated offers carry the
  // rider's waitlist row, which holds the companion + caregiver FKs.
  let partySize = 1
  let companionCount = 0
  let companions: Array<{ name: string; avatar_url: string | null }> = []
  let caregiver: { name: string | null; avatar_url: string | null } | null = null
  let pickup: { lat: number; lng: number; name: string | null } | null = null
  let waitlistTravelMode: string | null = null
  if (offer.waitlist_id != null) {
    const { data: wl } = await supabaseAdmin
      .from('destination_waitlist')
      .select('group_size, companion_a_id, companion_b_id, caregiver_id, pickup_lat, pickup_lng, pickup_address, travel_mode')
      .eq('id', offer.waitlist_id).maybeSingle()
    const wlRow = wl as {
      group_size: number; companion_a_id: string | null
      companion_b_id: string | null; caregiver_id: string | null
      pickup_lat: number | null; pickup_lng: number | null; pickup_address: string | null
      travel_mode: string | null
    } | null
    waitlistTravelMode = wlRow?.travel_mode ?? null
    partySize = Math.max(1, wlRow?.group_size ?? 1)
    if (typeof wlRow?.pickup_lat === 'number' && typeof wlRow?.pickup_lng === 'number') {
      pickup = { lat: wlRow.pickup_lat, lng: wlRow.pickup_lng, name: wlRow.pickup_address }
    }
    const compIds = [wlRow?.companion_a_id, wlRow?.companion_b_id].filter((v): v is string => v != null)
    companionCount = compIds.length
    if (compIds.length > 0) {
      const { data: comps } = await supabaseAdmin
        .from('companions').select('name, avatar_url').in('id', compIds)
      companions = (comps as Array<{ name: string; avatar_url: string | null }> | null) ?? []
    }
    if (wlRow?.caregiver_id != null) {
      const { data: cg } = await supabaseAdmin
        .from('caregivers').select('name, avatar_url').eq('id', wlRow.caregiver_id).maybeSingle()
      caregiver = (cg as { name: string | null; avatar_url: string | null } | null) ?? null
    }
  }

  // Estimated fare + party add-ons, so the accepter sees the full cost up
  // front like the instant-ride card. The base leg runs from the rider's
  // actual pickup (if they set one) to the event; otherwise it falls back to
  // the driver's origin (the old behaviour).
  let fareCents: number | null = null
  let fareBreakdown: FareBreakdown | null = null
  let fareSplit: FareSplit | null = null
  const fromLat = pickup?.lat ?? plan?.origin_lat
  const fromLng = pickup?.lng ?? plan?.origin_lng
  if (typeof fromLat === 'number' && typeof fromLng === 'number'
    && typeof dest?.latitude === 'number' && typeof dest?.longitude === 'number') {
    fareBreakdown = await estimatePartyFare(
      fromLat, fromLng, dest.latitude, dest.longitude, companionCount, caregiver != null,
    )
    fareCents = fareBreakdown.base_cents

    // V4 F6 — projected split: divide the base across everyone expected to
    // share this leg's drive. A pending offer adds THIS rider to the count
    // (they're not on the leg yet); an accepted one already includes them.
    if (offer.driver_plan_id != null) {
      const leg: 'outbound' | 'return' = waitlistTravelMode === 'own_thing' ? 'return' : 'outbound'
      const { riderIds } = await ridersOnPlanLeg(offer.driver_plan_id, leg)
      const alreadyOnLeg = riderIds.includes(offer.rider_id)
      const projectedCount = riderIds.length + (alreadyOnLeg ? 0 : 1)
      fareSplit = computeProjectedSplit(
        fareBreakdown.base_cents, fareBreakdown.companion_cents, fareBreakdown.caregiver_cents, projectedCount,
      )
    }
  }

  const viewerRole = offer.driver_id === userId ? 'driver' : 'rider'
  // The accepter is the counterparty of whoever initiated.
  const canAct = offer.status === 'pending'
    && ((offer.initiated_by === 'rider' && viewerRole === 'driver')
      || (offer.initiated_by === 'driver' && viewerRole === 'rider'))

  res.status(200).json({
    offer: {
      id: offer.id,
      destination_id: offer.destination_id,
      initiated_by: offer.initiated_by,
      status: offer.status,
      note: offer.note,
      outbound_ride_id: offer.outbound_ride_id,
    },
    viewer_role: viewerRole,
    can_act: canAct,
    counterpart: cpRow ?? null,
    destination: dest ?? null,
    origin: plan?.origin_lat != null && plan?.origin_lng != null
      ? { lat: plan.origin_lat, lng: plan.origin_lng, name: plan.origin_address }
      : null,
    trip: planRow ?? null,
    party_size: partySize,
    companions,
    caregiver,
    pickup,
    fare_cents: fareCents,
    fare_breakdown: fareBreakdown,
    fare_split: fareSplit,
  })
})

// ── Trip Stepper context (Spine-A) ────────────────────────────────────────────

// GET /api/destinations/trip-context/:rideID — the staged-journey state for a
// destination ride's chat (the pinned stepper header). Returns is_destination
// false for non-destination rides so the chat just hides the header.
destinationsRouter.get('/trip-context/:rideID', validateJwt, async (req: Request, res: Response) => {
  const rideID = req.params['rideID'] as string

  const { data: offerRow } = await supabaseAdmin
    .from('destination_offers')
    .select('id, driver_plan_id, waitlist_id, destination_id, outbound_ride_id, return_ride_id, status')
    .or(`outbound_ride_id.eq.${rideID},return_ride_id.eq.${rideID}`)
    .eq('status', 'accepted')
    .maybeSingle()
  const offer = offerRow as {
    id: string; driver_plan_id: string | null; waitlist_id: string | null; destination_id: string
    outbound_ride_id: string | null; return_ride_id: string | null; status: string
  } | null
  if (!offer) {
    res.status(200).json({ is_destination: false })
    return
  }

  // Whether this carpool has a return leg is decided by the RIDER's chosen
  // travel_mode, NOT the driver plan's wants_return. Only `together` is a true
  // round trip (outbound now + return composed at Stage 4). `own_thing` and
  // `one_way` are single-leg and never offer a return. Default 'together' for
  // legacy offers whose waitlist row predates travel_mode.
  let travelMode: 'together' | 'own_thing' | 'one_way' = 'together'
  if (offer.waitlist_id) {
    const { data: wlRow } = await supabaseAdmin
      .from('destination_waitlist').select('travel_mode').eq('id', offer.waitlist_id).maybeSingle()
    const mode = (wlRow as { travel_mode: string | null } | null)?.travel_mode
    if (mode === 'own_thing' || mode === 'one_way') travelMode = mode
  }
  const roundTrip = travelMode === 'together'

  const { data: destRow } = await supabaseAdmin
    .from('featured_destinations').select('name').eq('id', offer.destination_id).maybeSingle()
  const destinationName = (destRow as { name: string } | null)?.name ?? 'the destination'

  // Pull both legs' status + payment (+ the focused ride's schedule, which
  // anchors the phase below).
  const legIds = [offer.outbound_ride_id, offer.return_ride_id].filter((v): v is string => typeof v === 'string')
  const { data: rideRows } = await supabaseAdmin
    .from('rides').select('id, status, payment_status, trip_date, trip_time, trip_id').in('id', legIds)
  const rides = new Map<string, {
    status: string; payment_status: string; trip_date: string | null; trip_time: string | null; trip_id: string | null
  }>()
  for (const r of (rideRows ?? []) as Array<{
    id: string; status: string; payment_status: string; trip_date: string | null; trip_time: string | null
    trip_id: string | null
  }>) {
    rides.set(r.id, {
      status: r.status, payment_status: r.payment_status,
      trip_date: r.trip_date, trip_time: r.trip_time, trip_id: r.trip_id,
    })
  }
  const outbound = offer.outbound_ride_id ? rides.get(offer.outbound_ride_id) : undefined
  const returnLeg = offer.return_ride_id ? rides.get(offer.return_ride_id) : undefined

  // Stage machine.
  let stage = 'pickup'
  let canStartReturn = false
  const outStatus = outbound?.status ?? 'accepted'
  if (outStatus === 'cancelled') {
    stage = 'cancelled'
  } else if (outStatus === 'active') {
    stage = 'to_destination'
  } else if (outStatus === 'completed') {
    if (outbound?.payment_status !== 'paid') {
      stage = 'arrived_pay'
    } else if (!roundTrip) {
      stage = 'done'
    } else if (returnLeg == null) {
      stage = 'at_destination'
      canStartReturn = true
    } else if (returnLeg.status === 'accepted' || returnLeg.status === 'coordinating') {
      stage = 'return_ready' // return created, awaiting QR-start
    } else if (returnLeg.status === 'active') {
      stage = 'heading_home'
    } else if (returnLeg.status === 'cancelled') {
      // The ride home was cancelled — the carpool is over (the outbound
      // already happened). Terminal: never fall through to 'pickup' (which
      // showed a "Scan to start" + an un-cancellable Cancel on a done trip).
      stage = 'done'
    } else if (returnLeg.status === 'completed') {
      stage = returnLeg.payment_status === 'paid' ? 'done' : 'home_pay'
    } else {
      // Unknown return status — safe terminal-ish fallback (re-offer the
      // return), never 'pickup'.
      stage = 'at_destination'
      canStartReturn = true
    }
  } else {
    stage = 'pickup'
  }

  // V4 F6 5A — time anchor. A matched event trip can sit for WEEKS before
  // trip day, but the stage machine alone reads like an instant ride
  // ("show QR now"). `phase` tells the client whether the focused leg is
  // still in the future so it can swap the day-of chrome for a calm
  // "you're set for {date}" plan. Calendar-date compare in Pacific Time.
  const focused = rides.get(rideID) ?? outbound
  const focusedDate = focused?.trip_date ?? null
  const todayPT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const phase = focusedDate != null && focusedDate > todayPT ? 'scheduled' : 'day_of'

  // V4 F6 5B — has the driver started the day-of run for this leg's shared
  // drive? Flips the rider chat into the be-ready state before their own
  // ride goes active.
  let runStarted = false
  const focusedTripId = focused?.trip_id ?? null
  if (focusedTripId != null) {
    const { data: legTripRow } = await supabaseAdmin
      .from('trips').select('status, started_at').eq('id', focusedTripId).maybeSingle()
    const legTrip = legTripRow as { status: string; started_at: string | null } | null
    runStarted = legTrip?.started_at != null || legTrip?.status === 'active'
  }

  res.status(200).json({
    is_destination: true,
    round_trip: roundTrip,
    // The iOS chat slice relabels the stepper from this: for own_thing the
    // single leg heads HOME (not to the event), so the chrome must say so.
    travel_mode: travelMode,
    destination_name: destinationName,
    stage,
    phase,
    run_started: runStarted,
    trip_date: focusedDate,
    trip_time: focused?.trip_time ?? null,
    can_start_return: canStartReturn,
    outbound_ride_id: offer.outbound_ride_id,
    return_ride_id: offer.return_ride_id,
  })
})

// ── Day-of run mode (V4 F6 5B) ───────────────────────────────────────────────

// POST /api/destinations/run/:tripID/start — the driver starts the day-of
// run for a shared leg trip. Flips the trip to active (CAS on pending) and
// tells every committed rider "your driver is on the way" (chat line + bell
// + push), which flips their chat into the be-ready state. Gated to trip
// day — the whole point of the timeline is that nothing moves early.
destinationsRouter.post('/run/:tripID/start', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const tripID = req.params['tripID'] as string

  const { data: tripRow } = await supabaseAdmin
    .from('trips')
    .select('id, driver_id, status, started_at')
    .eq('id', tripID)
    .maybeSingle()
  const trip = tripRow as { id: string; driver_id: string; status: string; started_at: string | null } | null
  if (!trip) {
    res.status(404).json({ error: { code: 'TRIP_NOT_FOUND', message: 'Trip not found' } })
    return
  }
  if (trip.driver_id !== userId) {
    res.status(403).json({ error: { code: 'NOT_DRIVER', message: 'Only the driver can start the run.' } })
    return
  }

  const { data: rideRows } = await supabaseAdmin
    .from('rides')
    .select('id, rider_id, status, trip_date, origin_name')
    .eq('trip_id', tripID)
    .in('status', ['accepted', 'coordinating'])
  const rides = (rideRows ?? []) as Array<{
    id: string; rider_id: string; status: string; trip_date: string | null; origin_name: string | null
  }>
  if (rides.length === 0) {
    res.status(409).json({ error: { code: 'NO_RIDERS', message: 'No riders are waiting on this trip.' } })
    return
  }

  const tripDate = rides.find((r) => r.trip_date != null)?.trip_date ?? null
  if (!rideStartableToday(tripDate)) {
    res.status(409).json({
      error: {
        code: 'TRIP_NOT_TODAY',
        message: `This trip is scheduled for ${tripDayLabel(tripDate as string)} — start the run on trip day.`,
      },
    })
    return
  }

  // CAS pending → active so a double-tap doesn't re-notify everyone.
  const startedAtIso = new Date().toISOString()
  const { data: flipped } = await supabaseAdmin
    .from('trips')
    .update({ status: 'active', started_at: startedAtIso, updated_at: startedAtIso } as never)
    .eq('id', tripID)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (!flipped) {
    res.status(200).json({ ok: true, already_started: true })
    return
  }

  for (const ride of rides) {
    await seedChatMessage(
      ride.id, userId,
      "I'm on my way! Be ready at your pickup — scan my QR when you hop in.",
      'text',
    )
    await notifyUserDual(
      ride.rider_id,
      'destination_run_started',
      'Your driver is on the way!',
      `Be ready at ${ride.origin_name ?? 'your pickup'} — scan their QR when you hop in.`,
      { type: 'destination_run_started', ride_id: ride.id },
    )
  }

  res.status(200).json({ ok: true, riders_notified: rides.length })
})

// GET /api/destinations/run/:tripID/roster — per-ride travel modes for the
// driver's trip screen ("won't ride back" tags). Driver-gated.
destinationsRouter.get('/run/:tripID/roster', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const tripID = req.params['tripID'] as string

  const { data: tripRow } = await supabaseAdmin
    .from('trips').select('id, driver_id, status, started_at').eq('id', tripID).maybeSingle()
  const trip = tripRow as { id: string; driver_id: string; status: string; started_at: string | null } | null
  if (!trip || trip.driver_id !== userId) {
    res.status(404).json({ error: { code: 'TRIP_NOT_FOUND', message: 'Trip not found' } })
    return
  }

  const { data: rideRows } = await supabaseAdmin
    .from('rides').select('id').eq('trip_id', tripID)
  const rideIds = ((rideRows ?? []) as Array<{ id: string }>).map((r) => r.id)
  const modeByRide = new Map<string, string>()
  if (rideIds.length > 0) {
    const { data: offerRows } = await supabaseAdmin
      .from('destination_offers')
      .select('outbound_ride_id, return_ride_id, waitlist_id')
      .or(rideIds.flatMap((id) => [`outbound_ride_id.eq.${id}`, `return_ride_id.eq.${id}`]).join(','))
    const offers = (offerRows ?? []) as Array<{
      outbound_ride_id: string | null; return_ride_id: string | null; waitlist_id: string | null
    }>
    const waitlistIds = [...new Set(offers.map((o) => o.waitlist_id).filter((v): v is string => v != null))]
    const modeByWaitlist = new Map<string, string>()
    if (waitlistIds.length > 0) {
      const { data: wlRows } = await supabaseAdmin
        .from('destination_waitlist').select('id, travel_mode').in('id', waitlistIds)
      for (const w of (wlRows ?? []) as Array<{ id: string; travel_mode: string | null }>) {
        modeByWaitlist.set(w.id, w.travel_mode ?? 'together')
      }
    }
    for (const o of offers) {
      const mode = o.waitlist_id != null ? (modeByWaitlist.get(o.waitlist_id) ?? 'together') : 'together'
      for (const rid of [o.outbound_ride_id, o.return_ride_id]) {
        if (rid != null && rideIds.includes(rid)) modeByRide.set(rid, mode)
      }
    }
  }

  res.status(200).json({
    run_started: trip.started_at != null || trip.status === 'active',
    riders: rideIds.map((id) => ({ ride_id: id, travel_mode: modeByRide.get(id) ?? 'together' })),
  })
})

// PATCH /api/destinations/run/:tripID/order — driver persists the pickup
// sequence (greedy-shortest default computed client-side; drag overrides).
// Body: { ordered_ride_ids: [...] } — must exactly cover the trip's rides.
destinationsRouter.patch('/run/:tripID/order', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const tripID = req.params['tripID'] as string
  const body = (req.body ?? {}) as { ordered_ride_ids?: unknown }
  const ordered = Array.isArray(body.ordered_ride_ids)
    ? body.ordered_ride_ids.filter((v): v is string => typeof v === 'string')
    : []
  if (ordered.length === 0) {
    res.status(400).json({ error: { code: 'INVALID_BODY', message: 'ordered_ride_ids is required' } })
    return
  }

  const { data: tripRow } = await supabaseAdmin
    .from('trips').select('id, driver_id').eq('id', tripID).maybeSingle()
  const trip = tripRow as { id: string; driver_id: string } | null
  if (!trip || trip.driver_id !== userId) {
    res.status(404).json({ error: { code: 'TRIP_NOT_FOUND', message: 'Trip not found' } })
    return
  }

  const { data: rideRows } = await supabaseAdmin
    .from('rides').select('id').eq('trip_id', tripID)
  const tripRideIds = new Set(((rideRows ?? []) as Array<{ id: string }>).map((r) => r.id))
  if (ordered.length !== tripRideIds.size || !ordered.every((id) => tripRideIds.has(id))) {
    res.status(400).json({ error: { code: 'ORDER_MISMATCH', message: 'Order must cover exactly this trip\'s rides.' } })
    return
  }

  for (let i = 0; i < ordered.length; i++) {
    await supabaseAdmin
      .from('rides')
      .update({ stop_order: i + 1 } as never)
      .eq('id', ordered[i])
  }
  res.status(200).json({ ok: true })
})

// ── Return coordination (TT.1) — in the existing ride chat ────────────────────

/** Find the destination offer whose outbound leg is this ride. */
async function offerForOutboundRide(rideId: string): Promise<
  { id: string; driver_id: string; rider_id: string; return_ride_id: string | null; destination_id: string; driver_plan_id: string | null } | null
> {
  const { data } = await supabaseAdmin
    .from('destination_offers')
    .select('id, driver_id, rider_id, return_ride_id, destination_id, driver_plan_id')
    .eq('outbound_ride_id', rideId)
    .eq('status', 'accepted')
    .maybeSingle()
  return (data as { id: string; driver_id: string; rider_id: string; return_ride_id: string | null; destination_id: string; driver_plan_id: string | null } | null) ?? null
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

interface GeoJSONPoint { type: string; coordinates: [number, number] }

// POST /api/destinations/return/:rideID/start — create the return leg
// (event → home, pre-confirmed so nav works) once the outbound is done +
// paid. Either party can start it. The return ride then runs through the
// normal QR-start → drive → QR-end → pay flow.
destinationsRouter.post('/return/:rideID/start', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const rideID = req.params['rideID'] as string
  const body = (req.body ?? {}) as { dropoff_lat?: unknown; dropoff_lng?: unknown; dropoff_name?: unknown }

  const offer = await offerForOutboundRide(rideID)
  if (!offer) {
    res.status(404).json({ error: { code: 'TRIP_NOT_FOUND', message: 'Trip not found' } })
    return
  }
  if (offer.driver_id !== userId && offer.rider_id !== userId) {
    res.status(403).json({ error: { code: 'NOT_YOURS', message: 'Not your trip.' } })
    return
  }
  if (offer.return_ride_id != null) {
    res.status(409).json({ error: { code: 'RETURN_EXISTS', message: 'The return trip has already started.' } })
    return
  }

  // The outbound must be finished + paid.
  const { data: outRow } = await supabaseAdmin
    .from('rides')
    .select('status, payment_status, origin, origin_name, destination, destination_name, companion_a_id, companion_b_id, caregiver_id')
    .eq('id', rideID)
    .maybeSingle()
  const out = outRow as {
    status: string; payment_status: string
    origin: GeoJSONPoint | null; origin_name: string | null
    destination: GeoJSONPoint | null; destination_name: string | null
    companion_a_id: string | null; companion_b_id: string | null
    caregiver_id: string | null
  } | null
  if (!out || out.status !== 'completed' || out.payment_status !== 'paid') {
    res.status(409).json({ error: { code: 'NOT_READY', message: 'Finish and pay for the ride there first.' } })
    return
  }
  const homeCoords = out.origin?.coordinates
  const eventCoords = out.destination?.coordinates
  if (!homeCoords || !eventCoords) {
    res.status(400).json({ error: { code: 'MISSING_COORDS', message: 'Trip is missing location data.' } })
    return
  }
  // Return = outbound reversed: pickup = event, dropoff = home (default).
  // Optional override: a different drop-off.
  const dropLat = typeof body.dropoff_lat === 'number' ? body.dropoff_lat : homeCoords[1]
  const dropLng = typeof body.dropoff_lng === 'number' ? body.dropoff_lng : homeCoords[0]
  const dropName = optString(body.dropoff_name) ?? out.origin_name ?? 'Home'
  const eventLat = eventCoords[1]
  const eventLng = eventCoords[0]
  const eventName = out.destination_name ?? 'the destination'

  // V4 F6 — the return drive is shared: every rider riding home from this plan
  // links to the plan's return trip so the fare splits. Falls back to a
  // per-ride trip if the plan id is missing (legacy offers).
  const returnLegTrip = offer.driver_plan_id
    ? await getOrCreatePlanLegTrip(offer.driver_plan_id, 'return', offer.driver_id)
    : { tripId: '', error: undefined as string | undefined }
  if (returnLegTrip.error) {
    console.error('[destinations/return:start] leg trip grouping failed:', returnLegTrip.error)
  }
  const sharedReturnTripId = returnLegTrip.tripId || null

  const fareCents = await estimateFareCentsBetween(eventLat, eventLng, dropLat, dropLng)
  const { data: ride, error: rideErr } = await supabaseAdmin
    .from('rides')
    .insert({
      rider_id: offer.rider_id,
      driver_id: offer.driver_id,
      origin: geoPoint(eventLat, eventLng),
      origin_name: eventName,
      destination: geoPoint(dropLat, dropLng),
      destination_name: dropName,
      status: 'accepted',
      fare_cents: fareCents,
      payment_status: 'pending',
      pickup_point: geoPoint(eventLat, eventLng),
      pickup_confirmed: true,
      dropoff_point: geoPoint(dropLat, dropLng),
      dropoff_confirmed: true,
      companion_a_id: out.companion_a_id,
      companion_b_id: out.companion_b_id,
      caregiver_id: out.caregiver_id,
      trip_id: sharedReturnTripId,
    } as never)
    .select('id')
    .single()
  if (rideErr || !ride) {
    res.status(400).json({ error: { code: 'RETURN_FAILED', message: 'Could not start the return trip.' } })
    return
  }
  const returnRideId = (ride as { id: string }).id
  await getOrCreateTripForRide(returnRideId)
  await supabaseAdmin
    .from('destination_offers')
    .update({ return_ride_id: returnRideId, updated_at: new Date().toISOString() } as never)
    .eq('id', offer.id)

  // Tell the outbound chat the return is ready; nudge to scan.
  await seedChatMessage(
    rideID, userId,
    `Return trip is ready — scan the driver's QR to start the ride home from ${eventName}.`,
    'text',
  )
  const other = userId === offer.driver_id ? offer.rider_id : offer.driver_id
  await notifyUserDual(
    other,
    'destination_return',
    'Return trip ready',
    `Your ride home from ${eventName} is ready — scan to start.`,
    { type: 'destination_return', ride_id: returnRideId },
  )

  res.status(200).json({ return_ride_id: returnRideId })
})

// POST /api/destinations/return/:rideID/skip — at the destination, the rider
// or driver decides NOT to take the ride home. The outbound already happened
// and was paid, so there's nothing to cancel/refund — this just concludes the
// trip (releases the offer) so it drops off the home banner / Rides / stepper.
destinationsRouter.post('/return/:rideID/skip', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const rideID = req.params['rideID'] as string
  const offer = await offerForOutboundRide(rideID)
  if (!offer) {
    res.status(404).json({ error: { code: 'TRIP_NOT_FOUND', message: 'Trip not found' } })
    return
  }
  if (offer.driver_id !== userId && offer.rider_id !== userId) {
    res.status(403).json({ error: { code: 'NOT_YOURS', message: 'Not your trip.' } })
    return
  }
  if (offer.return_ride_id != null) {
    res.status(409).json({ error: { code: 'RETURN_EXISTS', message: 'The ride home already started — cancel it instead.' } })
    return
  }
  await supabaseAdmin
    .from('destination_offers')
    .update({ status: 'released', updated_at: new Date().toISOString() } as never)
    .eq('id', offer.id)

  const { data: dest } = await supabaseAdmin
    .from('featured_destinations').select('name').eq('id', offer.destination_id).maybeSingle()
  const destName = (dest as { name: string } | null)?.name ?? 'the destination'
  const role = userId === offer.driver_id ? 'driver' : 'rider'
  const other = userId === offer.driver_id ? offer.rider_id : offer.driver_id
  await notifyUserDual(
    other,
    'destination_return',
    'No ride home',
    `The ${role} isn't taking the ride home from ${destName}.`,
    { type: 'destination_return', ride_id: rideID },
  )
  broadcastDestinationChanged(offer.destination_id)
  res.status(200).json({ ok: true })
})
