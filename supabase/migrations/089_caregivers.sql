-- v1.2 F3.1 — Caregivers table (hard-delete model).
--
-- Originally planned as migration 088 in `docs/V1_2_PLAN.md` §3.3. Bumped to
-- 089 because 088 was reassigned to the user-accessibility profile (after
-- the cascade of bumps started by Reports v2 taking 086). Per the
-- migration-collision rule (`feedback_check_migration_number.md`), each
-- new migration just takes the next available slot.
--
-- One caregiver row per rider-relationship. Hard-delete model (Tarun's
-- direction 2026-05-20): when a user removes a caregiver, the row is
-- destroyed — historical rides / schedules that referenced the caregiver
-- get `caregiver_id = NULL` via `ON DELETE SET NULL` on the rides +
-- ride_schedules columns (added in the upcoming F6 / F7 migration).
--
-- RLS mirrors the `vehicles` table exactly — caregivers are private to
-- the owning user; nobody else can read, insert, update, or delete
-- another user's caregivers.

CREATE TABLE IF NOT EXISTS public.caregivers (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         TEXT         NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  relationship TEXT         CHECK (length(relationship) <= 50),  -- "Mom", "Sister", "Aide"
  phone        TEXT,        -- E.164; client validates
  notes        TEXT         CHECK (length(notes) <= 500),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS caregivers_user_id_idx
  ON public.caregivers (user_id, created_at DESC);

ALTER TABLE public.caregivers ENABLE ROW LEVEL SECURITY;

-- Drop-then-create so re-applying the migration on dev / staging
-- doesn't trip the "policy already exists" error.
DROP POLICY IF EXISTS caregivers_select_own ON public.caregivers;
CREATE POLICY caregivers_select_own
  ON public.caregivers FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS caregivers_insert_own ON public.caregivers;
CREATE POLICY caregivers_insert_own
  ON public.caregivers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS caregivers_update_own ON public.caregivers;
CREATE POLICY caregivers_update_own
  ON public.caregivers FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS caregivers_delete_own ON public.caregivers;
CREATE POLICY caregivers_delete_own
  ON public.caregivers FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.caregivers IS
  '2026-05-21 v1.2 F3 — rider-side caregivers who may accompany the user on rides. Hard-delete model (Tarun direction). Past ride/schedule references will use ON DELETE SET NULL on rides.caregiver_id / ride_schedules.caregiver_id (added by the F6/F7 migration).';
