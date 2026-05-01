-- 063_trusted_contacts.sql (SAFETY.1, 2026-04-30)
--
-- Trusted contacts the user wants to reach in an emergency. The
-- iOS EmergencySheet's new 'Text my trusted contacts' CTA pulls
-- this list and pre-populates an MFMessageComposeViewController
-- with the share-location URL — no system Share Sheet picker step
-- in the moment of crisis.
--
-- Cap of 5 contacts per user is enforced in the iOS UI; DB has no
-- constraint so a future web parity surface (or CLI tool) can
-- bulk-import without a 6th-row insert failing.
--
-- E.164 phone format (`+14155551234`) validated client-side; server
-- accepts any string and lets MFMessageComposeViewController surface
-- the system error if iOS can't parse it. Same trade-off the rest
-- of the app makes for `users.phone`.
CREATE TABLE IF NOT EXISTS trusted_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trusted_contacts_user_id_idx
  ON trusted_contacts(user_id);

ALTER TABLE trusted_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY trusted_contacts_select_own ON trusted_contacts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY trusted_contacts_insert_own ON trusted_contacts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY trusted_contacts_delete_own ON trusted_contacts
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Allow soft-revoking a location share before its 4-hour TTL — the
-- track endpoint now returns 410 Gone when revoked_at IS NOT NULL,
-- mirroring its existing expired-token branch. Lets the user kill a
-- shared link from the EmergencySheet's 'Stop sharing' button if
-- they sent it to the wrong person, the situation resolves, etc.
ALTER TABLE location_shares
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

COMMENT ON COLUMN location_shares.revoked_at IS
  'When the user explicitly revoked this share token via DELETE /api/safety/share-location/:token. NULL means the token is still active up to its expires_at. Set 2026-04-30 as part of SAFETY.1.';
