-- 071_push_tokens_platform.sql
--
-- Platform attribution for push tokens (Phase 1, Slice 1.1 of the
-- admin panel).
--
-- Adds `push_tokens.platform` so the admin Overview dashboard can
-- compute an "iOS install rate" KPI:
--
--   iOS install rate = (distinct users with platform='ios')
--                      / (distinct users with any known platform)
--
-- The clients know their platform at the call site when they upsert
-- the token, so writing it is free:
--   - Web (src/lib/fcm.ts requestAndSaveFcmToken) → 'web'
--   - iOS Swift FCM bridge (rolled out in next iOS-touching slice) → 'ios'
--   - Android (when we ship Android) → 'android'
--
-- Nullable on purpose: every existing row was inserted before this
-- column existed, so we don't know its platform. NULL = "unknown,
-- predates migration 071". The KPI explicitly excludes NULL from both
-- numerator and denominator so the rate reflects only users whose
-- platform we've observed. As clients refresh their tokens (every
-- login + every cold start that hits FCM), NULL backfills naturally.
--
-- The web client updates ship in this same slice, so web tokens
-- start writing 'web' immediately. iOS tokens stay NULL until the
-- iOS push-register call is updated in the next iOS slice — at which
-- point the iOS install rate becomes meaningful.
--
-- CHECK constraint keeps the value space tiny + searchable.
-- A partial index on platform='ios' supports the KPI without bloating
-- storage (most rows will be 'web' once iOS ships its update).

ALTER TABLE public.push_tokens
  ADD COLUMN IF NOT EXISTS platform TEXT
    CHECK (platform IN ('ios', 'android', 'web'));

COMMENT ON COLUMN public.push_tokens.platform IS
  'Client platform that registered this push token: ios | android | web. NULL = registered before migration 071 (no way to know retroactively). Powers iOS install rate KPI on the admin Overview dashboard.';

CREATE INDEX IF NOT EXISTS idx_push_tokens_platform_ios
  ON public.push_tokens(user_id)
  WHERE platform = 'ios';
