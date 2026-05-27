-- v1.2 F1.1 — User profile expansion (bio, gender, school, major, graduation_year).
--
-- Originally planned as migration 086 in `docs/V1_2_PLAN.md` §3.1. Bumped to
-- 087 because the parallel Reports v2 work stream already claimed 086 — per
-- the migration-collision rule (see `feedback_check_migration_number.md`),
-- new migrations take the next available slot rather than renumbering
-- in-flight work.
--
-- Schema adds five optional profile fields that surface in:
--   • EditProfileSheet "About you" section (F1.1 — bio + gender)
--   • EditProfileSheet "Education" section (F1.2 — school + major + grad year)
--   • ProfilePage subtitle + chip (F1.2)
--   • UserProfilePreviewCard in waiting room (F9)
--   • RideBoard accessibility card row (F8)
--
-- All five default to NULL; no backfill needed. Existing users see empty
-- fields on first edit and fill in what they want.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female', 'non_binary', 'prefer_not_to_say')),
  ADD COLUMN IF NOT EXISTS school TEXT,
  ADD COLUMN IF NOT EXISTS major TEXT,
  ADD COLUMN IF NOT EXISTS graduation_year INTEGER CHECK (graduation_year BETWEEN 1980 AND 2100);

COMMENT ON COLUMN public.users.bio IS '2026-05-20 v1.2 F1 — short user-supplied bio for profile preview surfaces. 280 chars max enforced client-side; no DB length constraint (TEXT) so legacy bios from a future longer-bio expansion still load.';
COMMENT ON COLUMN public.users.gender IS '2026-05-20 v1.2 F1 — optional gender for social profile. CHECK constrains to four values incl. ''prefer_not_to_say''. Editable from Profile.';
COMMENT ON COLUMN public.users.school IS '2026-05-20 v1.2 F1 — university name (e.g. "UC Davis"). Free text; optional.';
COMMENT ON COLUMN public.users.major IS '2026-05-20 v1.2 F1 — student major. Free text; optional.';
COMMENT ON COLUMN public.users.graduation_year IS '2026-05-20 v1.2 F1 — expected graduation year. CHECK 1980-2100 to catch typos.';

-- No new RLS policy needed — existing `users_select_own` / `users_update_own`
-- cover the new columns automatically (policies are row-level, not
-- column-level).
