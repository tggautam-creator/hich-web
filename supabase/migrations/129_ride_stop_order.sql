-- V4 F6 5B.2 — driver-controlled pickup sequence for shared event trips.
--
-- A multi-rider run visits N pickups; the driver's Run screen orders them
-- (default = shortest greedy route, draggable override). The position is
-- per-ride so every surface (run screen, stop list, rider "you're stop 2")
-- agrees. NULL = not yet sequenced (client computes the greedy default and
-- persists it via PATCH /api/destinations/run/:tripID/order).

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS stop_order INTEGER;

COMMENT ON COLUMN public.rides.stop_order IS
  '2026-06-10 V4 F6 5B.2 — 1-based pickup position within the ride''s shared trip (Explore multi-rider runs). NULL until the driver''s run screen sequences the stops.';
