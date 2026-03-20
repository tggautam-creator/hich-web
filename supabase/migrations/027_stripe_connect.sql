-- 027_stripe_connect.sql
-- Adds Stripe Connect fields for driver payouts and rider card-on-file payments.
-- Replaces the internal wallet transfer model with Stripe destination charges.

-- ── Users: Stripe Connect + default payment method ──────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS default_payment_method_id TEXT;

-- ── Rides: payment tracking ─────────────────────────────────────────────────
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'processing', 'paid', 'failed', 'refunded')),
  ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_fee_cents INTEGER DEFAULT 0;
