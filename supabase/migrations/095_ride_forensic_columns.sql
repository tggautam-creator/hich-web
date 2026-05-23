-- Migration 095 — capture the data the /admin/rides/:id page needs
-- but the schema doesn't store today.
--
-- 2026-05-23 — driven by an ops audit: the admin can see fare
-- TOTAL, status, distance, and rating, but cannot answer "where
-- exactly was the QR scanned", "WHY did the ride auto-end",
-- "what was the gas-price snapshot used at fare-set time", or
-- "what's the per-component breakdown of the fare cents we
-- charged." All of those are valuable for trust+safety triage,
-- disputes, and post-mortems.
--
-- This migration is ADDITIVE — every new column is nullable with
-- no default. Existing rows stay null; the UI renders "—" for
-- legacy rides and the actual values once the server-side write
-- paths get updated (next slice).
--
-- Server-side writes that need to happen in a follow-up slice
-- before these columns get populated:
--   1. `POST /api/rides/:id/start` (QR scan-to-start handler) —
--      capture the driver's last GPS ping into
--      pickup_scan_lat/lng/at + write gas_price_per_gallon_cents
--      snapshot + gas_cost_cents + time_cost_cents at fare-set time.
--   2. `POST /api/rides/:id/end` (QR scan-to-end handler) —
--      capture into dropoff_scan_lat/lng/at; if auto-ended,
--      write end_reason = 'auto_divergence' | 'auto_idle' | ...
--   3. `POST /api/rides/:id/cancel` (user-side cancel) — write
--      end_reason = 'rider_cancelled' | 'driver_cancelled' +
--      cancel_reason text.
--
-- Until those slices ship, the columns sit empty + the UI shows
-- the "Not captured" placeholders the migration enables but
-- doesn't yet fill.

ALTER TABLE public.rides
  -- Exact lat/lng + UTC timestamp at the moment the start-QR was
  -- scanned. Differs from `pickup_point` (the AGREED pickup coord
  -- — set during coordination, may not be where the scan happened)
  -- and from `last_driver_gps_lat/lng` (the LAST ping during the
  -- ride, overwritten on every ping).
  ADD COLUMN IF NOT EXISTS pickup_scan_lat  double precision,
  ADD COLUMN IF NOT EXISTS pickup_scan_lng  double precision,
  ADD COLUMN IF NOT EXISTS pickup_scan_at   timestamptz,

  ADD COLUMN IF NOT EXISTS dropoff_scan_lat double precision,
  ADD COLUMN IF NOT EXISTS dropoff_scan_lng double precision,
  ADD COLUMN IF NOT EXISTS dropoff_scan_at  timestamptz,

  -- Why the ride ended. Free-text + enum-style tokens; the server
  -- writes one of:
  --   'qr_scan_completed'     — normal happy path
  --   'auto_divergence'       — GPS divergence > 500m for 2+ min
  --   'auto_idle'             — no GPS pings for N min while active
  --   'rider_cancelled'       — rider hit cancel
  --   'driver_cancelled'      — driver hit cancel
  --   'admin_force_cancelled' — admin force-cancel via panel
  ADD COLUMN IF NOT EXISTS end_reason text,

  -- Optional free-text the canceller typed (rider/driver/admin).
  -- Empty for happy-path ends.
  ADD COLUMN IF NOT EXISTS cancel_reason text,

  -- Frozen snapshot of the EIA gas price used at fare-set time.
  -- Lets ops re-derive the fare from the original inputs even after
  -- the live EIA price has changed.
  ADD COLUMN IF NOT EXISTS gas_price_per_gallon_cents integer,

  -- Per-component breakdown computed at fare-set time. Per the
  -- formula in CLAUDE.md:
  --   gas_cost_cents  = round((distance_km * 0.621371 / mpg) * gas_price * 100)
  --   time_cost_cents = round(duration_min * 5)
  --   fare_cents = max(500, gas_cost + time_cost)  -- existing column
  -- These intermediate components let the admin show "fare = $5.00
  -- gas + $1.25 time → $5 minimum applied" instead of just "$6.25".
  ADD COLUMN IF NOT EXISTS gas_cost_cents  integer,
  ADD COLUMN IF NOT EXISTS time_cost_cents integer;

-- Indexes — none required for v1. The admin detail page reads a
-- single ride by id; these columns are forensic-only and never
-- queried for ranking. Skip to keep the migration cheap.

COMMENT ON COLUMN public.rides.pickup_scan_lat IS
  '2026-05-23 m095: GPS lat at the moment the start-QR was scanned. Differs from pickup_point (agreed coord) + last_driver_gps_lat (overwritten on each ping).';
COMMENT ON COLUMN public.rides.end_reason IS
  '2026-05-23 m095: one of qr_scan_completed | auto_divergence | auto_idle | rider_cancelled | driver_cancelled | admin_force_cancelled. NULL for legacy rows.';
COMMENT ON COLUMN public.rides.gas_price_per_gallon_cents IS
  '2026-05-23 m095: Frozen EIA gas-price snapshot used at fare-set time. Lets ops re-derive the fare even after the live EIA price changes.';
COMMENT ON COLUMN public.rides.gas_cost_cents IS
  '2026-05-23 m095: Gas-cost component of the fare (cents). See CLAUDE.md formula.';
COMMENT ON COLUMN public.rides.time_cost_cents IS
  '2026-05-23 m095: Time-cost component of the fare (cents). See CLAUDE.md formula.';
