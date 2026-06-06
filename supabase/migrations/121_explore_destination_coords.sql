-- V4 F6 — Explore card redesign support.
--
-- The poster cards need a "0.9 mi away" distance, computed client-side via
-- Haversine from the rider's location. PostGIS `geography` doesn't
-- serialize cleanly over PostgREST, so expose plain numeric lat/lng as
-- STORED generated columns derived from `location`. They recompute
-- whenever `location` is set/updated (admin curation, auto-promote).
--
-- Also backfills the three seed places (migration 120 left `location`
-- NULL), so distance works out of the box on the seeded catalogue.

ALTER TABLE public.featured_destinations
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION
    GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION
    GENERATED ALWAYS AS (ST_X(location::geometry)) STORED;

-- Seed coordinates (lng, lat) — recompute the generated lat/lng columns.
UPDATE public.featured_destinations
   SET location = ST_SetSRID(ST_MakePoint(-119.9772, 38.9399), 4326)::geography
 WHERE slug = 'lake-tahoe' AND location IS NULL;

UPDATE public.featured_destinations
   SET location = ST_SetSRID(ST_MakePoint(-119.5936, 37.7456), 4326)::geography
 WHERE slug = 'yosemite' AND location IS NULL;

UPDATE public.featured_destinations
   SET location = ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography
 WHERE slug = 'san-francisco' AND location IS NULL;
