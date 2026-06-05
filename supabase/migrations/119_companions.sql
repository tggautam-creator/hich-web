-- V4 F1 — Companions (travel-with friends/family), mirroring Caregivers.
--
-- A rider can bring up to TWO companions on a ride for a per-companion
-- seat fee. Modeled on `caregivers` (mig 089) + the caregiver ride
-- columns (mig 091), with these deliberate differences (per V4 plan §5.1):
--   • `avatar_url` is part of the table from the start (companion photo
--     is required at the UI layer so drivers recognize the party).
--   • `relationship` is KEPT + surfaced (caregivers deprecated it on iOS).
--   • Up to 2 per ride → two FK columns (companion_a_id / companion_b_id),
--     not a join table — the cap is a fixed 2.
--   • Fee is PER companion: <10mi $4 · 10–50mi $6 · >50mi $10. Total =
--     count × tier, computed server-side AT END OF RIDE from the real
--     distance (V4 changes caregiver to do the same). `companion_fare_cents`
--     stores the settled aggregate; cents-only per CLAUDE.md.
--
-- Hard-delete model (same as caregivers): removing a companion nulls its
-- references on past rides/schedules via ON DELETE SET NULL.

-- ── companions table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.companions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         TEXT         NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  relationship TEXT         CHECK (length(relationship) <= 50),   -- "Friend", "Brother", "Roommate"
  phone        TEXT,        -- E.164; client validates
  avatar_url   TEXT         CHECK (avatar_url IS NULL OR length(avatar_url) <= 1024),
  notes        TEXT         CHECK (length(notes) <= 500),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS companions_user_id_idx
  ON public.companions (user_id, created_at DESC);

ALTER TABLE public.companions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companions_select_own ON public.companions;
CREATE POLICY companions_select_own
  ON public.companions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS companions_insert_own ON public.companions;
CREATE POLICY companions_insert_own
  ON public.companions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS companions_update_own ON public.companions;
CREATE POLICY companions_update_own
  ON public.companions FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS companions_delete_own ON public.companions;
CREATE POLICY companions_delete_own
  ON public.companions FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.companions IS
  'V4 F1 — rider-side companions (friends/family) who travel along, max 2 per ride. Hard-delete model; past ride/schedule refs use ON DELETE SET NULL on the companion_a_id/companion_b_id columns.';

-- ── companion attachment on rides + ride_schedules ──────────────────────────
-- Up to two companions per ride/post; companion_fare_cents is the SETTLED
-- aggregate (count × per-companion tier), written at end-of-ride.
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS companion_a_id UUID REFERENCES public.companions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS companion_b_id UUID REFERENCES public.companions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS companion_fare_cents INT CHECK (companion_fare_cents IS NULL OR companion_fare_cents >= 0);

ALTER TABLE public.ride_schedules
  ADD COLUMN IF NOT EXISTS companion_a_id UUID REFERENCES public.companions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS companion_b_id UUID REFERENCES public.companions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS companion_fare_cents INT CHECK (companion_fare_cents IS NULL OR companion_fare_cents >= 0);

COMMENT ON COLUMN public.rides.companion_fare_cents IS
  'V4 F1 — settled per-companion seat-fee aggregate (count × tier $4/$6/$10 by real distance), folded into rider charge + driver earnings; 0/NULL when none or driver waives.';

CREATE INDEX IF NOT EXISTS idx_rides_companion_a
  ON public.rides (companion_a_id) WHERE companion_a_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ride_schedules_companion_a
  ON public.ride_schedules (companion_a_id) WHERE companion_a_id IS NOT NULL;

-- ── driver goodwill opt-out (mirrors users.waive_caregiver_fee, mig 092) ────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS waive_companion_fee BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.waive_companion_fee IS
  'V4 F1 — when true on a driver row, end-of-ride settlement zeros the companion add-on for both rider charge and driver earnings. Separate from waive_caregiver_fee. Default false.';
