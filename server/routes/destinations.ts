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
}

const DESTINATION_COLUMNS =
  'id, kind, name, slug, description, image_url, city, region, '
  + 'event_date, event_end_date, status, sort_priority'

// ── GET /api/destinations?kind= ──────────────────────────────────────────────
destinationsRouter.get('/', validateJwt, async (req: Request, res: Response) => {
  const kind = typeof req.query['kind'] === 'string' ? (req.query['kind'] as string) : null
  if (kind != null && kind !== 'event' && kind !== 'place') {
    res.status(400).json({ error: { code: 'INVALID_KIND', message: "kind must be 'event' or 'place'" } })
    return
  }

  let query = supabaseAdmin
    .from('featured_destinations')
    .select(DESTINATION_COLUMNS as never)
    .neq('status', 'archived')
    .order('sort_priority', { ascending: false })
    .order('event_date', { ascending: true, nullsFirst: false })
  if (kind != null) {
    query = query.eq('kind', kind)
  }

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to load destinations' } })
    return
  }
  const rows = (data ?? []) as unknown as DestinationRow[]
  const ids = rows.map((r) => r.id)

  // Per-card counts — waiting riders + active driver plans. Fetched in
  // two cheap reads + counted in JS (the catalogue is small).
  const waitlistCounts = new Map<string, number>()
  const planCounts = new Map<string, number>()
  if (ids.length > 0) {
    const { data: wl } = await supabaseAdmin
      .from('destination_waitlist')
      .select('destination_id')
      .in('destination_id', ids)
      .eq('status', 'waiting')
    for (const row of (wl ?? []) as Array<{ destination_id: string }>) {
      waitlistCounts.set(row.destination_id, (waitlistCounts.get(row.destination_id) ?? 0) + 1)
    }
    const { data: plans } = await supabaseAdmin
      .from('destination_driver_plans')
      .select('destination_id')
      .in('destination_id', ids)
      .eq('status', 'active')
    for (const row of (plans ?? []) as Array<{ destination_id: string }>) {
      planCounts.set(row.destination_id, (planCounts.get(row.destination_id) ?? 0) + 1)
    }
  }

  const destinations = rows.map((r) => ({
    ...r,
    waitlist_count: waitlistCounts.get(r.id) ?? 0,
    driver_plan_count: planCounts.get(r.id) ?? 0,
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
  })
})
