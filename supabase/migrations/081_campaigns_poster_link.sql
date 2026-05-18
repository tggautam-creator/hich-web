-- 081_campaigns_poster_link.sql
--
-- Slice 1.6 bonus — clickable poster + branded footer for email
-- campaigns (and persisted destination for push campaigns).
--
-- Adds:
--   poster_link_url — TEXT NULL. Optional URL the poster image
--                     should open when clicked. For EMAIL: the
--                     send path wraps the prepended `<img>` in an
--                     `<a href="...">` so the hero is clickable in
--                     the recipient's inbox. For PUSH/CAMPAIGN
--                     DETAIL: the public `GET /api/campaigns/:slug`
--                     returns it so the CampaignDetailPage (web)
--                     and CampaignDetailView (iOS) can make the
--                     hero clickable too — same link works whether
--                     the recipient arrives via email tap or push
--                     tap.
--
-- Use cases:
--   * "Spring Fling tickets" hero → links to the ticket sale page
--   * "Finish setting up your account" → links to /onboarding
--   * Marketing promo → links to a partner site
--
-- No CHECK constraint on the URL shape (admin enters arbitrary
-- URLs — partners, internal routes, anything). UI side validates
-- it looks like a URL before submit.
--
-- Reversibility: drop the column to roll back. Idempotent via
-- IF NOT EXISTS.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS poster_link_url TEXT;

COMMENT ON COLUMN public.campaigns.poster_link_url IS
  'Optional URL the poster image should open when clicked. Wired in the email send path (anchor wrapping the prepended hero <img>) AND surfaced on the public /api/campaigns/:slug endpoint so the in-app campaign detail views (web + iOS) can make the hero clickable. NULL = poster is not clickable. See migration 081.';
