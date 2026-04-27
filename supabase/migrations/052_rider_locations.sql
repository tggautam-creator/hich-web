-- ── rider_locations ──────────────────────────────────────────────────────────
-- Mirrors `driver_locations` (002) but for the inverse direction: lets the
-- driver's pickup map render the rider's last-known position immediately on
-- mount, instead of waiting up to one full broadcast tick (15s) for the first
-- realtime `rider_location` event to arrive. Fix landed 2026-04-26 — same
-- "realtime broadcasts are not buffered for late subscribers" gotcha that
-- already had the bootstrap-from-table pattern shipped on the rider side
-- (`bootstrapDriverLocation` reading `driver_locations`).
--
-- Ride-scoped rather than user-scoped (the way `driver_locations` is keyed
-- by user_id) because:
--   1. A rider only needs to be tracked while walking to ONE specific ride's
--      pickup. Their location is meaningless after the ride ends.
--   2. Ride-scoped RLS is much simpler than user-scoped: SELECT is allowed
--      only to the two parties on that ride. No "any user can read any
--      other user's last location" footgun.
--   3. A primary key on `ride_id` means upsert is a one-liner from any
--      client (rider GPS broadcast loop) — no UNIQUE constraint dance.

CREATE TABLE IF NOT EXISTS rider_locations (
  ride_id     uuid        PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  location    GEOMETRY(Point, 4326) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rider_locations_geom
  ON rider_locations USING GIST(location);

ALTER TABLE rider_locations ENABLE ROW LEVEL SECURITY;

-- INSERT + UPDATE: only the rider on the ride can write their own row.
-- Joined to `rides` so the rider_id check uses the ride's authoritative
-- column rather than trusting the client.
DROP POLICY IF EXISTS "rider_locations_write_own" ON rider_locations;
CREATE POLICY "rider_locations_write_own"
  ON rider_locations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = rider_locations.ride_id
        AND rides.rider_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "rider_locations_update_own" ON rider_locations;
CREATE POLICY "rider_locations_update_own"
  ON rider_locations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = rider_locations.ride_id
        AND rides.rider_id = auth.uid()
    )
  );

-- SELECT: both rider and driver on that ride can read it. Anyone else
-- (other drivers, other riders, unauthenticated) is denied.
DROP POLICY IF EXISTS "rider_locations_select_participants" ON rider_locations;
CREATE POLICY "rider_locations_select_participants"
  ON rider_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = rider_locations.ride_id
        AND (rides.rider_id = auth.uid() OR rides.driver_id = auth.uid())
    )
  );
