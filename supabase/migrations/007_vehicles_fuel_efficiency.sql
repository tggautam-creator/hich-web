-- Migration 007 — Add fuel_efficiency_mpg column to vehicles table
-- Safe to re-run: uses IF NOT EXISTS pattern via DO block.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'fuel_efficiency_mpg'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN fuel_efficiency_mpg numeric NULL;
  END IF;
END $$;
