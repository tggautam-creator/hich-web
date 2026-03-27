-- Saved addresses: Home, Work, and custom named locations per user
CREATE TABLE saved_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,                    -- 'home', 'work', or custom like 'Gym'
  place_id text,                          -- Google Places ID (nullable for manual entries)
  main_text text NOT NULL,                -- Display name (e.g., "123 Main St")
  secondary_text text,                    -- City, state, etc.
  full_address text NOT NULL,             -- Complete address string
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  is_preset boolean DEFAULT false,        -- true for 'home'/'work' slots
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_saved_addresses_user ON saved_addresses(user_id);

-- RLS: users can only manage their own addresses
ALTER TABLE saved_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own addresses" ON saved_addresses
  FOR ALL USING (auth.uid() = user_id);
