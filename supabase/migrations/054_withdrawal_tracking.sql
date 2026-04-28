-- Withdrawal tracking — adds Stripe Transfer linkage to the existing
-- `withdrawal` transaction rows so the wallet UI can show "in transit"
-- vs "completed" without storing duplicate state.
--
-- Two new nullable columns on `transactions`:
--   transfer_id        — Stripe Transfer id ('tr_...') set by the
--                        withdraw route after stripe.transfers.create
--                        succeeds. Lookup target for transfer.paid /
--                        transfer.failed webhooks.
--   transfer_paid_at   — server timestamp written by the transfer.paid
--                        webhook handler. NULL = still in transit.
--
-- One row tells the whole story:
--   transfer_id IS NULL                                  → withdraw never reached Stripe
--   transfer_id IS NOT NULL AND transfer_paid_at IS NULL → in transit (T+~2 days)
--   transfer_paid_at IS NOT NULL                         → landed in driver's bank
--
-- Idempotency on the webhook: a duplicate `transfer.paid` delivery for the
-- same transfer_id results in the same UPDATE re-running, which is a no-op
-- after the first call. No partial-unique index needed — UPDATE-based.
--
-- Also extends wallet_apply_delta to accept p_transfer_id so the route
-- doesn't need a follow-up UPDATE round-trip after the Stripe call.

-- 1) Columns ------------------------------------------------------------
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_id text,
  ADD COLUMN IF NOT EXISTS transfer_paid_at timestamptz;

-- Lookup index for the webhook handler (small WHERE keeps it cheap).
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_id
  ON transactions(transfer_id)
  WHERE transfer_id IS NOT NULL;

-- 2) wallet_apply_delta — replay 053 + accept p_transfer_id -------------
-- The new param is optional and defaulted to NULL so existing callers
-- (topups, fares, tips, refunds, reversals) need no change.
CREATE OR REPLACE FUNCTION wallet_apply_delta(
  p_user_id UUID,
  p_delta_cents INT,
  p_type TEXT,
  p_description TEXT,
  p_ride_id UUID DEFAULT NULL,
  p_payment_intent_id TEXT DEFAULT NULL,
  p_stripe_event_id TEXT DEFAULT NULL,
  p_transfer_id TEXT DEFAULT NULL
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

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'wallet_apply_delta would overdraw user % (balance would be %)',
      p_user_id, v_new_balance
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO transactions (
    user_id, ride_id, type, amount_cents, balance_after_cents,
    description, payment_intent_id, stripe_event_id, transfer_id
  )
  VALUES (
    p_user_id, p_ride_id, p_type, p_delta_cents, v_new_balance,
    p_description, p_payment_intent_id, p_stripe_event_id, p_transfer_id
  );

  RETURN jsonb_build_object('applied', true, 'balance', v_new_balance);
END;
$$;
