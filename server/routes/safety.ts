import { Router } from 'express'
import { randomBytes } from 'crypto'
import { validateJwt } from '../middleware/auth.ts'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

export const safetyRouter = Router()

/**
 * POST /api/safety/share-location
 *
 * Creates a temporary location-sharing token (expires in 4 hours).
 * The token maps to the user's current ride so anyone with the link can see
 * the rider/driver's live location on a public tracking page.
 *
 * Body: { ride_id: string }
 * Returns: { token: string }
 */
safetyRouter.post('/share-location', validateJwt, async (req, res) => {
  const userId = res.locals['userId'] as string
  const { ride_id } = req.body as { ride_id?: string }

  if (!ride_id) {
    res.status(400).json({
      error: { code: 'MISSING_RIDE_ID', message: 'ride_id is required' },
    })
    return
  }

  // Verify ride exists and user is a participant
  const { data: ride, error: rideError } = await supabaseAdmin
    .from('rides')
    .select('id, rider_id, driver_id, status')
    .eq('id', ride_id)
    .single()

  if (rideError ?? !ride) {
    res.status(404).json({
      error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' },
    })
    return
  }

  if (ride.rider_id !== userId && ride.driver_id !== userId) {
    res.status(403).json({
      error: { code: 'NOT_PARTICIPANT', message: 'You are not a participant of this ride' },
    })
    return
  }

  // Generate a secure random token
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()

  // Store the share token
  const { error: insertError } = await supabaseAdmin
    .from('location_shares')
    .insert({
      token,
      ride_id,
      user_id: userId,
      expires_at: expiresAt,
    })

  if (insertError) {
    res.status(500).json({
      error: { code: 'INSERT_FAILED', message: 'Failed to create share link' },
    })
    return
  }

  res.status(201).json({ token })
})

/**
 * GET /api/safety/track/:token
 *
 * Public endpoint — no auth required. Validates the share token,
 * checks expiry, then returns the driver's current GPS location.
 *
 * Returns: { lat, lng, recorded_at, ride_id, expires_at }
 */
