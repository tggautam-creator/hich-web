-- 041_vehicle_management_and_rls_fixes.sql
-- Adds soft-delete support for vehicles, fixes SELECT RLS so riders can see
-- driver vehicle info, and hardens UPDATE policy against editing deleted rows.

-- ── 1. Soft-delete column ────────────────────────────────────────────────────
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- ── 2. Fix vehicles SELECT — all authenticated users need to read vehicles ───
--    Riders must see driver vehicle info on pickup, active-ride, and chat pages.
--    Vehicle data (make, model, color, plate) is non-sensitive.
--    license_plate_photo_url is a path inside a PRIVATE storage bucket.
DROP POLICY IF EXISTS "vehicles_select_own" ON vehicles;
DROP POLICY IF EXISTS "vehicles_select_authenticated" ON vehicles;
CREATE POLICY "vehicles_select_authenticated"
  ON vehicles FOR SELECT
  TO authenticated
  USING (true);

-- ── 3. Harden UPDATE — owner-only, exclude soft-deleted rows ─────────────────
DROP POLICY IF EXISTS "vehicles_update_own" ON vehicles;
CREATE POLICY "vehicles_update_own"
  ON vehicles FOR UPDATE
  USING (auth.uid() = user_id AND deleted_at IS NULL)
  WITH CHECK (auth.uid() = user_id);

-- ── 4. Re-create INSERT (unchanged, but explicit for completeness) ───────────
DROP POLICY IF EXISTS "vehicles_insert_own" ON vehicles;
CREATE POLICY "vehicles_insert_own"
  ON vehicles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── 5. NO DELETE policy ──────────────────────────────────────────────────────
--    Vehicles are soft-deleted (UPDATE deleted_at + is_active = false).
--    Hard delete is never allowed from the client — preserves FK integrity
--    with rides and ride_offers tables.
