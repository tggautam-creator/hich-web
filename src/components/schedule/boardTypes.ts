/** Shared types for ride board components */

export interface Poster {
  id: string
  full_name: string | null
  avatar_url: string | null
  rating_avg: number | null
  is_driver: boolean
  /**
   * v1.2 F5.2 — mobility-aid signals surfaced on the board card.
   * `has_accessibility_needs` mirrors `users.has_accessibility_needs`
   * (top-level toggle). `needs_wheelchair` is the AND of the top toggle
   * and `users.accessibility_profile.needs_wheelchair`, computed
   * server-side in `/api/schedule/board` so the wire shape stays a
   * simple bool. Both default false / absent on rows from a pre-088
   * server response so legacy clients keep parsing cleanly.
   */
  has_accessibility_needs?: boolean
  needs_wheelchair?: boolean
}

export interface ScheduledRide {
  id: string
  user_id: string
  mode: 'driver' | 'rider'
  route_name: string
  origin_address: string
  dest_address: string
  direction_type: 'one_way' | 'roundtrip'
  trip_date: string
  time_type: 'departure' | 'arrival'
  trip_time: string
  /** When true, the poster is flexible on time — display as "Anytime". */
  time_flexible?: boolean
  available_seats?: number | null
  note?: string | null
  created_at: string
  poster: Poster | null
  relevance_score?: number
  already_requested?: boolean
  ride_status?: string | null
  ride_id?: string | null
  /** v1.2.1 S2 (2026-05-27) — when the VIEWER is a driver who has an
   *  outstanding pending board offer on this rider-post, the server
   *  enriches the ScheduledRide row with the offer id so the card can
   *  render "Offer Sent + Withdraw Offer" instead of the standard
   *  Request flow. Null when the viewer hasn't offered yet OR when
   *  they offered + the offer was accepted (then `ride_id` is set
   *  instead). Verified at server/routes/schedule.ts:544. */
  my_offer_id?: string | null
  // Coordinates stored directly on the schedule row (post-migration 048).
  // Populated for both driver and rider posts so fare preview and "Near me"
  // work everywhere, not just on driver posts that happen to have a routine.
  origin_lat?: number | null
  origin_lng?: number | null
  dest_lat?: number | null
  dest_lng?: number | null
  // Legacy: driver route coords pulled from driver_routines. Kept as a
  // fallback for older posts that pre-date migration 048.
  driver_origin_lat?: number | null
  driver_origin_lng?: number | null
  driver_dest_lat?: number | null
  driver_dest_lng?: number | null
}

export type TabFilter = 'all' | 'drivers' | 'riders'