safetyRouter.get('/track/:token', async (req, res) => {
  const { token } = req.params as { token: string }

  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    res.status(400).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid token format' },
    })
    return
  }

  // Look up the share token
  const { data: share, error: shareError } = await supabaseAdmin
    .from('location_shares')
    .select('ride_id, user_id, expires_at, revoked_at')
    .eq('token', token)
    .single()

  if (shareError ?? !share) {
    res.status(404).json({
      error: { code: 'TOKEN_NOT_FOUND', message: 'Link not found or expired' },
    })
    return
  }

  if (new Date(share.expires_at) < new Date()) {
    res.status(410).json({
      error: { code: 'TOKEN_EXPIRED', message: 'This tracking link has expired' },
    })
    return
  }

  // SAFETY.1 (2026-04-30) — user can revoke a share early via
  // DELETE /api/safety/share-location/:token. Treat it the same as
  // an expired token so existing TrackPage branches handle the 410
  // without a new state.
  if (share.revoked_at) {
    res.status(410).json({
      error: { code: 'TOKEN_REVOKED', message: 'This tracking link has been turned off' },
    })
    return
  }

  // Pull the ride row + per-party GPS pings. Each party has their
  // own safety toolkit, so the share creator is who we track —
  // rider-shared link → rider's GPS, driver-shared link → driver's
  // GPS. Symmetry matters: a rider sharing for safety wants the
  // friend to see WHERE THE RIDER IS, not where the driver is
  // (those diverge during pickup walk + after drop-off).
  const { data: ride } = await supabaseAdmin
    .from('rides')
    .select('driver_id, rider_id, last_rider_gps_lat, last_rider_gps_lng, last_rider_ping_at, last_driver_gps_lat, last_driver_gps_lng, last_driver_ping_at')
    .eq('id', share.ride_id)
    .single()

  let lat: number | null = null
  let lng: number | null = null
  let recordedAt: string | null = null

  if (ride) {
    const isRiderShare = share.user_id === ride.rider_id
    if (isRiderShare) {
      // Rider GPS sources, in order of recency:
      //   1. `rides.last_rider_gps_lat/lng` — written by
      //      /api/rides/:id/gps-ping during pre-active + active
      //      (post-2026-05-01 patch loosened the active gate).
      //   2. `rider_locations.location` keyed by ride_id — upserted
      //      every 15s by the rider's iOS pickup-page GPS broadcast
      //      loop (see DriverPickupPage+Live.swift::startGPSBroadcast).
      //      Catches the pickup-walk window before status=active.
      lat = ride.last_rider_gps_lat as number | null
      lng = ride.last_rider_gps_lng as number | null
      recordedAt = ride.last_rider_ping_at as string | null
      if (lat == null || lng == null) {
        const { data: rloc } = await supabaseAdmin
          .from('rider_locations')
          .select('location, recorded_at')
          .eq('ride_id', share.ride_id)
          .single()
        if (rloc) {
          const coords = (rloc.location as { coordinates: [number, number] }).coordinates
          lat = coords[1]
          lng = coords[0]
          recordedAt = rloc.recorded_at as string
        }
      }
    } else {
      // Driver GPS sources, in order of recency:
      //   1. `rides.last_driver_gps_lat/lng` — per-ride ping.
      //   2. `driver_locations` keyed by user_id — driver's standalone
      //      GPS broadcast while online (every 30s, used for the
      //      matching pipeline + now for safety-toolkit fallback).
      lat = ride.last_driver_gps_lat as number | null
      lng = ride.last_driver_gps_lng as number | null
      recordedAt = ride.last_driver_ping_at as string | null
      if (lat == null || lng == null) {
        const { data: loc } = await supabaseAdmin
          .from('driver_locations')
          .select('location, recorded_at')
          .eq('user_id', share.user_id)
          .single()
        if (loc) {
          const coords = (loc.location as { coordinates: [number, number] }).coordinates
          lat = coords[1]
          lng = coords[0]
          recordedAt = loc.recorded_at as string
        }
      }
    }
  }

  res.status(200).json({
    ride_id: share.ride_id,
    expires_at: share.expires_at,
    lat,
    lng,
    recorded_at: recordedAt,
  })
})

/**
 * DELETE /api/safety/share-location/:token
 *
 * Revoke a previously-minted share token before its 4-hour TTL.
 * The track endpoint then returns 410 (TOKEN_REVOKED) for any
 * subsequent fetch — recipients see the same expired-link UI.
 *
 * Only the share creator can revoke; RLS isn't sufficient because
 * the row is read by the public track endpoint via the service-role
 * key. We enforce ownership in code.
 *
 * Returns: { revoked: true } on success.
 *
 * SAFETY.1 (2026-04-30).
 */
safetyRouter.delete('/share-location/:token', validateJwt, async (req, res) => {
  const userId = res.locals['userId'] as string
  const { token } = req.params as { token: string }

  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    res.status(400).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid token format' },
    })
    return
  }

  const { data: share, error: shareError } = await supabaseAdmin
    .from('location_shares')
    .select('user_id, revoked_at')
    .eq('token', token)
    .single()

  if (shareError ?? !share) {
    res.status(404).json({
      error: { code: 'TOKEN_NOT_FOUND', message: 'Token not found' },
    })
    return
  }

  if (share.user_id !== userId) {
    res.status(403).json({
      error: { code: 'NOT_OWNER', message: 'You did not create this share link' },
    })
    return
  }

  // Idempotent — re-revoking an already-revoked token is a no-op.
  if (share.revoked_at) {
    res.status(200).json({ revoked: true })
    return
  }

  const { error: updateError } = await supabaseAdmin
    .from('location_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token', token)

  if (updateError) {
    res.status(500).json({
      error: { code: 'UPDATE_FAILED', message: 'Failed to revoke share link' },
    })
    return
  }

  res.status(200).json({ revoked: true })
})

