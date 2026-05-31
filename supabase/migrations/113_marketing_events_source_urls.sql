-- v1.3 marketing panel (2026-05-25) — Phase 5 grounding follow-up.
--
-- Persists the Google Search citation URLs Gemini consulted when
-- it suggested each AI event, so the admin can audit "where did
-- this date come from?" later. Without this, paid the grounding
-- fee + threw the URLs away.
--
-- Stored as TEXT[] (capped at 5 URLs per event to bound row size)
-- rather than a separate join table — events are low-volume, the
-- URLs are read-mostly, no need for a new index.

ALTER TABLE marketing_events
  ADD COLUMN IF NOT EXISTS source_urls TEXT[] DEFAULT '{}';

COMMENT ON COLUMN marketing_events.source_urls IS
  'v1.3 Phase 5.1 — Google Search citation URLs Gemini consulted '
  'when this event was AI-suggested. Empty for seeded + manual '
  'events. Up to 5 URLs (oldest dropped if more).';
