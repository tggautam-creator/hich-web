-- Migration 008 — Fix RLS and constraints for push_tokens and driver_locations
-- push_tokens: add UPDATE policy (needed for upsert)
-- driver_locations: add UNIQUE on user_id + UPDATE policy (needed for upsert)

-- ── push_tokens: add UPDATE policy ──────────────────────────────────────────
DROP POLICY IF EXISTS "Users can update own tokens" ON push_tokens;
CREATE POLICY "Users can update own tokens"
  ON push_tokens FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── driver_locations: add UNIQUE constraint on user_id ──────────────────────
-- The app upserts with onConflict: 'user_id' (one row per driver).
-- First, deduplicate: keep only the most recent row per user_id.
DELETE FROM driver_locations a
  USING driver_locations b
  WHERE a.user_id = b.user_id
    AND a.recorded_at < b.recorded_at;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'driver_locations_user_id_key'
  ) THEN
    ALTER TABLE driver_locations ADD CONSTRAINT driver_locations_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- ── driver_locations: add UPDATE policy ──────────────────────────────────────
DROP POLICY IF EXISTS "driver_locations_update_own" ON driver_locations;
CREATE POLICY "driver_locations_update_own"
  ON driver_locations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
