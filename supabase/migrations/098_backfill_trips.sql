-- v1.2 F17 — Backfill `trips` rows from existing `rides`.
--
-- Migration 097 added the `trips` table + `rides.trip_id` column. This
-- migration populates `rides.trip_id` for every historical row that has
-- a driver (i.e. an actual matched ride, not an abandoned request).
--
-- Strategy
-- - One trip per existing rides row. For historical board trips with
--   multiple rider rows on the same schedule, each rider row gets its
--   OWN trip — we can't reconstruct the shared parent retroactively
--   (no segment trail was kept). This is fine because historical
--   billing is already settled; the trips table will be the canonical
--   parent going FORWARD.
-- - Skip rides without a driver (driver_id IS NULL). Those are
--   abandoned requests that never became actual trips.
-- - Map ride.status → trip.status with the same vocabulary:
--     active/coordinating → 'active'
--     completed/paid → 'completed'
--     anything starting with 'cancelled' or 'declined' → 'cancelled'
--     everything else → 'pending'
-- - Copy across the trip-level columns (started_at, ended_at, origin,
--   destination, route_polyline, gps_distance_metres, gas/time costs)
--   so that backfilled trips look consistent with newly-created ones.
--
-- Performance
-- Loops one row at a time via PL/pgSQL because we need RETURNING id
-- per insert to set rides.trip_id correctly. Prod has < 10k historical
-- rides today, so this runs in seconds. If we ever hit > 1M rows the
-- loop can be refactored to use a CTE + temporary mapping table.

DO $$
DECLARE
  r RECORD;
  new_trip_id UUID;
  mapped_status TEXT;
  mapped_kind TEXT;
BEGIN
  FOR r IN
    SELECT
      id, driver_id, schedule_id, status, started_at, ended_at,
      origin, origin_name, destination, destination_name,
      route_polyline, gps_distance_metres,
      gas_cost_cents, time_cost_cents, gas_price_per_gallon_cents,
      created_at
    FROM public.rides
    WHERE trip_id IS NULL
      AND driver_id IS NOT NULL
  LOOP
    mapped_kind := CASE
      WHEN r.schedule_id IS NOT NULL THEN 'board'
      ELSE 'instant'
    END;

    mapped_status := CASE
      WHEN r.status IN ('active', 'coordinating') THEN 'active'
      WHEN r.status IN ('completed', 'paid') THEN 'completed'
      WHEN r.status LIKE 'cancelled%' OR r.status LIKE 'declined%' THEN 'cancelled'
      ELSE 'pending'
    END;

    INSERT INTO public.trips (
      driver_id, schedule_id, kind, status,
      started_at, ended_at,
      origin, origin_name, destination, destination_name,
      route_polyline, gps_distance_metres,
      gas_cost_cents, time_cost_cents, gas_price_per_gallon_cents,
      created_at, updated_at
    ) VALUES (
      r.driver_id, r.schedule_id, mapped_kind, mapped_status,
      r.started_at, r.ended_at,
      r.origin, r.origin_name, r.destination, r.destination_name,
      r.route_polyline, COALESCE(r.gps_distance_metres, 0),
      COALESCE(r.gas_cost_cents, 0), COALESCE(r.time_cost_cents, 0), r.gas_price_per_gallon_cents,
      r.created_at, NOW()
    )
    RETURNING id INTO new_trip_id;

    UPDATE public.rides
       SET trip_id = new_trip_id
     WHERE id = r.id;
  END LOOP;
END $$;

-- Sanity: every driver-matched ride should now have a trip_id.
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
    FROM public.rides
   WHERE trip_id IS NULL AND driver_id IS NOT NULL;
  IF orphan_count > 0 THEN
    RAISE WARNING 'v1.2 F17 backfill: % driver-matched rides still have no trip_id', orphan_count;
  END IF;
END $$;
