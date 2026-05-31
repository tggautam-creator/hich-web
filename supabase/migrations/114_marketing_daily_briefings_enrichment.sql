-- 114_marketing_daily_briefings_enrichment.sql (2026-05-31)
--
-- Feature 3 — Daily focus brief for the Marketing Advisor.
--
-- The base table (migration 108) shipped with the placeholder shape:
--   id, for_date UNIQUE, generated_at, focus, detail, llm_model,
--   dismissed_at.
--
-- This migration enriches it for the actual generator:
--   kpi_snapshot   — frozen context the LLM consumed (JSONB)
--   recommendations — extracted bullets the UI renders as a quick list
--   thread_id      — backref to a spawned advisor thread (idempotent
--                    "Talk through this" CTA)
--   input_tokens / output_tokens — Pro/Flash usage tracking per call
--   error          — populated when generation fails (quota, parse)
--
-- The unique constraint on for_date is the cron-retry idempotency
-- guard (INSERT ... ON CONFLICT DO NOTHING). No new index needed —
-- PG's UNIQUE constraint already provides a btree.

ALTER TABLE marketing_daily_briefings
  ADD COLUMN IF NOT EXISTS kpi_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS recommendations JSONB,
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES marketing_advisor_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS error TEXT;

-- focus + llm_model were NOT NULL in 108. The generator now writes
-- error rows where focus is empty, so relax the constraint.
ALTER TABLE marketing_daily_briefings
  ALTER COLUMN focus DROP NOT NULL,
  ALTER COLUMN llm_model DROP NOT NULL;

COMMENT ON COLUMN marketing_daily_briefings.kpi_snapshot IS
  'Frozen context payload the LLM consumed when generating the brief '
  '— KPIs + day-over-day deltas + events + theme + history. Lets the '
  'UI re-render the supporting cards without re-fetching, and lets a '
  'thread spawned from this brief replay the same numbers.';

COMMENT ON COLUMN marketing_daily_briefings.recommendations IS
  'LLM-extracted bullets. Shape: '
  'Array<{ text: string (<=120 chars), priority: high|medium|low, '
  'tag: supply|demand|content|events|ops|growth }>. Capped at 5.';

COMMENT ON COLUMN marketing_daily_briefings.thread_id IS
  'If the founder clicks "Talk through this", a fresh advisor thread '
  'is spawned with the brief seeded as the opening assistant message. '
  'Backref here makes the spawn idempotent (clicking twice reopens '
  'the same thread).';

COMMENT ON COLUMN marketing_daily_briefings.error IS
  'Populated when generation failed — quota (all Gemini tiers in the '
  'chain hit 429), parse (LLM returned non-JSON), or other. Surfaced '
  'inline as a small badge instead of the banner. The next cron sweep '
  'or a manual regenerate retries.';
