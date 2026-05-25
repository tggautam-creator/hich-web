-- v1.3 — add `push_suggestions` opt-out to notification_preferences.
--
-- The Suggested Rides feature (migration 100) introduces a new push
-- category. Per the FCM sender's filter-by-preferences pattern
-- (server/lib/fcm.ts), every category needs its own toggle in
-- notification_preferences so users can opt out without losing
-- operational ride pushes (`push_rides`) or marketing
-- (`push_promos`). Default-on for product growth — users discover
-- the feature via the first push, can opt out from Settings if it
-- becomes noise.

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS push_suggestions BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN notification_preferences.push_suggestions IS
  'v1.3 — receive pushes about Suggested Rides matches (instant for '
  'high-relevance matches + same-day rides, daily 7am digest for the '
  'rest). Default-on; toggled from Settings > Notifications.';
