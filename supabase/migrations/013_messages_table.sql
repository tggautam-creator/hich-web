-- Messages table for ride chat between rider and driver
CREATE TABLE IF NOT EXISTS messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     uuid        NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  sender_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_ride_id ON messages(ride_id, created_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Rider and driver of the ride can read messages
DROP POLICY IF EXISTS "messages_select_participants" ON messages;
CREATE POLICY "messages_select_participants"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = messages.ride_id
        AND (rides.rider_id = auth.uid() OR rides.driver_id = auth.uid())
    )
  );

-- Participants can insert messages
DROP POLICY IF EXISTS "messages_insert_participants" ON messages;
CREATE POLICY "messages_insert_participants"
  ON messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM rides
      WHERE rides.id = messages.ride_id
        AND (rides.rider_id = auth.uid() OR rides.driver_id = auth.uid())
    )
  );
