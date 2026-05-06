-- 066_users_onboarding_completed.sql (2026-05-05)
--
-- Adds an explicit `onboarding_completed` flag to `users` so the iOS
-- + web clients can gate onto SignedInTabs only AFTER the user has
-- finished every onboarding step (CreateProfile → PhoneVerify →
-- Location → ModeSelection → (Vehicle if driver/both)). Replaces the
-- earlier heuristic — `full_name IS NOT NULL` — which was a one-step
-- proxy and caused the iOS RootView to swap OnboardingFlow →
-- SignedInTabs the moment CreateProfile saved, dropping the user out
-- of the rest of the flow (mode selection silently skipped on iOS,
-- 2026-05-05).
--
-- Backfill policy: NONE. Per CTO call, every existing user gets
-- pushed back through onboarding so the explicit "I picked rider/
-- driver/both" choice is recorded for everyone. New users land at
-- FALSE by default (DEFAULT FALSE) and the client flips it TRUE
-- when they finish the relevant terminal step:
--   - rider → end of ModeSelectionPage
--   - driver / both → end of VehicleRegistrationPage
--
-- Apply to BOTH the prod Supabase project (pdxtswlaxqbqkrfwailf) and
-- the dev project (krcwdzwqahcpqsoauttf). Idempotent — safe to re-run
-- in either environment.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.users.onboarding_completed IS
  'TRUE when the user has finished every onboarding step (mode '
  'selection at minimum; vehicle registration if driver/both). '
  'iOS RootView + web AuthGuard gate the post-signup home tabs on '
  'this flag instead of the older `full_name IS NOT NULL` heuristic.';
