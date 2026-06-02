-- 117_email_templates_v2.sql (2026-06-02)
--
-- Lifecycle email v2 — adds the deferred items from migration 116:
--   1. Unsubscribe / opt-out tracking
--   2. Generalized triggers (trigger_event + delay_hours so the
--      same email_templates table can drive welcome / drip /
--      re-engagement / event-based sequences)
--   3. users.onboarding_completed_at timestamp (auto-populated by
--      a BEFORE UPDATE trigger so existing client code keeps working)
--
-- All changes are additive — v1 senders keep working without edits.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.onboarding_completed_at IS
  'Set automatically when onboarding_completed flips false → true. '
  'Drives the lifecycle-email delay_hours feature. Backfilled to '
  'updated_at for legacy rows.';

CREATE OR REPLACE FUNCTION public.set_onboarding_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.onboarding_completed = TRUE
     AND (OLD.onboarding_completed IS NULL OR OLD.onboarding_completed = FALSE)
     AND NEW.onboarding_completed_at IS NULL THEN
    NEW.onboarding_completed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_onboarding_completed_at ON public.users;
CREATE TRIGGER trg_set_onboarding_completed_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_onboarding_completed_at();

-- Backfill for already-onboarded users. We use created_at as the
-- proxy (the only timestamp the users table guarantees exists per
-- migration 001 — there's no updated_at column on this table).
-- Imperfect because a user who signed up months ago but completed
-- onboarding yesterday would get an artificially old timestamp;
-- the delay_hours math still works correctly because old timestamps
-- always satisfy the .lte('onboarding_completed_at', cutoff) test.
-- Future onboarding-completion flips set the column to NOW() via
-- the trigger above so this backfill is one-time only.
UPDATE public.users
  SET onboarding_completed_at = created_at
  WHERE onboarding_completed = TRUE
    AND onboarding_completed_at IS NULL;

ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS trigger_event TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS delay_hours   INTEGER NOT NULL DEFAULT 0;

UPDATE public.email_templates
  SET trigger_event = 'onboarding_completed',
      delay_hours = 0
  WHERE key = 'welcome-new-user';

CREATE TABLE IF NOT EXISTS public.email_opt_outs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  template_key TEXT,
  reason       TEXT,
  source       TEXT NOT NULL DEFAULT 'self',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_opt_outs_user_template
  ON public.email_opt_outs (user_id, COALESCE(template_key, '*'));

CREATE INDEX IF NOT EXISTS idx_email_opt_outs_user
  ON public.email_opt_outs (user_id);

ALTER TABLE public.email_opt_outs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_opt_outs_admin ON public.email_opt_outs;
CREATE POLICY email_opt_outs_admin ON public.email_opt_outs
  FOR ALL USING (fn_is_admin()) WITH CHECK (fn_is_admin());

COMMENT ON COLUMN public.email_opt_outs.template_key IS
  'NULL = opted out of every lifecycle email. Non-null = scoped to '
  'that single template_key (still receives other templates).';

COMMENT ON COLUMN public.email_opt_outs.source IS
  'self = user clicked unsubscribe; admin = admin set via UI; '
  'bounce = Resend hard-bounce webhook recorded the address as '
  'undeliverable. Future expansion.';
