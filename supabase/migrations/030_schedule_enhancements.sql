-- Add available_seats, end_date, and note to ride_schedules and driver_routines

ALTER TABLE ride_schedules
  ADD COLUMN IF NOT EXISTS available_seats integer,
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE driver_routines
  ADD COLUMN IF NOT EXISTS available_seats integer,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS note text;
