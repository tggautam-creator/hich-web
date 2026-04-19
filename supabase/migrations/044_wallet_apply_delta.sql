-- Atomic single-user wallet delta (topup or adjustment).
-- Complements transfer_ride_fare, which handles rider↔driver settlement.
--
-- Updates wallet_balance and inserts a transactions row in one transaction so
-- a failure in either step rolls the whole thing back. Idempotency is
-- enforced by the existing unique partial indexes on
-- transactions.stripe_event_id and transactions.payment_intent_id —
-- a duplicate insert raises SQLSTATE 23505 and the balance UPDATE rolls back.

CREATE OR REPLACE FUNCTION wallet_apply_delta(
  p_user_id UUID,
  p_delta_cents INT,
  p_type TEXT,
  p_description TEXT,
  p_ride_id UUID DEFAULT NULL,
  p_payment_intent_id TEXT DEFAULT NULL,
  p_stripe_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance INT;
BEGIN
  UPDATE users
     SET wallet_balance = COALESCE(wallet_balance, 0) + p_delta_cents
   WHERE id = p_user_id
  RETURNING wallet_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'error', 'User not found');
  END IF;

  INSERT INTO transactions (
    user_id, ride_id, type, amount_cents, balance_after_cents,
    description, payment_intent_id, stripe_event_id
  )
  VALUES (
    p_user_id, p_ride_id, p_type, p_delta_cents, v_new_balance,
    p_description, p_payment_intent_id, p_stripe_event_id
  );

  RETURN jsonb_build_object('applied', true, 'balance', v_new_balance);
END;
$$;
