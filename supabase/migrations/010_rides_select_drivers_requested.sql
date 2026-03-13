-- Allow drivers to SELECT rides with status 'requested' so they can view
-- ride details before accepting. Without this, RLS blocks the driver
-- because driver_id is NULL until they accept.
DROP POLICY IF EXISTS "rides_select_drivers_requested" ON rides;
CREATE POLICY "rides_select_drivers_requested"
  ON rides FOR SELECT
  USING (
    status = 'requested'
    AND EXISTS (
      SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_driver = true
    )
  );
