-- V4 F6 — waitlist date flexibility.
--
-- Places riders are often flexible ("any weekend" / "whenever") rather than
-- tied to a fixed date. Capture that so the demand signal tells a driver
-- WHEN to post a trip. `exact` keeps the existing `desired_date` behaviour;
-- `weekends` / `any` leave `desired_date` NULL.

ALTER TABLE public.destination_waitlist
  ADD COLUMN IF NOT EXISTS date_flexibility TEXT NOT NULL DEFAULT 'exact'
    CHECK (date_flexibility IN ('exact', 'weekends', 'any'));
