-- ── Payments security hardening (PAY.0 — 2026-04-28) ────────────────────
-- Closes two findings from the payments security audit:
--
--   M1. There's no unique constraint preventing two `ride_earning`
--       rows for the same ride. Today the partial-unique index on
--       `payment_intent_id` blocks the duplicate-PI case (the only
--       known driver-credit-twice path), but a future code path that
--       calls `creditDriverEarning` twice with two different PIs
--       (e.g. wallet+card split with both eventually settling) could
--       insert two earning rows under different PI ids. A
--       `(ride_id) WHERE type='ride_earning'` partial-unique catches
--       it at the database layer regardless of how many code paths
--       converge.
--
--   H2. The `transactions` table relies on RLS *default-deny* for
--       INSERT / UPDATE / DELETE — only the SELECT-own policy is
--       defined explicitly. A future migration that adds a permissive
--       `FOR ALL USING (true)` policy (e.g. "let users insert their
--       own withdrawal request") could accidentally widen the surface.
--       Defense-in-depth: add explicit DENY-style policies that
--       authenticated users cannot override. Service role bypasses
--       RLS entirely and is unaffected.

-- 1) Partial-unique on (ride_id) WHERE type='ride_earning' -----------
--
-- A standard UNIQUE constraint won't work because non-ride-earning
-- rows (topups, fare_debit, withdrawal, etc.) all have NULL ride_id
-- and would conflict with each other. Partial-unique scoped to
-- `type='ride_earning'` is the right tool — only earnings are
-- compared, and at most one earning per ride is allowed.
--
-- Pre-flight: this fails with a 23505 if any existing data already
-- violates the invariant. If a prior bug created duplicates,
-- de-dupe with `DELETE … USING …` before re-running this migration.
-- The `IF NOT EXISTS` keeps re-applies idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_ride_earning_unique
  ON transactions (ride_id)
  WHERE type = 'ride_earning' AND ride_id IS NOT NULL;

-- 2) Explicit DENY policies on transactions write paths --------------
--
-- Default-deny RLS already blocks authenticated INSERT/UPDATE/DELETE
-- because there's no permissive policy. Adding explicit `WITH CHECK
-- (false)` and `USING (false)` policies makes the intent visible in
-- pg_policy + survives a future "FOR ALL" mistake (Postgres applies
-- restrictive policies in addition to permissive ones, so as long as
-- this DENY exists, even an accidental ALL-USERS policy can't widen
-- writes).
--
-- service_role still works because it bypasses RLS entirely
-- (SECURITY-DEFINER `wallet_apply_delta` + admin SDK calls).

DROP POLICY IF EXISTS "transactions_no_insert_authenticated"
    ON transactions;
CREATE POLICY "transactions_no_insert_authenticated"
    ON transactions
    AS RESTRICTIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

DROP POLICY IF EXISTS "transactions_no_update_authenticated"
    ON transactions;
CREATE POLICY "transactions_no_update_authenticated"
    ON transactions
    AS RESTRICTIVE
    FOR UPDATE
    TO authenticated
    USING (false)
    WITH CHECK (false);

DROP POLICY IF EXISTS "transactions_no_delete_authenticated"
    ON transactions;
CREATE POLICY "transactions_no_delete_authenticated"
    ON transactions
    AS RESTRICTIVE
    FOR DELETE
    TO authenticated
    USING (false);
