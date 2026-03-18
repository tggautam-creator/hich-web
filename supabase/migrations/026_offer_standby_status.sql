-- Add 'standby' status to ride_offers.
-- Standby means: "rider picked another driver, but you're on backup."
-- If the selected driver cancels, standby offers revert to 'pending'.
-- Standby offers are released when the ride starts or is cancelled.

-- Drop existing check constraint (if any)
ALTER TABLE ride_offers
  DROP CONSTRAINT IF EXISTS ride_offers_status_check;

-- Widen the column to accept 'standby'
-- (If status is an enum, alter it; if it's text with a check, re-add the check.)
-- Supabase typically uses text + check constraint for status columns.
DO $$
BEGIN
  -- Try to alter enum if it exists
  BEGIN
    ALTER TYPE ride_offer_status ADD VALUE IF NOT EXISTS 'standby';
  EXCEPTION WHEN undefined_object THEN
    -- Not an enum — it's a text column, add a check constraint
    NULL;
  END;
END $$;

-- Add check constraint for all valid statuses
ALTER TABLE ride_offers
  ADD CONSTRAINT ride_offers_status_check
  CHECK (status IN ('pending', 'selected', 'standby', 'released'));
