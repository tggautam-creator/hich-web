-- 116_email_templates_and_sends.sql (2026-06-02)
--
-- Feature: editable lifecycle email templates + per-user send ledger.
--
-- TWO TABLES:
--   email_templates   — admin-editable content (subject + markdown).
--                       One row per key (e.g. 'welcome-new-user').
--                       Changing a template never requires a deploy.
--   email_sends       — append-only ledger of every actual send.
--                       Drives idempotency (never double-send the
--                       same template to the same user) + debugging
--                       ("why didn't S. get the email?").
--
-- IDEMPOTENCY MODEL
-- The (user_id, template_key) pair gets a UNIQUE partial index that
-- only applies when status='sent', so a successful send blocks any
-- retry from sending again. Failed/queued rows can coexist freely
-- (a transient Resend 500 should be retryable).
--
-- TRIGGER
-- A cron sweep (server/lib/email/welcomeEmailSweep.ts) picks up
-- users where `onboarding_completed = true` AND no successful
-- 'welcome-new-user' send row exists, then sends the welcome email
-- using the template loaded from email_templates. Cron runs every
-- 5 min as part of the existing reminder sweep — zero added load
-- on the signup hot path.

-- ── email_templates ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable slug the server references. Mutable on edit so the
  -- ledger's `template_key` column anchors stably as long as the
  -- key string doesn't change. (Don't rename keys casually.)
  key           TEXT NOT NULL UNIQUE,
  -- Founder-visible name for the admin UI list. "Welcome — new user"
  -- vs the more technical key.
  name          TEXT NOT NULL,
  -- Subject line — supports {{var}} substitution like the body.
  subject       TEXT NOT NULL,
  -- Markdown source. Rendered to HTML at send time so the admin
  -- can't paste malicious HTML in (rendered through an allow-listed
  -- subset; no <script>, no raw embeds).
  body_markdown TEXT NOT NULL,
  -- Resend "From" address — must be on the FROM_ADDRESS_ALLOWLIST
  -- in server/lib/resend.ts (enforced server-side on update).
  from_email    TEXT NOT NULL DEFAULT 'support@tagorides.com',
  from_name     TEXT NOT NULL DEFAULT 'Tago Support',
  -- Reply-To address. Defaults to the same as From, but can be
  -- separate (e.g. founder's personal inbox).
  reply_to      TEXT,
  -- Allowlist of variable keys the template can reference. Anything
  -- outside this list is replaced with the empty string at render
  -- time so a future admin can't fish for {{password}} etc.
  variables     TEXT[] NOT NULL DEFAULT ARRAY['first_name', 'email']::TEXT[],
  -- Off-switch: when false, the sweep skips sending it. Lets you
  -- pause without losing the template.
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Admin-only RLS — same fn_is_admin() helper the other admin tables
-- use (defined in migration 108).
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_templates_admin ON email_templates;
CREATE POLICY email_templates_admin ON email_templates
  FOR ALL USING (fn_is_admin()) WITH CHECK (fn_is_admin());

-- ── email_sends ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_sends (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_key          TEXT NOT NULL,
  recipient_email       TEXT NOT NULL,
  -- Subject + body as rendered AT send time (post-substitution).
  -- Crucial for forensic debug — the template may have been edited
  -- since this row was created.
  subject_at_send       TEXT,
  body_html_at_send     TEXT,
  status                TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')) DEFAULT 'queued',
  provider_message_id   TEXT,
  error                 TEXT,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  -- Test sends (via the admin "send test to me" button) are flagged
  -- so they don't pollute the production send-history stats.
  is_test               BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at               TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_sends_user_template
  ON email_sends (user_id, template_key);
CREATE INDEX IF NOT EXISTS idx_email_sends_status_created
  ON email_sends (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_sends_template_recent
  ON email_sends (template_key, created_at DESC);

-- Partial UNIQUE: a successful, non-test send blocks any further
-- 'queued' rows from advancing. Lets us safely re-enqueue on the
-- sweep (the INSERT may succeed, but the SELECT-for-send query
-- checks this guard and skips).
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sends_one_per_user_template_sent
  ON email_sends (user_id, template_key)
  WHERE status = 'sent' AND is_test = FALSE;

ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_sends_admin ON email_sends;
CREATE POLICY email_sends_admin ON email_sends
  FOR ALL USING (fn_is_admin()) WITH CHECK (fn_is_admin());

COMMENT ON COLUMN email_sends.is_test IS
  'Flagged true when this row came from an admin "send test to me" '
  'button. Excluded from production send-history counts AND from '
  'the idempotency guard so admins can test repeatedly.';

COMMENT ON COLUMN email_sends.subject_at_send IS
  'Subject as actually rendered (post-substitution) and shipped. '
  'Preserves history even if the template is edited later. NULL on '
  'queued/failed rows that never reached the send step.';

-- ── Seed: welcome-new-user template ───────────────────────────────
--
-- The founder-written copy from the planning session. Admin can
-- edit this freely in the UI; only the `key` column is load-bearing
-- on the server side.
INSERT INTO email_templates (key, name, subject, body_markdown, from_email, from_name, reply_to, variables)
VALUES (
  'welcome-new-user',
  'Welcome — new user',
  'Welcome to Tago — quick note from the founder',
  E'Hi {{first_name}},\n\nThanks for signing up for Tago. I''m Tarun Gautam — an MM student at the UC Davis GSM, and the person who built this app.\n\nI started Tago because in my first year here I didn''t have a car, and getting anywhere outside Davis was either an $80–$120 Uber, an Amtrak schedule that didn''t match student life, or asking around in Facebook groups. Meanwhile, dozens of fellow Aggies were driving exactly where I needed to go every weekend — with empty seats. So I built the matching layer that didn''t exist.\n\nThe most important thing to know about Tago: every single person on the platform is verified with a .edu email. You''ll only ever ride or drive with another student. No randoms. No anonymous gig drivers.\n\nHere''s how it works:\n\n→ **Need a ride?** Post where you''re going. The app matches you with a student already driving that route.\n\n→ **Driving somewhere yourself?** Post your trip. Riders request a seat, gas split goes straight to you. Drivers keep 100% of the fare.\n\nTwo quick things people often ask up front:\n\n- You don''t need a card to post or browse. A card is only needed when you actually accept or request a ride — and even then, it''s just a security hold. You''re never charged until the ride completes, and there''s no penalty for cancelling.\n- If you drive the same route every week (campus, Bay Area, home for the weekend), add it under **Routines** in the app. Tago auto-posts the trip for you so you never have to repost manually.\n\nNext time you''re heading anywhere — Bay Area, Sacramento, Tahoe, LA, or even just home — give it a try.\n\n→ [Post your first trip](https://tagorides.com)\n\nIf you have any questions or feedback, just reply to this email or hit me directly at support@tagorides.com. I read every one.\n\nThanks for being early,\n\n**Tarun Gautam**\nMaster of Management ''26\nTago',
  'support@tagorides.com',
  'Tarun at Tago',
  'support@tagorides.com',
  ARRAY['first_name', 'email']::TEXT[]
)
ON CONFLICT (key) DO NOTHING;
