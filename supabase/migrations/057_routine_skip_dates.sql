-- 057_routine_skip_dates.sql
--
-- Add a per-routine skip-dates tombstone array so that when a user
-- deletes a `ride_schedules` row that was auto-projected from a
-- `driver_routines` entry, the next sync-routines run won't resurrect
-- it. Without this column, deleting "I'm not driving Wednesday"
-- silently re-creates the row on the next /api/schedule/sync-routines
-- call (e.g. next time the user opens the Routines sheet).
--
-- Bug surfaced 2026-04-28 by Tarun via the iOS Routines sheet QA pass:
-- "will the post be deleted for the day and when app will refresh
-- for sending more trips as per your routine, will it still post the
-- trip to rideboard despite been deleted by the user". Answer was
-- "yes, it would". This migration closes that.
--
-- Rationale for DATE[] (vs a separate skip-dates table):
--   1. Per-routine cardinality is small (a user typically skips a
--      handful of one-off dates per routine, not hundreds).
--   2. No JOIN cost in sync — single column read on the same routine
--      row we're already iterating.
--   3. Postgres array operators (= ANY, &&, etc.) are sufficient for
--      the queries we need.
--   4. Easy to inspect / hand-edit in the Supabase dashboard.

ALTER TABLE driver_routines
  ADD COLUMN IF NOT EXISTS skip_dates DATE[] NOT NULL DEFAULT '{}'::DATE[];

COMMENT ON COLUMN driver_routines.skip_dates IS
  'Dates the user has explicitly opted out of for this routine. The /api/schedule/sync-routines projection skips any date in this array. Populated when the user deletes a ride_schedules row that originated from this routine (origin_place_id = ''routine:{id}'').';
