-- V4 F6 — Explore (Events & Places): discovery + group-travel matching.
--
-- UI label is "Explore" (sub-tabs Events / Places). Internal entity is
-- `destinations` to avoid the `trips` (mig 097, cost-settlement) and
-- `marketing_events` (mig 112, admin calendar) collisions — every new
-- table here is prefixed `destination_*` / `featured_destinations` per
-- V4 plan §5.6.
--
-- Flow: admins curate `featured_destinations` (auto-promoted when ≥5
-- distinct users request the same one). Riders join `destination_waitlist`
-- (with up to 2 companions, reusing F1). Drivers post a
-- `destination_driver_plan` (which also auto-creates a ride-board post).
-- `destination_offers` is the two-way connection; on accept it converts to
-- real `rides` rows (outbound + optional return), reusing the board flow.
--
-- RLS lesson from F1 B.7: owner-only client RLS blocks the COUNTERPARTY
-- (a driver can't read a rider's waitlist row, and vice versa). So writes
-- are owner-scoped here and all CROSS-PARTY browsing/connection goes
-- through the server (supabaseAdmin) — never a client query.

-- ── featured_destinations — admin-curated public catalogue ───────────────────
CREATE TABLE IF NOT EXISTS public.featured_destinations (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           TEXT         NOT NULL CHECK (kind IN ('event', 'place')),
  name           TEXT         NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  slug           TEXT         NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 200),
  description    TEXT         CHECK (description IS NULL OR length(description) <= 2000),
  image_url      TEXT         CHECK (image_url IS NULL OR length(image_url) <= 1024),
  location       GEOGRAPHY(Point, 4326),
  city           TEXT         CHECK (city IS NULL OR length(city) <= 120),
  region         TEXT         CHECK (region IS NULL OR length(region) <= 120),
  -- Events carry dates; places are evergreen (both nullable).
  event_date     DATE,
  event_end_date DATE,
  status         TEXT         NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'coming_soon', 'archived')),
  source         TEXT         NOT NULL DEFAULT 'admin'
                              CHECK (source IN ('admin', 'auto_promoted')),
  sort_priority  INTEGER      NOT NULL DEFAULT 0,
  -- Nullable so admin/auto-promoted rows can exist without a user owner.
  created_by     UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS featured_destinations_kind_status_idx
  ON public.featured_destinations (kind, status, sort_priority DESC, event_date);

ALTER TABLE public.featured_destinations ENABLE ROW LEVEL SECURITY;

-- Public read of the live catalogue; archived rows hidden from clients.
-- Writes are service-role only (admin curation endpoints) — no client
-- INSERT/UPDATE/DELETE policy.
DROP POLICY IF EXISTS featured_destinations_select_live ON public.featured_destinations;
CREATE POLICY featured_destinations_select_live
  ON public.featured_destinations FOR SELECT
  USING (status <> 'archived');

