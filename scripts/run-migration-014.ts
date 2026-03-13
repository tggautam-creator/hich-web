import { createClient } from '@supabase/supabase-js'

const url = process.env['SUPABASE_URL']!
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']!
const sb = createClient(url, key, { auth: { persistSession: false } })

// Check if table exists
const { error } = await sb.from('ride_ratings').select('id').limit(0)
if (!error) {
  console.log('ride_ratings table already exists')
  process.exit(0)
}

console.log('Table does not exist:', error.message)
console.log('')
console.log('Please run this SQL in the Supabase Dashboard SQL Editor:')
console.log('Dashboard → SQL Editor → New query → paste → Run')
console.log('')
console.log('='.repeat(60))
console.log(`
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

DROP POLICY IF EXISTS "ride_ratings_select_own" ON ride_ratings;
CREATE POLICY "ride_ratings_select_own"
  ON ride_ratings FOR SELECT
  USING (rated_id = auth.uid() OR rater_id = auth.uid());

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
`)
console.log('='.repeat(60))
