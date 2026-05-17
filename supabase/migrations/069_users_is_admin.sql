-- 069_users_is_admin.sql
--
-- Admin account support (Phase 0, Slice 0.2 of the admin panel).
--
-- Adds a per-user `is_admin` boolean so:
--   1. The client (web AuthGuard / iOS RootView) can skip the
--      onboarding flow for admin accounts — admins log in to use the
--      admin panel, not to take/give rides, so the
--      full-name/phone/DOB/photo gates would just trap them in a
--      loop. With `is_admin=true`, both clients bypass the
--      `isProfileIncomplete` check.
--   2. The server (Slice 0.3 middleware) can authorise the
--      `/api/admin/*` routes by reading this column. For Phase 1 a
--      simple boolean is enough; Phase 3 will add a separate
--      `admin_users` table with role columns once RBAC matters.
--
-- The column defaults to FALSE so every existing + new student user
-- stays a non-admin until a Tago team member flips the bit manually
-- in the Supabase SQL editor. There is intentionally no client-facing
-- write path for this column — the only way to become admin is for
-- Tarun (or another existing admin) to run an UPDATE in SQL editor:
--
--   UPDATE public.users SET is_admin = TRUE WHERE id = '<user-uuid>';
--
-- After Phase 1 ships, a UI surface inside the admin panel will let
-- admins flip this on/off for other admins (audit-logged).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.users.is_admin IS
  'Tago internal admin / team member flag. Bypasses the onboarding gate on web (AuthGuard) and iOS (RootView). Granted by manual SQL UPDATE only; no public API writes to this column. See migration 069 + ADMIN_PLAN.md.';

-- Useful index for admin-panel queries that filter on this column.
-- Most rows are FALSE; a partial index keeps storage cheap.
CREATE INDEX IF NOT EXISTS idx_users_is_admin
  ON public.users(id)
  WHERE is_admin = TRUE;
