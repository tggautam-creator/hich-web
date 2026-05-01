-- ── notification_preferences ─────────────────────────────────────────────
-- Per-user toggles for which notification channels Tago is allowed to
-- send to. Replaces the localStorage / UserDefaults-only stubs that
-- web (`SettingsPage.tsx`) and iOS (`NotificationPreferences.swift`)
-- previously used — those persisted on a single device only and gave
-- no way for the server to honour the user's choice when fanning out
-- pushes / emails / SMS. Wired 2026-04-27 as part of P.9 (Profile
-- slice plan).
--
-- Default semantics:
--   - `push_rides`  = true  — ride lifecycle pushes (accepted, cancelled,
--                              pickup/dropoff reminders, payment alerts).
--                              Operationally critical; default-on so a
--                              new user gets functional notifications.
--   - `push_promos` = true  — promotional pushes (referral, new-feature
--                              announcements). Default-on for product
--                              growth; users can opt out.
--   - `email_marketing` = true  — marketing emails. CAN-SPAM defaults
--                              to opt-out, but our marketing emails
--                              are tied to the user's account state,
--                              not bulk lists, so opt-in is the
--                              honest default — the user can disable
--                              from this same UI.
--   - `sms_alerts`  = false — explicit opt-in only. Twilio toll-free
--                              approval is pending so this isn't
--                              actively used yet, but the column
--                              exists so we don't need a migration
--                              when the feature lands.
--
-- Schema is per-user (one row max, primary key on user_id) rather
-- than per-channel-row to keep reads to a single SELECT and let the
-- caller flip booleans without a row-existence check. The server
-- endpoint uses INSERT … ON CONFLICT to upsert — first GET creates
-- the row with defaults if missing.

-- Define the updated-at trigger helper inline so this migration is
-- self-contained — earlier migrations don't currently expose a
-- `set_updated_at()` (the original assumption was wrong; the SQL
-- failed at apply time on 2026-04-28 with "function set_updated_at()
-- does not exist"). `CREATE OR REPLACE` keeps re-applies safe + lets
-- a future shared definition land without conflict.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    push_rides       boolean     NOT NULL DEFAULT true,
    push_promos      boolean     NOT NULL DEFAULT true,
    email_marketing  boolean     NOT NULL DEFAULT true,
    sms_alerts       boolean     NOT NULL DEFAULT false,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Trigger to keep `updated_at` honest on UPDATE.
DROP TRIGGER IF EXISTS notification_preferences_updated_at ON notification_preferences;
CREATE TRIGGER notification_preferences_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- SELECT: only the user themselves can read their preferences.
-- No public read — these aren't shareable.
DROP POLICY IF EXISTS "notification_preferences_select_own"
    ON notification_preferences;
CREATE POLICY "notification_preferences_select_own"
    ON notification_preferences FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- INSERT: only the user themselves; service role bypasses RLS.
DROP POLICY IF EXISTS "notification_preferences_insert_own"
    ON notification_preferences;
CREATE POLICY "notification_preferences_insert_own"
    ON notification_preferences FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- UPDATE: only the user themselves can flip their toggles.
DROP POLICY IF EXISTS "notification_preferences_update_own"
    ON notification_preferences;
CREATE POLICY "notification_preferences_update_own"
    ON notification_preferences FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
