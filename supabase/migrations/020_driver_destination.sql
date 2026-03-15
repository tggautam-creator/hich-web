-- Add driver destination fields to rides for transit dropoff suggestions
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS driver_destination geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS driver_destination_name text,
  ADD COLUMN IF NOT EXISTS driver_route_polyline text;

-- Allow drivers to see their own destination on rides they're involved in (existing RLS covers this)
