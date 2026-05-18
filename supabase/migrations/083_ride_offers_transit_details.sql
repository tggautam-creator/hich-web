-- 083_ride_offers_transit_details.sql (2026-05-17)
--
-- Extends `ride_offers` (mig 072 added the board-offer columns) with
-- transit hand-off context + a system-computed fare estimate so the
-- rider's `BoardOfferAcceptPage` can show a rich proposal even when
-- the driver left the fare blank ("Confirm in chat").
--
-- New columns:
--   • estimated_fare_cents — server-computed at offer-creation time
--     using the standard fare formula (gas + per-minute) against the
--     proposed_pickup_point → proposed_dropoff_point distance. Always
--     populated; rider UI shows it as "Estimated $X" when the driver
--     didn't set an explicit fare, or as a sanity-check tooltip
--     alongside the explicit price.
--   • proposed_transit_line_name — e.g. "BART Yellow Line",
--     "Caltrain". Nil when the driver isn't proposing a transit
--     hand-off (drop at rider's posted dest).
--   • proposed_transit_walk_minutes — rider's minutes from drop
--     station to platform / their dest. Nil when not a hand-off.
--   • proposed_transit_to_dest_minutes — rider's minutes on transit
--     leg. Nil when not a hand-off.
--   • proposed_transit_total_minutes — convenience sum so the page
--     doesn't have to add walk + transit on the client. Nil when
--     not a hand-off.
--
-- Backward compat: all NULL-able; existing rows decode fine, the iOS
-- + web pages already handle nil values by hiding the relevant
-- chrome.

ALTER TABLE public.ride_offers
  ADD COLUMN IF NOT EXISTS estimated_fare_cents          INTEGER,
  ADD COLUMN IF NOT EXISTS proposed_transit_line_name    TEXT,
  ADD COLUMN IF NOT EXISTS proposed_transit_walk_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS proposed_transit_to_dest_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS proposed_transit_total_minutes INTEGER;
