-- Add pickup/dropoff confirmation flags for location negotiation
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS pickup_confirmed  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dropoff_confirmed BOOLEAN NOT NULL DEFAULT false;

-- Index for quickly finding rides needing confirmation
CREATE INDEX IF NOT EXISTS idx_rides_negotiation
  ON rides (status)
  WHERE status IN ('accepted', 'coordinating');
