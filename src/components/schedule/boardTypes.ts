/** Shared types for ride board components */

export interface Poster {
  id: string
  full_name: string | null
  avatar_url: string | null
  rating_avg: number | null
  is_driver: boolean
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
