-- v1.2 F14.1 — Driver-side goodwill opt-out for the caregiver seat fee.
--
-- Background (DJC review 2026-05-22):
--   The Disability Justice Committee asked for an option to let drivers
--   skip charging the $3/$5/$8 caregiver seat fee — an explicit
--   goodwill switch. Per-DRIVER (not per-ride) so a driver who wants to
--   act on goodwill sets it once in Edit Profile and every ride they
--   accept honors it. Defaults to FALSE so no existing driver is
--   silently switched into the waiver.
--
-- Semantics at end-of-ride (see `server/routes/rides.ts::foldCaregiverFare`):
--   * `users.waive_caregiver_fee = false` (default) → caregiver tier
--     fee folds into BOTH the rider's Stripe charge and the driver's
--     wallet credit, same as F6.1's original behavior.
--   * `users.waive_caregiver_fee = true` AND ride has a caregiver →
--     fold returns addOnCents = 0; rider pays only base fare, driver
--     earns only base fare. The persisted `rides.caregiver_fare_cents`
--     stays at the tier value (for audit), only the settlement zeros.
--
-- Visibility:
--   * Edit Profile (drivers only) — toggle in a new "Caregiver fees"
--     section, gated on `auth.profile?.isDriver == true`.
--   * BoardOfferAcceptPage — when a driver's offer carries
--     `driver.waive_caregiver_fee = true` AND the rider's board post
--     has a caregiver attached, the rider sees "Driver waives caregiver
--     fee for this ride 💛" and the displayed total drops to base.
--   * Chat — server inserts a `caregiver_fee_waived` system message
--     post-acceptance so the rider learns about the goodwill act.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS waive_caregiver_fee BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.waive_caregiver_fee IS
  '2026-05-22 v1.2 F14 — DJC ask. When true on a driver row, end-of-ride foldCaregiverFare zeros the caregiver add-on for both rider charge and driver earnings. Persisted rides.caregiver_fare_cents keeps the tier value for audit. Default false so no existing driver is silently opted in.';
