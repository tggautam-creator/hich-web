-- Returns distinct user_ids of is_driver=true users who have a driver_locations
-- record within the last stale_min minutes AND within radius_m metres of origin.
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
    AND  dl.recorded_at > NOW() - (stale_min || ' minutes')::interval
    AND  ST_DWithin(
           dl.location::geography,
           ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography,
           radius_m
         );
$$;

GRANT EXECUTE ON FUNCTION public.nearby_active_drivers TO service_role;