// ── Trusted contacts (SAFETY.1, 2026-04-30) ───────────────────────────────────
//
// Per-user list of people the rider/driver wants to reach in an
// emergency. iOS EmergencySheet's 'Text my trusted contacts' CTA
// pulls this and pre-fills MFMessageComposeViewController with the
// share-location URL so the user doesn't have to pick recipients
// in the moment of crisis. Cap of 5 per user enforced here too —
// migration 063 has no DB constraint so a future bulk-import path
// stays open.

const TRUSTED_CONTACTS_CAP = 5

interface TrustedContactRow {
  id: string
  name: string
  phone: string
  created_at: string
}

/**
 * GET /api/safety/trusted-contacts — list the user's saved contacts,
 * oldest first. Returns: { contacts: TrustedContactRow[] }.
 */
safetyRouter.get('/trusted-contacts', validateJwt, async (_req, res) => {
  const userId = res.locals['userId'] as string

  const { data, error } = await supabaseAdmin
    .from('trusted_contacts')
    .select('id, name, phone, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) {
    res.status(500).json({
      error: { code: 'FETCH_FAILED', message: 'Failed to load trusted contacts' },
    })
    return
  }

  res.status(200).json({ contacts: (data ?? []) as TrustedContactRow[] })
})

/**
 * POST /api/safety/trusted-contacts
 * Body: { name: string, phone: string }
 * Returns: { contact: TrustedContactRow } on success, 4xx on bad input.
 */
safetyRouter.post('/trusted-contacts', validateJwt, async (req, res) => {
  const userId = res.locals['userId'] as string
  const { name, phone } = req.body as { name?: string; phone?: string }

  const trimmedName = (name ?? '').trim()
  const trimmedPhone = (phone ?? '').trim()

  if (!trimmedName || trimmedName.length > 60) {
    res.status(400).json({
      error: { code: 'INVALID_NAME', message: 'Name must be 1-60 characters' },
    })
    return
  }

  if (!trimmedPhone || trimmedPhone.length > 20) {
    res.status(400).json({
      error: { code: 'INVALID_PHONE', message: 'Phone must be a valid number' },
    })
    return
  }

  // Cap check before insert. Race-tolerant by design — two concurrent
  // adds could land 6 rows; UI cap is the front-line guard.
  const { count } = await supabaseAdmin
    .from('trusted_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if ((count ?? 0) >= TRUSTED_CONTACTS_CAP) {
    res.status(409).json({
      error: {
        code: 'LIMIT_REACHED',
        message: `You can save up to ${TRUSTED_CONTACTS_CAP} trusted contacts`,
      },
    })
    return
  }

  const { data, error } = await supabaseAdmin
    .from('trusted_contacts')
    .insert({ user_id: userId, name: trimmedName, phone: trimmedPhone })
    .select('id, name, phone, created_at')
    .single()

  if (error || !data) {
    res.status(500).json({
      error: { code: 'INSERT_FAILED', message: 'Failed to save trusted contact' },
    })
    return
  }

  res.status(201).json({ contact: data as TrustedContactRow })
})

/**
 * DELETE /api/safety/trusted-contacts/:id
 * Returns: { deleted: true } on success.
 */
safetyRouter.delete('/trusted-contacts/:id', validateJwt, async (req, res) => {
  const userId = res.locals['userId'] as string
  const { id } = req.params as { id: string }

  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid contact id' },
    })
    return
  }

  const { error } = await supabaseAdmin
    .from('trusted_contacts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) {
    res.status(500).json({
      error: { code: 'DELETE_FAILED', message: 'Failed to delete trusted contact' },
    })
    return
  }

  res.status(200).json({ deleted: true })
})
