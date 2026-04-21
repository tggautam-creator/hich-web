-- 24h dunning cron bookkeeping.
--
-- When a rider finishes a ride without a card (B2) or an off-session charge
-- declines, the ride's payment_status sits in 'pending' or 'failed'. A daily
-- cron (sendPendingPaymentNudges) fires an FCM push at 24 h, 48 h, and 72 h
-- after end-of-ride to nudge them to open the app and retry. After 72 h the
-- ghost-refund job (F7) takes over.
--
-- This table is the per-bucket idempotency ledger. `UNIQUE(ride_id, bucket)`
-- guarantees at-most-once delivery per bucket even under cron overlap: the
-- insert races to the second write, 23505 on the loser, skip without pushing.

CREATE TABLE IF NOT EXISTS payment_nudges (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id    UUID        NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  bucket     TEXT        NOT NULL CHECK (bucket IN ('24h', '48h', '72h')),
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ride_id, bucket)
);

-- Service-role only.
ALTER TABLE payment_nudges ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_payment_nudges_ride_id ON payment_nudges(ride_id);
CREATE INDEX IF NOT EXISTS idx_payment_nudges_sent_at ON payment_nudges(sent_at);
