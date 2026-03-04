-- Migration 002 — vehicles, driver_locations, rides, transactions, driver_routines
-- Run AFTER 001_users_table.sql.
-- Safe to re-run: tables/indexes use IF NOT EXISTS; policies use DROP IF EXISTS + CREATE.

-- ── vehicles ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vin                     text        NOT NULL,
  make                    text        NOT NULL,
  model                   text        NOT NULL,
  year                    integer     NOT NULL,
  color                   text        NOT NULL,
  plate                   text        NOT NULL,
  license_plate_photo_url text,                  -- optional; NULL allowed
  car_photo_url           text,                  -- optional; NULL allowed
  seats_available         integer     NOT NULL DEFAULT 4,
  is_active               boolean     NOT NULL DEFAULT true
);

-- Make photo columns nullable on existing deployments (photos are optional for MVP).
-- Safe to re-run: DROP NOT NULL is a no-op when the column is already nullable.
ALTER TABLE vehicles ALTER COLUMN license_plate_photo_url DROP NOT NULL;
ALTER TABLE vehicles ALTER COLUMN car_photo_url           DROP NOT NULL;

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicles_select_own" ON vehicles;
CREATE POLICY "vehicles_select_own"
  ON vehicles FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "vehicles_insert_own" ON vehicles;
CREATE POLICY "vehicles_insert_own"
  ON vehicles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "vehicles_update_own" ON vehicles;
CREATE POLICY "vehicles_update_own"
  ON vehicles FOR UPDATE
  USING (auth.uid() = user_id);

-- ── driver_locations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_locations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location    GEOMETRY(Point, 4326) NOT NULL,
  heading     numeric,
  speed       numeric,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- PostGIS spatial index — critical for ST_DWithin radius queries (Stage 2 matching)
CREATE INDEX IF NOT EXISTS idx_driver_locations_geom
  ON driver_locations USING GIST(location);

-- Index for fast per-driver lookups (most recent location)
CREATE INDEX IF NOT EXISTS idx_driver_locations_user_recorded
  ON driver_locations(user_id, recorded_at DESC);

ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_locations_insert_own" ON driver_locations;
CREATE POLICY "driver_locations_insert_own"
  ON driver_locations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- All authenticated users can read driver locations (needed for rider map view)
DROP POLICY IF EXISTS "driver_locations_select_authenticated" ON driver_locations;
CREATE POLICY "driver_locations_select_authenticated"
  ON driver_locations FOR SELECT
  USING (auth.role() = 'authenticated');

-- ── rides ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rides (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id            uuid        NOT NULL REFERENCES users(id),
  driver_id           uuid        REFERENCES users(id),
  vehicle_id          uuid        REFERENCES vehicles(id),
  status              text        NOT NULL DEFAULT 'requested'
                        CHECK (status IN (
                          'requested', 'accepted', 'coordinating',
                          'active', 'completed', 'cancelled'
                        )),
  origin              GEOMETRY(Point, 4326) NOT NULL,
  destination_bearing numeric,
  pickup_point        GEOMETRY(Point, 4326),
  pickup_note         text,
  dropoff_point       GEOMETRY(Point, 4326),
  fare_cents          integer,               -- always in cents
  started_at          timestamptz,
  ended_at            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rides_rider   ON rides(rider_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver  ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_status  ON rides(status);
CREATE INDEX IF NOT EXISTS idx_rides_origin  ON rides USING GIST(origin);

ALTER TABLE rides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rides_select_participant" ON rides;
CREATE POLICY "rides_select_participant"
  ON rides FOR SELECT
  USING (auth.uid() = rider_id OR auth.uid() = driver_id);

DROP POLICY IF EXISTS "rides_insert_rider" ON rides;
CREATE POLICY "rides_insert_rider"
  ON rides FOR INSERT
  WITH CHECK (auth.uid() = rider_id);

DROP POLICY IF EXISTS "rides_update_participant" ON rides;
CREATE POLICY "rides_update_participant"
  ON rides FOR UPDATE
  USING (auth.uid() = rider_id OR auth.uid() = driver_id);

-- ── transactions ──────────────────────────────────────────────────────────────
-- Debit + credit must always be written in a single BEGIN/COMMIT block.
-- Never insert individual rows from application code.
CREATE TABLE IF NOT EXISTS transactions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id),
  ride_id             uuid        REFERENCES rides(id),
  type                text        NOT NULL,  -- 'fare_debit' | 'fare_credit' | 'topup' | 'refund'
  amount_cents        integer     NOT NULL,  -- always in cents
  balance_after_cents integer     NOT NULL,  -- snapshot for audit trail
  description         text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user  ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_ride  ON transactions(ride_id);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transactions_select_own" ON transactions;
CREATE POLICY "transactions_select_own"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id);

-- ── driver_routines ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_routines (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_name          text        NOT NULL,
  origin              GEOMETRY(Point, 4326) NOT NULL,
  destination         GEOMETRY(Point, 4326) NOT NULL,
  destination_bearing numeric     NOT NULL,
  direction_type      text        NOT NULL DEFAULT 'one_way'
                        CHECK (direction_type IN ('one_way', 'roundtrip')),
  day_of_week         integer[]   NOT NULL,  -- 0=Sun … 6=Sat
  departure_time      time,
  arrival_time        time,
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_routines_user
  ON driver_routines(user_id);

CREATE INDEX IF NOT EXISTS idx_driver_routines_bearing
  ON driver_routines(destination_bearing);

ALTER TABLE driver_routines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_routines_select_own" ON driver_routines;
CREATE POLICY "driver_routines_select_own"
  ON driver_routines FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "driver_routines_insert_own" ON driver_routines;
CREATE POLICY "driver_routines_insert_own"
  ON driver_routines FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "driver_routines_update_own" ON driver_routines;
CREATE POLICY "driver_routines_update_own"
  ON driver_routines FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "driver_routines_delete_own" ON driver_routines;
CREATE POLICY "driver_routines_delete_own"
  ON driver_routines FOR DELETE
  USING (auth.uid() = user_id);
