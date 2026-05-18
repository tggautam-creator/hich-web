-- 075_ride_offers_unique_schedule_driver.sql (2026-05-17)
--
-- (Originally numbered 074 — renamed to 075 because there was
-- already an unrelated `074_admin_audit_log.sql` from a parallel
-- work stream. Apply-in-order matters.)
--
-- Fixes a runtime bug discovered while testing the new board-offer
-- flow on 2026-05-17. Migration 072 created a PARTIAL unique index:
--
--   CREATE UNIQUE INDEX uq_ride_offers_schedule_driver
--     ON ride_offers (schedule_id, driver_id)
--     WHERE schedule_id IS NOT NULL;
--
-- PostgreSQL's `INSERT ... ON CONFLICT (cols) DO UPDATE ...` clause
-- requires a unique constraint OR a unique index whose column set
-- AND predicate match what the planner can derive from the INSERT.
-- For partial indexes the planner needs a matching `WHERE` clause
-- on the conflict_target. The Supabase JS client's
-- `.upsert(row, { onConflict: 'schedule_id,driver_id' })` only emits
-- the column list — no predicate — so PostgreSQL returns
-- error code 42P10: "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification".
--
-- Fix: replace the partial unique index with a plain (non-partial)
-- unique index. NULLs are treated as DISTINCT by default in
-- PostgreSQL unique indexes (NULLS DISTINCT, the SQL standard),
-- which means:
--   * Instant-ride offers (schedule_id IS NULL, ride_id NOT NULL) —
--     unaffected. Multiple NULLs in schedule_id are still allowed
--     across different drivers / rides.
--   * Board offers (schedule_id NOT NULL, ride_id IS NULL) — the
--     full unique index now enforces "at most one pending offer per
--     (schedule, driver)" pair, AND lets supabase-js .upsert() use
--     the conflict target without a WHERE predicate.
--
-- Idempotent via IF EXISTS / IF NOT EXISTS.

BEGIN;

DROP INDEX IF EXISTS public.uq_ride_offers_schedule_driver;

-- Note the absence of a WHERE clause — that's the whole point of
-- this migration. Default NULLS DISTINCT semantics keep instant-
-- ride rows unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ride_offers_schedule_driver
  ON public.ride_offers (schedule_id, driver_id);

COMMIT;
