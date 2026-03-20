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
  created_at: string
  poster: Poster | null
  relevance_score?: number
  already_requested?: boolean
  ride_status?: string | null
  ride_id?: string | null
}

export type TabFilter = 'all' | 'drivers' | 'riders'
