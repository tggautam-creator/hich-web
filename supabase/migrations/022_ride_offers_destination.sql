-- Add driver destination fields to ride_offers so drivers can share their
-- destination when accepting, enabling overlap preview for riders.
ALTER TABLE ride_offers
  ADD COLUMN IF NOT EXISTS driver_destination geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS driver_destination_name text,
  ADD COLUMN IF NOT EXISTS driver_route_polyline text,
  ADD COLUMN IF NOT EXISTS overlap_pct smallint;
