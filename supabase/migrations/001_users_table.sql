-- Migration 001 — users table + PostGIS
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: tables use IF NOT EXISTS; policies use DROP IF EXISTS + CREATE.

-- ── PostGIS extension ────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text          NOT NULL UNIQUE,
  phone               text,
  full_name           text,
  avatar_url          text,
  wallet_balance      integer       NOT NULL DEFAULT 0,   -- always in cents
  stripe_customer_id  text,
  is_driver           boolean       NOT NULL DEFAULT false,
  rating_avg          numeric,
  rating_count        integer       NOT NULL DEFAULT 0,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

-- ── home_location geometry column ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'home_location'
  ) THEN
    ALTER TABLE users
      ADD COLUMN home_location GEOMETRY(Point, 4326);
  END IF;
END;
$$;

-- ── Row-level security ────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can read their own row
DROP POLICY IF EXISTS "users_select_own" ON users;
CREATE POLICY "users_select_own"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own row
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  USING (auth.uid() = id);
