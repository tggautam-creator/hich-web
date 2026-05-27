-- v1.2 F4.1 — Vehicle accessibility fields.
--
-- Originally planned as migration 089 in `docs/V1_2_PLAN.md` §3.4. Bumped to
-- 090 because 089 was reassigned to caregivers (the cascade from Reports v2
-- taking 086). Per the migration-collision rule
-- (`feedback_check_migration_number.md`), new migrations take the next
-- available slot.
--
-- Two columns:
--   • `wheelchair_capable` — driver-declared boolean. True iff the
--     vehicle can stow a folded or motorized wheelchair. Powers the
--     F5 board filter ("wheelchair-accessible vehicles only").
--   • `trunk_size` — TEXT enum ('small' / 'medium' / 'large'). Driver-
--     declared but the iOS form pre-fills it from `body_type` via the
--     derivation rule (V1_2_PLAN.md §F4):
--       sedan / coupe / hatchback → small
--       wagon / suv               → medium
--       minivan / pickup / van    → large
--     Driver can override for unusual configurations.
--
-- Partial index on `wheelchair_capable` filters to active vehicles only
-- so the index stays tiny — most vehicles won't flip the flag.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS wheelchair_capable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trunk_size TEXT CHECK (trunk_size IN ('small', 'medium', 'large'));

COMMENT ON COLUMN public.vehicles.wheelchair_capable IS
  '2026-05-21 v1.2 F4 — driver-declared. True iff vehicle can stow a wheelchair (foldable or motorized).';
COMMENT ON COLUMN public.vehicles.trunk_size IS
  '2026-05-21 v1.2 F4 — small/medium/large. Driver-declared; iOS pre-fills from body_type via the derivation rule and lets the driver override. Used to advise riders with bulkier mobility aids. NULL = not yet set (legacy rows).';

CREATE INDEX IF NOT EXISTS idx_vehicles_wheelchair
  ON public.vehicles (wheelchair_capable)
  WHERE wheelchair_capable = true AND is_active = true;
