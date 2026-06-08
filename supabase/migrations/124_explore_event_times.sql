-- 124: event start/end TIMES + an optional event LINK for
-- featured_destinations.
--
-- Events have timings (a game at 7:00 PM, a festival 10 AM–10 PM), not just
-- a date. `event_time` is the start; `event_end_time` is the optional end
-- (for ranges). `event_url` is an optional link to the event (tickets /
-- official page) riders can tap. All nullable — places + all-day events
-- leave times null; events without a link leave event_url null.
ALTER TABLE public.featured_destinations
  ADD COLUMN IF NOT EXISTS event_time     TIME,
  ADD COLUMN IF NOT EXISTS event_end_time TIME,
  ADD COLUMN IF NOT EXISTS event_url      TEXT
    CHECK (event_url IS NULL OR length(event_url) <= 500);

COMMENT ON COLUMN public.featured_destinations.event_time IS
  'V4 F6 — event start time (local). NULL for places / all-day events.';
COMMENT ON COLUMN public.featured_destinations.event_end_time IS
  'V4 F6 — optional event end time (local), for ranges.';
COMMENT ON COLUMN public.featured_destinations.event_url IS
  'V4 F6 — optional event link (tickets / info) riders can tap. NULL if none.';

-- Seed a few demo times so the field is visible before the admin panel gains
-- an input. Best-effort by name; no-ops if the demo rows aren't present.
UPDATE public.featured_destinations
  SET event_time = '19:00' WHERE name = 'River Cats Night Game' AND event_time IS NULL;
UPDATE public.featured_destinations
  SET event_time = '12:00', event_end_time = '17:00' WHERE name = 'Music in the Park' AND event_time IS NULL;
UPDATE public.featured_destinations
  SET event_time = '10:00', event_end_time = '22:00' WHERE name = 'SF Pride Weekend' AND event_time IS NULL;
UPDATE public.featured_destinations
  SET event_url = 'https://www.sfpride.org' WHERE name = 'SF Pride Weekend' AND event_url IS NULL;
UPDATE public.featured_destinations
  SET event_url = 'https://www.milb.com/sacramento' WHERE name = 'River Cats Night Game' AND event_url IS NULL;
