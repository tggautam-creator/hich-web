-- v1.3 marketing panel (2026-05-24) — Phase 5 smart calendar.
--
-- Stores upcoming events the admin wants to target with marketing.
-- Three sources:
--   - 'seeded'        — auto-loaded on first call: federal holidays,
--                       UC Davis academic calendar, Picnic Day, etc.
--   - 'ai_suggested'  — Gemini suggested via the "Refresh AI" button
--                       (admin can approve/reject)
--   - 'manual'        — admin typed it in
--
-- A 1-week reminder banner shows on the marketing dashboard for
-- every event whose event_date is within target_lead_time_days
-- AND reminder_dismissed_at IS NULL. Cron can also pipe these to
-- Slack/email in a follow-up phase.

CREATE TABLE IF NOT EXISTS marketing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  end_date DATE,
  category TEXT NOT NULL DEFAULT 'custom'
    CHECK (category IN (
      'holiday',         -- federal/national holidays
      'academic',        -- UC Davis quarter start/end, finals
      'campus',          -- Picnic Day, game days, move-in
      'travel-trigger',  -- Coachella, ski season, etc.
      'custom'           -- admin-defined
    )),
  location_hint TEXT,
  description TEXT,
  target_audience TEXT NOT NULL DEFAULT 'both'
    CHECK (target_audience IN ('rider', 'driver', 'both')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('seeded', 'ai_suggested', 'manual')),
  target_lead_time_days INTEGER NOT NULL DEFAULT 7,
  reminder_dismissed_at TIMESTAMPTZ,
  notes TEXT,
  -- Linkage to content that was created targeting this event so
  -- the calendar page can show "you've made 2 posters and 4 stories
  -- for this event" at a glance.
  linked_story_batch_ids UUID[] DEFAULT '{}',
  linked_poster_item_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uniqueness on (event_date, title) so re-running the seed doesn't
-- duplicate (e.g. Memorial Day 2027 should land once even if seed
-- fires multiple times).
CREATE UNIQUE INDEX IF NOT EXISTS marketing_events_one_per_date_title
  ON marketing_events (event_date, lower(title));

-- Common lookups: upcoming events ordered by date.
CREATE INDEX IF NOT EXISTS idx_marketing_events_event_date
  ON marketing_events (event_date);

-- Lookup for the reminder banner: events with active reminders
-- in the upcoming window.
CREATE INDEX IF NOT EXISTS idx_marketing_events_reminder_active
  ON marketing_events (event_date)
  WHERE reminder_dismissed_at IS NULL;

ALTER TABLE marketing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_events_admin_all ON marketing_events;
CREATE POLICY marketing_events_admin_all ON marketing_events
  FOR ALL
  USING (fn_is_admin())
  WITH CHECK (fn_is_admin());

COMMENT ON TABLE marketing_events IS
  'v1.3 Phase 5 — calendar of events Tago marketing should target. '
  'Seeded with academic + holiday + campus events; admin can add '
  'manual entries; Gemini can suggest more via the AI refresh button.';
