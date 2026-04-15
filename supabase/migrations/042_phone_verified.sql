-- Add phone_verified column to users table
-- Tracks whether a user has verified their phone number via SMS OTP.
-- Required during onboarding; re-verified when phone number changes.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;
