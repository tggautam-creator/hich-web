-- 082_users_last_known_location.sql
--
-- Slice 1.11 — per-user last-known GPS for admin visibility.
--
-- Tarun's product call 2026-05-18: every signed-in user (rider AND
-- driver) uploads their current GPS when the app foregrounds (and
-- when they tap a notification), throttled to at most once every
-- 5 minutes. Powers the admin panel's "where is this user?" view
-- and ops investigations regardless of whether the user is mid-ride.
--
-- Distinct from:
--   * `driver_locations` — driver-specific, drives the matcher RPC,
--     populated only while DriverHomePage is open + online.
--   * `rider_locations` — ride-scoped, populated only during an
--     active ride for pickup tracking.
--
-- These three new columns are denormalized onto `users` (single
-- row per user) because the admin queries are per-user lookups —
-- a separate table would just force a join on every read. The
-- write path is a single UPDATE on the user's own row, which
-- supabase-js + the existing RLS already allows.
--
-- Privacy note (must propagate to /privacy):
--   Continuous-while-foregrounded GPS collection is a real shift
--   in what Tago tracks. Tarun's responsibility to update the
--   Privacy Policy + add an in-app disclosure banner before this
--   ships to real users. The endpoint won't break privacy compliance
--   on its own — but ops needs to declare the use case.
--
-- Reversibility: drop the columns to roll back. Idempotent.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_known_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_known_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_known_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.last_known_lat IS
  'Latitude of the user''s most recent GPS upload via POST /api/users/me/location. Updated on app foreground (throttled to 1/5min/user). NULL until the user first foregrounds a build that ships the ping. See migration 082.';

COMMENT ON COLUMN public.users.last_known_lng IS
  'Longitude of the user''s most recent GPS upload. See last_known_lat.';

COMMENT ON COLUMN public.users.last_known_at IS
  'Timestamp of the most recent successful GPS upload. Admin panel uses this for "Last seen X min ago" + age-fading the on-map dot.';

-- Index for "users active in the last N minutes" admin queries
-- (e.g. heatmap of who's currently in the app). Partial — most
-- rows will be NULL for users who pre-date this migration.
CREATE INDEX IF NOT EXISTS idx_users_last_known_at
  ON public.users (last_known_at DESC)
  WHERE last_known_at IS NOT NULL;
