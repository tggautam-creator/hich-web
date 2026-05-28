-- v1.3 hotfix (2026-05-24) — drop the silent mode default on routines.
--
-- Background: migration 103 unified rider_routines into driver_routines
-- by adding `mode TEXT NOT NULL DEFAULT 'driver' CHECK (mode IN
-- ('driver','rider'))`. The default was a backwards-compat shim so that
-- code paths still in transition wouldn't break.
--
-- Side effect we just hit in production: the web client's routine
-- insert at src/components/schedule/SchedulePage.tsx omitted the mode
-- column. Every rider who clicked "Add routine" on the web got
-- mode='driver' silently — the row landed in driver_routines as a
-- driver. The suggestion engine, which correctly filters opposite-role
-- candidates via .eq('mode', oppositeRole), then surfaced those rider
-- rows to other riders as driver matches ("Request this ride" cards
-- for people who don't drive).
--
-- This migration removes the default so any future caller that forgets
-- to specify mode fails loudly with a NOT NULL violation instead of
-- silently mis-routing the row. iOS already specifies mode explicitly
-- (Tago/Core/Supabase/Repositories/RoutinesRepository.swift); the web
-- fix lands in the same deploy that applies this migration.
--
-- Idempotency: ALTER COLUMN DROP DEFAULT on a column with no default
-- is a no-op in Postgres — safe to re-run.
--
-- NOT NULL stays in place (carried over from 103); the CHECK constraint
-- also stays. We're only removing the DEFAULT.

ALTER TABLE driver_routines
  ALTER COLUMN mode DROP DEFAULT;

COMMENT ON COLUMN driver_routines.mode IS
  'v1.3 — driver or rider role for this routine. NOT NULL, no default '
  '(default dropped in migration 106 after web client bug masked rider '
  'inserts as driver rows). All clients MUST specify mode at insert '
  'time. Re-applies the unified-routines invariant from migration 103.';
