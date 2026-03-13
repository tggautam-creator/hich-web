-- Emergency location sharing tokens
CREATE TABLE IF NOT EXISTS location_shares (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token      TEXT NOT NULL UNIQUE,
  ride_id    UUID NOT NULL REFERENCES rides(id),
  user_id    UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_location_shares_token ON location_shares (token);

-- RLS: only the user who created the share can see it
ALTER TABLE location_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own shares"
  ON location_shares FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own shares"
  ON location_shares FOR SELECT
  USING (auth.uid() = user_id);

-- Service role (supabaseAdmin) bypasses RLS for the public tracking page
