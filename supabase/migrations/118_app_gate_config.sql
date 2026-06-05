-- V4 F5 System A — App Gate (force-update + maintenance) remote config.
--
-- A single global config row read by `GET /api/app/gate` to decide
-- whether a client must update, is in maintenance, or can proceed.
-- Seeded maintenance-OFF with no version floor, so the gate is a no-op
-- until an admin flips it (via SQL today; via the admin UI in the later
-- web pass). The gate FAILS OPEN everywhere — if this table or the
-- endpoint errors, clients are never blocked.
--
-- Force-update applies to iOS only (web auto-updates via Vercel).
-- Maintenance applies per-platform.

CREATE TABLE IF NOT EXISTS public.app_gate_config (
  -- Enforced single row.
  id                          TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),

  -- iOS version gates (CFBundleShortVersionString, e.g. '1.4.0').
  -- Below `min_required_version_ios` → hard block (must update).
  -- Below `recommended_version_ios` → soft, dismissible "update available".
  -- NULL = no gate at that level.
  min_required_version_ios    TEXT,
  recommended_version_ios     TEXT,

  -- Maintenance mode (per platform).
  maintenance_ios             BOOLEAN NOT NULL DEFAULT false,
  maintenance_web             BOOLEAN NOT NULL DEFAULT false,

  -- Copy shown on the gate covers.
  maintenance_title           TEXT NOT NULL DEFAULT 'We''ll be right back',
  maintenance_message         TEXT NOT NULL DEFAULT 'Tago is down for a quick tune-up. Please check back shortly.',
  maintenance_eta             TEXT,
  update_title                TEXT NOT NULL DEFAULT 'Update required',
  update_message              TEXT NOT NULL DEFAULT 'A newer version of Tago is required to continue. Please update to keep riding.',
  recommended_update_message  TEXT NOT NULL DEFAULT 'A new version of Tago is available with the latest improvements.',

  -- App Store deep link for the Update button (Tago Rides app id).
  ios_store_url               TEXT NOT NULL DEFAULT 'https://apps.apple.com/us/app/tago-rides/id6763382426',

  updated_by                  UUID REFERENCES public.users(id),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the single global row (no-op gate: maintenance off, no version floor).
INSERT INTO public.app_gate_config (id) VALUES ('global')
ON CONFLICT (id) DO NOTHING;

-- Lock the table: it's served only through GET /api/app/gate (public,
-- via the service-role admin client, which bypasses RLS) and edited by
-- admins (service role). No anon/auth client access — no policies.
ALTER TABLE public.app_gate_config ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.app_gate_config IS
  'V4 F5 — single-row remote config for the App Gate (force-update + maintenance). Read by GET /api/app/gate. Gate fails open if absent/errored.';
