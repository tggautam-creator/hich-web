/**
 * Users-domain routes — small/read-only stats today, room for more
 * profile-shape endpoints later (email change, phone re-verify, etc.).
 *
 *   GET /api/users/me/stats   (JWT-protected)
 *     → `{ rides_completed, rating_avg, rating_count }`
 *
 *   GET /api/users/me/notification-preferences  (JWT-protected)
 *     → `{ push_rides, push_promos, email_marketing, sms_alerts }`
 *     Auto-creates the row with defaults if missing — first GET
 *     after migration 055 lands also acts as the bootstrap.
 *
 *   PUT /api/users/me/notification-preferences  (JWT-protected)
 *     Body: any subset of the toggle flags as booleans.
 *     Returns the updated row. UPSERT semantics; missing flags keep
 *     their prior value.
 *
 * Authoritative replacement for the rides-completed count that both
 * web and iOS were sampling client-side via `select rides limit 50`
 * (incorrect once a user has more than 50 rides) plus the
 * `users.rating_avg`/`rating_count` pair already on `auth.profile`.
 * Single round-trip beats the two HEAD-count queries iOS was doing
 * post-2026-04-27 P.1.a, and surfaces a freshness signal too —
 * `auth.profile.rating_avg` only refreshes on `refreshProfile()`
 * which iOS doesn't call after every rate event.
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { validateJwt } from '../middleware/auth.ts'

export const usersRouter = Router()

// ── GET /api/users/me/stats ──────────────────────────────────────────────
usersRouter.get(
  '/me/stats',
  validateJwt,
  async (_req: Request, res: Response) => {
    const userId = res.locals['userId'] as string
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
      return
    }

    try {
      // Profile row carries the canonical rating values.
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('users')
        .select('rating_avg, rating_count')
        .eq('id', userId)
        .single()

      if (profileErr || !profile) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User profile not found' } })
        return
      }

      // Single completed-rides count, server-side, using `head + exact`
      // so we don't drag rows down. The OR matches both rider-role
      // and driver-role rides; the server-enforced no-self-rides rule
      // means a single ride can't satisfy both predicates → no
      // double-counting.
      const { count, error: countErr } = await supabaseAdmin
        .from('rides')
        .select('id', { head: true, count: 'exact' })
        .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
        .eq('status', 'completed')

      if (countErr) {
        console.error(`[users/me/stats] count failed: ${countErr.message}`)
      }

      res.status(200).json({
        rides_completed: count ?? 0,
        rating_avg: profile.rating_avg as number | null,
        rating_count: (profile.rating_count as number | null) ?? 0,
      })
    } catch (err) {
      console.error(`[users/me/stats] unexpected error:`, err)
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Stats fetch failed' } })
    }
  },
)

// ── Notification preferences ─────────────────────────────────────────────
//
// Default values mirror the column DEFAULTs in migration 055 — see that
// file for the rationale on why each toggle defaults the way it does.
const DEFAULT_PREFS = {
  push_rides: true,
  push_promos: true,
  email_marketing: true,
  sms_alerts: false,
  // v1.3 Suggested Rides (2026-05-25) — default-on; users can opt
  // out from Settings if the daily/instant cadence becomes noise.
  push_suggestions: true,
}

type NotificationPreferences = typeof DEFAULT_PREFS

// GET /api/users/me/notification-preferences — also bootstraps the
// row when it doesn't exist yet, so the client never has to handle
// a 404.
usersRouter.get(
  '/me/notification-preferences',
  validateJwt,
  async (_req: Request, res: Response) => {
    const userId = res.locals['userId'] as string
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
      return
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('notification_preferences')
        .select('push_rides, push_promos, email_marketing, sms_alerts, push_suggestions')
        .eq('user_id', userId)
        .maybeSingle()

      if (error) {
        console.error(`[users/me/notification-prefs GET] ${error.message}`)
        res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not load preferences' } })
        return
      }

      if (data) {
        res.status(200).json(data)
        return
      }

      // No row yet — bootstrap with defaults so future GETs are
      // identical to the first one. Cast via `as any` because the
      // auto-generated `database.ts` doesn't include the
      // notification_preferences table yet — same pattern used by
      // `account.ts::purge`. Regenerating types is a follow-up.
      const { error: insertErr } = await supabaseAdmin
        .from('notification_preferences' as never)
        .insert({ user_id: userId, ...DEFAULT_PREFS } as never)

      if (insertErr) {
        // Don't fail the request — fall back to returning the
        // defaults synthetically. Next request will retry the
        // bootstrap. RLS-mediated unique-violation can race here on
        // double-launch and that's fine.
        console.error(`[users/me/notification-prefs GET] bootstrap failed: ${insertErr.message}`)
      }

      res.status(200).json(DEFAULT_PREFS)
    } catch (err) {
      console.error(`[users/me/notification-prefs GET] unexpected error:`, err)
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Preferences fetch failed' } })
    }
  },
)

// PUT /api/users/me/notification-preferences — UPSERT. Body is any
// subset of the toggle keys. Missing keys keep their prior value
// (we read first, then merge, then upsert).
usersRouter.put(
  '/me/notification-preferences',
  validateJwt,
  async (req: Request, res: Response) => {
    const userId = res.locals['userId'] as string
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
      return
    }

    const body = (req.body ?? {}) as Partial<NotificationPreferences>
    // Accept only the four known keys + only boolean values. Anything
    // else is silently dropped; that's friendlier than rejecting the
    // whole request when a client adds a field we haven't shipped yet.
    const update: Partial<NotificationPreferences> = {}
    for (const key of Object.keys(DEFAULT_PREFS) as Array<keyof NotificationPreferences>) {
      const v = body[key]
      if (typeof v === 'boolean') {
        update[key] = v
      }
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'No valid preference flags in body' },
      })
      return
    }

    try {
      // Read current → merge → upsert. Saves us a write when the
      // client sends every flag (the merge is a no-op) and keeps
      // existing values when the client sends a subset.
      const { data: existing } = await supabaseAdmin
        .from('notification_preferences')
        .select('push_rides, push_promos, email_marketing, sms_alerts, push_suggestions')
        .eq('user_id', userId)
        .maybeSingle()

      const merged = {
        ...DEFAULT_PREFS,
        ...(existing ?? {}),
        ...update,
        user_id: userId,
      }

      const { error } = await supabaseAdmin
        .from('notification_preferences' as never)
        .upsert(merged as never, { onConflict: 'user_id' })

      if (error) {
        console.error(`[users/me/notification-prefs PUT] ${error.message}`)
        res.status(500).json({
          error: { code: 'DB_ERROR', message: 'Could not save preferences' },
        })
        return
      }

      // Strip user_id before returning — caller already knows who they are.
      const { user_id: _userId, ...returned } = merged
      res.status(200).json(returned)
    } catch (err) {
      console.error(`[users/me/notification-prefs PUT] unexpected error:`, err)
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Preferences save failed' } })
    }
  },
)

// ── POST /api/users/me/profile (2026-06-03) ──────────────────────────────
//
// Server-mediated profile upsert. Replaces the previous direct
// supabase.from('users').upsert(...) the iOS app used to call —
// that path hit RLS races when the supabase-swift session JWT
// lagged the cached user.id on new-signup INSERT, producing the
// "new row violates row-level security policy" 42501 we kept seeing
// on the CreateProfilePage Continue button. Using the service role
// here bypasses RLS entirely + lets us own validation in one place.
//
// Idempotent: read-then-update if a row exists, else INSERT.
// `email` is taken from auth.users (never client-provided) so a
// compromised JWT can't forge a row for a different account.
//
// Body fields are all optional; only the provided fields are
// updated. Field types + lengths are validated and any unknown
// fields are silently dropped (consistent with notification-prefs).

interface ProfileUpsertBody {
  full_name?: unknown
  phone?: unknown
  avatar_url?: unknown
  date_of_birth?: unknown
  gender?: unknown
  bio?: unknown
  school?: unknown
  major?: unknown
  graduation_year?: unknown
  has_accessibility_needs?: unknown
  accessibility_profile?: unknown
  waive_caregiver_fee?: unknown
}

const ALLOWED_GENDERS = ['male', 'female', 'nonbinary', 'other', 'prefer_not_to_say'] as const

usersRouter.post(
  '/me/profile',
  validateJwt,
  async (req: Request, res: Response) => {
    const userId = res.locals['userId'] as string
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
      return
    }

    const body = (req.body ?? {}) as ProfileUpsertBody
    const updates: Record<string, unknown> = {}

    if (typeof body.full_name === 'string') {
      const trimmed = body.full_name.trim()
      if (trimmed.length < 1 || trimmed.length > 200) {
        res.status(400).json({ error: { code: 'INVALID_NAME', message: 'full_name must be 1–200 characters' } })
        return
      }
      updates['full_name'] = trimmed
    }
    if (body.phone !== undefined) {
      updates['phone'] = typeof body.phone === 'string' ? body.phone.slice(0, 50) : null
    }
    if (body.avatar_url !== undefined) {
      updates['avatar_url'] = typeof body.avatar_url === 'string' ? body.avatar_url.slice(0, 1000) : null
    }
    if (body.date_of_birth !== undefined) {
      if (body.date_of_birth === null) {
        updates['date_of_birth'] = null
      } else if (typeof body.date_of_birth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date_of_birth)) {
        updates['date_of_birth'] = body.date_of_birth
      } else {
        res.status(400).json({ error: { code: 'INVALID_DOB', message: 'date_of_birth must be YYYY-MM-DD or null' } })
        return
      }
    }
    if (body.gender !== undefined) {
      if (body.gender === null || (typeof body.gender === 'string' && (ALLOWED_GENDERS as readonly string[]).includes(body.gender))) {
        updates['gender'] = body.gender
      } else {
        res.status(400).json({
          error: { code: 'INVALID_GENDER', message: 'gender must be one of: ' + ALLOWED_GENDERS.join(', ') },
        })
        return
      }
    }
    if (body.bio !== undefined) {
      updates['bio'] = typeof body.bio === 'string' ? body.bio.slice(0, 500) : null
    }
    if (body.school !== undefined) {
      updates['school'] = typeof body.school === 'string' ? body.school.slice(0, 200) : null
    }
    if (body.major !== undefined) {
      updates['major'] = typeof body.major === 'string' ? body.major.slice(0, 200) : null
    }
    if (body.graduation_year !== undefined) {
      if (typeof body.graduation_year === 'number' && Number.isFinite(body.graduation_year)) {
        updates['graduation_year'] = Math.max(1900, Math.min(2100, Math.floor(body.graduation_year)))
      } else {
        updates['graduation_year'] = null
      }
    }
    if (typeof body.has_accessibility_needs === 'boolean') {
      updates['has_accessibility_needs'] = body.has_accessibility_needs
    }
    if (body.accessibility_profile !== undefined
      && body.accessibility_profile !== null
      && typeof body.accessibility_profile === 'object'
      && !Array.isArray(body.accessibility_profile)) {
      updates['accessibility_profile'] = body.accessibility_profile
    }
    if (typeof body.waive_caregiver_fee === 'boolean') {
      updates['waive_caregiver_fee'] = body.waive_caregiver_fee
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: { code: 'EMPTY_BODY', message: 'No valid profile fields in body' } })
      return
    }

    try {
      // Does the row already exist? Determines INSERT vs UPDATE.
      const { data: existing, error: readErr } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', userId)
        .maybeSingle()
      if (readErr) {
        console.error(`[users/me/profile POST] read failed: ${readErr.message}`)
        res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not load profile' } })
        return
      }

      if (existing) {
        const { data: updated, error } = await supabaseAdmin
          .from('users')
          .update(updates as never)
          .eq('id', userId)
          .select('*')
          .single()
        if (error || !updated) {
          console.error(`[users/me/profile POST] update failed: ${error?.message ?? 'no row'}`)
          res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not save profile' } })
          return
        }
        res.status(200).json({ ok: true, profile: updated })
        return
      }

      // INSERT path — resolve email from auth.users (never client).
      const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId)
      const email = authUser?.user?.email
      if (authErr || !email) {
        console.error(`[users/me/profile POST] auth lookup failed: ${authErr?.message ?? 'no email'}`)
        res.status(500).json({
          error: { code: 'AUTH_LOOKUP_FAILED', message: 'Could not resolve email for this user' },
        })
        return
      }
      const insertRow = { id: userId, email, ...updates }
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('users')
        .insert(insertRow as never)
        .select('*')
        .single()
      if (insertErr || !inserted) {
        console.error(`[users/me/profile POST] insert failed: ${insertErr?.message ?? 'no row'}`)
        res.status(500).json({ error: { code: 'DB_ERROR', message: 'Could not create profile' } })
        return
      }
      res.status(200).json({ ok: true, profile: inserted })
    } catch (err) {
      console.error('[users/me/profile POST] unexpected:', err)
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Profile save failed' } })
    }
  },
)

// ── POST /api/users/me/location (Slice 1.11) ─────────────────────────────
//
// Per-user GPS ping. iOS + web call this on app foreground (and after
// a notification tap, since tapping brings the app to foreground).
// Client-side throttled to ~1/5 min so the row's write rate stays
// sane even for chatty users.
//
// Privacy note: continuous foreground GPS collection — Tarun's
// product call 2026-05-18. Disclose in /privacy before rolling
// out to real users (build guard added separately).
interface LocationPingBody {
  lat?: unknown
  lng?: unknown
}

usersRouter.post(
  '/me/location',
  validateJwt,
  async (req: Request, res: Response) => {
    const userId = res.locals['userId'] as string
    const b = req.body as LocationPingBody
    const lat = typeof b.lat === 'number' ? b.lat : NaN
    const lng = typeof b.lng === 'number' ? b.lng : NaN
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({
        error: { code: 'INVALID_COORDS', message: 'lat + lng must be finite numbers' },
      })
      return
    }
    // Sanity-check the coord is on Earth — a buggy client sending
    // (0, 0) or out-of-range values shouldn't pollute the data.
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({
        error: { code: 'COORDS_OUT_OF_RANGE', message: 'lat in [-90, 90], lng in [-180, 180]' },
      })
      return
    }
    try {
      const nowIso = new Date().toISOString()
      const { data: updated, error } = await supabaseAdmin
        .from('users')
        .update({
          last_known_lat: lat,
          last_known_lng: lng,
          last_known_at: nowIso,
        })
        .eq('id', userId)
        .select('is_driver')
        .maybeSingle()
      if (error) throw error

      // 2026-05-18 fix — a user who IS a driver shares the same physical
      // body as the driver. When they ping their generic location (any
      // foreground), mirror it into `driver_locations` so the matcher's
      // freshness gate stays current too. WITHOUT this, a driver who's
      // been toggled Online but isn't on DriverHomePage (e.g. browsing
      // Profile / Wallet / Inbox) goes stale to the matcher within 5 min
      // even though the app is clearly still in their hand.
      //
      // We preserve is_online state: if the driver had toggled offline,
      // we don't flip them back on (their explicit choice wins). If
      // they were online, we keep them online + refresh recorded_at.
      // If they have no driver_locations row at all (never went online),
      // we leave it absent — going online is an explicit action elsewhere.
      if (updated?.is_driver === true) {
        const { data: existing } = await supabaseAdmin
          .from('driver_locations')
          .select('is_online')
          .eq('user_id', userId)
          .maybeSingle()
        if (existing) {
          await supabaseAdmin
            .from('driver_locations')
            .update({
              // PostGIS accepts GeoJSON via supabase-js — same shape
              // the iOS DriverHomePage upsert uses (see GeoJSONPoint
              // in ios/Tago/Models/DriverLocationDTO.swift).
              location: { type: 'Point', coordinates: [lng, lat] } as never,
              recorded_at: nowIso,
            })
            .eq('user_id', userId)
        }
      }

      res.status(204).end()
    } catch (err) {
      console.error('[users/me/location POST] update failed:', err)
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Location save failed' } })
    }
  },
)

// ── GET /api/users/:id/public-profile (v1.2 F18.1) ──────────────────────
//
// Canonical "view someone else's profile" endpoint. Any signed-in user
// can read any other user's public-safe fields. Private fields (phone,
// email, stripe_*, wallet_balance, push_tokens) are NEVER returned. The
// companion vehicle object is included only when the subject is a
// driver AND has an active vehicle row. Plate is REDACTED to last 4
// chars to match the F18 design decision (Uber-style); full plate
// stays in the DB for support purposes but is never sent over this
// endpoint.
//
// Cherry-picked 2026-05-24 from v1.2-wip — closes the "profile preview
// shows only name + avatar" gap noted in today's session (iOS
// PublicProfileEndpoint was hitting a non-existent /api/users/:id/public-profile
// and getting 404, then falling back to whatever .partial(...) was
// already in hand).
usersRouter.get(
  '/:id/public-profile',
  validateJwt,
  async (req: Request, res: Response) => {
    const viewerId = res.locals['userId'] as string
    if (!viewerId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } })
      return
    }
    const rawSubjectId = req.params['id']
    const subjectId = typeof rawSubjectId === 'string' ? rawSubjectId : ''
    if (!subjectId || !/^[0-9a-f-]{36}$/i.test(subjectId)) {
      res.status(400).json({ error: { code: 'INVALID_ID', message: 'User id must be a UUID' } })
      return
    }

    try {
      const { data: rawUser, error } = await supabaseAdmin
        .from('users')
        .select(
          'id, full_name, avatar_url, is_driver, rating_avg, rating_count, '
          + 'bio, gender, school, major, graduation_year, '
          + 'has_accessibility_needs, accessibility_profile, '
          + 'created_at, waive_caregiver_fee' as never,
        )
        .eq('id', subjectId)
        .single()
      if (error || !rawUser) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } })
        return
      }
      type UserRow = {
        id: string
        full_name: string | null
        avatar_url: string | null
        is_driver: boolean | null
        rating_avg: number | null
        rating_count: number | null
        bio: string | null
        gender: string | null
        school: string | null
        major: string | null
        graduation_year: number | null
        has_accessibility_needs: boolean | null
        accessibility_profile: { needs_wheelchair?: boolean } | null
        created_at: string
        waive_caregiver_fee?: boolean | null
      }
      const user = rawUser as unknown as UserRow

      let vehiclePayload: {
        make: string | null
        model: string | null
        color: string | null
        year: number | null
        plate_last4: string | null
        wheelchair_capable: boolean
        trunk_size: string | null
      } | null = null
      if (user.is_driver === true) {
        const { data: vRaw } = await supabaseAdmin
          .from('vehicles')
          .select('make, model, color, year, plate, wheelchair_capable, trunk_size' as never)
          .eq('user_id', subjectId)
          .eq('is_active', true)
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle()
        type VehicleRow = {
          make: string | null
          model: string | null
          color: string | null
          year: number | null
          plate: string | null
          wheelchair_capable?: boolean | null
          trunk_size?: string | null
        }
        const v = vRaw as unknown as VehicleRow | null
        if (v) {
          const plate = (v.plate ?? '').replace(/\s+/g, '')
          const last4 = plate.length >= 4 ? plate.slice(-4) : (plate || null)
          vehiclePayload = {
            make: v.make,
            model: v.model,
            color: v.color,
            year: v.year,
            plate_last4: last4,
            wheelchair_capable: v.wheelchair_capable === true,
            trunk_size: v.trunk_size ?? null,
          }
        }
      }

      const { count: ridesCompleted } = await supabaseAdmin
        .from('rides')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .or(`rider_id.eq.${subjectId},driver_id.eq.${subjectId}`)

      const needsWheelchair = user.has_accessibility_needs === true
        && user.accessibility_profile?.needs_wheelchair === true

      res.status(200).json({
        id: user.id,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
        is_driver: user.is_driver === true,
        rating_avg: user.rating_avg,
        rating_count: user.rating_count ?? 0,
        rides_completed: ridesCompleted ?? 0,
        bio: user.bio,
        gender: user.gender,
        school: user.school,
        major: user.major,
        graduation_year: user.graduation_year,
        has_accessibility_needs: user.has_accessibility_needs === true,
        needs_wheelchair: needsWheelchair,
        waive_caregiver_fee: user.waive_caregiver_fee === true,
        member_since: user.created_at,
        vehicle: vehiclePayload,
      })
    } catch (err) {
      console.error('[users/:id/public-profile GET] failed:', err)
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Profile fetch failed' } })
    }
  },
)
