-- Adds origin/destination coordinates to ride_schedules so the ride board
-- can compute fare estimates and "near me" proximity for BOTH driver and
-- rider posts (previously only driver posts carried coords via the routine
-- join). Columns are nullable because older rows have no coords; newer posts
-- from the client resolve place_id → lat/lng at insert time.

alter table public.ride_schedules
  add column if not exists origin_lat  double precision,
  add column if not exists origin_lng  double precision,
  add column if not exists dest_lat    double precision,
  add column if not exists dest_lng    double precision;
