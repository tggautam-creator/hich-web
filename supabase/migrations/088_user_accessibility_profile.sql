-- v1.2 F2.1 — User accessibility profile (top-level toggle + JSONB blob).
--
-- Originally planned as migration 087 in `docs/V1_2_PLAN.md` §3.2. Bumped to
-- 088 because 087 was reassigned to user-profile-expansion (after the
-- Reports v2 collision pushed everything up one slot). Per the
-- migration-collision rule (`feedback_check_migration_number.md`), each
-- new migration just takes the next available slot.
--
-- Two columns:
--   • `has_accessibility_needs` — top-level boolean. Drives whether
--     the rest of the profile is rendered / honored. Default false so
--     existing rows don't accidentally start matching as
--     accessibility-needing users.
--   • `accessibility_profile` — JSONB blob with the schema:
--       { needs_wheelchair: bool, needs_caregiver: bool, other_notes: text? }
--     v1.2 only renders wheelchair-specific UX downstream (F5 / F8);
--     other types live in the blob for product-research input but
--     don't alter matching behavior.
--
-- Index `idx_users_has_accessibility` is partial — only indexes the
-- accessibility-needing minority so the index stays small (most users
-- never flip the flag).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS has_accessibility_needs BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accessibility_profile JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.users.has_accessibility_needs IS
  '2026-05-21 v1.2 F2 — top-level flag. True iff the user toggled "I have accessibility needs" on. When false, accessibility_profile is ignored downstream.';
COMMENT ON COLUMN public.users.accessibility_profile IS
  '2026-05-21 v1.2 F2 — JSONB blob. Schema: { needs_wheelchair: bool, needs_caregiver: bool, other_notes: text? }. v1.2 only renders wheelchair-specific UX; other types are captured for product input but do not alter matching.';

-- Partial index for finding accessibility users (analytics, admin
-- surface, future matching filters). Low cardinality vs the full
-- users table so the partial keeps the index tiny.
CREATE INDEX IF NOT EXISTS idx_users_has_accessibility
  ON public.users (has_accessibility_needs)
  WHERE has_accessibility_needs = true;
