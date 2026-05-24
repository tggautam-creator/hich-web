-- v1.2 F17 — Top-level `trips` table + segmented split fare.
--
-- BACKGROUND
-- Today a board trip with 3 riders is modelled as 3 separate `rides` rows
-- sharing a `schedule_id`. Pre-F17, every rider gets charged the FULL
-- standalone fare even when 2 of them are sharing fuel + driver-time.
-- Drivers double-bill, riders overpay.
--
-- The fix is a *segment trail*: from t0..t1 these N riders were in the
-- car. A segment opens whenever the set of active riders changes (a
-- /start adds a UUID, a /end removes one). Each segment's cost is split
-- evenly across that segment's active riders. A rider's bill = sum over
-- segments-they-were-in of (segment_cost / active_count) + their own
-- caregiver/companion add-ons.
--
-- WHY A NEW `trips` TABLE
-- A multi-rider trip has no single "owner row" today — there are N rides
-- rows, no shared parent. Hanging segments off `schedule_id OR ride_id`
-- works but is fragile (CHECK constraints, partial unique indexes, half
-- the queries need a UNION). Long-term answer is a `trips` table that
-- is the canonical parent: one row per driver-trip, riders' rides rows
-- point at it via `trip_id`. Future work (admin trip aggregates, driver
-- earnings rollup, multi-rider summary) all hang off `trips` cleanly.
--
-- SCOPE OF THIS MIGRATION
-- - Create `trips`, add `rides.trip_id` (nullable, backfilled in 098).
-- - Create `ride_segments` keyed by trip_id.
-- - Create `ride_rider_shares` keyed by (trip_id, rider_id).
-- - Leave existing endpoints untouched — they keep reading `rides`
--   directly. The server adds a `getOrCreateTripForRide()` helper that
--   creates a trip on demand for any rides row without one (defensive,
--   covers any backfill gap).
--
-- MIGRATION NUMBER
-- main is at 096_ride_divergence_safety. v1.2-wip drafted this as "095"
-- before 095_ride_forensic_columns + 096_ride_divergence_safety landed.
-- Next free slot is 097.

-- ── trips ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trips (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id                   UUID NOT NULL REFERENCES public.users(id),
  schedule_id                 UUID REFERENCES public.ride_schedules(id) ON DELETE SET NULL,
  kind                        TEXT NOT NULL DEFAULT 'instant'
    CHECK (kind IN ('instant', 'board')),
  status                      TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  started_at                  TIMESTAMPTZ,
  ended_at                    TIMESTAMPTZ,
  origin                      GEOGRAPHY(POINT, 4326),
  origin_name                 TEXT,
  destination                 GEOGRAPHY(POINT, 4326),
  destination_name            TEXT,
  route_polyline              TEXT,
  gps_distance_metres         INTEGER NOT NULL DEFAULT 0
    CHECK (gps_distance_metres >= 0),
  gas_cost_cents              INTEGER NOT NULL DEFAULT 0
    CHECK (gas_cost_cents >= 0),
  time_cost_cents             INTEGER NOT NULL DEFAULT 0
    CHECK (time_cost_cents >= 0),
  gas_price_per_gallon_cents  INTEGER,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX trips_driver_active_idx
  ON public.trips (driver_id) WHERE status = 'active';
CREATE INDEX trips_schedule_idx
  ON public.trips (schedule_id) WHERE schedule_id IS NOT NULL;
CREATE INDEX trips_driver_created_idx
  ON public.trips (driver_id, created_at DESC);

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- Driver + any participant rider can SELECT. Writes via service-role.
CREATE POLICY trips_select_participant ON public.trips
  FOR SELECT TO authenticated USING (
    auth.uid() = driver_id
    OR EXISTS (
      SELECT 1 FROM public.rides r
       WHERE r.trip_id = trips.id AND r.rider_id = auth.uid()
    )
  );

COMMENT ON TABLE public.trips IS
  'v1.2 F17 — top-level trip. One row per driver-trip. Instant rides have '
  'kind=instant + schedule_id NULL. Board trips have kind=board + '
  'schedule_id set. A multi-rider board trip has ONE trips row and N '
  'rides rows (one per rider) all referencing it via rides.trip_id.';

COMMENT ON COLUMN public.trips.status IS
  'pending = trip created, driver not yet started. active = driver started '
  '(at least one rider scanned /start). completed = all riders scanned '
  '/end. cancelled = trip aborted before any rider scanned /start.';


-- ── rides.trip_id ──────────────────────────────────────────────────────
-- Nullable for backfill (migration 098 sets it for existing rows).
-- Server-side, every newly-created ride gets a trip_id immediately.
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rides_trip_idx
  ON public.rides (trip_id) WHERE trip_id IS NOT NULL;

COMMENT ON COLUMN public.rides.trip_id IS
  'v1.2 F17 — FK to the parent trip. Nullable transitionally during '
  'backfill (migration 098). All NEW rides get this set immediately by '
  'the server. Future work: enforce NOT NULL once backfill is complete.';


-- ── ride_segments ──────────────────────────────────────────────────────
-- A segment is a continuous stretch during which the set of active
-- riders does not change. Bounded by QR scans.
CREATE TABLE IF NOT EXISTS public.ride_segments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id             UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  segment_index       INTEGER NOT NULL CHECK (segment_index >= 0),
  started_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ,
  distance_meters     INTEGER NOT NULL DEFAULT 0 CHECK (distance_meters >= 0),
  duration_seconds    INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  active_rider_ids    UUID[] NOT NULL DEFAULT '{}',
  gas_cost_cents      INTEGER NOT NULL DEFAULT 0 CHECK (gas_cost_cents >= 0),
  time_cost_cents     INTEGER NOT NULL DEFAULT 0 CHECK (time_cost_cents >= 0),
  UNIQUE (trip_id, segment_index)
);

