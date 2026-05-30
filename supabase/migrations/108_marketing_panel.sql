-- v1.3 marketing panel (2026-05-24) — Phase 0 foundation.
--
-- Five tables that back the new /admin/marketing surface:
--
--  - marketing_story_batches   ─ one row per daily story-gen run.
--  - marketing_story_items     ─ the 6 Instagram-story copies per run.
--  - marketing_poster_batches  ─ one row per daily poster-gen run.
--  - marketing_poster_items    ─ generated feed-poster copy (text only).
--  - marketing_themes          ─ monthly theme + weekly feature focus.
--  - marketing_advisor_threads ─ chat threads with the advisor agent.
--  - marketing_advisor_messages ─ per-thread message log.
--  - marketing_daily_briefings ─ pre-generated "focus for today" banner.
--
-- All tables are admin-only — RLS is enabled with a single policy that
-- allows access when the calling user has users.is_admin = true. The
-- server-side cron runs as service_role and bypasses RLS regardless.
--
-- Idempotent — every CREATE uses IF NOT EXISTS and every constraint /
-- index / policy is guarded.

-- ── helper: admin-only RLS policy used by every table below ────────
-- Re-applied on each table; expressing it as a stored function avoids
-- duplicating the subselect six times.
CREATE OR REPLACE FUNCTION public.fn_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

-- ── marketing_story_batches ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_story_batches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- which "day" the batch is for in PT (the cron clock). Stored as
  -- DATE so we can constrain at most one batch per day per source.
  for_date    DATE NOT NULL,
  -- 'cron' for scheduled runs, 'manual' when the admin clicks
  -- "Generate now" in the UI.
  source      TEXT NOT NULL CHECK (source IN ('cron', 'manual')),
  -- LLM provider + model snapshot for forensics.
  llm_model   TEXT NOT NULL,
  -- Total stories produced (typically 6).
  item_count  INTEGER NOT NULL DEFAULT 0,
  -- 'pending' until any item is acted on; 'reviewed' once at least one
  -- item is copied or skipped.
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'reviewed', 'failed')),
  error       TEXT,
  CONSTRAINT marketing_story_batches_one_per_day
    UNIQUE (for_date, source)
);
CREATE INDEX IF NOT EXISTS idx_marketing_story_batches_for_date
  ON marketing_story_batches (for_date DESC);

ALTER TABLE marketing_story_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_story_batches_admin ON marketing_story_batches;
CREATE POLICY marketing_story_batches_admin ON marketing_story_batches
  FOR ALL USING (fn_is_admin()) WITH CHECK (fn_is_admin());

-- ── marketing_story_items ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_story_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    UUID NOT NULL REFERENCES marketing_story_batches(id) ON DELETE CASCADE,
  -- e.g. "Davis ↔ SoCal", "Davis ↔ Bay Area", "Sac ↔ Davis".
  corridor    TEXT NOT NULL,
  -- 'driver' = corridor is rider-heavy, story asks for drivers.
  -- 'rider'  = corridor is driver-heavy, story asks for riders.
  asking_for  TEXT NOT NULL CHECK (asking_for IN ('driver', 'rider')),
  -- the LLM-generated copy fields the admin will copy-paste.
  headline    TEXT NOT NULL,
  body        TEXT NOT NULL,
  -- Friendly date label baked into the copy ("June 4", "Tomorrow").
  date_label  TEXT,
  -- How many rides this corridor pulled in.
  matched_ride_count INTEGER NOT NULL DEFAULT 0,
  -- Lifecycle. 'pending' → admin hasn't acted. 'copied' → admin
  -- clicked Copy. 'posted' → admin marks it as posted (UI toggle).
  -- 'skipped' → admin dismissed it.
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'copied', 'posted', 'skipped')),
  acted_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_story_items_batch
  ON marketing_story_items (batch_id, created_at);

ALTER TABLE marketing_story_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_story_items_admin ON marketing_story_items;
CREATE POLICY marketing_story_items_admin ON marketing_story_items
  FOR ALL USING (fn_is_admin()) WITH CHECK (fn_is_admin());

-- ── marketing_themes ───────────────────────────────────────────────
-- Editable from the admin UI. Roughly one row per month, but you can
-- pre-fill the year ahead if you want.
CREATE TABLE IF NOT EXISTS marketing_themes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- YYYY-MM-01 — the first of the month the theme applies to.
  effective_month DATE NOT NULL UNIQUE,
  theme_name  TEXT NOT NULL,
  theme_summary TEXT NOT NULL,
  -- Four weekly focus rotations (week_1 = first feed post of month, etc).
  week_1_feature TEXT NOT NULL,
  week_2_feature TEXT NOT NULL,
  week_3_feature TEXT NOT NULL,
  week_4_feature TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE marketing_themes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_themes_admin ON marketing_themes;
CREATE POLICY marketing_themes_admin ON marketing_themes
  FOR ALL USING (fn_is_admin()) WITH CHECK (fn_is_admin());

