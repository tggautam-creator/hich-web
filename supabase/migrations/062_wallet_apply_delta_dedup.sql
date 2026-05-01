-- 062_wallet_apply_delta_dedup.sql (2026-04-30)
--
-- Migration 044 created `wallet_apply_delta(7 params)` and migration 054
-- ADDED `wallet_apply_delta(8 params)` — same function name, the 8-arg
-- version has an extra `p_transfer_id TEXT DEFAULT NULL`. Both rows now
-- live in `pg_proc` and PostgREST can't disambiguate because the
-- 8-arg version's `DEFAULT NULL` means a 7-arg call is valid against
-- BOTH. Result: every wallet write fails with PGRST203:
--
--   Could not choose the best candidate function between:
--     public.wallet_apply_delta(... 7 params ...),
--     public.wallet_apply_delta(... 8 params ...)
--
-- Rider hit this on a fare-debit retry 2026-04-30 — payment couldn't
-- complete because the RPC dispatch failed before any wallet logic ran.
--
-- Fix: drop the 7-arg version. The 8-arg version with `p_transfer_id
-- DEFAULT NULL` is a strict superset — every existing 7-arg caller
-- continues to work without code changes (Postgres binds the missing
-- arg to NULL).
--
-- This migration is idempotent — re-running is safe because both DROPs
-- and the function preserved by 054 use IF EXISTS / OR REPLACE.

DROP FUNCTION IF EXISTS wallet_apply_delta(
  p_user_id UUID,
  p_delta_cents INT,
  p_type TEXT,
  p_description TEXT,
  p_ride_id UUID,
  p_payment_intent_id TEXT,
  p_stripe_event_id TEXT
);
