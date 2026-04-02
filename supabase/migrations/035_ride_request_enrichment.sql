-- Phase 1A: Add rider context columns to rides table
-- Allows riders to send destination, note, and flexibility info with their request
-- Use GEOMETRY (not geography) to match rides.origin/destination column types,
-- so PostgREST accepts GeoJSON objects on insert.

ALTER TABLE rides ADD COLUMN IF NOT EXISTS requester_destination GEOMETRY(Point, 4326);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS requester_destination_name text;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS requester_note text;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS destination_flexible boolean DEFAULT false;

-- Phase 3A: Seat lock column on ride_schedules
-- Prevents new riders from being accepted after the first QR scan starts the ride

ALTER TABLE ride_schedules ADD COLUMN IF NOT EXISTS seats_locked boolean DEFAULT false;
