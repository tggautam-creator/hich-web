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

ALTER TABLE rider_routines
  ADD COLUMN IF NOT EXISTS origin_address TEXT,
  ADD COLUMN IF NOT EXISTS dest_address TEXT;

COMMENT ON COLUMN driver_routines.origin_address IS
  'v1.3 — human-readable origin address. Populated at insert time '
  'from the client''s Google Places autocomplete result. Nullable '
  'for backwards compat (pre-migration-102 rows + clients that '
  'haven''t been updated yet).';

COMMENT ON COLUMN driver_routines.dest_address IS
  'v1.3 — human-readable destination address. Same population path '
  'as origin_address.';

COMMENT ON COLUMN rider_routines.origin_address IS
  'v1.3 — human-readable origin address. See driver_routines.origin_address.';

COMMENT ON COLUMN rider_routines.dest_address IS
  'v1.3 — human-readable destination address. See driver_routines.dest_address.';
