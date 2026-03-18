-- Atomic wallet transfer for ride fare settlement.
-- Debits rider, credits driver, and inserts transaction records in a single transaction.
-- Prevents TOCTOU race conditions when multiple rides complete simultaneously.

CREATE OR REPLACE FUNCTION transfer_ride_fare(
  p_ride_id UUID,
  p_rider_id UUID,
  p_driver_id UUID,
  p_fare_cents INT,
  p_platform_fee_cents INT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_driver_earns INT := p_fare_cents - p_platform_fee_cents;
  v_rider_balance INT;
  v_driver_balance INT;
  v_new_rider_balance INT;
  v_new_driver_balance INT;
BEGIN
  -- Lock rows to prevent concurrent modifications (SELECT ... FOR UPDATE)
  SELECT wallet_balance INTO v_rider_balance
    FROM users WHERE id = p_rider_id FOR UPDATE;

  SELECT wallet_balance INTO v_driver_balance
    FROM users WHERE id = p_driver_id FOR UPDATE;

  IF v_rider_balance IS NULL OR v_driver_balance IS NULL THEN
    RETURN jsonb_build_object('transferred', false, 'error', 'User not found');
  END IF;

  v_new_rider_balance := COALESCE(v_rider_balance, 0) - p_fare_cents;
  v_new_driver_balance := COALESCE(v_driver_balance, 0) + v_driver_earns;

  -- Debit rider
  UPDATE users SET wallet_balance = v_new_rider_balance WHERE id = p_rider_id;

  -- Credit driver
  UPDATE users SET wallet_balance = v_new_driver_balance WHERE id = p_driver_id;

  -- Insert transaction records
  INSERT INTO transactions (user_id, ride_id, type, amount_cents, balance_after_cents, description)
  VALUES
    (p_rider_id, p_ride_id, 'fare_debit', -p_fare_cents, v_new_rider_balance, 'Ride fare charged'),
    (p_driver_id, p_ride_id, 'fare_credit', v_driver_earns, v_new_driver_balance, 'Ride fare earned');

  RETURN jsonb_build_object(
    'transferred', true,
    'rider_balance', v_new_rider_balance,
    'driver_balance', v_new_driver_balance
  );
END;
$$;
