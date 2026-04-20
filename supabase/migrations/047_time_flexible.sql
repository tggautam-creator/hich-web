-- 047_time_flexible.sql
-- Adds a time_flexible flag to ride_schedules so users can post a one-time
-- trip on a specific date without committing to an hour.
--
-- Design notes:
--  - time_type + trip_time stay NOT NULL to preserve existing consumers and
--    the CHECK constraint on time_type. When time_flexible = true the UI
--    hides/ignores the stored time; we write a noon placeholder on insert
--    so any legacy sort-by-time behavior keeps working.
--  - Default is FALSE so every existing row keeps its exact current meaning.

alter table public.ride_schedules
  add column if not exists time_flexible boolean not null default false;