-- ── marketing_poster_batches ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_poster_batches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  for_date    DATE NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('cron', 'manual')),
  -- Snapshot of the theme used for this batch (denormalized so the
  -- batch tells a complete story even if the theme row is edited later).
  theme_id    UUID REFERENCES marketing_themes(id) ON DELETE SET NULL,
  theme_snapshot TEXT,
  weekly_focus_snapshot TEXT,
  llm_model   TEXT NOT NULL,
  item_count  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'reviewed', 'failed')),
  error       TEXT,
  CONSTRAINT marketing_poster_batches_one_per_day
    UNIQUE (for_date, source)
);

ALTER TABLE marketing_poster_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_poster_batches_admin ON marketing_poster_batches;
CREATE POLICY marketing_poster_batches_admin ON marketing_poster_batches
  FOR ALL USING (fn_is_admin()) WITH CHECK (fn_is_admin());

-- ── marketing_poster_items ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_poster_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    UUID NOT NULL REFERENCES marketing_poster_batches(id) ON DELETE CASCADE,
  -- 'rider' / 'driver' / 'both' — which audience this poster targets.
  audience    TEXT NOT NULL CHECK (audience IN ('rider', 'driver', 'both')),
  -- Suggested Canva template key — one of the four templates the admin
  -- maintains. Stays text so we can add new templates without a
  -- migration.
  canva_template TEXT,
  -- The four text fields the admin pastes into the template.
  headline    TEXT NOT NULL,
  subheadline TEXT,
  body        TEXT NOT NULL,
  hashtags    TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'copied', 'posted', 'skipped')),
  acted_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_poster_items_batch
  ON marketing_poster_items (batch_id, created_at);

ALTER TABLE marketing_poster_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_poster_items_admin ON marketing_poster_items;
CREATE POLICY marketing_poster_items_admin ON marketing_poster_items
  FOR ALL USING (fn_is_admin()) WITH CHECK (fn_is_admin());

-- ── marketing_advisor_threads ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_advisor_threads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Friendly auto-generated title for the sidebar (LLM-named after
  -- the first user message; truncated to ~60 chars).
  title       TEXT NOT NULL DEFAULT 'New conversation',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Bumped on every message so the sidebar can sort by recency
  -- without aggregating messages.
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The admin who owns this thread. Each admin's threads are
  -- scoped to them by the RLS policy below.
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_marketing_advisor_threads_user_recent
  ON marketing_advisor_threads (user_id, updated_at DESC);

ALTER TABLE marketing_advisor_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_advisor_threads_owner ON marketing_advisor_threads;
CREATE POLICY marketing_advisor_threads_owner ON marketing_advisor_threads
  FOR ALL USING (fn_is_admin() AND user_id = auth.uid())
  WITH CHECK (fn_is_admin() AND user_id = auth.uid());

-- ── marketing_advisor_messages ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_advisor_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES marketing_advisor_threads(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  -- Optional snapshot of token counts (input + output) so we can
  -- track Gemini quota burn in the admin UI.
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_advisor_messages_thread
  ON marketing_advisor_messages (thread_id, created_at);

ALTER TABLE marketing_advisor_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_advisor_messages_thread_owner ON marketing_advisor_messages;
CREATE POLICY marketing_advisor_messages_thread_owner ON marketing_advisor_messages
  FOR ALL USING (
    fn_is_admin() AND EXISTS (
      SELECT 1 FROM marketing_advisor_threads t
      WHERE t.id = thread_id AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    fn_is_admin() AND EXISTS (
      SELECT 1 FROM marketing_advisor_threads t
      WHERE t.id = thread_id AND t.user_id = auth.uid()
    )
  );

-- ── marketing_daily_briefings ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_daily_briefings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  for_date    DATE NOT NULL UNIQUE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The 1-2 sentence "focus for today" the cron pre-generates from
  -- live KPIs + the current theme.
  focus       TEXT NOT NULL,
  -- Optional expanded body shown when the admin expands the banner.
  detail      TEXT,
  llm_model   TEXT NOT NULL,
  -- Was the banner dismissed by an admin? Hides it for the day.
  dismissed_at TIMESTAMPTZ
);

ALTER TABLE marketing_daily_briefings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_daily_briefings_admin ON marketing_daily_briefings;
CREATE POLICY marketing_daily_briefings_admin ON marketing_daily_briefings
  FOR ALL USING (fn_is_admin()) WITH CHECK (fn_is_admin());

-- ── seed: one initial theme for the current month so the poster
--    generator has something to work with on day 1. The admin can
--    edit it from the UI. June 2026 = "Summer break is GO" per the
--    plan we agreed on.
INSERT INTO marketing_themes (
  effective_month, theme_name, theme_summary,
  week_1_feature, week_2_feature, week_3_feature, week_4_feature
)
VALUES (
  '2026-06-01',
  'Summer break is GO',
  'Riders heading home, drivers already on the route — meet in the middle. '
  || 'Position Tago as the obvious choice for the summer-break exodus from Davis '
  || 'to SoCal, Bay Area, and Sacramento.',
  'Safety: .edu email gate + emergency button + ride ratings',
  'Driver upside: instant Stripe wallet payouts + "your gas is paid"',
  'Smart matching: Suggested Rides + routine matching + transit handoff',
  'Frictionless: QR-scan start/end + no driver license required + 30-second post'
)
ON CONFLICT (effective_month) DO NOTHING;
