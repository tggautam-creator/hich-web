-- v1.3 (2026-05-25 CTO review) — track which API produced the polyline.
--
-- Background: as of Phase B.7, iOS computes route_polyline on-device via
-- Apple MapKit (free) and uploads via POST /api/directions/validate-polyline.
-- If MapKit fails (no route in region, offline, etc.) the server falls
-- back to Google Routes. Web posts always go through Google Routes via
-- the legacy /compute-route path. We want telemetry on the split so we
-- can track:
--   - cost: every 'google_routes' row is ~$0.005 we paid
--   - coverage: high 'google_routes' rate = MapKit isn't covering our
--     user base well (rural, off-network, etc.) and we should investigate
--   - backfill provenance: NULL means pre-fix legacy row (no polyline),
--     to be populated by the polyline-backfill script
--
-- Values:
--   'apple_mapkit' — iOS computed via MKDirections, server validated
--   'google_routes' — server fell back to Google Routes (either iOS
--                     fallback OR web /compute-route path OR backfill)
--   NULL — legacy row with no polyline (or polyline computed before
--          this column existed). Backfill script sets to 'google_routes'.
--
-- Both columns nullable + no CHECK constraint so the engine never blocks
-- on missing telemetry.

ALTER TABLE public.ride_schedules
  ADD COLUMN IF NOT EXISTS polyline_source TEXT;

ALTER TABLE public.driver_routines
  ADD COLUMN IF NOT EXISTS polyline_source TEXT;

COMMENT ON COLUMN public.ride_schedules.polyline_source IS
  'Origin of route_polyline. apple_mapkit | google_routes | NULL (legacy).';
COMMENT ON COLUMN public.driver_routines.polyline_source IS
  'Origin of route_polyline. apple_mapkit | google_routes | NULL (legacy).';
