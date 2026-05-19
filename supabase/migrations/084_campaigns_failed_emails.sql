-- 084_campaigns_failed_emails.sql (2026-05-19)
--
-- Per-campaign retry support. When `POST /api/admin/campaigns/email`
-- fires N personalized emails through Resend, anything that doesn't
-- come back with a delivery id is recorded here. The admin UI then
-- exposes a "Retry failed (N)" button on past campaigns, which
-- re-sends with the same subject + body using the persisted list.
-- After retry, this array is rewritten with the still-failed set so
-- retries are idempotent (clicking Retry on a clean list is a no-op).
--
-- Stored as the raw email string rather than `user_id`:
--   - The retry path doesn't need the user row (subject + body are on
--     the campaign row; we only need the address to send to).
--   - A user can have a deleted account but the campaign still needs
--     the historical list of who didn't get it.
--
-- Empty array default so existing rows continue to work without a
-- backfill. NULL avoidance keeps the JSON shape consistent on the
-- read path.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS failed_emails TEXT[] NOT NULL DEFAULT '{}';
