-- 093_caregivers_avatar_url.sql
-- v1.2 F18.5 — caregiver photo. CTO direction (2026-05-23):
-- caregivers must have an identifying photo so the driver-facing
-- context row + CaregiverInfoSheet show a real face, not a generic
-- person glyph. The iOS AddCaregiverSheet enforces non-null on
-- add/edit; this column is nullable at the DB level so existing
-- pre-F18.5 rows can be migrated forward (the rider gets a
-- "Photo required — tap to add" affordance until they fill it in).

ALTER TABLE public.caregivers
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN public.caregivers.avatar_url IS
  '2026-05-23 v1.2 F18.5 — photo URL for the caregiver. Stored in '
  'the public `avatars` Supabase Storage bucket under the rider''s '
  'subpath (rider UUID / caregivers / caregiver UUID .jpg). Mandatory '
  'on add/edit per the iOS UI; nullable in DB for back-compat with '
  'pre-migration rows.';
