-- V4 F6 5B — day-before trip reminder flag.
--
-- Explore event trips are matched days/weeks ahead (unlike board rides,
-- matched within a day or two), so the reminder ladder gains an evening-
-- before rung: "Trip tomorrow — {event} at 9:00 PM." The sweep
-- (server/lib/scheduledReminders.ts::checkUpcomingDestinationRides) sets
-- this once per ride; the existing reminder_today_sent / _30 / _15 flags
-- (migration 038) cover the rest of the ladder.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS reminder_daybefore_sent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rides.reminder_daybefore_sent IS
  '2026-06-09 V4 F6 5B — evening-before reminder sent (destination trips). Mirrors the migration-038 reminder flags.';
