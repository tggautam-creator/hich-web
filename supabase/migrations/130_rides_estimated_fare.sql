-- 130_rides_estimated_fare.sql (2026-06-10)
--
-- Fare-preview consistency: a single server-owned "current estimate"
-- for instant rides.
--
-- Before this, every surface computed its own preview:
--   - rider's app sent the LOW end of its ±15% client range at request
--     time; the server trusted it and echoed it to drivers
--   - the driver card re-derived Gas/Time locally with a 35 mph guess
--   - pickup/dropoff re-negotiations computed fresh server fares but
--     froze them only into chat-message meta — the agreed number was
--     never stored anywhere queryable
--
-- rides.estimated_fare_cents is the canonical CURRENT estimate
-- (base + caregiver + companion seat-fee tiers, waivers applied at
-- settle time, not here). Written at request time (server-computed),
-- rewritten whenever an accepted pickup/dropoff change re-prices the
-- trip (accept-location / confirm-dropoff / confirm-direct-dropoff /
-- find-new-driver). The FINAL fare still lands in fare_cents at
-- end-of-ride from real GPS distance — this column is preview-only.
--
-- Distinct from ride_offers.estimated_fare_cents (migration 083),
-- which freezes the estimate shown on one driver's offer card.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS estimated_fare_cents INTEGER;

COMMENT ON COLUMN public.rides.estimated_fare_cents IS
  'Server-owned current fare estimate in cents (base + seat-fee tiers). '
  'Set at request time, updated when an accepted pickup/dropoff change '
  're-prices the trip. Preview only — the settled fare is fare_cents.';
