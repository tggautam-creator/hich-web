-- Allow any authenticated user to read other users' public profile fields.
-- Needed for: drivers viewing rider info, riders viewing driver info,
-- messaging windows, ratings display, etc.
DROP POLICY IF EXISTS "users_select_authenticated" ON users;
CREATE POLICY "users_select_authenticated"
  ON users FOR SELECT
  USING (auth.role() = 'authenticated');
