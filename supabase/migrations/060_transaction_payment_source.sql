-- 060_transaction_payment_source.sql
--
-- Add columns to capture the funding source on `transactions` rows
-- so the wallet UI can show "Apple Pay" or "Visa •••• 4242" on top-
-- ups. Today the row stores the linked Stripe PaymentIntent id but
-- not the brand/last4/wallet — the iOS Transaction Detail page falls
-- back to a generic "Added to wallet" subtitle which makes auditing
-- past top-ups (which card actually funded this?) impossible without
-- jumping to the Stripe Dashboard.
--
-- Bug surfaced 2026-04-29 by Tarun during the iOS Wallet QA pass:
-- "I want to see whether this top-up came from Apple Pay or my Visa
-- so I can reconcile against my bank statement."
--
-- Three nullable TEXT columns:
--   * pm_brand   — Stripe brand string (`visa`, `mastercard`, `amex`,
--                  `discover`, etc.). Null for non-card top-ups
--                  (would only matter if we add ACH later).
--   * pm_last4   — last 4 digits of the underlying PAN as Stripe
--                  reports them. Null when not a card row.
--   * pm_wallet  — `apple_pay`, `google_pay`, `samsung_pay`, or null
--                  for a plain card swipe. Comes from Stripe's
--                  `payment_method.card.wallet.type`. Lets the UI
--                  show "Apple Pay" instead of "Visa •••• 4242" when
--                  the funding actually went through a wallet.
--
-- Population strategy: both `/api/wallet/confirm-topup` and the
-- `payment_intent.succeeded` webhook UPDATE the row by
-- `payment_intent_id` AFTER `wallet_apply_delta` inserts it. The
-- RPC stays at its current 8-arg signature — adding `pm_*` to the
-- RPC would mean another overload and another PGRST203 dispatch
-- footgun (we just fixed five of those, see migration 056-era fix
-- + 2026-04-29 server fix in IOS_PROGRESS).
--
-- Backfill: not attempted. Existing rows stay null; iOS treats null
-- as "unknown source" and renders the generic subtitle as before.
-- Going forward every new top-up gets the columns populated.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS pm_brand  TEXT NULL,
  ADD COLUMN IF NOT EXISTS pm_last4  TEXT NULL,
  ADD COLUMN IF NOT EXISTS pm_wallet TEXT NULL;

COMMENT ON COLUMN transactions.pm_brand IS
  'Stripe card brand (visa/mastercard/amex/discover/etc.) for the funding source on a top-up row. Null for non-card-funded transactions.';
COMMENT ON COLUMN transactions.pm_last4 IS
  'Last 4 digits of the funding card, as Stripe reports them. Null when the row was not funded by a card.';
COMMENT ON COLUMN transactions.pm_wallet IS
  'Wallet type when the card was tokenized through a wallet (apple_pay / google_pay / samsung_pay). Null for plain card swipes.';
