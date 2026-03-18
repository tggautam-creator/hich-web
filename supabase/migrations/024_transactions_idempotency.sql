-- Add idempotency columns for Stripe deduplication.
-- stripe_event_id: unique per webhook event (prevents Stripe retry double-credit)
-- payment_intent_id: shared key between webhook and confirm-topup (prevents both crediting)

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS stripe_event_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;

-- Unique constraint on stripe_event_id to reject duplicate webhook events
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_stripe_event_id
  ON transactions(stripe_event_id) WHERE stripe_event_id IS NOT NULL;

-- Unique constraint on payment_intent_id to prevent either path crediting twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_payment_intent_id
  ON transactions(payment_intent_id) WHERE payment_intent_id IS NOT NULL;
