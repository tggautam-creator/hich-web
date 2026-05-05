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
 *
 * NOTE: Each table requires a `Relationships: never[]` field to satisfy the
 * supabase-js `GenericTable` constraint introduced in v2.x. Without it, the
 * generic resolves `Schema` to `never` and all query builder methods break.
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
  | 'expired'

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
          stripe_account_id: string | null
          stripe_onboarding_complete: boolean
          default_payment_method_id: string | null
          phone_verified: boolean
          date_of_birth: string | null
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          phone?: string | null
          phone_verified?: boolean
          full_name?: string | null
          avatar_url?: string | null
          wallet_balance?: number
          stripe_customer_id?: string | null
          is_driver?: boolean
          rating_avg?: number | null
          rating_count?: number
          home_location?: GeoPoint | null
          stripe_account_id?: string | null
          stripe_onboarding_complete?: boolean
          default_payment_method_id?: string | null
          date_of_birth?: string | null
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
          stripe_account_id?: string | null
          stripe_onboarding_complete?: boolean
          default_payment_method_id?: string | null
          phone_verified?: boolean
          date_of_birth?: string | null
          created_at?: string
        }
        Relationships: never[]
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
          car_photo_url: string | null
          seats_available: number
          fuel_efficiency_mpg: number | null
          is_active: boolean
          body_type: string
          deleted_at: string | null
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
          car_photo_url?: string | null
          seats_available?: number
          fuel_efficiency_mpg?: number | null
          is_active?: boolean
          body_type?: string
          deleted_at?: string | null
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
          car_photo_url?: string
          seats_available?: number
          fuel_efficiency_mpg?: number | null
          is_active?: boolean
          body_type?: string
          deleted_at?: string | null
        }
        Relationships: never[]
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
          is_online: boolean
          snoozed_until: string | null
        }
        Insert: {
          id?: string
          user_id: string
          location: GeoPoint
          heading?: number | null
          speed?: number | null
          recorded_at?: string
          is_online?: boolean
          snoozed_until?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          location?: GeoPoint
          heading?: number | null
          speed?: number | null
          recorded_at?: string
          is_online?: boolean
          snoozed_until?: string | null
        }
        Relationships: never[]
      }

      // ── driver_decline_reasons ──────────────────────────────────────────────
      driver_decline_reasons: {
        Row: {
          id: string
          driver_id: string
          ride_id: string | null
          reason: string
          snooze_minutes: number | null
          created_at: string
        }
        Insert: {
          id?: string
          driver_id: string
          ride_id?: string | null
          reason: string
          snooze_minutes?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          driver_id?: string
          ride_id?: string | null
          reason?: string
          snooze_minutes?: number | null
          created_at?: string
        }
        Relationships: never[]
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
          origin_name: string | null
          destination: GeoPoint | null
          destination_name: string | null
          destination_bearing: number | null
          pickup_point: GeoPoint | null
          pickup_note: string | null
          dropoff_point: GeoPoint | null
          pickup_confirmed: boolean
          dropoff_confirmed: boolean
          fare_cents: number | null     // cents — never floats
          started_at: string | null
          ended_at: string | null
          created_at: string
          schedule_id: string | null
          trip_date: string | null      // ISO date YYYY-MM-DD
          trip_time: string | null      // HH:MM:SS
          driver_destination: GeoPoint | null
          driver_destination_name: string | null
          route_polyline: string | null           // encoded polyline, pickup → destination
          driver_route_polyline: string | null  // encoded polyline, driver origin → driver destination
          payment_status: string | null
          payment_intent_id: string | null
          stripe_fee_cents: number
          reminder_sent: boolean
          reminder_30_sent: boolean
          reminder_15_sent: boolean
          progress_pct: number
          requester_destination: GeoPoint | null
          requester_destination_name: string | null
          requester_note: string | null
          destination_flexible: boolean
          gps_distance_metres: number
          last_gps_lat: number | null
          last_gps_lng: number | null
          last_driver_gps_lat: number | null
          last_driver_gps_lng: number | null
          last_rider_gps_lat: number | null
          last_rider_gps_lng: number | null
          last_driver_ping_at: string | null
          last_rider_ping_at: string | null
          dropoff_reminder_sent: boolean
          auto_ended: boolean
          // Migration 059 — Anytime ride support. `time_flexible`
          // mirrors the parent `ride_schedules.time_flexible` flag so
          // cron paths can branch without joining; `reminder_today_sent`
          // gates the 9 AM "Today's the day" push to fire once per
          // Anytime ride per day.
          time_flexible: boolean
          reminder_today_sent: boolean
        }
        Insert: {
          id?: string
          rider_id: string
          driver_id?: string | null
          vehicle_id?: string | null
          status?: RideStatus
          origin: GeoPoint
          origin_name?: string | null
          destination?: GeoPoint | null
          destination_name?: string | null
          destination_bearing?: number | null
          pickup_point?: GeoPoint | null
          pickup_note?: string | null
          dropoff_point?: GeoPoint | null
          pickup_confirmed?: boolean
          dropoff_confirmed?: boolean
          fare_cents?: number | null
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
          schedule_id?: string | null
          trip_date?: string | null
          trip_time?: string | null
          driver_destination?: GeoPoint | null
          driver_destination_name?: string | null
          route_polyline?: string | null
          driver_route_polyline?: string | null
          payment_status?: string | null
          payment_intent_id?: string | null
          stripe_fee_cents?: number
          reminder_sent?: boolean
          reminder_30_sent?: boolean
          reminder_15_sent?: boolean
          progress_pct?: number
          requester_destination?: GeoPoint | null
          requester_destination_name?: string | null
          requester_note?: string | null
          destination_flexible?: boolean
          gps_distance_metres?: number
          last_gps_lat?: number | null
          last_gps_lng?: number | null
          last_driver_gps_lat?: number | null
          last_driver_gps_lng?: number | null
          last_rider_gps_lat?: number | null
          last_rider_gps_lng?: number | null
          last_driver_ping_at?: string | null
          last_rider_ping_at?: string | null
          dropoff_reminder_sent?: boolean
          auto_ended?: boolean
          time_flexible?: boolean
          reminder_today_sent?: boolean
        }
        Update: {
          id?: string
          rider_id?: string
          driver_id?: string | null
          vehicle_id?: string | null
          status?: RideStatus
          origin?: GeoPoint
          origin_name?: string | null
          destination?: GeoPoint | null
          destination_name?: string | null
          destination_bearing?: number | null
          pickup_point?: GeoPoint | null
          pickup_note?: string | null
          dropoff_point?: GeoPoint | null
          pickup_confirmed?: boolean
          dropoff_confirmed?: boolean
          fare_cents?: number | null
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
          schedule_id?: string | null
          trip_date?: string | null
          trip_time?: string | null
          driver_destination?: GeoPoint | null
          driver_destination_name?: string | null
          route_polyline?: string | null
          driver_route_polyline?: string | null
          payment_status?: string | null
          payment_intent_id?: string | null
          stripe_fee_cents?: number
          reminder_sent?: boolean
          reminder_30_sent?: boolean
          reminder_15_sent?: boolean
          progress_pct?: number
          requester_destination?: GeoPoint | null
          requester_destination_name?: string | null
          requester_note?: string | null
          destination_flexible?: boolean
          gps_distance_metres?: number
          last_gps_lat?: number | null
          last_gps_lng?: number | null
          last_driver_gps_lat?: number | null
          last_driver_gps_lng?: number | null
          last_rider_gps_lat?: number | null
          last_rider_gps_lng?: number | null
          last_driver_ping_at?: string | null
          last_rider_ping_at?: string | null
          dropoff_reminder_sent?: boolean
          auto_ended?: boolean
          time_flexible?: boolean
          reminder_today_sent?: boolean
        }
        Relationships: never[]
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
          payment_intent_id: string | null
          stripe_event_id: string | null
          // Phase 5 — withdrawal tracking. Set by /wallet/withdraw after
          // stripe.transfers.create succeeds; transfer_paid_at is filled
          // by the transfer.paid webhook handler.
          transfer_id: string | null
          transfer_paid_at: string | null
          // Migration 060 — funding-source labels for top-up rows.
          // `pm_brand` = card brand (visa/mastercard/...), `pm_last4`
          // = last 4 of the funding card, `pm_wallet` = "apple_pay" /
          // "google_pay" / "samsung_pay" when tokenized through a
          // wallet. Nil on non-card-funded rows + legacy rows.
          pm_brand: string | null
          pm_last4: string | null
          pm_wallet: string | null
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
          payment_intent_id?: string | null
          stripe_event_id?: string | null
          transfer_id?: string | null
          transfer_paid_at?: string | null
          pm_brand?: string | null
          pm_last4?: string | null
          pm_wallet?: string | null
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
          payment_intent_id?: string | null
          stripe_event_id?: string | null
          transfer_id?: string | null
          transfer_paid_at?: string | null
          pm_brand?: string | null
          pm_last4?: string | null
          pm_wallet?: string | null
        }
        Relationships: never[]
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
          origin_address: string | null
          dest_address: string | null
          route_polyline: string | null
          available_seats: number | null
          end_date: string | null
          note: string | null
          is_active: boolean
          created_at: string
          // Migration 057 — anti-resurrection: dates the user explicitly
          // skipped on this routine via DELETE /api/schedule/:id of a
          // routine-projected ride. The cron projector consults this list
          // before re-creating ride_schedules rows so a deleted date stays
          // deleted forever.
          skip_dates: string[] | null
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
          origin_address?: string | null
          dest_address?: string | null
          route_polyline?: string | null
          available_seats?: number | null
          end_date?: string | null
          note?: string | null
          is_active?: boolean
          created_at?: string
          skip_dates?: string[] | null
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
          origin_address?: string | null
          dest_address?: string | null
          route_polyline?: string | null
          available_seats?: number | null
          end_date?: string | null
          note?: string | null
          is_active?: boolean
          created_at?: string
          skip_dates?: string[] | null
        }
        Relationships: never[]
      }

      // ── messages ────────────────────────────────────────────────────────────
      messages: {
        Row: {
          id: string
          ride_id: string
          sender_id: string
          content: string
          type: string            // 'text' | 'pickup_suggestion' | 'dropoff_suggestion' | 'details_accepted' | 'system'
          meta: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          ride_id: string
          sender_id: string
          content: string
          type?: string
          meta?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          id?: string
          ride_id?: string
          sender_id?: string
          content?: string
          type?: string
          meta?: Record<string, unknown> | null
          created_at?: string
        }
        Relationships: never[]
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
        Relationships: never[]
      }

      // ── ride_schedules ──────────────────────────────────────────────────────
      ride_schedules: {
        Row: {
          id: string
          user_id: string
          mode: 'driver' | 'rider'
          route_name: string
          origin_place_id: string
          origin_address: string
          dest_place_id: string
          dest_address: string
          direction_type: 'one_way' | 'roundtrip'
          trip_date: string             // ISO date YYYY-MM-DD
          time_type: 'departure' | 'arrival'
          trip_time: string             // HH:MM:SS
          time_flexible: boolean
          available_seats: number | null
          note: string | null
          is_notified: boolean
          seats_locked: boolean
          created_at: string
          origin_lat: number | null
          origin_lng: number | null
          dest_lat: number | null
          dest_lng: number | null
        }
        Insert: {
          id?: string
          user_id: string
          mode: 'driver' | 'rider'
          route_name: string
          origin_place_id: string
          origin_address: string
          dest_place_id: string
          dest_address: string
          direction_type?: 'one_way' | 'roundtrip'
          trip_date: string
          time_type?: 'departure' | 'arrival'
          trip_time: string
          time_flexible?: boolean
          available_seats?: number | null
          note?: string | null
          is_notified?: boolean
          seats_locked?: boolean
          created_at?: string
          origin_lat?: number | null
          origin_lng?: number | null
          dest_lat?: number | null
          dest_lng?: number | null
        }
        Update: {
          id?: string
          user_id?: string
          mode?: 'driver' | 'rider'
          route_name?: string
          origin_place_id?: string
          origin_address?: string
          dest_place_id?: string
          dest_address?: string
          direction_type?: 'one_way' | 'roundtrip'
          trip_date?: string
          time_type?: 'departure' | 'arrival'
          trip_time?: string
          time_flexible?: boolean
          available_seats?: number | null
          note?: string | null
          is_notified?: boolean
          seats_locked?: boolean
          created_at?: string
          origin_lat?: number | null
          origin_lng?: number | null
          dest_lat?: number | null
          dest_lng?: number | null
        }
        Relationships: never[]
      }

      // ── notifications ───────────────────────────────────────────────────────
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          body: string
          data: Record<string, unknown>
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          title: string
          body: string
          data?: Record<string, unknown>
          is_read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          title?: string
          body?: string
          data?: Record<string, unknown>
          is_read?: boolean
          created_at?: string
        }
        Relationships: never[]
      }

      // ── ride_offers ─────────────────────────────────────────────────────────
      ride_offers: {
        Row: {
          id: string
          ride_id: string
          driver_id: string
          vehicle_id: string | null
          status: 'pending' | 'selected' | 'standby' | 'released'
          created_at: string
          driver_destination: GeoPoint | null
          driver_destination_name: string | null
          driver_route_polyline: string | null
          overlap_pct: number | null
        }
        Insert: {
          id?: string
          ride_id: string
          driver_id: string
          vehicle_id?: string | null
          status?: 'pending' | 'selected' | 'standby' | 'released'
          created_at?: string
          driver_destination?: GeoPoint | null
          driver_destination_name?: string | null
          driver_route_polyline?: string | null
          overlap_pct?: number | null
        }
        Update: {
          id?: string
          ride_id?: string
          driver_id?: string
          vehicle_id?: string | null
          status?: 'pending' | 'selected' | 'standby' | 'released'
          created_at?: string
          driver_destination?: GeoPoint | null
          driver_destination_name?: string | null
          driver_route_polyline?: string | null
          overlap_pct?: number | null
        }
        Relationships: never[]
      }

      // ── ride_ratings ────────────────────────────────────────────────────────
      ride_ratings: {
        Row: {
          id: string
          ride_id: string
          rater_id: string
          rated_id: string
          stars: number
          tags: string[]
          comment: string | null
          created_at: string
        }
        Insert: {
          id?: string
          ride_id: string
          rater_id: string
          rated_id: string
          stars: number
          tags?: string[]
          comment?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          ride_id?: string
          rater_id?: string
          rated_id?: string
          stars?: number
          tags?: string[]
          comment?: string | null
          created_at?: string
        }
        Relationships: never[]
      }

      // ── location_shares ──────────────────────────────────────────────────────
      location_shares: {
        Row: {
          id: string
          token: string
          ride_id: string
          user_id: string
          expires_at: string
          created_at: string
          // Migration 063 (SAFETY.1) — soft-revoke. When the user
          // taps Stop sharing on EmergencySheet before the 4hr TTL,
          // server writes the timestamp here. The track endpoint
          // returns 410 TOKEN_REVOKED for any subsequent fetch.
          revoked_at: string | null
        }
        Insert: {
          id?: string
          token: string
          ride_id: string
          user_id: string
          expires_at: string
          created_at?: string
          revoked_at?: string | null
        }
        Update: {
          id?: string
          token?: string
          ride_id?: string
          user_id?: string
          expires_at?: string
          created_at?: string
          revoked_at?: string | null
        }
        Relationships: never[]
      }

      // ── rider_locations (Migration 052) ─────────────────────────────────────
      // Per-ride upserted GPS for the rider's pickup-walk position.
      // Driver's pickup map reads from here to bootstrap the rider
      // person glyph immediately on mount; the safety-toolkit track
      // endpoint (SAFETY.1) reads from here as a fallback when
      // `rides.last_rider_gps_lat/lng` is null (pre-active phase).
      // PK on `ride_id` (one row per ride, latest position wins).
      rider_locations: {
        Row: {
          ride_id: string
          location: GeoPoint
          recorded_at: string
        }
        Insert: {
          ride_id: string
          location: GeoPoint
          recorded_at?: string
        }
        Update: {
          ride_id?: string
          location?: GeoPoint
          recorded_at?: string
        }
        Relationships: never[]
      }

      // ── trusted_contacts (Migration 063 — SAFETY.1) ─────────────────────────
      // Per-user list of names + phones the user wants to text in an
      // emergency. Cap of 5 enforced server-side.
      trusted_contacts: {
        Row: {
          id: string
          user_id: string
          name: string
          phone: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          phone: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          phone?: string
          created_at?: string
        }
        Relationships: never[]
      }

      // ── saved_addresses ────────────────────────────────────────────────────
      saved_addresses: {
        Row: {
          id: string
          user_id: string
          label: string
          place_id: string | null
          main_text: string
          secondary_text: string | null
          full_address: string
          lat: number
          lng: number
          is_preset: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          label: string
          place_id?: string | null
          main_text: string
          secondary_text?: string | null
          full_address: string
          lat: number
          lng: number
          is_preset?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          label?: string
          place_id?: string | null
          main_text?: string
          secondary_text?: string | null
          full_address?: string
          lat?: number
          lng?: number
          is_preset?: boolean
          created_at?: string
        }
        Relationships: never[]
      }

      // ── reports ────────────────────────────────────────────────────────────
      reports: {
        Row: {
          id: string
          user_id: string
          ride_id: string | null
          category: string
          description: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          ride_id?: string | null
          category: string
          description: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          ride_id?: string | null
          category?: string
          description?: string
          created_at?: string
        }
        Relationships: never[]
      }

      // ── ghost_refunds ───────────────────────────────────────────────────────
      ghost_refunds: {
        Row: {
          id: string
          ride_id: string
          driver_id: string
          rider_id: string
          amount_cents: number
          payment_intent_id: string
          reminder_sent_at: string | null
          refunded_at: string | null
          stripe_refund_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          ride_id: string
          driver_id: string
          rider_id: string
          amount_cents: number
          payment_intent_id: string
          reminder_sent_at?: string | null
          refunded_at?: string | null
          stripe_refund_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          ride_id?: string
          driver_id?: string
          rider_id?: string
          amount_cents?: number
          payment_intent_id?: string
          reminder_sent_at?: string | null
          refunded_at?: string | null
          stripe_refund_id?: string | null
          created_at?: string
        }
        Relationships: never[]
      }

      // ── payment_nudges ──────────────────────────────────────────────────────
      payment_nudges: {
        Row: {
          id: string
          ride_id: string
          bucket: '24h' | '48h' | '72h'
          sent_at: string
        }
        Insert: {
          id?: string
          ride_id: string
          bucket: '24h' | '48h' | '72h'
          sent_at?: string
        }
        Update: {
          id?: string
          ride_id?: string
          bucket?: '24h' | '48h' | '72h'
          sent_at?: string
        }
        Relationships: never[]
      }

      // ── request_idempotency ─────────────────────────────────────────────────
      request_idempotency: {
        Row: {
          user_id: string
          idempotency_key: string
          endpoint: string
          response_status: number
          response_body: unknown
          created_at: string
        }
        Insert: {
          user_id: string
          idempotency_key: string
          endpoint: string
          response_status: number
          response_body: unknown
          created_at?: string
        }
        Update: {
          user_id?: string
          idempotency_key?: string
          endpoint?: string
          response_status?: number
          response_body?: unknown
          created_at?: string
        }
        Relationships: never[]
      }
    }
    Views: Record<string, never>
    Functions: {
      check_email_exists: {
        Args: { check_email: string }
        Returns: boolean
      }
      nearby_active_drivers: {
        Args: {
          origin_lng: number
          origin_lat: number
          radius_m?: number
          stale_min?: number
        }
        Returns: Array<{ user_id: string }>
      }
      wallet_apply_delta: {
        Args: {
          p_user_id: string
          p_delta_cents: number
          p_type: string
          p_description: string
          p_ride_id?: string | null
          p_payment_intent_id?: string | null
          p_stripe_event_id?: string | null
        }
        Returns: { applied: boolean; balance?: number; error?: string }
      }
      tip_ride: {
        Args: {
          p_ride_id: string
          p_rider_id: string
          p_driver_id: string
          p_tip_cents: number
        }
        Returns: {
          tipped: boolean
          rider_balance?: number
          driver_balance?: number
          error?: string
        }
      }
    }
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
export type RideSchedule   = Database['public']['Tables']['ride_schedules']['Row']
export type RideOffer      = Database['public']['Tables']['ride_offers']['Row']
export type RideRating     = Database['public']['Tables']['ride_ratings']['Row']
export type Notification   = Database['public']['Tables']['notifications']['Row']
export type SavedAddress   = Database['public']['Tables']['saved_addresses']['Row']
