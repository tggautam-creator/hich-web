-- Ride ratings table — blind ratings (neither user sees the other's until both submit)
CREATE TABLE IF NOT EXISTS ride_ratings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     uuid        NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  rater_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rated_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars       integer     NOT NULL CHECK (stars >= 1 AND stars <= 5),
  tags        text[]      NOT NULL DEFAULT '{}',
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ride_id, rater_id)
);

CREATE INDEX IF NOT EXISTS idx_ride_ratings_ride_id ON ride_ratings(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_ratings_rated_id ON ride_ratings(rated_id);

ALTER TABLE ride_ratings ENABLE ROW LEVEL SECURITY;

-- Users can read their own ratings (received)
DROP POLICY IF EXISTS "ride_ratings_select_own" ON ride_ratings;
CREATE POLICY "ride_ratings_select_own"
  ON ride_ratings FOR SELECT
  USING (
    rated_id = auth.uid() OR rater_id = auth.uid()
  );

-- Users can insert a rating for a ride they participated in
DROP POLICY IF EXISTS "ride_ratings_insert_participant" ON ride_ratings;
CREATE POLICY "ride_ratings_insert_participant"
  ON ride_ratings FOR INSERT
  WITH CHECK (
    rater_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = ride_ratings.ride_id
        AND rides.status = 'completed'
        AND (rides.rider_id = auth.uid() OR rides.driver_id = auth.uid())
    )
  );
