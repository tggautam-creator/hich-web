-- 070_users_last_active_at.sql
--
-- DAU / WAU / MAU support for the admin Overview dashboard
-- (Phase 1, Slice 1.1 of the admin panel).
--
-- Adds `users.last_active_at` so the dashboard can show:
--   DAU = users with last_active_at >= now() - INTERVAL '1 day'
--   WAU = users with last_active_at >= now() - INTERVAL '7 days'
--   MAU = users with last_active_at >= now() - INTERVAL '30 days'
--
-- Bump source: server/middleware/auth.ts (`validateJwt`) does a
-- conditional UPDATE on every authenticated API call, throttled
-- in-memory to once per 5 minutes per user. The conditional
-- WHERE clause (`last_active_at IS NULL OR last_active_at < now() - INTERVAL '5 minutes'`)
-- is a second-layer guard so even a cache miss won't generate a write
-- if the row was just bumped.
--
-- Why nullable: existing users have no activity timestamp yet. They
-- start as NULL and get backfilled on their next authenticated request.
-- The dashboard treats NULL as "no recent activity" (not counted in
-- DAU/WAU/MAU), which is correct — we can't claim activity we never saw.
--
-- Index choice: BRIN over BTREE because we always query `last_active_at
-- >= <threshold>` (range scan over a monotonically-growing column).
-- BRIN is ~100x smaller than BTREE for this access pattern and is the
-- standard recommendation for timestamp columns that only get filtered
-- by recency.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.last_active_at IS
  'Last time this user made an authenticated API call. Bumped by validateJwt middleware (throttled to once / 5 min). Powers DAU/WAU/MAU on the admin Overview dashboard. NULL = never seen since column added in migration 070.';

CREATE INDEX IF NOT EXISTS idx_users_last_active_at
  ON public.users
  USING BRIN (last_active_at);
