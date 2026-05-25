-- v1.3 — `ride_suggestions` table.
--
-- The persistent store for the Suggested Rides feature. One row =
-- one suggested rider/driver pairing for one trip date. Both viewers
-- read from the same row but render different sides (rider sees the
-- driver-side info + a "Request this ride" CTA; driver sees the
-- rider-side info + an "Offer this ride" CTA). Per-side `*_status`
-- columns let one side dismiss without affecting the other.
--
-- DESIGN NOTES
-- - The "source" of a suggestion is one of four origin records:
--   rider_schedule_id, driver_schedule_id, rider_routine_id, or
--   driver_routine_id. A given suggestion typically has at least one
--   on each side (e.g. rider_schedule + driver_routine, or
--   rider_routine + driver_schedule). The unique index keys on the
--   (rider source, driver source, trip_date) triple so the engine can
--   safely UPSERT without producing duplicates across cron runs.
-- - `trip_date` is the calendar date the match would happen on. Used
--   for browse-list ordering AND for the nightly expiry sweep.
-- - `expires_at` is `trip_date + 1 day` so suggestions linger one day
--   past the trip (a back-stop for the user to act on a same-day
--   match before the cron purges it).
-- - `relevance_score` is a 0..1 composite from bearing alignment +
--   time proximity + origin proximity + (for reverse-trip) temporal
--   distance. Drives ranking on the home card + tab.
-- - `match_signals` keeps the per-axis raw inputs so we can debug
--   "why was this suggested?" without a re-run and so a future ML
--   ranker has training data.
-- - `notified_via_instant` flags suggestions where the underlying
--   ride already entered the live Stage 1/2/3 matching loop today.
--   Prevents double-pushing the user — the instant flow's push wins.
-- - `*_notified_at` are the per-side timestamps the cron uses to
--   decide whether to push or fold into the daily digest (instant
--   threshold = relevance > 0.7 OR trip_date = today; everything else
--   waits for the 7am sweep).

CREATE TABLE IF NOT EXISTS ride_suggestions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Two viewers, two CTAs from the same row.
  rider_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Source records. At least one of (rider_schedule_id, rider_routine_id)
  -- and one of (driver_schedule_id, driver_routine_id) is non-null;
  -- the engine never writes a row with both rider sources or both
  -- driver sources null. Enforced via CHECK below.
  rider_schedule_id   UUID REFERENCES ride_schedules(id) ON DELETE CASCADE,
  driver_schedule_id  UUID REFERENCES ride_schedules(id) ON DELETE CASCADE,
  rider_routine_id    UUID REFERENCES rider_routines(id) ON DELETE CASCADE,
  driver_routine_id   UUID REFERENCES driver_routines(id) ON DELETE CASCADE,

  trip_date           DATE NOT NULL,
  match_type          TEXT NOT NULL
                        CHECK (match_type IN (
                          'same_day_forward',     -- Stage 3 forward (Phase A)
                          'routine_recurring',    -- nightly cron, both sides on a routine (Phase E)
                          'reverse_trip'          -- opposite-direction return-leg match (Phase D)
                        )),
  relevance_score     NUMERIC NOT NULL
                        CHECK (relevance_score >= 0 AND relevance_score <= 1),
  match_signals       JSONB NOT NULL DEFAULT '{}',

  -- Per-side state. 'new' = unseen by this viewer. 'seen' = appeared in
  -- their UI. 'dismissed' = swiped/closed (hidden for them, still
  -- visible to the other side). 'acted' = converted via the existing
  -- /schedule/request or /schedule/board/offers endpoints.
  rider_status        TEXT NOT NULL DEFAULT 'new'
                        CHECK (rider_status IN ('new', 'seen', 'dismissed', 'acted')),
  driver_status       TEXT NOT NULL DEFAULT 'new'
                        CHECK (driver_status IN ('new', 'seen', 'dismissed', 'acted')),
  rider_notified_at   TIMESTAMPTZ,
  driver_notified_at  TIMESTAMPTZ,

  -- Dedup with the instant-matching loop — set true the first time
  -- the cron detects this match's rider_schedule is currently in the
  -- live Stage 1/2/3 fanout. Prevents the suggestion push from
  -- piling on top of the instant push.
  notified_via_instant BOOLEAN NOT NULL DEFAULT FALSE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,

  CONSTRAINT ride_suggestions_has_rider_source CHECK (
    rider_schedule_id IS NOT NULL OR rider_routine_id IS NOT NULL
  ),
  CONSTRAINT ride_suggestions_has_driver_source CHECK (
    driver_schedule_id IS NOT NULL OR driver_routine_id IS NOT NULL
  )
);

-- Dedup index: one suggestion per (rider source, driver source, date)
-- triple. The COALESCE pattern means rider_schedule_id takes priority
-- when present, else rider_routine_id; same on the driver side. This
-- lets the cron and the on-write engine UPSERT without coordinating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ride_suggestions_pair_day
  ON ride_suggestions (
    COALESCE(rider_schedule_id, rider_routine_id),
    COALESCE(driver_schedule_id, driver_routine_id),
    trip_date
  );

-- Per-viewer browse indexes (used by GET /api/suggestions/board and
-- GET /api/suggestions/top). Partial WHERE to skip dismissed rows
-- since the UI never asks for them.
CREATE INDEX IF NOT EXISTS idx_ride_suggestions_rider_active
  ON ride_suggestions (rider_user_id, trip_date, relevance_score DESC)
  WHERE rider_status <> 'dismissed';

CREATE INDEX IF NOT EXISTS idx_ride_suggestions_driver_active
  ON ride_suggestions (driver_user_id, trip_date, relevance_score DESC)
  WHERE driver_status <> 'dismissed';

-- Nightly expiry sweep index.
CREATE INDEX IF NOT EXISTS idx_ride_suggestions_expires
  ON ride_suggestions (expires_at);

ALTER TABLE ride_suggestions ENABLE ROW LEVEL SECURITY;

-- Read: a user can see suggestions where they are the rider OR the
-- driver. Writes go through the service role only (the suggestion
-- engine + the dismiss endpoint write as service role after JWT auth
-- validates the actor matches a side).
DROP POLICY IF EXISTS "ride_suggestions_select_either_side" ON ride_suggestions;
CREATE POLICY "ride_suggestions_select_either_side"
  ON ride_suggestions FOR SELECT
  USING (auth.uid() = rider_user_id OR auth.uid() = driver_user_id);

COMMENT ON TABLE ride_suggestions IS
  'v1.3 Suggested Rides — bidirectional pairing store. One row = one '
  'rider/driver match for one trip_date. Both sides read the same row '
  'and render their own CTA. Engine UPSERTs on (rider source, driver '
  'source, trip_date). Nightly cron purges where expires_at < now().';
