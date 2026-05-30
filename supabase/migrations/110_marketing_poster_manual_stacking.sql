-- v1.3 marketing panel (2026-05-24) — Phase 2 hotfix.
--
-- Mirrors what migration 109 did for marketing_story_batches:
-- relax the (for_date, source) UNIQUE constraint on
-- marketing_poster_batches so manual generations can stack within
-- a day. The cron path remains idempotent via a partial unique
-- index gated to source='cron'.
--
-- Without this, the Phase-2 contract (cron idempotent, manual
-- stacks for targeted audiences) is broken at the schema layer:
-- the second manual click on the same day hits Postgres 23505 and
-- the admin UI surfaces a raw unique-violation error.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + CREATE UNIQUE INDEX
-- IF NOT EXISTS. Safe to re-run.

ALTER TABLE marketing_poster_batches
  DROP CONSTRAINT IF EXISTS marketing_poster_batches_one_per_day;

CREATE UNIQUE INDEX IF NOT EXISTS marketing_poster_batches_cron_one_per_day
  ON marketing_poster_batches (for_date)
  WHERE source = 'cron';
