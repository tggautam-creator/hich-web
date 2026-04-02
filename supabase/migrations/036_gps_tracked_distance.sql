-- Track actual GPS distance during rides for accurate fare calculation.
-- gps_distance_metres accumulates haversine distance between consecutive GPS pings.
-- last_gps_lat/lng store the most recent ping so the next ping can compute delta.

ALTER TABLE rides ADD COLUMN gps_distance_metres double precision NOT NULL DEFAULT 0;
ALTER TABLE rides ADD COLUMN last_gps_lat double precision;
ALTER TABLE rides ADD COLUMN last_gps_lng double precision;

-- Separate driver/rider GPS for divergence detection (forgotten QR scan safety net).
-- When these two positions diverge by >500m for 2+ min, the system auto-ends the ride.
ALTER TABLE rides ADD COLUMN last_driver_gps_lat double precision;
ALTER TABLE rides ADD COLUMN last_driver_gps_lng double precision;
ALTER TABLE rides ADD COLUMN last_rider_gps_lat double precision;
ALTER TABLE rides ADD COLUMN last_rider_gps_lng double precision;
ALTER TABLE rides ADD COLUMN last_driver_ping_at timestamptz;
ALTER TABLE rides ADD COLUMN last_rider_ping_at timestamptz;
ALTER TABLE rides ADD COLUMN dropoff_reminder_sent boolean NOT NULL DEFAULT false;
ALTER TABLE rides ADD COLUMN auto_ended boolean NOT NULL DEFAULT false;
