-- Add origin_name to rides table so the rider's preferred pickup address
-- is stored alongside the origin GeoPoint, avoiding reverse-geocoding.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS origin_name text;
