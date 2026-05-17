-- 079_campaigns_recall.sql
--
-- Campaign recall support (Phase 1, Slice 1.4d of the admin panel).
--
-- Adds three columns to `public.campaigns` so an admin can "undo" a
-- broadcast that was sent in error (typo, wrong audience, sensitive
-- content):
--
--   recalled_at      — TIMESTAMPTZ NULL. Set by
--                      POST /api/admin/campaigns/:id/recall.
--                      NULL = live; set = recalled at that moment.
--   recalled_reason  — TEXT NULL. Why the admin pulled it (audit /
--                      ops handoff).
--   recalled_by      — UUID NULL → public.users(id). Which admin
--                      hit the button.
--
-- Side effects of a recall (handled in the endpoint, not the schema):
--   * DELETE FROM notifications WHERE type='admin_broadcast' AND
--     data->>'campaign_id' = campaign.id — wipes the in-app inbox
--     copies so users no longer see the message.
--   * GET /api/campaigns/:slug returns 404 CAMPAIGN_RECALLED so the
--     public /c/<slug> marketing page disappears too (push deep-links
--     land on an "expired or never sent" empty state).
--   * One audit_log row with action='recall_campaign' captures the
--     reason + how many inbox rows were deleted.
--
-- Storage poster files (in the campaign-posters bucket) are NOT
-- deleted on recall — the admin can manually clean them up if they
-- contain sensitive content. Keeping them around means a recall is
-- reversible by clearing the recalled_at field manually in SQL.
--
-- Nullable so existing rows (pre-this-migration) stay live until an
-- admin explicitly recalls them.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS recalled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recalled_reason  TEXT,
  ADD COLUMN IF NOT EXISTS recalled_by      UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.campaigns.recalled_at IS
  'When an admin recalled this campaign. NULL = live. Recalled campaigns: notifications wiped from inboxes, /c/<slug> 404s. See migration 079.';

COMMENT ON COLUMN public.campaigns.recalled_reason IS
  'Admin-supplied reason for the recall (audit / ops handoff).';

COMMENT ON COLUMN public.campaigns.recalled_by IS
  'Admin who hit the recall button.';

-- Partial index for the live-only browse / public-read paths. Most
-- rows will stay NULL so the index is small + the planner can skip
-- recalled rows quickly.
CREATE INDEX IF NOT EXISTS idx_campaigns_live
  ON public.campaigns (sent_at DESC)
  WHERE recalled_at IS NULL;
