-- 065_dob_and_drop_license_photo.sql (2026-05-04)
--
-- Two product changes shipped together because they touch onboarding:
--
-- 1. Add `users.date_of_birth` for basic age awareness on the platform.
--    Required at signup going forward (enforced client-side because
--    legacy users predate this column — making it NOT NULL would break
--    every existing row's RLS-validated upserts). Server validates the
--    format on submit; iOS / web gate the form field.
--
-- 2. Drop `vehicles.license_plate_photo_url`. The plate string itself
--    (`vehicles.plate`) plus the car photo are sufficient for rider-
--    side trust at pickup; collecting the plate photo added zero
--    matching value but doubled the upload friction during driver
--    onboarding. Storage bucket `license-photos` is left in place
--    intentionally — orphaned objects are inert and dropping the
--    bucket would also wipe the policies. Code stops writing to it
--    after this migration.
--
-- Idempotent: ADD COLUMN uses IF NOT EXISTS; DROP COLUMN uses IF EXISTS.

-- ── 1. users.date_of_birth ──────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

COMMENT ON COLUMN public.users.date_of_birth IS
  'YYYY-MM-DD. Collected at signup (CreateProfile step). Nullable for '
  'pre-2026-05-04 users who predate the column; new signups must '
  'supply it (enforced in iOS + web). Used for age-gating driver mode '
  'and future age-band analytics. Not exposed to other users.';

-- ── 2. vehicles.license_plate_photo_url drop ────────────────────────────
ALTER TABLE public.vehicles
  DROP COLUMN IF EXISTS license_plate_photo_url;
