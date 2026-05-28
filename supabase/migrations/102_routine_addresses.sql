-- v1.3 Suggested Rides polish (2026-05-25, Option C).
--
-- Routines historically only stored origin/destination as PostGIS
-- GEOMETRY points + an encoded polyline. The Suggested Rides detail
-- sheet needs human-readable From/To labels to let users tell which
-- routine matched (esp. when they have multiple). Reverse-geocoding
-- on every render is wasteful and inconsistent across web (no
-- CLGeocoder) vs iOS (CLGeocoder).
--
-- This migration adds the address text columns. Clients populate them
-- at insert/update time (they already have the strings from Google
-- Places autocomplete). A one-shot backfill script reverse-geocodes
-- existing rows.
--
-- Nullable for backwards compat — old code paths that insert without
-- the address columns still work; the iOS detail sheet falls back to
-- CLGeocoder on the lat/lng when the address is missing.

ALTER TABLE driver_routines
  ADD COLUMN IF NOT EXISTS origin_address TEXT,
  ADD COLUMN IF NOT EXISTS dest_address TEXT;

-- 2026-05-24 — rider_routines was dropped by migration 103
-- (unify_routines). Guard the rider_routines ALTER + its COMMENTs in
-- an IF EXISTS block so this migration can be applied out of order
-- (after 103) without erroring on the missing table. For fresh DBs
-- applying 101 → 102 → 103 in order, the table still exists at this
-- point and the ALTER runs normally.
DO $rider_routines_addresses$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rider_routines'
  ) THEN
    ALTER TABLE rider_routines
      ADD COLUMN IF NOT EXISTS origin_address TEXT,
      ADD COLUMN IF NOT EXISTS dest_address TEXT;

    COMMENT ON COLUMN rider_routines.origin_address IS
      'v1.3 — human-readable origin address. See driver_routines.origin_address.';
    COMMENT ON COLUMN rider_routines.dest_address IS
      'v1.3 — human-readable destination address. See driver_routines.dest_address.';
  END IF;
END
$rider_routines_addresses$;

COMMENT ON COLUMN driver_routines.origin_address IS
  'v1.3 — human-readable origin address. Populated at insert time '
  'from the client''s Google Places autocomplete result. Nullable '
  'for backwards compat (pre-migration-102 rows + clients that '
  'haven''t been updated yet).';

COMMENT ON COLUMN driver_routines.dest_address IS
  'v1.3 — human-readable destination address. Same population path '
  'as origin_address.';
