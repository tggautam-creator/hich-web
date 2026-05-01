-- 2026-05-01 — Driver snooze (decline → "I'm busy" UX)
--
-- When a driver declines an inbound ride request, the iOS sheet asks
-- WHY (analytics) and offers to snooze them for 15 min / 1 hr / 2 hr /
-- rest of day. While snoozed, the matcher must skip them so they don't
-- get bombarded with notifications they're going to dismiss anyway.
--
-- Schema choices:
--   * `snoozed_until` lives on `driver_locations` (not a separate table)
--     because the matcher already reads this row on every match attempt
--     — colocation = zero extra query.
--   * `driver_decline_reasons` is a separate table because reasons are
--     append-only analytics data, not hot-path state. Keeping it off
--     `driver_locations` avoids bloating the row that gets upserted
--     every 30 s.

-- ── 1. Snoozed-until column ─────────────────────────────────────────────
ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS driver_locations_snoozed_until_idx
  ON public.driver_locations (snoozed_until)
  WHERE snoozed_until IS NOT NULL;

COMMENT ON COLUMN public.driver_locations.snoozed_until IS
  'When NOT NULL and > NOW(), the matcher excludes this driver. Set when '
  'the driver picks a snooze duration on the post-decline reason sheet. '
  'Cleared by the driver tapping "Resume now" on the home indicator.';

-- ── 2. Update the matcher RPC to skip snoozed drivers ───────────────────
CREATE OR REPLACE FUNCTION public.nearby_active_drivers(
  origin_lng double precision,
  origin_lat double precision,
  radius_m   double precision DEFAULT 15000,
  stale_min  integer          DEFAULT 5
)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT dl.user_id
  FROM   driver_locations dl
  JOIN   users u ON u.id = dl.user_id
  WHERE  u.is_driver = true
    AND  dl.is_online = true
    AND  (dl.snoozed_until IS NULL OR dl.snoozed_until <= NOW())
    AND  dl.recorded_at > NOW() - (stale_min || ' minutes')::interval
    AND  ST_DWithin(
           dl.location::geography,
           ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography,
           radius_m
         );
$$;

-- ── 3. Decline-reasons analytics table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.driver_decline_reasons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ride_id         UUID NULL REFERENCES public.rides(id) ON DELETE SET NULL,
  reason          TEXT NOT NULL,
  snooze_minutes  INTEGER NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS driver_decline_reasons_driver_id_idx
  ON public.driver_decline_reasons (driver_id, created_at DESC);

COMMENT ON TABLE public.driver_decline_reasons IS
  'Append-only log of why drivers declined ride requests + which snooze '
  'duration (if any) they picked. Drives future personalisation (e.g. '
  '"You usually decline rides going north — show direction filter?").';

-- ── 4. RLS — driver can read their own rows; service-role writes ────────
ALTER TABLE public.driver_decline_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY driver_decline_reasons_self_read
  ON public.driver_decline_reasons
  FOR SELECT
  USING (auth.uid() = driver_id);

-- (No INSERT policy — only the server (service-role key) writes here, so
--  drivers can't fabricate decline reasons that influence personalisation.)
