-- 080_campaigns_email_channel.sql
--
-- Email broadcast channel support (Phase 1, Slice 1.5 of the admin
-- panel).
--
-- Extends `public.campaigns` so a single table can store both push
-- broadcasts (channel='push') and email broadcasts (channel='email').
-- The history list, recall flow, and audit pattern all reuse the
-- existing infrastructure — only the send path differs (sendFcmPush
-- vs Resend).
--
-- Columns:
--   channel       — TEXT NOT NULL DEFAULT 'push'. Existing rows
--                   backfill to 'push' (they predate this migration
--                   and were all push-channel sends). CHECK
--                   constraint pins to the two known values; adding
--                   a third channel later (sms? in-app banner?)
--                   means another migration that loosens the check.
--   email_from    — TEXT NULL. The From address an email campaign
--                   was sent from (e.g. 'marketing@tagorides.com').
--                   NULL for push rows.
--
-- For email rows:
--   * `title`       holds the email SUBJECT.
--   * `body`        holds the HTML body (TipTap-serialized).
--   * `poster_url`  stays NULL (inline images live inside body HTML).
--
-- Audience filter for email campaigns uses
-- `notification_preferences.email_marketing` (vs push_promos for
-- push) — column already exists in migration 055.
--
-- Reversibility: drop the two columns + the check constraint to roll
-- back. Idempotent via IF NOT EXISTS / DROP IF EXISTS.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'push';

-- CHECK constraint added separately so the IF NOT EXISTS on the
-- column add doesn't trip when the constraint already exists.
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_channel_check;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_channel_check
  CHECK (channel IN ('push', 'email'));

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS email_from TEXT;

COMMENT ON COLUMN public.campaigns.channel IS
  'push | email. Determines which send path fires (sendFcmPush vs Resend) + which user-preference column gates the recipient set (push_promos vs email_marketing). Existing pre-migration rows backfill to push. See migration 080.';

COMMENT ON COLUMN public.campaigns.email_from IS
  'From address used for an email campaign (e.g. marketing@tagorides.com). NULL for push rows. Must match an entry in the server-side allowlist enforced at send time.';

-- Index for the channel-filtered history views the UI will eventually
-- want (e.g. "show only email campaigns"). Partial sized — most rows
-- will be push for the first while.
CREATE INDEX IF NOT EXISTS idx_campaigns_channel_sent_at
  ON public.campaigns (channel, sent_at DESC);
