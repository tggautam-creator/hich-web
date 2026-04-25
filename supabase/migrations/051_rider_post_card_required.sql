-- 051_rider_post_card_required.sql
--
-- Rider-mode board posts charge a card after the ride completes, so a poster
-- without a saved card creates a dead-end: drivers see the post, try to
-- offer, and hit RIDER_NO_PAYMENT_METHOD with no way forward. Two parts:
--
-- 1. Delete existing rider-mode ride_schedules whose poster has no card.
--    Safe because rides.schedule_id is ON DELETE SET NULL (migration 017),
--    so any in-flight rides survive without their schedule reference.
-- 2. BEFORE INSERT trigger that rejects future rider-posts whose poster has
--    neither stripe_customer_id nor default_payment_method_id. The frontend
--    (SchedulePage) does this check too for a clean redirect; this trigger
--    is the defensive backstop because schedule creation goes straight to
--    Supabase via the client SDK rather than through Express.

BEGIN;

-- ── 1. Cleanup ───────────────────────────────────────────────────────────────
DELETE FROM ride_schedules
WHERE mode = 'rider'
  AND user_id IN (
    SELECT id FROM users
    WHERE default_payment_method_id IS NULL
       OR stripe_customer_id IS NULL
  );

-- ── 2. Trigger function ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_rider_post_has_card()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_card boolean;
BEGIN
  IF NEW.mode = 'rider' THEN
    SELECT (default_payment_method_id IS NOT NULL
            AND stripe_customer_id IS NOT NULL)
      INTO has_card
      FROM users
      WHERE id = NEW.user_id;

    IF NOT COALESCE(has_card, false) THEN
      RAISE EXCEPTION 'Cannot post a rider-mode schedule without a saved payment method'
        USING ERRCODE = 'check_violation',
              HINT = 'Add a debit card in Wallet → Payment methods, then post again.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ride_schedules_rider_card_check ON ride_schedules;
CREATE TRIGGER ride_schedules_rider_card_check
BEFORE INSERT ON ride_schedules
FOR EACH ROW EXECUTE FUNCTION enforce_rider_post_has_card();

COMMIT;
