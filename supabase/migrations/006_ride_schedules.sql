-- ride_schedules — stores one-time scheduled trips
-- Created by riders or drivers to plan a future trip with a specific date/time.

CREATE TABLE IF NOT EXISTS ride_schedules (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  mode            TEXT NOT NULL CHECK (mode IN ('driver', 'rider')),
  route_name      TEXT NOT NULL,
  origin_place_id TEXT NOT NULL,
  origin_address  TEXT NOT NULL,
  dest_place_id   TEXT NOT NULL,
  dest_address    TEXT NOT NULL,
  direction_type  TEXT NOT NULL DEFAULT 'one_way' CHECK (direction_type IN ('one_way', 'roundtrip')),
  trip_date       DATE NOT NULL,
  time_type       TEXT NOT NULL DEFAULT 'departure' CHECK (time_type IN ('departure', 'arrival')),
  trip_time       TIME NOT NULL,
  is_notified     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE ride_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own schedules"
  ON ride_schedules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own schedules"
  ON ride_schedules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own schedules"
  ON ride_schedules FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own schedules"
  ON ride_schedules FOR DELETE
  USING (auth.uid() = user_id);

-- Index for querying upcoming schedules
CREATE INDEX idx_ride_schedules_user_date ON ride_schedules (user_id, trip_date);
