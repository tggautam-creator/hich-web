-- 115_marketing_weekly_reviews.sql (2026-05-31)
--
-- Feature 4 — Weekly Slack review.
--
-- Tracks each week's auto-generated marketing summary that gets
-- posted to the Slack webhook (SLACK_MARKETING_WEBHOOK_URL). One
-- row per week, identified by the Monday date the week starts on
-- (PT-anchored). The cron generates Monday morning 9 AM PT covering
-- the previous Monday-Sunday window.
--
-- Why a separate table from marketing_daily_briefings: different
-- cadence (weekly vs daily), different consumer (Slack vs the
-- admin UI banner), different content shape (Block Kit JSON vs
-- structured recommendations). One unified table would bury both
-- features in conditional columns.

CREATE TABLE IF NOT EXISTS marketing_weekly_reviews (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monday of the week being reviewed (PT-anchored YYYY-MM-DD).
  -- Cron-retry idempotency: UNIQUE constraint means a second run on
  -- the same Monday no-ops via INSERT ... ON CONFLICT DO NOTHING.
  for_week_starting     DATE NOT NULL UNIQUE,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  llm_model             TEXT,                 -- nullable for error rows
  -- LLM output, parsed
  summary               TEXT,                 -- 1-3 sentence headline
  highlights            JSONB,                -- bullet array
  next_week_focus       TEXT,                 -- recommended pivot
  -- Numeric context snapshot the LLM consumed (KPIs + activity counts)
  context_snapshot      JSONB,
  -- The actual Slack Block Kit payload that was/will be POSTed
  slack_payload         JSONB,
  -- Send-state tracking
  slack_sent_at         TIMESTAMPTZ,
  slack_response_status INTEGER,              -- HTTP status from Slack
  slack_response_body   TEXT,                 -- Slack's error string when not 200
  -- Usage tracking + error
  input_tokens          INTEGER,
  output_tokens         INTEGER,
  error                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_marketing_weekly_reviews_week
  ON marketing_weekly_reviews (for_week_starting DESC);

-- Same RLS treatment as the other marketing tables — admin-only.
ALTER TABLE marketing_weekly_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_weekly_reviews_admin ON marketing_weekly_reviews;
CREATE POLICY marketing_weekly_reviews_admin ON marketing_weekly_reviews
  FOR ALL USING (fn_is_admin()) WITH CHECK (fn_is_admin());

COMMENT ON COLUMN marketing_weekly_reviews.for_week_starting IS
  'Monday (PT) of the week being reviewed. Cron generates on the '
  'following Monday at 9 AM PT, summarizing the prior week.';

COMMENT ON COLUMN marketing_weekly_reviews.highlights IS
  'Array<{ icon: string, text: string }> — bullet list rendered as '
  'Slack section blocks. icon is a short text marker (NOT an emoji '
  'shortcode — Slack renders Unicode directly).';

COMMENT ON COLUMN marketing_weekly_reviews.context_snapshot IS
  'Frozen JSON the LLM consumed (last-7-day metrics + content '
  'history + theme + upcoming events). Lets a re-render reproduce '
  'the same numbers without re-querying.';

COMMENT ON COLUMN marketing_weekly_reviews.slack_response_status IS
  'HTTP status returned by Slack when the payload was POSTed. NULL '
  'before send; 200 on success; 4xx for invalid payload / channel '
  'not found / etc.';
