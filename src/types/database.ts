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

/**
 * Closed enum mirroring the `users.gender` CHECK constraint (mig 087).
 * `prefer_not_to_say` is a first-class option, not an "other" — gender
 * is treated as a self-declared social signal, not a categorization.
 */
export type Gender = 'male' | 'female' | 'non_binary' | 'prefer_not_to_say'

/**
 * JSONB shape stored in `users.accessibility_profile` (mig 088).
 * When `users.has_accessibility_needs` is false the blob is ignored
 * downstream; the values are still persisted so toggling the flag
 * back on restores the user's prior selections.
 */
export interface AccessibilityProfile {
  needs_wheelchair?: boolean
  needs_caregiver?: boolean
  other_notes?: string | null
}

/** Vehicle trunk size enum (mig 090). Driver-declared. */
export type TrunkSize = 'small' | 'medium' | 'large'

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
          onboarding_completed: boolean
          is_admin: boolean
          last_active_at: string | null
          /** Slice 1.11 — most recent GPS upload from POST /api/users/me/location. Throttled 1/5min. NULL until first foreground ping. */
          last_known_lat: number | null
          last_known_lng: number | null
          last_known_at: string | null
          suspended_at: string | null
          suspended_reason: string | null
          /** v1.2 F1 — mig 087, social profile fields. All optional. */
          bio: string | null
          gender: Gender | null
          school: string | null
          major: string | null
          graduation_year: number | null
          /** v1.2 F2 — mig 088. NOT NULL DEFAULT false. */
          has_accessibility_needs: boolean
          /** v1.2 F2 — mig 088. NOT NULL DEFAULT '{}'. */
          accessibility_profile: AccessibilityProfile
          /** v1.2 F14 — mig 092. Driver goodwill opt-out. NOT NULL DEFAULT false. */
          waive_caregiver_fee: boolean
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
          onboarding_completed?: boolean
          is_admin?: boolean
          last_active_at?: string | null
          last_known_lat?: number | null
          last_known_lng?: number | null
          last_known_at?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          bio?: string | null
          gender?: Gender | null
          school?: string | null
          major?: string | null
          graduation_year?: number | null
          has_accessibility_needs?: boolean
          accessibility_profile?: AccessibilityProfile
          waive_caregiver_fee?: boolean
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
          onboarding_completed?: boolean
          is_admin?: boolean
          last_active_at?: string | null
          last_known_lat?: number | null
          last_known_lng?: number | null
          last_known_at?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          bio?: string | null
          gender?: Gender | null
          school?: string | null
          major?: string | null
          graduation_year?: number | null
          has_accessibility_needs?: boolean
          accessibility_profile?: AccessibilityProfile
          waive_caregiver_fee?: boolean
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
          /** v1.2 F4 — mig 090. Driver-declared. NOT NULL DEFAULT false. */
          wheelchair_capable: boolean
          /** v1.2 F4 — mig 090. NULL when wheelchair_capable is false. */
          trunk_size: TrunkSize | null
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
          wheelchair_capable?: boolean
          trunk_size?: TrunkSize | null
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
          wheelchair_capable?: boolean
          trunk_size?: TrunkSize | null
        }
        Relationships: never[]
      }

      // ── caregivers ──────────────────────────────────────────────────────────
      //
      // v1.2 F3 — rider-side caregivers who may accompany the user on
      // rides. Hard-delete model (Tarun direction): destroying a row
      // sets caregiver_id=NULL on past rides + ride_schedules via the
      // ON DELETE SET NULL clause in mig 091. RLS scopes all access
      // to the owning user (auth.uid() = user_id).
      caregivers: {
        Row: {
          id: string
          user_id: string
          /** 1-100 chars, CHECK constraint in mig 089. */
          name: string
          /** ≤50 chars, nullable. e.g. "Mom", "Sister", "Aide". */
          relationship: string | null
          /** E.164 phone, nullable. Client validates. */
          phone: string | null
          /** ≤500 chars, nullable. Free-text note for the rider. */
          notes: string | null
          /** v1.2 F18.5 — mandatory at the UI layer (mig 093), nullable
           *  in the DB for back-compat with pre-093 rows. */
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          relationship?: string | null
          phone?: string | null
          notes?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          relationship?: string | null
          phone?: string | null
          notes?: string | null
          avatar_url?: string | null
          updated_at?: string
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
          /** v1.2 F6.1 — mig 091. Caregiver attached at ride-request
           *  time. ON DELETE SET NULL preserves the ride row when
           *  the rider hard-deletes the caregiver. */
          caregiver_id: string | null
          /** v1.2 F6.1 — mig 091. Server-computed tier fee (300 /
           *  500 / 800 cents) added to rider charge + driver
           *  earnings. NULL when no caregiver attached. */
          caregiver_fare_cents: number | null
          /** v1.3 F17 — mig 097. FK to the parent `trips` row.
           *  Nullable transitionally during the 098 backfill; new
           *  rides get this set immediately by the server. The
           *  `share-details` endpoint 404s when this is null. */
          trip_id: string | null
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
          caregiver_id?: string | null
          caregiver_fare_cents?: number | null
          trip_id?: string | null
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
          caregiver_id?: string | null
          caregiver_fare_cents?: number | null
          trip_id?: string | null
        }
        Relationships: never[]
      }

      // ── trips ───────────────────────────────────────────────────────────────
      // v1.3 F17 (mig 097). Parent of multi-rider trips — one trip row per
      // driver-trip, multiple rides rows point at it via rides.trip_id.
      // Server-derived: created on /start + /end via getOrCreateTripForRide.
      // Web clients READ only via /api/rides/:id/share-details (Sprint 9 S2).
      trips: {
        Row: {
          id: string
          driver_id: string
          schedule_id: string | null
          kind: 'instant' | 'board'
          status: 'pending' | 'active' | 'completed' | 'cancelled'
          started_at: string | null
          ended_at: string | null
          origin: GeoPoint | null
          origin_name: string | null
          destination: GeoPoint | null
          destination_name: string | null
          route_polyline: string | null
          gps_distance_metres: number
          gas_cost_cents: number
          time_cost_cents: number
          gas_price_per_gallon_cents: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          driver_id: string
          schedule_id?: string | null
          kind?: 'instant' | 'board'
          status?: 'pending' | 'active' | 'completed' | 'cancelled'
          started_at?: string | null
          ended_at?: string | null
          origin?: GeoPoint | null
          origin_name?: string | null
          destination?: GeoPoint | null
          destination_name?: string | null
          route_polyline?: string | null
          gps_distance_metres?: number
          gas_cost_cents?: number
          time_cost_cents?: number
          gas_price_per_gallon_cents?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          driver_id?: string
          schedule_id?: string | null
          kind?: 'instant' | 'board'
          status?: 'pending' | 'active' | 'completed' | 'cancelled'
          started_at?: string | null
          ended_at?: string | null
          origin?: GeoPoint | null
          origin_name?: string | null
          destination?: GeoPoint | null
          destination_name?: string | null
          route_polyline?: string | null
          gps_distance_metres?: number
          gas_cost_cents?: number
          time_cost_cents?: number
          gas_price_per_gallon_cents?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: never[]
      }

      // ── ride_segments ──────────────────────────────────────────────────────
      // v1.3 F17 (mig 097). Per-segment cost breakdown. A segment is a
      // continuous stretch during which the set of active riders does not
      // change. Bounded by QR scans.
      ride_segments: {
        Row: {
          id: string
          trip_id: string
          segment_index: number
          started_at: string
          ended_at: string | null
          distance_meters: number
          duration_seconds: number
          active_rider_ids: string[]
          gas_cost_cents: number
          time_cost_cents: number
        }
        Insert: {
          id?: string
          trip_id: string
          segment_index: number
          started_at: string
          ended_at?: string | null
          distance_meters?: number
          duration_seconds?: number
          active_rider_ids?: string[]
          gas_cost_cents?: number
          time_cost_cents?: number
        }
        Update: {
          id?: string
          trip_id?: string
          segment_index?: number
          started_at?: string
          ended_at?: string | null
          distance_meters?: number
          duration_seconds?: number
          active_rider_ids?: string[]
          gas_cost_cents?: number
          time_cost_cents?: number
        }
        Relationships: never[]
      }

      // ── ride_rider_shares ──────────────────────────────────────────────────
      // v1.3 F17 (mig 097). Per-rider settlement rollup. Charged + driver-
      // Connect-transferred at this rider's dropoff scan (not at trip end).
      // total_cents = max(base_minimum, base_share) + caregiver_share + companion_share.
      ride_rider_shares: {
        Row: {
          id: string
          trip_id: string
          ride_id: string
          rider_id: string
          driver_id: string
          base_share_cents: number
          caregiver_share_cents: number
          companion_share_cents: number
          total_cents: number
          segments_in_count: number
          finalized_at: string | null
          charged_at: string | null
          payment_status: 'pending' | 'paid' | 'processing' | 'failed'
          payment_intent_id: string | null
        }
        Insert: {
          id?: string
          trip_id: string
          ride_id: string
          rider_id: string
          driver_id: string
          base_share_cents?: number
          caregiver_share_cents?: number
          companion_share_cents?: number
          total_cents?: number
          segments_in_count?: number
          finalized_at?: string | null
          charged_at?: string | null
          payment_status?: 'pending' | 'paid' | 'processing' | 'failed'
          payment_intent_id?: string | null
        }
        Update: {
          id?: string
          trip_id?: string
          ride_id?: string
          rider_id?: string
          driver_id?: string
          base_share_cents?: number
          caregiver_share_cents?: number
          companion_share_cents?: number
          total_cents?: number
          segments_in_count?: number
          finalized_at?: string | null
          charged_at?: string | null
          payment_status?: 'pending' | 'paid' | 'processing' | 'failed'
          payment_intent_id?: string | null
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
          // Migration 103 (Session A unification) — driver_routines now
          // stores BOTH driver routines AND rider routines via the
          // mode column. Migration 106 dropped the DB default, so
          // every INSERT must specify mode explicitly (failing to do
          // so silently coerced rider routines into driver routines
          // and surfaced riders as driver matches in suggestions).
          mode: 'driver' | 'rider'
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
          mode: 'driver' | 'rider'
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
          mode?: 'driver' | 'rider'
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
          platform: 'ios' | 'android' | 'web' | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          token: string
          platform?: 'ios' | 'android' | 'web' | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          token?: string
          platform?: 'ios' | 'android' | 'web' | null
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
      // Columns added by migrations 072 (board fields), 083 (transit
      // hand-off + estimated_fare_cents). `ride_id` is nullable on
      // rows that originated from `ride_schedules` (board-offer flow)
      // because the ride row only materializes on rider-accept.
      ride_offers: {
        Row: {
          id: string
          ride_id: string | null
          driver_id: string
          vehicle_id: string | null
          status: 'pending' | 'selected' | 'standby' | 'released'
          created_at: string
          driver_destination: GeoPoint | null
          driver_destination_name: string | null
          driver_route_polyline: string | null
          overlap_pct: number | null
          schedule_id: string | null
          proposed_pickup_point: GeoPoint | null
          proposed_dropoff_point: GeoPoint | null
          proposed_pickup_name: string | null
          proposed_dropoff_name: string | null
          proposed_fare_cents: number | null
          proposed_eta_minutes: number | null
          estimated_fare_cents: number | null
          proposed_transit_line_name: string | null
          proposed_transit_walk_minutes: number | null
          proposed_transit_to_dest_minutes: number | null
          proposed_transit_total_minutes: number | null
        }
        Insert: {
          id?: string
          ride_id?: string | null
          driver_id: string
          vehicle_id?: string | null
          status?: 'pending' | 'selected' | 'standby' | 'released'
          created_at?: string
          driver_destination?: GeoPoint | null
          driver_destination_name?: string | null
          driver_route_polyline?: string | null
          overlap_pct?: number | null
          schedule_id?: string | null
          proposed_pickup_point?: GeoPoint | null
          proposed_dropoff_point?: GeoPoint | null
          proposed_pickup_name?: string | null
          proposed_dropoff_name?: string | null
          proposed_fare_cents?: number | null
          proposed_eta_minutes?: number | null
          estimated_fare_cents?: number | null
          proposed_transit_line_name?: string | null
          proposed_transit_walk_minutes?: number | null
          proposed_transit_to_dest_minutes?: number | null
          proposed_transit_total_minutes?: number | null
        }
        Update: {
          id?: string
          ride_id?: string | null
          driver_id?: string
          vehicle_id?: string | null
          status?: 'pending' | 'selected' | 'standby' | 'released'
          created_at?: string
          driver_destination?: GeoPoint | null
          driver_destination_name?: string | null
          driver_route_polyline?: string | null
          overlap_pct?: number | null
          schedule_id?: string | null
          proposed_pickup_point?: GeoPoint | null
          proposed_dropoff_point?: GeoPoint | null
          proposed_pickup_name?: string | null
          proposed_dropoff_name?: string | null
          proposed_fare_cents?: number | null
          proposed_eta_minutes?: number | null
          estimated_fare_cents?: number | null
          proposed_transit_line_name?: string | null
          proposed_transit_walk_minutes?: number | null
          proposed_transit_to_dest_minutes?: number | null
          proposed_transit_total_minutes?: number | null
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

      // ── reports (extended 2026-05-20, mig 086) ───────────────────────────
      // Renamed from the migration-039 shape: user_id → reporter_id,
      // description → body. Added severity / status / metadata / etc.
      // for the admin triage workflow (docs/REPORTS_PLAN.md).
      reports: {
        Row: {
          id: string
          reporter_id: string
          subject_user_id: string | null
          ride_id: string | null
          schedule_id: string | null
          category: string
          severity: 'emergency' | 'urgent' | 'normal' | 'low'
          status: 'open' | 'in_progress' | 'awaiting_user' | 'resolved' | 'closed'
          title: string
          body: string
          requested_refund_cents: number | null
          ride_state_at_report: string | null
          metadata: Record<string, unknown>
          assigned_admin_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          reporter_id: string
          subject_user_id?: string | null
          ride_id?: string | null
          schedule_id?: string | null
          category: string
          severity?: 'emergency' | 'urgent' | 'normal' | 'low'
          status?: 'open' | 'in_progress' | 'awaiting_user' | 'resolved' | 'closed'
          title: string
          body: string
          requested_refund_cents?: number | null
          ride_state_at_report?: string | null
          metadata?: Record<string, unknown>
          assigned_admin_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          reporter_id?: string
          subject_user_id?: string | null
          ride_id?: string | null
          schedule_id?: string | null
          category?: string
          severity?: 'emergency' | 'urgent' | 'normal' | 'low'
          status?: 'open' | 'in_progress' | 'awaiting_user' | 'resolved' | 'closed'
          title?: string
          body?: string
          requested_refund_cents?: number | null
          ride_state_at_report?: string | null
          metadata?: Record<string, unknown>
          assigned_admin_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: never[]
      }

      // ── report_messages (2026-05-20, mig 086) ────────────────────────────
      report_messages: {
        Row: {
          id: string
          report_id: string
          author_id: string
          author_role: 'admin' | 'user'
          body: string
          channel: 'admin_panel' | 'email_inbound' | 'email_outbound' | 'in_app'
          is_internal_note: boolean
          email_message_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          report_id: string
          author_id: string
          author_role: 'admin' | 'user'
          body: string
          channel: 'admin_panel' | 'email_inbound' | 'email_outbound' | 'in_app'
          is_internal_note?: boolean
          email_message_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          report_id?: string
          author_id?: string
          author_role?: 'admin' | 'user'
          body?: string
          channel?: 'admin_panel' | 'email_inbound' | 'email_outbound' | 'in_app'
          is_internal_note?: boolean
          email_message_id?: string | null
          created_at?: string
        }
        Relationships: never[]
      }

      // ── report_attachments (2026-05-20, mig 086) ─────────────────────────
      report_attachments: {
        Row: {
          id: string
          report_id: string
          storage_path: string
          mime_type: string | null
          file_size: number | null
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          report_id: string
          storage_path: string
          mime_type?: string | null
          file_size?: number | null
          uploaded_by: string
          created_at?: string
        }
        Update: {
          id?: string
          report_id?: string
          storage_path?: string
          mime_type?: string | null
          file_size?: number | null
          uploaded_by?: string
          created_at?: string
        }
        Relationships: never[]
      }

      // ── report_audit_log (2026-05-20, mig 086) ───────────────────────────
      report_audit_log: {
        Row: {
          id: string
          report_id: string
          admin_id: string
          action: string
          payload: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          report_id: string
          admin_id: string
          action: string
          payload?: Record<string, unknown>
          created_at?: string
        }
        Update: {
          id?: string
          report_id?: string
          admin_id?: string
          action?: string
          payload?: Record<string, unknown>
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

      // ── campaigns ───────────────────────────────────────────────────────────
      campaigns: {
        Row: {
          id: string
          slug: string
          audience: Record<string, unknown>
          title: string
          body: string
          poster_url: string | null
          /** Slice 1.6 — optional URL the poster opens when clicked (email anchor wrap + detail-page click target). */
          poster_link_url: string | null
          recipient_count: number
          push_sent_count: number
          sent_by: string
          sent_at: string
          recalled_at: string | null
          recalled_reason: string | null
          recalled_by: string | null
          channel: 'push' | 'email'
          email_from: string | null
          /** Slice 2026-05-19 (migration 084) — emails that failed
           * during the original send (Resend rate-limit, bounce, etc).
           * Drives the "Retry failed (N)" button. Rewritten after every
           * retry with the still-failed set. */
          failed_emails: string[]
          created_at: string
        }
        Insert: {
          id?: string
          slug: string
          audience: Record<string, unknown>
          title: string
          body: string
          poster_url?: string | null
          poster_link_url?: string | null
          recipient_count?: number
          push_sent_count?: number
          sent_by: string
          sent_at?: string
          recalled_at?: string | null
          recalled_reason?: string | null
          recalled_by?: string | null
          channel?: 'push' | 'email'
          email_from?: string | null
          failed_emails?: string[]
          created_at?: string
        }
        Update: {
          id?: string
          slug?: string
          audience?: Record<string, unknown>
          title?: string
          body?: string
          poster_url?: string | null
          poster_link_url?: string | null
          recipient_count?: number
          push_sent_count?: number
          sent_by?: string
          sent_at?: string
          recalled_at?: string | null
          recalled_reason?: string | null
          recalled_by?: string | null
          channel?: 'push' | 'email'
          email_from?: string | null
          failed_emails?: string[]
          created_at?: string
        }
        Relationships: never[]
      }

      // ── admin_audit_log ─────────────────────────────────────────────────────
      admin_audit_log: {
        Row: {
          id: string
          admin_id: string
          target_user_id: string | null
          action: string
          payload: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          admin_id: string
          target_user_id?: string | null
          action: string
          payload?: Record<string, unknown>
          created_at?: string
        }
        Update: {
          id?: string
          admin_id?: string
          target_user_id?: string | null
          action?: string
          payload?: Record<string, unknown>
          created_at?: string
        }
        Relationships: never[]
      }

      // ── api_usage_daily (migration 085, 2026-05-19) ─────────────────────────
      api_usage_daily: {
        Row: {
          service: string
          date: string
          count: number
        }
        Insert: {
          service: string
          date: string
          count?: number
        }
        Update: {
          service?: string
          date?: string
          count?: number
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
export type Caregiver      = Database['public']['Tables']['caregivers']['Row']
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
