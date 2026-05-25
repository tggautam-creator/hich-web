-- v1.3 — `rider_routines` table.
--
-- BACKGROUND
-- Drivers have had a saved-routines surface since migration 002
-- (recurring patterns: Mon-Fri 5pm Davis -> Sacramento). Riders had no
-- equivalent — riders could only post one-off `ride_schedules`. As a
-- result, the matching engine in `server/routes/schedule.ts` could
-- never propose "this driver matches your weekly Tuesday class
-- commute" — only "this driver matches your one-off post."
--
-- This migration introduces `rider_routines` mirroring `driver_routines`
-- column-for-column (same shape, same RLS, same indexes) so the
-- suggestion engine can cross-join both routine tables symmetrically.
-- Riders save patterns like "Mon-Wed-Fri 9am, dorm -> campus" and the
-- engine materializes Suggested Rides for them automatically, the same
-- way driver routines already drive driver-side matching.
--
-- WHY NOT REUSE `driver_routines` WITH A `mode` COLUMN
-- Considered. Rejected because (a) every existing call site queries
-- `driver_routines` assuming all rows are drivers; adding a `mode`
-- column would silently leak rider routines into those reads unless
-- every site adds a `WHERE mode = 'driver'` filter, (b) RLS policies
-- on `driver_routines` were written without this consideration, (c)
-- the suggestion engine reads BOTH tables anyway — a separate table
-- adds zero query cost and avoids a multi-week audit.
--
-- DELIBERATE DIFFERENCES FROM `driver_routines`
-- - `available_seats` is NOT present. Riders don't have seats; they
--   ARE the seat. Schema-level enforcement.
-- - All other columns mirror exactly so the engine can JOIN/UNION
--   without per-table column maps.

CREATE TABLE IF NOT EXISTS rider_routines (
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
  end_date            date,                  -- optional sunset (e.g. "summer carpool ends Aug 31")
  route_polyline      text,                  -- encoded polyline for corridor-match Phase D
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_routines_user
  ON rider_routines(user_id);

CREATE INDEX IF NOT EXISTS idx_rider_routines_bearing
  ON rider_routines(destination_bearing);

-- Origin GiST index for the suggestion engine's `ST_DWithin` filters
-- when scanning routines against opposite-role posts geo-bounded by
-- the poster's origin.
CREATE INDEX IF NOT EXISTS idx_rider_routines_origin
  ON rider_routines USING GIST (origin);

ALTER TABLE rider_routines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rider_routines_select_own" ON rider_routines;
CREATE POLICY "rider_routines_select_own"
  ON rider_routines FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "rider_routines_insert_own" ON rider_routines;
CREATE POLICY "rider_routines_insert_own"
  ON rider_routines FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "rider_routines_update_own" ON rider_routines;
CREATE POLICY "rider_routines_update_own"
  ON rider_routines FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "rider_routines_delete_own" ON rider_routines;
CREATE POLICY "rider_routines_delete_own"
  ON rider_routines FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE rider_routines IS
  'v1.3 — recurring rider patterns. Mirrors driver_routines column-for-'
  'column except available_seats (riders ARE the seat). Drives the '
  'Suggested Rides engine''s ability to match riders to drivers on '
  'lifestyle patterns, not just one-off posted schedules.';
