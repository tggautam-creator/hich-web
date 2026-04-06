-- Reports submitted by users via the in-app report flow
CREATE TABLE IF NOT EXISTS reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_id     uuid REFERENCES rides(id) ON DELETE SET NULL,
  category    text NOT NULL,
  description text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Users can only read their own reports; inserts validated server-side via service role
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users can view own reports" ON reports
  FOR SELECT USING (auth.uid() = user_id);
