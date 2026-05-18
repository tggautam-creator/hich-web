-- 078_smart_search_polylines.sql (2026-05-17)
--
-- (Originally numbered 077 — renamed to 078 to avoid collision with
-- `077_campaigns_and_posters.sql` from a parallel admin work stream.
-- Same fix as 075 vs the original 074 collision two days ago.)
--
-- Phase C Slice C1 of the smart-search rebuild (see
-- `docs/SMART_SEARCH_PLAN.md`). Adds three columns to
-- `ride_schedules` so the new `/board/search` endpoint can match
-- riders against driver routes that PASS THROUGH the rider's
-- origin / destination — not just routes whose endpoints happen
-- to be close.
--
-- Phase B v1's endpoint-distance matching is too crude: a rider in
-- Vacaville (between Davis and SF) can't find a Davis→SF driver
-- because Davis is far from Vacaville. With the polyline + cached
-- coords, we can ask PostGIS / JS "is Vacaville within 5km of the
-- Davis-SF line?" — that's the smart-match win.
--
-- Columns:
--   route_polyline             — Google-encoded polyline string
--                                (~200 chars typical). NULL when
--                                we haven't computed it yet.
--                                Computed by the new
--                                `POST /api/schedule/:id/compute-route`
--                                endpoint right after the schedule
--                                is inserted (Slice C2).
--   route_origin_geo           — PostGIS Point holding the resolved
--                                origin lat/lng. We currently only
--                                store origin_place_id; the geo
--                                copy avoids a Places lookup on
--                                every search.
--   route_destination_geo      — same for destination.
--
-- NULLABILITY:
--   All three are nullable. Older rows (pre-this-migration) and
--   newly-inserted rows that haven't been compute-routed yet show
--   NULL. The search endpoint filters to rows WHERE
--   `route_polyline IS NOT NULL`, so missing rows are simply
--   excluded from smart-match results until backfilled — they
--   still appear in the standard `/board` list view.
--
-- INDEX:
--   Partial index on (trip_date) WHERE route_polyline IS NOT NULL
--   gives smart-search its primary lookup path: "schedules for
--   today that have a polyline." Reduces the planner's work as
--   the table grows.
--
-- Irreversible? No. To roll back, drop the three columns + the
-- index. Idempotent via IF NOT EXISTS.

BEGIN;

-- 1. Encoded polyline string (Google's algorithm, same format
--    DirectionsEndpoint already returns to iOS).
ALTER TABLE public.ride_schedules
  ADD COLUMN IF NOT EXISTS route_polyline TEXT;

-- 2. Cached resolved coords. PostGIS Point so the search endpoint
--    can use ST_DWithin / ST_Distance directly without parsing.
ALTER TABLE public.ride_schedules
  ADD COLUMN IF NOT EXISTS route_origin_geo geometry(Point, 4326);

ALTER TABLE public.ride_schedules
  ADD COLUMN IF NOT EXISTS route_destination_geo geometry(Point, 4326);

-- 3. Partial index for the smart-search hot path: "schedules for
--    a given date that have a polyline." Excludes rows where
--    route_polyline is still NULL so the index stays small.
CREATE INDEX IF NOT EXISTS idx_ride_schedules_searchable
  ON public.ride_schedules (trip_date)
  WHERE route_polyline IS NOT NULL;

-- 4. GiST index on the origin geo for proximity queries (rider's
--    point near driver's start, when the search wants to filter
--    on endpoint distance as a coarse pre-filter before doing
--    expensive polyline-distance work).
CREATE INDEX IF NOT EXISTS idx_ride_schedules_origin_geo
  ON public.ride_schedules USING GIST (route_origin_geo)
  WHERE route_origin_geo IS NOT NULL;

-- Comments
COMMENT ON COLUMN public.ride_schedules.route_polyline IS
  'Google-encoded polyline for the schedule''s posted route, computed by POST /api/schedule/:id/compute-route after the row is inserted. NULL until compute runs; rows with NULL are excluded from /board/search smart-match results (but still show on the standard /board list). See SMART_SEARCH_PLAN.md.';

COMMENT ON COLUMN public.ride_schedules.route_origin_geo IS
  'Cached PostGIS point for the schedule''s origin. Resolved from origin_place_id via Google Geocoding when compute-route runs. Lets /board/search query proximity without a Places lookup per candidate.';

COMMENT ON COLUMN public.ride_schedules.route_destination_geo IS
  'Same as route_origin_geo, for the destination.';

COMMIT;
