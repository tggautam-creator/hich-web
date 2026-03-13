-- Add address text columns to driver_routines so synced board entries have readable addresses.
ALTER TABLE driver_routines
  ADD COLUMN IF NOT EXISTS origin_address TEXT,
  ADD COLUMN IF NOT EXISTS dest_address TEXT;
