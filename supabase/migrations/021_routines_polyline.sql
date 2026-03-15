-- Add route_polyline to driver_routines for Phase 2 transit auto-detection
ALTER TABLE driver_routines
  ADD COLUMN IF NOT EXISTS route_polyline text;
