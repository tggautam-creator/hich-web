-- V4 F6 A.4 — driver trip origin.
--
-- A `destination_driver_plan` is a driver saying "I'm driving to X". To
-- cross-post it to the ride board (and later to create the actual rides),
-- we need the driver's DEPARTURE point. Migration 120 didn't capture it,
-- so add origin columns here. The destination side comes from
-- `featured_destinations.location` (lat/lng via migration 121).

ALTER TABLE public.destination_driver_plans
  ADD COLUMN IF NOT EXISTS origin_lat      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS origin_lng      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS origin_address  TEXT
    CHECK (origin_address IS NULL OR length(origin_address) <= 300),
  ADD COLUMN IF NOT EXISTS origin_place_id TEXT
    CHECK (origin_place_id IS NULL OR length(origin_place_id) <= 300);
