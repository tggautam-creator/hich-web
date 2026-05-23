-- Migration 094 — ride_audit_log table + trigger.
-- 2026-05-23 — gives the admin /admin/rides/:id timeline a historical
-- record of status flips + coordination state changes. Without this,
-- the admin can see CURRENT state but not WHO/WHEN flipped what.
-- Trigger captures the actor via auth.uid() when present; system
-- updates from the service role show changed_by = NULL (acceptable —
-- the field tells you "system did it" implicitly).

CREATE TABLE IF NOT EXISTS public.ride_audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     uuid        NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  field       text        NOT NULL,
  old_value   text,
  new_value   text,
  changed_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-ride lookup for the admin detail page. Created_at ASC = the
-- order the timeline renders (oldest first, top-to-bottom).
CREATE INDEX IF NOT EXISTS idx_ride_audit_log_ride_created
  ON public.ride_audit_log (ride_id, created_at);

ALTER TABLE public.ride_audit_log ENABLE ROW LEVEL SECURITY;

-- No user-facing SELECT policy on purpose: the admin endpoint reads
-- via supabaseAdmin (service role) which bypasses RLS. End users
-- never need to read this directly.

-- ── Trigger function ────────────────────────────────────────────────
-- Writes one row per changed field of interest. Wrapped in
-- `SECURITY DEFINER` so the trigger can write to ride_audit_log
-- regardless of the calling user's RLS — same pattern as the
-- existing `report_audit_log` writes.

CREATE OR REPLACE FUNCTION public.write_ride_audit()
RETURNS TRIGGER AS $$
DECLARE
  actor uuid;
BEGIN
  -- auth.uid() returns the authenticated user's id when the UPDATE
  -- is made via a JWT-bearing client; returns NULL for service-role
  -- updates (the server-side ride lifecycle paths). NULL actor is
  -- meaningful — admin can read it as "system did this."
  BEGIN
    actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    actor := NULL;
  END;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.ride_audit_log (ride_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'status', OLD.status, NEW.status, actor);
  END IF;

  IF OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
    INSERT INTO public.ride_audit_log (ride_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'driver_id', OLD.driver_id::text, NEW.driver_id::text, actor);
  END IF;

  IF OLD.pickup_confirmed IS DISTINCT FROM NEW.pickup_confirmed THEN
    INSERT INTO public.ride_audit_log (ride_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'pickup_confirmed', OLD.pickup_confirmed::text, NEW.pickup_confirmed::text, actor);
  END IF;

  IF OLD.dropoff_confirmed IS DISTINCT FROM NEW.dropoff_confirmed THEN
    INSERT INTO public.ride_audit_log (ride_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'dropoff_confirmed', OLD.dropoff_confirmed::text, NEW.dropoff_confirmed::text, actor);
  END IF;

  IF OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
    INSERT INTO public.ride_audit_log (ride_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'payment_status', OLD.payment_status, NEW.payment_status, actor);
  END IF;

  IF OLD.fare_cents IS DISTINCT FROM NEW.fare_cents THEN
    INSERT INTO public.ride_audit_log (ride_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'fare_cents', OLD.fare_cents::text, NEW.fare_cents::text, actor);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop + recreate for idempotency. Migrations may re-run during
-- local dev.
DROP TRIGGER IF EXISTS rides_audit_trigger ON public.rides;
CREATE TRIGGER rides_audit_trigger
  AFTER UPDATE ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.write_ride_audit();
