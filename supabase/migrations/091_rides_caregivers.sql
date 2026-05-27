-- v1.2 F6.1 / F7.1 — Caregiver attachment on rides + scheduled rides.
--
-- Spec §3.5 originally bundled this as migration 090. The cascade started
-- by Reports v2 taking 086 has shifted every subsequent v1.2 migration:
-- 087 user profile, 088 user accessibility profile, 089 caregivers, 090
-- vehicle accessibility — so this lands at 091. Per the migration-
-- collision rule (`feedback_check_migration_number.md`), new migrations
-- always take the next available slot.
--
-- Two columns each on `rides` + `ride_schedules`:
--   • `caregiver_id` — nullable FK into `caregivers(id)`. Riders attach a
--     caregiver from their saved list at request time (F6) or post time
--     (F7). NULL means "no caregiver on this ride."
--   • `caregiver_fare_cents` — tiered add-on the rider is charged + the
--     driver earns when a caregiver is attached. Always computed
--     server-side from `distance_km` so the client can't underbid:
--       <  5 mi   → $3 (300¢)
--       5–20 mi   → $5 (500¢)
--       > 20 mi   → $8 (800¢)
--     NULL when no caregiver attached. INT not numeric so the existing
--     cents-only money convention (CLAUDE.md "Key Conventions") holds.
--
-- ON DELETE SET NULL — when a rider hard-deletes a caregiver (model
-- decision 2026-05-20), historical rides + schedules retain their fare
-- but lose the named reference. The `caregiver_fare_cents` column is
-- preserved so wallet ledger entries reconcile.
--
-- Partial indexes filter to non-null caregiver_id only so the indexes
-- stay tiny — most rides won't have a caregiver attached. Used by
-- (1) the F8 driver-side request review pulling the caregiver name
-- inline, and (2) per-caregiver ride-history queries on the rider's
-- profile if F-future surfaces them.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS caregiver_id UUID REFERENCES public.caregivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS caregiver_fare_cents INT CHECK (caregiver_fare_cents IS NULL OR caregiver_fare_cents >= 0);

ALTER TABLE public.ride_schedules
  ADD COLUMN IF NOT EXISTS caregiver_id UUID REFERENCES public.caregivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS caregiver_fare_cents INT CHECK (caregiver_fare_cents IS NULL OR caregiver_fare_cents >= 0);

COMMENT ON COLUMN public.rides.caregiver_id IS
  '2026-05-21 v1.2 F6 — caregiver attached at ride-request time. ON DELETE SET NULL preserves historical rides when the rider removes the caregiver row.';
COMMENT ON COLUMN public.rides.caregiver_fare_cents IS
  '2026-05-21 v1.2 F6 — server-computed tier fee added to rider charge and driver earnings. NULL when no caregiver attached. <5mi=$3, 5-20mi=$5, >20mi=$8.';
COMMENT ON COLUMN public.ride_schedules.caregiver_id IS
  '2026-05-21 v1.2 F7 — caregiver attached at board-post / board-request time. ON DELETE SET NULL preserves historical schedules.';
COMMENT ON COLUMN public.ride_schedules.caregiver_fare_cents IS
  '2026-05-21 v1.2 F7 — server-computed tier fee. NULL when no caregiver attached.';

CREATE INDEX IF NOT EXISTS idx_rides_caregiver
  ON public.rides (caregiver_id)
  WHERE caregiver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ride_schedules_caregiver
  ON public.ride_schedules (caregiver_id)
  WHERE caregiver_id IS NOT NULL;
