-- Add is_online flag to driver_locations so drivers can go offline.
-- Default TRUE so existing drivers remain visible until they explicitly toggle off.

ALTER TABLE driver_locations
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT true;

-- Update nearby_active_drivers to exclude offline drivers.
CREATE OR REPLACE FUNCTION public.nearby_active_drivers(
  origin_lng double precision,
  origin_lat double precision,
  radius_m   double precision DEFAULT 15000,
  stale_min  integer          DEFAULT 5
)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT dl.user_id
  FROM   driver_locations dl
  JOIN   users u ON u.id = dl.user_id
  WHERE  u.is_driver = true
    AND  dl.is_online = true
    AND  dl.recorded_at > NOW() - (stale_min || ' minutes')::interval
    AND  ST_DWithin(
           dl.location::geography,
           ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography,
           radius_m
         );
$$;
