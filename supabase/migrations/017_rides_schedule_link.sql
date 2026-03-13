-- Link rides to the schedule that created them, carry trip metadata
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES ride_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_date DATE,
  ADD COLUMN IF NOT EXISTS trip_time TIME;
