-- V4 F6 — rider pickup on the Explore waitlist.
--
-- When a rider requests an event ride they never said WHERE to be picked up,
-- so the matched ride's pickup_point defaulted to the DRIVER's origin (their
-- own start) — the driver had no real pickup to navigate to. This stores the
-- rider's chosen pickup (home→event) / drop-off (return-only) so it carries
-- into the matched ride at accept.
--
-- Generic "the rider's end of the trip": for together/one_way it's the
-- pickup; for own_thing (event→home) it's the drop-off (their home).

ALTER TABLE public.destination_waitlist
  ADD COLUMN IF NOT EXISTS pickup_lat     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_lng     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_address TEXT;

COMMENT ON COLUMN public.destination_waitlist.pickup_lat IS
  '2026-06-08 V4 F6 — rider pickup (home→event) / drop-off (own_thing) latitude. Carried into the matched ride at accept.';
