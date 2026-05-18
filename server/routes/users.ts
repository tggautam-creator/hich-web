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
        .select('push_rides, push_promos, email_marketing, sms_alerts')
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
        .select('push_rides, push_promos, email_marketing, sms_alerts')
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
      const { error } = await supabaseAdmin
        .from('users')
        .update({
          last_known_lat: lat,
          last_known_lng: lng,
          last_known_at: new Date().toISOString(),
        })
        .eq('id', userId)
      if (error) throw error
      res.status(204).end()
    } catch (err) {
      console.error('[users/me/location POST] update failed:', err)
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Location save failed' } })
    }
  },
)
