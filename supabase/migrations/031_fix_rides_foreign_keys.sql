-- Fix foreign key constraints to allow user deletion
-- This migration adds ON DELETE CASCADE to all user foreign keys that are missing it

-- ── Fix rides table foreign keys ───────────────────────────────────────────
-- Drop existing foreign key constraints
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_rider_id_fkey;
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_driver_id_fkey;

-- Recreate with proper ON DELETE behavior
-- rider_id: CASCADE (delete ride when rider is deleted)
ALTER TABLE rides
ADD CONSTRAINT rides_rider_id_fkey
FOREIGN KEY (rider_id) REFERENCES users(id) ON DELETE CASCADE;

-- driver_id: CASCADE (delete ride when driver is deleted)
ALTER TABLE rides
ADD CONSTRAINT rides_driver_id_fkey
FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE CASCADE;

-- ── Fix transactions table foreign key ─────────────────────────────────────
-- Drop existing foreign key constraint
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_user_id_fkey;

-- Recreate with CASCADE (delete transactions when user is deleted)
ALTER TABLE transactions
ADD CONSTRAINT transactions_user_id_fkey
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ── Fix location_shares table foreign key ──────────────────────────────────
-- Drop existing foreign key constraint
ALTER TABLE location_shares DROP CONSTRAINT IF EXISTS location_shares_user_id_fkey;

-- Recreate with CASCADE (delete location shares when user is deleted)
ALTER TABLE location_shares
ADD CONSTRAINT location_shares_user_id_fkey
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ── Fix ride_schedules table foreign key ───────────────────────────────────
-- Note: ride_schedules references auth.users(id), not public.users(id)
-- This should cascade when the auth user is deleted
ALTER TABLE ride_schedules DROP CONSTRAINT IF EXISTS ride_schedules_user_id_fkey;

-- Recreate with CASCADE (delete schedule when auth user is deleted)
ALTER TABLE ride_schedules
ADD CONSTRAINT ride_schedules_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;