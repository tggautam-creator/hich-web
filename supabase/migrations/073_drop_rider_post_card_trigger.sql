-- 073_drop_rider_post_card_trigger.sql (2026-05-17)
--
-- Drops the BEFORE INSERT trigger from migration 051 that blocked
-- rider-mode `ride_schedules` posts when the poster had no card on
-- file. The trigger created a chicken-and-egg problem: riders
-- wouldn't add a card before getting an offer, but couldn't post to
-- get an offer without a card.
--
-- Phase A of the Ride Board redesign (see
-- `docs/BOARD_REDESIGN_PLAN.md`) replaces this upfront gate with a
-- deferred gate: rider posts freely, driver offers freely, AND the
-- card requirement fires only when the rider taps Accept on a
-- driver's offer (server-side in
-- `POST /api/schedule/board/offers/:id/accept`).
--
-- Migrations 072 + this one together enable the new flow:
--   * 072 — adds `ride_offers.schedule_id` so offers can attach to
--           a schedule before any ride exists.
--   * 073 — drops the trigger so rider posts succeed without a card.
--
-- The trigger function is also dropped because no other migration
-- references it. Recreating the gate later would require a fresh
-- migration anyway.
--
-- Irreversible? No. To restore the old behaviour, re-run the SQL
-- from migration 051. Idempotent: uses DROP TRIGGER / FUNCTION IF
-- EXISTS so re-applying this migration on a DB where it already ran
-- is a no-op.

BEGIN;

DROP TRIGGER IF EXISTS ride_schedules_rider_card_check ON public.ride_schedules;
DROP FUNCTION IF EXISTS public.enforce_rider_post_has_card();

COMMIT;
