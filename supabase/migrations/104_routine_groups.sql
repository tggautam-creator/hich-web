-- v1.3 Session C — group rows in driver_routines that represent the
-- same logical "user routine" (e.g., "University Routine" =
-- Mon-Wed 9am + Thu 1pm = 2 rows that share a group).
--
-- Background: per-day-mode in SchedulePostPage already splits a
-- multi-time routine into N rows (one per unique time-group). The
-- matching engine matches each row independently with its own time —
-- functionally correct. But Profile renders each row as a separate
-- card, which doesn't match how users think about their routine.
-- The user wants ONE card titled "University Routine" with all time
-- slots listed.
--
-- This migration adds `routine_group_id` so iOS can group rows by
-- save event:
--   - INSERT path: generate ONE group_id per save, apply to every
--     row in that per-day-mode batch.
--   - Profile: GROUP BY routine_group_id, render one card per group.
--   - Edit: load all rows in the group, present in per-day mode,
--     save uses delete-all-and-reinsert within the same group_id.
--
-- The matching engine doesn't need to change — it still scans per
-- row, which is correct. The group_id is purely a UI grouping key.
--
-- Existing rows each get their OWN group_id via the column default
-- (`gen_random_uuid()`), so legacy routines continue to render as
-- individual cards. No data migration needed.

ALTER TABLE driver_routines
  ADD COLUMN IF NOT EXISTS routine_group_id UUID NOT NULL
    DEFAULT gen_random_uuid();

-- Index for the grouping query on Profile.
CREATE INDEX IF NOT EXISTS idx_driver_routines_group
  ON driver_routines (user_id, routine_group_id);

COMMENT ON COLUMN driver_routines.routine_group_id IS
  'v1.3 Session C — groups rows that represent the same logical user '
  'routine (e.g., Mon-Wed 9am + Thu 1pm share one group_id). UI '
  'groups cards by this; matching engine ignores it. Existing rows '
  'get their own auto-generated group_id via the column default.';
