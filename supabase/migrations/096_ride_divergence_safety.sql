-- 096_ride_divergence_safety.sql (v1.2 Phase 3.1, 2026-05-23)
--
-- Adds divergence state machine columns to `rides` so the safety-net
-- cron (server/lib/rideSafetyNet.ts) can move a ride through:
--
--   NULL  →  'watching'  →  'warning'  →  'responded' OR 'safety_ended'
--
-- and the response endpoints (server/routes/rides.ts:
-- /safety-warning-response, /safety-end) can record who tapped what,
-- when, and whether SMS-help was minted. Numeric `warning_push_count`
-- gates the FCM throttle (hard cap 2 / ride, see MAX_WARNING_PUSHES).
--
-- All columns nullable / default NULL so existing rows keep their
-- current behaviour — the state machine only engages once the cron
-- starts populating them on a fresh ride.

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS divergence_state TEXT,
  ADD COLUMN IF NOT EXISTS divergence_first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warning_fired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warning_push_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warning_responded_by TEXT,
  ADD COLUMN IF NOT EXISTS warning_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warning_responded_role TEXT,
  ADD COLUMN IF NOT EXISTS help_sms_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS divergence_pattern TEXT;

-- ── CHECK constraints ─────────────────────────────────────────────────
ALTER TABLE rides
  DROP CONSTRAINT IF EXISTS rides_divergence_state_check;
ALTER TABLE rides
  ADD CONSTRAINT rides_divergence_state_check
  CHECK (
    divergence_state IS NULL
    OR divergence_state IN ('watching', 'warning', 'responded', 'safety_ended')
  );

ALTER TABLE rides
  DROP CONSTRAINT IF EXISTS rides_warning_responded_by_check;
ALTER TABLE rides
  ADD CONSTRAINT rides_warning_responded_by_check
  CHECK (
    warning_responded_by IS NULL
    OR warning_responded_by IN (
      'rider_in_car',
      'driver_in_car',
      'rider_left',
      'driver_left',
      'help_requested'
    )
  );

ALTER TABLE rides
  DROP CONSTRAINT IF EXISTS rides_warning_responded_role_check;
ALTER TABLE rides
  ADD CONSTRAINT rides_warning_responded_role_check
  CHECK (
    warning_responded_role IS NULL
    OR warning_responded_role IN ('rider', 'driver')
  );

-- Hard cap on warning_push_count — cron MUST never exceed 2 FCM pushes
-- per ride (MAX_WARNING_PUSHES). DB-level check is belt-and-suspenders.
ALTER TABLE rides
  DROP CONSTRAINT IF EXISTS rides_warning_push_count_cap;
ALTER TABLE rides
  ADD CONSTRAINT rides_warning_push_count_cap
  CHECK (warning_push_count >= 0 AND warning_push_count <= 2);

-- ── Partial index for the cron's hot scan ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rides_divergence_active
  ON rides (divergence_state)
  WHERE status = 'active' AND divergence_state IS NOT NULL;
