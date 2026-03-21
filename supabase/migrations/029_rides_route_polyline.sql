-- Add route_polyline column to rides table to persist the pickup→destination
-- encoded polyline and avoid re-fetching it from Google Routes API across screens.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS route_polyline text;
