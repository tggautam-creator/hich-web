-- V4 F6 Explore — demo catalogue seed (no admin panel needed).
--
-- HOW TO RUN: open the Supabase dashboard → your DEV project →
-- SQL Editor → paste this → Run. Safe to re-run: ON CONFLICT (slug)
-- DO NOTHING skips rows that already exist.
--
-- The generated latitude/longitude columns (migration 121) populate
-- automatically from `location`, so cards get "X mi away" + fare for free.
--
-- To ADD YOUR OWN: copy a row below, give it a UNIQUE slug, set
-- kind = 'event' (with event_date) or 'place' (event_date NULL), and the
-- location as POINT(longitude latitude)  ← lng first, then lat.

INSERT INTO public.featured_destinations
  (kind, name, slug, description, image_url, city, region, event_date, status, source, sort_priority, location)
VALUES
  ('event', 'Music in the Park', 'davis-music-in-the-park',
   'Free outdoor concert in Central Park — bring a blanket.',
   'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800',
   'Davis', 'CA', '2026-06-13', 'active', 'admin', 70,
   ST_SetSRID(ST_MakePoint(-121.7405, 38.5449), 4326)::geography),

  ('event', 'River Cats Night Game', 'sac-river-cats',
   'Minor league baseball under the lights at Sutter Health Park.',
   'https://images.unsplash.com/photo-1508344928928-7165b67de128?w=800',
   'West Sacramento', 'CA', '2026-06-20', 'active', 'admin', 65,
   ST_SetSRID(ST_MakePoint(-121.5101, 38.5800), 4326)::geography),

  ('event', 'SF Pride Weekend', 'sf-pride-weekend',
   'Carpool to the city for Pride — parade + Civic Center festival.',
   'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=800',
   'San Francisco', 'CA', '2026-06-27', 'active', 'admin', 60,
   ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography),

  ('place', 'Santa Cruz Beach Boardwalk', 'santa-cruz-beach',
   'Classic beach + boardwalk rides, ~2.5 hrs from campus.',
   'https://images.unsplash.com/photo-1505228395891-9a51e7e86bf6?w=800',
   'Santa Cruz', 'CA', NULL, 'active', 'admin', 50,
   ST_SetSRID(ST_MakePoint(-122.0308, 36.9641), 4326)::geography),

  ('place', 'Napa Valley', 'napa-valley',
   'Wine country day trip — vineyards and tastings.',
   'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=800',
   'Napa', 'CA', NULL, 'active', 'admin', 45,
   ST_SetSRID(ST_MakePoint(-122.2869, 38.2975), 4326)::geography)
ON CONFLICT (slug) DO NOTHING;
