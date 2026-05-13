-- 068_routines_audit_fixes.sql
--
-- Three closely-related fixes from the 2026-05-13 routines audit:
--
--   B4 — Unique index on routine-projected ride_schedules
--   B8 — Document the available_seats reset-on-projection semantics
--   (note) B3 (end_date filter) is purely query-level; no schema change needed.
--
-- ── B4 — projection dedup hardening ─────────────────────────────────────────
--
-- The server's `syncAllRoutines()` cron + `/api/schedule/sync-routines` AND
-- the iOS/web submission-time projection ALL insert into ride_schedules with
-- effectively the same (user_id, route_name, trip_date, trip_time) tuple
-- when a routine is in play. Their in-memory dedup (a Set keyed on
-- `${trip_date}|${trip_time}|${route_name}`) prevents same-process
-- collisions, but a race between two parallel callers (e.g. user opens
-- iOS Routines sheet while the 5-min PM2 cron is mid-run) could still
-- double-insert.
--
-- A partial unique index on routine-projected rows closes the race at
-- the DB level. Restricted to rows whose origin_place_id starts with
-- `routine:` so one-time posts (which can legitimately repeat
-- route_name on different days) are unaffected.
--
-- After this lands, callers should use `.on_conflict()` / `ignoreDuplicates`
-- on the insert so the duplicate path 23505 is silent — but the index
-- itself is the safety net even when callers forget.

-- Defensive scrub: drop any pre-existing duplicates among routine-
-- projected rows so the partial unique index below can be created
-- cleanly on production. ctid is Postgres's internal row identifier
-- — unique per physical row, so `ctid > b.ctid` keeps one arbitrary
-- copy and removes the rest. No-op when there are no duplicates.
DELETE FROM public.ride_schedules a
USING public.ride_schedules b
WHERE a.ctid > b.ctid
  AND a.user_id = b.user_id
  AND a.route_name = b.route_name
  AND a.trip_date = b.trip_date
  AND a.trip_time = b.trip_time
  AND a.origin_place_id LIKE 'routine:%'
  AND b.origin_place_id LIKE 'routine:%';

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_ride_schedules_routine_projection
  ON public.ride_schedules (user_id, route_name, trip_date, trip_time)
  WHERE origin_place_id LIKE 'routine:%';

COMMENT ON INDEX public.uq_ride_schedules_routine_projection IS
  'Prevents duplicate routine-projected board rows across parallel sync paths (PM2 cron + per-user /sync-routines + client submission-time projection). See migration 068 + the 2026-05-13 routines audit.';

-- ── B8 — document available_seats reset semantics ──────────────────────────
--
-- `driver_routines.available_seats` is the TEMPLATE seat count. Each
-- projected `ride_schedules` row gets a fresh copy. When a rider
-- requests a board entry, `ride_schedules.available_seats` decrements
-- on THAT row only — the underlying routine row is untouched, so the
-- next date projected for the same routine starts at the template
-- count again. That's intentional (each occurrence is a separate
-- trip) but easy to misread.

COMMENT ON COLUMN public.driver_routines.available_seats IS
  'Template seat count copied into each projected ride_schedules row at sync time. Per-occurrence reservations decrement ride_schedules.available_seats only; this template column never changes.';

COMMENT ON COLUMN public.driver_routines.end_date IS
  'Optional last date this routine should project to. Honoured by /api/schedule/notify (Stage 3 matcher), /api/schedule/sync-routines (per-user sync), and the PM2 syncAllRoutines() cron. NULL = no end date.';

COMMENT ON COLUMN public.driver_routines.skip_dates IS
  'Per-routine tombstone array. Populated by DELETE /api/schedule/:id when the deleted row was projected from a routine (origin_place_id = ''routine:{id}'' OR user_id+route_name+(date,time) match). The next sync-routines / cron run skips any date present here.';
