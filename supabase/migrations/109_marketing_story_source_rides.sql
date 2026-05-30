-- v1.3 marketing panel (2026-05-24) — Phase 1.1.
--
-- Adds an audit trail of which ride_schedules rows were used to
-- generate each story. Lets the admin UI surface a "Source rides
-- (4)" drawer under every story card so we can verify the LLM
-- didn't hallucinate (e.g. claim "4 riders" when only 2 actually
-- posted).
--
-- Shape (JSONB array, capped at 8 entries by the generator):
--   [{ ride_id, mode, origin_address, dest_address, trip_date, trip_time }, ...]
--
-- Nullable + JSONB → zero-impact additive change. Existing items
-- (generated before this migration) stay NULL; new items populate.
--
-- Idempotent via ADD COLUMN IF NOT EXISTS.

ALTER TABLE marketing_story_items
  ADD COLUMN IF NOT EXISTS source_rides JSONB;

COMMENT ON COLUMN marketing_story_items.source_rides IS
  'v1.3 Phase 1.1 — snapshot of the ride_schedules rows that drove '
  'this story''s copy. Capped at 8 entries. JSONB shape: '
  '[{ride_id, mode, origin_address, dest_address, trip_date, trip_time}]. '
  'Nullable for pre-Phase-1.1 rows; new generations always populate.';

-- Phase 1.1 — relax the batch-uniqueness constraint so admins can
-- run multiple manual batches per day (e.g. one asking drivers,
-- one asking riders). The cron path is still gated to one
-- batch/day via a partial unique index below.
--
-- Drop the old (for_date, source) unique constraint if present.
ALTER TABLE marketing_story_batches
  DROP CONSTRAINT IF EXISTS marketing_story_batches_one_per_day;

-- Replace with a partial unique index: only cron-sourced batches
-- have the one-per-day invariant; manual batches can stack.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_story_batches_cron_one_per_day
  ON marketing_story_batches (for_date)
  WHERE source = 'cron';
