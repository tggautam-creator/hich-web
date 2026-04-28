-- Defence-in-depth: refuse any wallet_apply_delta that would drive a user's
-- balance below zero. Phase 3a wallet-first payment debits the wallet before
-- the card charge attempt; without this guard a logic bug or a corrupted
-- replay path could overdraw the wallet and leave a negative balance that
-- the rest of the app does not expect (the UI assumes balance ≥ 0, the
-- driver-credit code does not subtract overdrafts, etc.).
--
-- We RAISE EXCEPTION rather than returning {applied:false}: callers already
-- handle Postgres errors as RPC failures, and a hard error makes the bad
-- case loud in logs instead of silently no-op'd.
--
-- Replays the full body of migration 044 with the new check appended.

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

  -- ⚠ Negative-balance guard. Rolls back the UPDATE above via the implicit
  -- transaction that wraps a plpgsql function body.
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'wallet_apply_delta would overdraw user % (balance would be %)',
      p_user_id, v_new_balance
      USING ERRCODE = '23514'; -- check_violation
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
