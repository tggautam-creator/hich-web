-- 085_api_usage_daily.sql (2026-05-19)
--
-- Per-day counter table for every external API call we fan out. Drives
-- the /admin/api-usage page so admins see "we're at 42 of 100 Resend
-- emails today" at a glance.
--
-- Schema:
--   service  TEXT  — short token: 'resend', 'fcm', 'gmaps_routes',
--                                  'gmaps_places', 'stripe'
--   date     DATE  — UTC day the call was made
--   count    INT   — running counter; incremented per call via
--                    `recordApiCall()` helper in server/lib/apiUsage.ts
--
-- Primary key is (service, date) so two daemons incrementing concurrently
-- coalesce into an UPSERT path (we use Supabase's `.upsert()` with the
-- conflict target spelled out — see apiUsage.ts).
--
-- We deliberately don't track per-user or per-endpoint detail at this
-- granularity — the goal is "are we close to a quota?" not "who hit
-- the endpoint." If we ever need per-endpoint debugging, add a
-- separate `api_call_log` table without dropping this rollup.

CREATE TABLE IF NOT EXISTS public.api_usage_daily (
  service TEXT NOT NULL,
  date    DATE NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (service, date)
);

-- Read pattern is "today's counts for all services" + "last 30 days
-- for a service." Index on date supports both without scanning.
CREATE INDEX IF NOT EXISTS idx_api_usage_daily_date
  ON public.api_usage_daily (date DESC);

-- Service-role only. The recordApiCall helper writes via supabaseAdmin
-- already (service-role key bypasses RLS), so we don't need a policy
-- for regular users.
ALTER TABLE public.api_usage_daily ENABLE ROW LEVEL SECURITY;