-- ── destination_requests — demand signal ("I wish Tago went to X") ───────────
CREATE TABLE IF NOT EXISTS public.destination_requests (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind            TEXT         NOT NULL CHECK (kind IN ('event', 'place')),
  requested_name  TEXT         NOT NULL CHECK (length(requested_name) BETWEEN 1 AND 160),
  -- Lowercased/trimmed for demand counting + dedup; ≥5 distinct users on
  -- the same normalized_name auto-promotes to featured_destinations
  -- (handled server-side at request time — the "sweep" option in §5.6).
  normalized_name TEXT         NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 160),
  note            TEXT         CHECK (note IS NULL OR length(note) <= 500),
  target_date     DATE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Anti-spam: one request per user per normalized destination.
  UNIQUE (user_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS destination_requests_normalized_idx
  ON public.destination_requests (normalized_name);

ALTER TABLE public.destination_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS destination_requests_insert_own ON public.destination_requests;
CREATE POLICY destination_requests_insert_own
  ON public.destination_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS destination_requests_select_own ON public.destination_requests;
CREATE POLICY destination_requests_select_own
  ON public.destination_requests FOR SELECT
  USING (auth.uid() = user_id);

-- ── destination_driver_plans — "I'm driving to X on this date" ───────────────
CREATE TABLE IF NOT EXISTS public.destination_driver_plans (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id    UUID         NOT NULL REFERENCES public.featured_destinations(id) ON DELETE CASCADE,
  driver_id         UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  outbound_date     DATE         NOT NULL,
  outbound_time     TIME,
  wants_return      BOOLEAN      NOT NULL DEFAULT FALSE,
  return_date       DATE,
  return_time       TIME,
  seats_total       INTEGER      NOT NULL DEFAULT 1 CHECK (seats_total BETWEEN 1 AND 8),
  seats_available   INTEGER      NOT NULL DEFAULT 1 CHECK (seats_available >= 0),
  note              TEXT         CHECK (note IS NULL OR length(note) <= 500),
  status            TEXT         NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'full', 'cancelled', 'completed')),
  -- The ride-board post auto-created from this plan (so a driver
  -- registering a plan also shows up on the board). Nulled if that post
  -- is removed.
  board_schedule_id UUID         REFERENCES public.ride_schedules(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS destination_driver_plans_dest_idx
  ON public.destination_driver_plans (destination_id, status, outbound_date);
CREATE INDEX IF NOT EXISTS destination_driver_plans_driver_idx
  ON public.destination_driver_plans (driver_id, created_at DESC);

ALTER TABLE public.destination_driver_plans ENABLE ROW LEVEL SECURITY;

-- Driver owns their plans. Riders browsing "who's going" read via the
-- server (supabaseAdmin) — no cross-party client policy.
DROP POLICY IF EXISTS destination_driver_plans_rw_own ON public.destination_driver_plans;
CREATE POLICY destination_driver_plans_rw_own
  ON public.destination_driver_plans FOR ALL
  USING (auth.uid() = driver_id)
  WITH CHECK (auth.uid() = driver_id);

-- ── destination_waitlist — "I want to go to X" (rider + companions) ──────────
CREATE TABLE IF NOT EXISTS public.destination_waitlist (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id  UUID         NOT NULL REFERENCES public.featured_destinations(id) ON DELETE CASCADE,
  rider_id        UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  desired_date    DATE,
  desired_time    TIME,
  wants_return    BOOLEAN      NOT NULL DEFAULT FALSE,
  return_date     DATE,
  return_time     TIME,
  travel_mode     TEXT         NOT NULL DEFAULT 'together'
                              CHECK (travel_mode IN ('together', 'own_thing', 'one_way')),
  -- Group size = rider + companions (F1). Hard cap small.
  group_size      INTEGER      NOT NULL DEFAULT 1 CHECK (group_size BETWEEN 1 AND 5),
  companion_a_id  UUID         REFERENCES public.companions(id) ON DELETE SET NULL,
  companion_b_id  UUID         REFERENCES public.companions(id) ON DELETE SET NULL,
  note            TEXT         CHECK (note IS NULL OR length(note) <= 500),
  status          TEXT         NOT NULL DEFAULT 'waiting'
                              CHECK (status IN ('waiting', 'offered', 'matched', 'cancelled')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- One active waitlist entry per rider per destination.
  UNIQUE (destination_id, rider_id)
);

CREATE INDEX IF NOT EXISTS destination_waitlist_dest_idx
  ON public.destination_waitlist (destination_id, status, desired_date);
CREATE INDEX IF NOT EXISTS destination_waitlist_rider_idx
  ON public.destination_waitlist (rider_id, created_at DESC);

ALTER TABLE public.destination_waitlist ENABLE ROW LEVEL SECURITY;

-- Rider owns their waitlist entries. Drivers browsing the waitlist read
-- via the server (supabaseAdmin) — no cross-party client policy.
DROP POLICY IF EXISTS destination_waitlist_rw_own ON public.destination_waitlist;
CREATE POLICY destination_waitlist_rw_own
  ON public.destination_waitlist FOR ALL
  USING (auth.uid() = rider_id)
  WITH CHECK (auth.uid() = rider_id);

-- ── destination_offers — the two-way connection (driver⇄rider) ───────────────
CREATE TABLE IF NOT EXISTS public.destination_offers (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id  UUID         NOT NULL REFERENCES public.featured_destinations(id) ON DELETE CASCADE,
  driver_plan_id  UUID         REFERENCES public.destination_driver_plans(id) ON DELETE CASCADE,
  waitlist_id     UUID         REFERENCES public.destination_waitlist(id) ON DELETE CASCADE,
  driver_id       UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rider_id        UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  initiated_by    TEXT         NOT NULL CHECK (initiated_by IN ('driver', 'rider')),
  note            TEXT         CHECK (note IS NULL OR length(note) <= 500),
  status          TEXT         NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'declined', 'released')),
  -- Real ride rows created on accept (return nullable). Reuse the board
  -- request→ride conversion; same driver for both legs.
  outbound_ride_id UUID        REFERENCES public.rides(id) ON DELETE SET NULL,
  return_ride_id   UUID        REFERENCES public.rides(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS destination_offers_driver_idx
  ON public.destination_offers (driver_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS destination_offers_rider_idx
  ON public.destination_offers (rider_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS destination_offers_plan_idx
  ON public.destination_offers (driver_plan_id);
CREATE INDEX IF NOT EXISTS destination_offers_waitlist_idx
  ON public.destination_offers (waitlist_id);

ALTER TABLE public.destination_offers ENABLE ROW LEVEL SECURITY;

-- Either participant can READ their offers; all WRITES (create/accept/
-- decline/release + the ride conversion) go through the server
-- (supabaseAdmin) so the connection logic stays authoritative.
DROP POLICY IF EXISTS destination_offers_select_participant ON public.destination_offers;
CREATE POLICY destination_offers_select_participant
  ON public.destination_offers FOR SELECT
  USING (auth.uid() = driver_id OR auth.uid() = rider_id);

-- ── Seed a few destinations so Explore has content during dev ────────────────
-- (Real catalogue is admin-curated; these are safe evergreen placeholders.)
INSERT INTO public.featured_destinations (kind, name, slug, description, city, region, status, source, sort_priority)
VALUES
  ('place', 'Lake Tahoe', 'lake-tahoe', 'Alpine lake getaway — beaches in summer, slopes in winter.', 'South Lake Tahoe', 'CA', 'active', 'admin', 100),
  ('place', 'Yosemite National Park', 'yosemite', 'Granite cliffs, waterfalls, and giant sequoias.', 'Yosemite Valley', 'CA', 'active', 'admin', 90),
  ('place', 'San Francisco', 'san-francisco', 'City trips — Golden Gate, Embarcadero, the works.', 'San Francisco', 'CA', 'active', 'admin', 80)
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE public.featured_destinations IS
  'V4 F6 — admin-curated Explore catalogue (events + places). Public-read live rows; writes service-role only.';
COMMENT ON TABLE public.destination_waitlist IS
  'V4 F6 — riders wanting to go (rider + up to 2 companions). Owner-RLS; drivers browse via server.';
COMMENT ON TABLE public.destination_driver_plans IS
  'V4 F6 — driver plans to a destination; auto-creates a ride-board post. Owner-RLS; riders browse via server.';
COMMENT ON TABLE public.destination_offers IS
  'V4 F6 — two-way driver⇄rider connection; on accept converts to outbound (+return) rides.';
