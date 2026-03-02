/**
 * Supabase database types — single source of truth for all table shapes.
 *
 * The top-level `Database` type is passed to `createClient<Database>` so every
 * `.from('table')` call is fully typed (Row, Insert, Update).
 *
 * The Row-type aliases at the bottom are what the rest of the app imports for
 * everyday use — e.g. `import type { User, Ride } from '@/types/database'`.
 *
 * Geometry columns (PostGIS) are returned as GeoJSON by the Supabase JS client.
 */

// ── Shared ────────────────────────────────────────────────────────────────────

export interface GeoPoint {
  type: 'Point'
  coordinates: [longitude: number, latitude: number]
}

export type RideStatus =
  | 'requested'
  | 'accepted'
  | 'coordinating'
  | 'active'
  | 'completed'
  | 'cancelled'

// ── Supabase Database schema ──────────────────────────────────────────────────

export type Database = {
  public: {
    Tables: {

      // ── users ───────────────────────────────────────────────────────────────
      users: {
        Row: {
          id: string
          email: string
          phone: string | null
          full_name: string | null
          avatar_url: string | null
          wallet_balance: number        // cents — never floats
          stripe_customer_id: string | null
          is_driver: boolean
          rating_avg: number | null
          rating_count: number
          home_location: GeoPoint | null
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          phone?: string | null
          full_name?: string | null
          avatar_url?: string | null
          wallet_balance?: number
          stripe_customer_id?: string | null
          is_driver?: boolean
          rating_avg?: number | null
          rating_count?: number
          home_location?: GeoPoint | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          phone?: string | null
          full_name?: string | null
          avatar_url?: string | null
          wallet_balance?: number
          stripe_customer_id?: string | null
          is_driver?: boolean
          rating_avg?: number | null
          rating_count?: number
          home_location?: GeoPoint | null
          created_at?: string
        }
      }

      // ── vehicles ────────────────────────────────────────────────────────────
      vehicles: {
        Row: {
          id: string
          user_id: string
          vin: string
          make: string
          model: string
          year: number
          color: string
          plate: string
          license_plate_photo_url: string
          car_photo_url: string
          seats_available: number
          is_active: boolean
        }
        Insert: {
          id?: string
          user_id: string
          vin: string
          make: string
          model: string
          year: number
          color: string
          plate: string
          license_plate_photo_url: string
          car_photo_url: string
          seats_available?: number
          is_active?: boolean
        }
        Update: {
          id?: string
          user_id?: string
          vin?: string
          make?: string
          model?: string
          year?: number
          color?: string
          plate?: string
          license_plate_photo_url?: string
          car_photo_url?: string
          seats_available?: number
          is_active?: boolean
        }
      }

      // ── driver_locations ────────────────────────────────────────────────────
      driver_locations: {
        Row: {
          id: string
          user_id: string
          location: GeoPoint
          heading: number | null
          speed: number | null
          recorded_at: string
        }
        Insert: {
          id?: string
          user_id: string
          location: GeoPoint
          heading?: number | null
          speed?: number | null
          recorded_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          location?: GeoPoint
          heading?: number | null
          speed?: number | null
          recorded_at?: string
        }
      }

      // ── rides ───────────────────────────────────────────────────────────────
      rides: {
        Row: {
          id: string
          rider_id: string
          driver_id: string | null
          vehicle_id: string | null
          status: RideStatus
          origin: GeoPoint
          destination_bearing: number | null
          pickup_point: GeoPoint | null
          pickup_note: string | null
          dropoff_point: GeoPoint | null
          fare_cents: number | null     // cents — never floats
          started_at: string | null
          ended_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          rider_id: string
          driver_id?: string | null
          vehicle_id?: string | null
          status?: RideStatus
          origin: GeoPoint
          destination_bearing?: number | null
          pickup_point?: GeoPoint | null
          pickup_note?: string | null
          dropoff_point?: GeoPoint | null
          fare_cents?: number | null
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          rider_id?: string
          driver_id?: string | null
          vehicle_id?: string | null
          status?: RideStatus
          origin?: GeoPoint
          destination_bearing?: number | null
          pickup_point?: GeoPoint | null
          pickup_note?: string | null
          dropoff_point?: GeoPoint | null
          fare_cents?: number | null
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
        }
      }

      // ── transactions ────────────────────────────────────────────────────────
      transactions: {
        Row: {
          id: string
          user_id: string
          ride_id: string | null
          type: string
          amount_cents: number          // cents — never floats
          balance_after_cents: number   // snapshot for audit trail
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          ride_id?: string | null
          type: string
          amount_cents: number
          balance_after_cents: number
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          ride_id?: string | null
          type?: string
          amount_cents?: number
          balance_after_cents?: number
          description?: string | null
          created_at?: string
        }
      }

      // ── driver_routines ─────────────────────────────────────────────────────
      driver_routines: {
        Row: {
          id: string
          user_id: string
          route_name: string
          origin: GeoPoint
          destination: GeoPoint
          destination_bearing: number
          direction_type: 'one_way' | 'roundtrip'
          day_of_week: number[]         // 0 = Sun … 6 = Sat
          departure_time: string | null
          arrival_time: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          route_name: string
          origin: GeoPoint
          destination: GeoPoint
          destination_bearing: number
          direction_type?: 'one_way' | 'roundtrip'
          day_of_week: number[]
          departure_time?: string | null
          arrival_time?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          route_name?: string
          origin?: GeoPoint
          destination?: GeoPoint
          destination_bearing?: number
          direction_type?: 'one_way' | 'roundtrip'
          day_of_week?: number[]
          departure_time?: string | null
          arrival_time?: string | null
          is_active?: boolean
          created_at?: string
        }
      }

      // ── messages ────────────────────────────────────────────────────────────
      messages: {
        Row: {
          id: string
          ride_id: string
          sender_id: string
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          ride_id: string
          sender_id: string
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          ride_id?: string
          sender_id?: string
          content?: string
          created_at?: string
        }
      }

      // ── push_tokens ─────────────────────────────────────────────────────────
      push_tokens: {
        Row: {
          id: string
          user_id: string
          token: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          token: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          token?: string
          created_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}

// ── Convenient Row-type aliases ───────────────────────────────────────────────
// Import these in components instead of the verbose Database[...][...]['Row'] path.

export type User           = Database['public']['Tables']['users']['Row']
export type Vehicle        = Database['public']['Tables']['vehicles']['Row']
export type DriverLocation = Database['public']['Tables']['driver_locations']['Row']
export type Ride           = Database['public']['Tables']['rides']['Row']
export type Transaction    = Database['public']['Tables']['transactions']['Row']
export type DriverRoutine  = Database['public']['Tables']['driver_routines']['Row']
export type Message        = Database['public']['Tables']['messages']['Row']
export type PushToken      = Database['public']['Tables']['push_tokens']['Row']
