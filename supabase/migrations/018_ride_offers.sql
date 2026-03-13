-- Track multiple driver acceptances for a single ride request.
-- Enables the multi-driver selection flow.

CREATE TABLE IF NOT EXISTS ride_offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id  UUID REFERENCES vehicles(id),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'selected', 'released')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ride_id, driver_id)
);

-- Fast lookup of offers for a given ride
CREATE INDEX IF NOT EXISTS idx_ride_offers_ride ON ride_offers (ride_id);
-- Fast lookup of a driver's pending offers
CREATE INDEX IF NOT EXISTS idx_ride_offers_driver ON ride_offers (driver_id) WHERE status = 'pending';

-- RLS: drivers can see their own offers, riders can see offers on their rides
ALTER TABLE ride_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY ride_offers_select ON ride_offers
  FOR SELECT USING (
    auth.uid() = driver_id
    OR auth.uid() IN (SELECT rider_id FROM rides WHERE id = ride_id)
  );

CREATE POLICY ride_offers_insert ON ride_offers
  FOR INSERT WITH CHECK (auth.uid() = driver_id);
