-- F7 — Ghost-driver 90-day auto-refund bookkeeping.
--
-- Problem: under the platform-custody model (F1) a rider's payment sits on
-- TAGO's Stripe balance as a driver credit, but if the driver never connects
-- a bank the credit never leaves. After 90 days we refund the rider and
-- claw back the driver's wallet balance. This table tracks which rides have
-- already been reminded or refunded so the daily job is idempotent on
-- replay (idempotency guaranteed by UNIQUE(ride_id)).

CREATE TABLE IF NOT EXISTS ghost_refunds (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id             UUID        NOT NULL UNIQUE REFERENCES rides(id) ON DELETE CASCADE,
  driver_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rider_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents        INTEGER     NOT NULL CHECK (amount_cents > 0),
  payment_intent_id   TEXT        NOT NULL,
  reminder_sent_at    TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  stripe_refund_id    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service-role only — no user ever reads or writes ghost_refunds directly.
ALTER TABLE ghost_refunds ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ghost_refunds_refunded_at ON ghost_refunds(refunded_at);
CREATE INDEX IF NOT EXISTS idx_ghost_refunds_driver_id ON ghost_refunds(driver_id);