-- "Open segment for this trip right now" lookup — used on every QR scan
-- to find the segment we need to close.
CREATE INDEX ride_segments_trip_open_idx
  ON public.ride_segments (trip_id) WHERE ended_at IS NULL;

ALTER TABLE public.ride_segments ENABLE ROW LEVEL SECURITY;

-- Trip participants can SELECT.
CREATE POLICY ride_segments_select_participant ON public.ride_segments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.trips t
       WHERE t.id = ride_segments.trip_id
         AND (
           t.driver_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.rides r
              WHERE r.trip_id = t.id AND r.rider_id = auth.uid()
           )
         )
    )
  );

COMMENT ON TABLE public.ride_segments IS
  'v1.2 F17 — per-segment cost breakdown. A segment is a continuous '
  'stretch during which the set of active riders does not change. '
  'Bounded by QR scans (pickup = rider enters, dropoff = rider exits). '
  'Instant single-rider trips degrade to one segment with one active '
  'rider — math matches pre-F17 single-rider fare.';

COMMENT ON COLUMN public.ride_segments.active_rider_ids IS
  'UUIDs of riders in the car during this segment. Length = denominator '
  'for the per-rider cost split. Caregivers + companions do NOT appear '
  'here — they ride on their paying rider''s share.';


-- ── ride_rider_shares ──────────────────────────────────────────────────
-- Per-rider settlement rollup. Filled in at the rider's dropoff scan:
-- base_share = Σ over segments-they-were-in of (segment_cost / active_count)
-- total_cents = max(base_minimum, base_share) + caregiver_share + companion_share
CREATE TABLE IF NOT EXISTS public.ride_rider_shares (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                  UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  ride_id                  UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  rider_id                 UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  driver_id                UUID NOT NULL REFERENCES public.users(id),
  base_share_cents         INTEGER NOT NULL DEFAULT 0 CHECK (base_share_cents >= 0),
  caregiver_share_cents    INTEGER NOT NULL DEFAULT 0 CHECK (caregiver_share_cents >= 0),
  companion_share_cents    INTEGER NOT NULL DEFAULT 0 CHECK (companion_share_cents >= 0),
  total_cents              INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  segments_in_count        INTEGER NOT NULL DEFAULT 0 CHECK (segments_in_count >= 0),
  finalized_at             TIMESTAMPTZ,
  charged_at               TIMESTAMPTZ,
  payment_status           TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'processing', 'failed')),
  payment_intent_id        TEXT,
  UNIQUE (ride_id, rider_id)
);

CREATE INDEX ride_rider_shares_trip_idx
  ON public.ride_rider_shares (trip_id);
CREATE INDEX ride_rider_shares_driver_idx
  ON public.ride_rider_shares (driver_id, finalized_at);
CREATE INDEX ride_rider_shares_rider_idx
  ON public.ride_rider_shares (rider_id, finalized_at);

ALTER TABLE public.ride_rider_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY ride_rider_shares_select_own ON public.ride_rider_shares
  FOR SELECT TO authenticated USING (auth.uid() = rider_id OR auth.uid() = driver_id);

COMMENT ON TABLE public.ride_rider_shares IS
  'v1.2 F17 — per-rider settlement rollup. Charged + driver-Connect-'
  'transferred at THIS rider''s dropoff scan (not at trip end). '
  'total_cents = max(base_minimum, base_share) + caregiver_share + '
  'companion_share. Base minimum applies per-rider.';

COMMENT ON COLUMN public.ride_rider_shares.segments_in_count IS
  'Number of segments this rider was active in. Used by ride summary '
  '"You were in N segments" copy + admin diagnostic.';
