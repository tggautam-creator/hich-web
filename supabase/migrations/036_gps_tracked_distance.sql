-- Track actual GPS distance during rides for accurate fare calculation.
-- gps_distance_metres accumulates haversine distance between consecutive GPS pings.
-- last_gps_lat/lng store the most recent ping so the next ping can compute delta.

ALTER TABLE rides ADD COLUMN gps_distance_metres double precision NOT NULL DEFAULT 0;
ALTER TABLE rides ADD COLUMN last_gps_lat double precision;
ALTER TABLE rides ADD COLUMN last_gps_lng double precision;
