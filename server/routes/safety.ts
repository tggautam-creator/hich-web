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
    .select('ride_id, user_id, expires_at')
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

  // Get the ride to find the driver
  const { data: ride } = await supabaseAdmin
    .from('rides')
    .select('driver_id, rider_id')
    .eq('id', share.ride_id)
    .single()

  // Track the driver's location (fall back to share creator if no driver yet)
  const trackUserId = ride?.driver_id ?? share.user_id

  const { data: loc, error: locError } = await supabaseAdmin
    .from('driver_locations')
    .select('location, recorded_at')
    .eq('user_id', trackUserId)
    .single()

  if (locError ?? !loc) {
    res.status(200).json({
      ride_id: share.ride_id,
      expires_at: share.expires_at,
      lat: null,
      lng: null,
      recorded_at: null,
    })
    return
  }

  const coords = (loc.location as { coordinates: [number, number] }).coordinates
  res.status(200).json({
    ride_id: share.ride_id,
    expires_at: share.expires_at,
    lat: coords[1],
    lng: coords[0],
    recorded_at: loc.recorded_at,
  })
})
