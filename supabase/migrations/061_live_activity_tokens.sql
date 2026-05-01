-- 061_live_activity_tokens.sql (LIVE.2, 2026-04-30)
--
-- Stores APNs push tokens minted by ActivityKit for each rider's
-- active ride Live Activity. The server uses these to push update
-- payloads (`aps.event = "update"`) to the activity directly,
-- bypassing the iOS app process — so the lock-screen card stays
-- fresh while iOS is suspended for >30s (the limit beyond which
-- LIVE.1's local-update path would otherwise let the activity go
-- stale).
--
-- Lifecycle:
--   • iOS starts the activity → ActivityKit hands the app a push
--     token. App POSTs it here keyed by (user_id, ride_id).
--   • Server fires APNs push-to-update on every relevant ride row
--     change (status flip, driver_location broadcast, ETA refresh).
--   • iOS ends the activity → ActivityKit invalidates the token.
--     iOS DELETEs the row so the server stops pushing.
--   • Apple's `apns-id` response 410 Gone tells the server the
--     token is dead → defensive cleanup deletes the row server-side
--     too (handled in server/lib/apns.ts).
--
-- One row per (user, ride). Apple permits N concurrent activities
-- per app, but Tago's UX is one ride at a time, so dedupe by
-- composite key keeps the table tight.
CREATE TABLE IF NOT EXISTS live_activity_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  -- ActivityKit's per-activity APNs push token (hex, 64 chars).
  -- Distinct from the device push token in `push_tokens`.
  push_token text NOT NULL,
  -- ActivityKit activity identifier (UUID string from the iOS side).
  -- Used for client-driven cleanup when the activity ends, so the
  -- DELETE call doesn't need the ride_id (which the iOS side might
  -- have already cleared).
  activity_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_activity_tokens_unique_user_ride UNIQUE (user_id, ride_id)
);

CREATE INDEX IF NOT EXISTS live_activity_tokens_ride_id_idx
  ON live_activity_tokens (ride_id);

CREATE INDEX IF NOT EXISTS live_activity_tokens_activity_id_idx
  ON live_activity_tokens (activity_id);

-- Auto-bump updated_at on row mutation.
CREATE OR REPLACE FUNCTION set_live_activity_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS live_activity_tokens_updated_at_trigger
  ON live_activity_tokens;
CREATE TRIGGER live_activity_tokens_updated_at_trigger
  BEFORE UPDATE ON live_activity_tokens
  FOR EACH ROW EXECUTE FUNCTION set_live_activity_tokens_updated_at();

-- RLS: server-side service-role writes/reads. Authenticated users
-- can read their own rows (so they can debug from the app), but
-- writes go through the server's authenticated endpoints which use
-- the service-role key. No insert/update/delete policy for
-- authenticated users — matches the lockdown pattern from
-- migration 056.
ALTER TABLE live_activity_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY live_activity_tokens_select_own ON live_activity_tokens
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Restrictive denies on writes for the authenticated role so a
-- future permissive policy can't widen the surface.
CREATE POLICY live_activity_tokens_deny_authenticated_insert
  ON live_activity_tokens AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY live_activity_tokens_deny_authenticated_update
  ON live_activity_tokens AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY live_activity_tokens_deny_authenticated_delete
  ON live_activity_tokens AS RESTRICTIVE
  FOR DELETE TO authenticated USING (false);
