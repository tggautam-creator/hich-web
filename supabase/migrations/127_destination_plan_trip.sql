-- V4 F6 — shared multi-rider event trip (option 2: board-parity cost split).
--
-- Today every accepted event rider gets their OWN trips row (makeRide →
-- getOrCreateTripForRide per ride), so the segment-based cost split in
-- rides.ts /end never fires (it gates on COUNT(rides WHERE trip_id) >= 2).
-- Result: four people in one car each pay a full solo fare.
--
-- To make one physical drive = ONE trips row + N rides rows (the model the
-- F17 segment engine already implements), every rider accepted onto the same
-- driver plan + leg must converge on the SAME trip_id. The board was meant to
-- do this via (driver, schedule_id) but never wired the eager link; event
-- rides have no schedule_id at all. So we group explicitly: the plan remembers
-- which trip its outbound drive and its return drive belong to.
--
--   together / one_way  → home→event ride  → joins outbound_trip_id
--   own_thing           → event→home ride  → joins return_trip_id
--   together return leg → event→home ride  → joins return_trip_id
--
-- First accept for a leg mints the trip and stamps it here; later accepts read
-- it back and link their ride to the same trip. ON DELETE SET NULL so an
-- orphan-trip cleanup (lost-race path in getOrCreatePlanLegTrip) can't dangle.

ALTER TABLE public.destination_driver_plans
  ADD COLUMN IF NOT EXISTS outbound_trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_trip_id   UUID REFERENCES public.trips(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.destination_driver_plans.outbound_trip_id IS
  '2026-06-09 V4 F6 — the shared trips row for this plan''s outbound (home→event) drive. All riders on the outbound leg link their ride to it so the segment cost-split fires.';
COMMENT ON COLUMN public.destination_driver_plans.return_trip_id IS
  '2026-06-09 V4 F6 — the shared trips row for this plan''s return (event→home) drive. own_thing riders + together return legs link here.';
