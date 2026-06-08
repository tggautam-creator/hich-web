-- V4 F6 — caregiver on the Explore waitlist.
--
-- destination_waitlist already holds the rider's party (companion_a_id /
-- companion_b_id, migration 120). Accessibility riders can also bring a
-- caregiver on instant/board rides (migration 091 added caregiver_id to
-- rides), but the Explore join flow had nowhere to record one — so a
-- wheelchair rider matched via Explore silently lost their caregiver at
-- accept time. This adds the missing column so the caregiver travels with
-- the waitlist entry through offer → accept → ride, exactly like companions.
--
-- ON DELETE SET NULL mirrors companion_a_id/b_id: removing a caregiver from
-- the profile nulls the reference instead of deleting the waitlist row.

ALTER TABLE public.destination_waitlist
  ADD COLUMN IF NOT EXISTS caregiver_id UUID
    REFERENCES public.caregivers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.destination_waitlist.caregiver_id IS
  '2026-06-08 V4 F6 — optional caregiver the rider brings (accessibility). Carried into the matched ride at accept; fee settled at ride end like rides.caregiver_id.';
