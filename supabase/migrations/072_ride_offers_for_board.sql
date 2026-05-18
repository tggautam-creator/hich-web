-- 072_ride_offers_for_board.sql (2026-05-16)
--
-- Extends `ride_offers` (originally migration 018) to support a NEW
-- flow: drivers offering on rider-posted board entries BEFORE the
-- rider has added a payment method. See `docs/BOARD_REDESIGN_PLAN.md`
-- (Slice A1).
--
-- Existing flow (unchanged): instant-ride matching. A rider hits
-- /api/rides/request → server creates a `rides` row → multiple drivers
-- can each insert a `ride_offers` row referencing that ride_id. Rider
-- picks one. This still works exactly as before.
--
-- New flow: a rider posts on the Ride Board (`ride_schedules.mode='rider'`)
-- WITHOUT a card on file. A driver browses the board, sees the
-- rider's request, taps "Offer to drive." Today this 4xx's with
-- RIDER_NO_PAYMENT_METHOD because the existing path tries to
-- immediately materialise a `rides` row, which requires the rider
-- to have a card.
--
-- After this migration: the driver's offer creates a `ride_offers`
-- row whose `ride_id` is NULL and whose new `schedule_id` points
-- at the rider's `ride_schedules` row. No `rides` row exists yet.
-- The rider gets a push, opens the new BoardOfferAcceptPage, adds
-- a card if needed, and accepts. Only THEN does the server create
-- the `rides` row and flip this offer to 'selected'.
--
-- Backward compatibility:
--   * Existing offers (ride_id NOT NULL, schedule_id NULL) keep
--     working unchanged.
--   * New offers (ride_id NULL, schedule_id NOT NULL) carry the
--     driver's proposed pickup / dropoff / fare / ETA so the rider
--     has all the context they need on the accept screen.
--   * CHECK constraint enforces "exactly one of ride_id or schedule_id"
--     so future code can branch cleanly without worrying about
--     orphaned rows.

-- ── 1. Drop the NOT NULL on ride_id ─────────────────────────────────────
-- Was NOT NULL since mig 018; new board offers reference a schedule,
-- not a ride.
ALTER TABLE public.ride_offers
  ALTER COLUMN ride_id DROP NOT NULL;

-- ── 2. New schedule_id FK ───────────────────────────────────────────────
-- Cascade so cleaning up a withdrawn rider post auto-clears all
-- offers attached to it.
ALTER TABLE public.ride_offers
  ADD COLUMN IF NOT EXISTS schedule_id UUID
    REFERENCES public.ride_schedules(id) ON DELETE CASCADE;

-- ── 3. Exactly-one constraint ───────────────────────────────────────────
-- An offer must reference EITHER a ride (instant flow) OR a schedule
-- (board flow) — never both, never neither. Prevents data drift.
ALTER TABLE public.ride_offers
  DROP CONSTRAINT IF EXISTS ride_offers_target_check;
ALTER TABLE public.ride_offers
  ADD CONSTRAINT ride_offers_target_check
  CHECK (
    (ride_id IS NOT NULL AND schedule_id IS NULL) OR
    (ride_id IS NULL AND schedule_id IS NOT NULL)
  );

-- ── 4. Proposed terms (carried until rider accepts) ─────────────────────
-- Set when the offer is created and frozen at accept-time. Rider sees
-- these on BoardOfferAcceptPage so they know what they're agreeing to.
ALTER TABLE public.ride_offers
  ADD COLUMN IF NOT EXISTS proposed_pickup_point  geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS proposed_dropoff_point geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS proposed_pickup_name   TEXT,
  ADD COLUMN IF NOT EXISTS proposed_dropoff_name  TEXT,
  ADD COLUMN IF NOT EXISTS proposed_fare_cents    INTEGER,
  ADD COLUMN IF NOT EXISTS proposed_eta_minutes   INTEGER;

-- ── 5. Partial unique index — one offer per driver per schedule ─────────
-- A driver who re-opens the post and taps "Offer" again should UPDATE
-- their existing offer, not create a duplicate. The server enforces
-- the upsert against this index. The existing `UNIQUE (ride_id,
-- driver_id)` table constraint is untouched and still protects the
-- instant flow.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ride_offers_schedule_driver
  ON public.ride_offers (schedule_id, driver_id)
  WHERE schedule_id IS NOT NULL;

-- ── 6. Lookup index — pending offers per schedule ───────────────────────
-- Powers `GET /api/rides/board/schedule/:id/offers` for the rider's
-- "you have N offers" inbox.
CREATE INDEX IF NOT EXISTS idx_ride_offers_schedule_pending
  ON public.ride_offers (schedule_id)
  WHERE status = 'pending' AND schedule_id IS NOT NULL;

-- ── 7. RLS — rider can see offers on their own schedule ─────────────────
-- The original SELECT policy from mig 018 only covered ride-based
-- offers (rider via rides.rider_id). For board offers there's no
-- ride yet, so the rider needs to be granted SELECT via the
-- schedule owner path.
DROP POLICY IF EXISTS ride_offers_select ON public.ride_offers;
CREATE POLICY ride_offers_select ON public.ride_offers
  FOR SELECT USING (
    auth.uid() = driver_id
    OR auth.uid() IN (
      SELECT rider_id FROM public.rides WHERE id = ride_id
    )
    OR auth.uid() IN (
      SELECT user_id FROM public.ride_schedules WHERE id = schedule_id
    )
  );

-- Insert policy stays at "auth.uid() = driver_id" — drivers are the
-- ones creating offers in both flows. Server-side checks the
-- schedule mode + driver role separately.

COMMENT ON COLUMN public.ride_offers.schedule_id IS
  'When set (and ride_id is NULL), this offer is a driver responding to a rider-posted Ride Board entry that has not yet been accepted. Once the rider accepts, the server creates a rides row, sets ride_offers.ride_id, and keeps schedule_id for traceability. See migration 072.';

COMMENT ON COLUMN public.ride_offers.proposed_fare_cents IS
  'Driver-proposed fare in cents at offer time. Frozen on the rider''s BoardOfferAcceptPage so the rider sees the same number when they accept. Becomes rides.fare_cents on acceptance.';
