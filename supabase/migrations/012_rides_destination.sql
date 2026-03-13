-- Add destination point and name to rides table
-- Use GEOMETRY (not geography) to match the origin column type,
-- so PostgREST accepts GeoJSON objects on insert.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS destination GEOMETRY(Point, 4326);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS destination_name text;
