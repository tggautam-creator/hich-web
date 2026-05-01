-- 059_rides_time_flexible.sql
--
-- Copy `time_flexible` from `ride_schedules` to `rides` so the
-- reminder + expiry cron paths (which read `rides` directly) can
-- branch correctly for Anytime posts. Without this, the cron
-- treats the `'12:00:00'` placeholder time as the literal trip time
-- and fires meaningless 30/15-min reminders + auto-cancels at noon
-- on the trip date (instead of staying all day per the Anytime
-- contract).
--
-- Bug surfaced 2026-04-28 by Tarun on the iOS Slice U pre-window
-- gate review: "What happens to anytime rides... the behavior should
-- be navigate to pickup for the whole day and no gate for them will
-- be before the day starts and after the day ends."
--
-- Three pieces:
--   1. Add `time_flexible BOOLEAN DEFAULT FALSE` on `rides`.
--   2. Backfill from `ride_schedules` for existing linked rides.
--   3. Add `reminder_today_sent BOOLEAN DEFAULT FALSE` for the new
--      9 AM "Today's the day" reminder on Anytime trip dates.

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS time_flexible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_today_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill time_flexible from the parent ride_schedules row.
-- Only updates rows where the schedule still exists; orphaned rides
-- keep the default FALSE which matches the historical behavior.
UPDATE rides r
SET time_flexible = s.time_flexible
FROM ride_schedules s
WHERE r.schedule_id = s.id
  AND s.time_flexible IS NOT NULL
  AND r.time_flexible IS DISTINCT FROM s.time_flexible;

COMMENT ON COLUMN rides.time_flexible IS
  'Mirrors the parent ride_schedules.time_flexible flag at the time the rides row was created. Used by cron paths (checkUpcomingRides, expireStaleRequests, expireMissedRides) to branch behavior for Anytime posts: no 30/15-min reminders, expire only after end-of-trip-date, etc. See migration 059 for context.';

COMMENT ON COLUMN rides.reminder_today_sent IS
  'Set to true once the 9 AM "Today''s the day" reminder fires on the trip_date for an Anytime (time_flexible=true) ride. Prevents duplicate reminders if the cron sweeps multiple times in the morning.';
