/**
 * v1.3 Sprint 12 Slice 2b — `GET /api/rides/driver-pending-offer`
 * resume-after-kill helper.
 *
 * Mirrors iOS `DriverPendingOfferEndpoint.swift` + the server route
 * at `server/routes/rides.ts:5681`. Returns the driver's most
 * recent actionable pending offer (status='pending', ride still
 * `requested`, created in the last 5 minutes) — or `null` when
 * nothing's resumable.
 *
 * Complements web's existing notifications-inbox `bootstrapResume`:
 *   - bootstrapResume reads the `notifications` table → re-fires
 *     banners for pushes the driver may have missed
 *   - this endpoint reads `ride_offers` directly → catches the case
 *     where the push never landed (network down at request time)
 *     OR where the driver had already started typing a destination
 *     before killing the PWA (the offer carries `saved_destination_*`)
 *
 * Dedup happens at the call site (RideRequestNotification queues by
 * rideId), so calling both paths on mount is safe.
 */
import { supabase } from '@/lib/supabase'

export interface DriverPendingOffer {
  rideId: string
  offerCreatedAt: string
  riderName: string
  riderAvatarUrl: string
  riderRating: number | null
  riderRatingCount: number
  originName: string
  destination: string
  originLat: number | null
  originLng: number | null
  destinationLat: number | null
  destinationLng: number | null
  estimatedEarningsCents: number
  distanceKm: number | null
  /** Set when the driver had already submitted a destination before
   *  the PWA was killed. Future polish (Sprint 12+) will use this
   *  to skip the suggestion form and jump straight to
   *  DropoffSelectionPage with the destination pre-populated. */
  savedDestinationLat: number | null
  savedDestinationLng: number | null
  savedDestinationName: string | null
}

interface ServerOfferShape {
  ride_id: string
  offer_created_at: string
  rider_name: string
  rider_avatar_url: string
  rider_rating: number | null
  rider_rating_count: number
  origin_name: string
  destination: string
  origin_lat: number | null
  origin_lng: number | null
  destination_lat: number | null
  destination_lng: number | null
  estimated_earnings_cents: number
  distance_km: number | null
  saved_destination_lat: number | null
  saved_destination_lng: number | null
  saved_destination_name: string | null
}

function decode(raw: ServerOfferShape): DriverPendingOffer {
  return {
    rideId: raw.ride_id,
    offerCreatedAt: raw.offer_created_at,
    riderName: raw.rider_name,
    riderAvatarUrl: raw.rider_avatar_url,
    riderRating: raw.rider_rating,
    riderRatingCount: raw.rider_rating_count,
    originName: raw.origin_name,
    destination: raw.destination,
    originLat: raw.origin_lat,
    originLng: raw.origin_lng,
    destinationLat: raw.destination_lat,
    destinationLng: raw.destination_lng,
    estimatedEarningsCents: raw.estimated_earnings_cents,
    distanceKm: raw.distance_km,
    savedDestinationLat: raw.saved_destination_lat,
    savedDestinationLng: raw.saved_destination_lng,
    savedDestinationName: raw.saved_destination_name,
  }
}

/**
 * One-shot fetch. Returns null when:
 *   - no session (caller will retry on auth ready)
 *   - server returns `{ offer: null }` (nothing resumable)
 *   - any error (silent — the regular FCM / inbox poll paths still
 *     cover live offers; this is just the resume-after-kill backstop)
 */
export async function fetchDriverPendingOffer(): Promise<DriverPendingOffer | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null
    const resp = await fetch('/api/rides/driver-pending-offer', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!resp.ok) return null
    const body = (await resp.json()) as { offer: ServerOfferShape | null }
    if (!body.offer) return null
    return decode(body.offer)
  } catch {
    return null
  }
}
