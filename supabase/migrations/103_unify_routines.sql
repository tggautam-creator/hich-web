-- v1.3 Session A — architectural unification of routines.
--
-- Background: migrations 002 created driver_routines, 099 created
-- rider_routines. Both stored the same shape of data (route_name,
-- origin geo, destination geo, day_of_week, departure/arrival time,
-- end_date, polyline) — they differ only by which role uses them.
-- Two tables for one concept is a design smell user-CTO flagged
-- (2026-05-25): "I want architecturally pure results."
--
-- This migration unifies them by adding a `mode` column to
-- driver_routines (effectively renaming the concept to "routines"
-- while keeping the table name for backwards compat) and folding
-- rider_routines into it. Net effect: one table, two modes,
-- one entity type in the application code.
--
-- Lucky timing — rider_routines just shipped (migration 099) and is
-- empty in production, so no real data migration risk. The INSERT
-- below is defensive in case any test rows exist on dev.
--
-- WHAT THIS BREAKS IF YOU DON'T DEPLOY THE CODE CHANGES FIRST:
-- The new `mode` column is NOT NULL with default 'driver'. Any
-- existing query that doesn't filter on `mode` will see ALL rows
-- including rider routines, which would silently surface rider
-- routines as driver routines in legacy code paths. Code changes
-- in Session A (suggestionEngine.ts, ProfileRoutinesSection, etc.)
-- add explicit mode filters. Apply migration only after deploying
-- those changes — or atomically if both land at once.

BEGIN;

-- 1. Add the mode column with backwards-compat default. Idempotent
--    via IF NOT EXISTS.
ALTER TABLE driver_routines
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'driver'
    CHECK (mode IN ('driver', 'rider'));

-- 2-4. Migrate rider_routines (if it still exists). Re-running this
--      after a successful first apply is a no-op because rider_routines
--      gets dropped at the end. Wrap in a DO block so the conditional
--      check is part of the migration itself.
DO $migrate_rider_routines$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rider_routines'
  ) THEN
    -- 2. Migrate any rider_routines rows into driver_routines with
    --    mode='rider'. ON CONFLICT DO NOTHING in case the unique
    --    id constraint matches.
    INSERT INTO driver_routines (
      id, user_id, route_name, origin, destination,
      destination_bearing, direction_type, day_of_week,
      departure_time, arrival_time, is_active, end_date,
      route_polyline, note, origin_address, dest_address, mode,
      created_at
    )
    SELECT
      id, user_id, route_name, origin, destination,
      destination_bearing, direction_type, day_of_week,
      departure_time, arrival_time, is_active, end_date,
      route_polyline, note, origin_address, dest_address, 'rider' AS mode,
      created_at
    FROM rider_routines
    ON CONFLICT (id) DO NOTHING;

    -- 3. Repoint ride_suggestions.rider_routine_id FK from
    --    rider_routines to driver_routines (the unified table).
    --    Wrapped in a conditional because the FK only exists when
    --    migration 100 was applied to this DB.
    IF EXISTS (
      SELECT FROM pg_constraint
      WHERE conname = 'ride_suggestions_rider_routine_id_fkey'
    ) THEN
      ALTER TABLE ride_suggestions
        DROP CONSTRAINT ride_suggestions_rider_routine_id_fkey;
      ALTER TABLE ride_suggestions
        ADD CONSTRAINT ride_suggestions_rider_routine_id_fkey
        FOREIGN KEY (rider_routine_id)
        REFERENCES driver_routines(id) ON DELETE CASCADE;
    END IF;

    -- 4. Drop the rider_routines table.
    DROP TABLE rider_routines CASCADE;
  END IF;
END
$migrate_rider_routines$;

COMMIT;

COMMENT ON COLUMN driver_routines.mode IS
  'v1.3 Session A — driver or rider role for this routine. Was a '
  'separate rider_routines table before this migration; unified to '
  'reduce architectural surface (one entity, two modes). The table '
  'NAME stays driver_routines for backwards compat with older '
  'migrations + existing code that hasn''t been refactored to the '
  'generic "routines" name yet. Renaming is a separate cosmetic '
  'cleanup deferred to v1.4.';
