-- Atomic rider→driver tip transfer on a completed ride.
-- Mirrors transfer_ride_fare (022) but for an optional tip the rider adds
-- from the wallet after a successful ride. A single transaction debits the
-- rider, credits the driver, and writes matched transaction rows.
--
-- Idempotency: callers should check for an existing 'tip_debit' transaction
-- on (ride_id, user_id) before invoking — there is no unique index because
-- tip_cents can be zero and we keep the schema untouched at this step.

CREATE OR REPLACE FUNCTION tip_ride(
  p_ride_id UUID,
  p_rider_id UUID,
  p_driver_id UUID,
  p_tip_cents INT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_rider_balance INT;
  v_driver_balance INT;
  v_new_rider_balance INT;
  v_new_driver_balance INT;
BEGIN
  IF p_tip_cents IS NULL OR p_tip_cents <= 0 THEN
    RETURN jsonb_build_object('tipped', false, 'error', 'Tip must be positive');
  END IF;

  SELECT wallet_balance INTO v_rider_balance
    FROM users WHERE id = p_rider_id FOR UPDATE;

  SELECT wallet_balance INTO v_driver_balance
    FROM users WHERE id = p_driver_id FOR UPDATE;

  IF v_rider_balance IS NULL OR v_driver_balance IS NULL THEN
    RETURN jsonb_build_object('tipped', false, 'error', 'User not found');
  END IF;

  IF v_rider_balance < p_tip_cents THEN
    RETURN jsonb_build_object('tipped', false, 'error', 'Insufficient balance');
  END IF;

  v_new_rider_balance := v_rider_balance - p_tip_cents;
  v_new_driver_balance := v_driver_balance + p_tip_cents;

  UPDATE users SET wallet_balance = v_new_rider_balance WHERE id = p_rider_id;
  UPDATE users SET wallet_balance = v_new_driver_balance WHERE id = p_driver_id;

  INSERT INTO transactions (user_id, ride_id, type, amount_cents, balance_after_cents, description)
  VALUES
    (p_rider_id, p_ride_id, 'tip_debit', -p_tip_cents, v_new_rider_balance, 'Tip for driver'),
    (p_driver_id, p_ride_id, 'tip_credit', p_tip_cents, v_new_driver_balance, 'Tip from rider');

  RETURN jsonb_build_object(
    'tipped', true,
    'rider_balance', v_new_rider_balance,
    'driver_balance', v_new_driver_balance
  );
END;
$$;
