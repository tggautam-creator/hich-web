-- 076_users_suspended.sql
--
-- Suspended-user gate (Phase 1, Slice 1.3d of the admin panel).
-- (Numbered 076 because the parallel ride-offers sprint took 075.)
--
-- Adds two columns to `public.users`:
--   suspended_at      — TIMESTAMPTZ NULL. Set by an admin via
--                       POST /api/admin/users/:id/actions/suspend.
--                       NULL = active; set = suspended at that
--                       moment.
--   suspended_reason  — TEXT NULL. Human-readable explanation the
--                       admin entered. Surfaced to the affected user
--                       on the 403 SUSPENDED response so support
--                       conversations have context.
--
-- Enforcement:
--   The web/iOS clients aren't the source of truth — they will
--   eventually render a friendly "your account has been suspended"
--   screen, but the actual block is server-side in
--   `server/middleware/auth.ts::validateJwt`, which now returns
--   403 { code: 'SUSPENDED', message: <suspended_reason> } on every
--   authenticated API call from a suspended user. This way:
--     1) iOS doesn't need a code change to enforce — it just sees
--        every API call fail with 403 and falls through to its
--        normal auth-failure handling.
--     2) Admins can't be locked-out-by-mistake: the suspend endpoint
--        refuses to suspend users with `is_admin=true` (and refuses
--        to suspend the caller themselves).
--
-- Why partial index: most rows will be NULL (active users). A partial
-- index on `WHERE suspended_at IS NOT NULL` keeps storage cheap while
-- letting the admin panel page through suspended users quickly when
-- we ship that surface in a follow-up.
--
-- Reversibility: to un-suspend, call the same endpoint with
-- { suspended: false } — the endpoint nulls both columns. Or in the
-- SQL editor: UPDATE users SET suspended_at = NULL, suspended_reason
-- = NULL WHERE id = '<uuid>';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

COMMENT ON COLUMN public.users.suspended_at IS
  'When the user was suspended by an admin. NULL = active. Enforced server-side in validateJwt (403 SUSPENDED on every authenticated call). See migration 076 + ADMIN_PLAN.md.';

COMMENT ON COLUMN public.users.suspended_reason IS
  'Admin-supplied reason for the suspension, surfaced in the 403 response so support has context.';

CREATE INDEX IF NOT EXISTS idx_users_suspended_at
  ON public.users(suspended_at DESC)
  WHERE suspended_at IS NOT NULL;
