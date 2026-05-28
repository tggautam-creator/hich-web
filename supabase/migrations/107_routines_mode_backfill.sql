-- v1.3 hotfix (2026-05-24) — heuristic backfill for web-bug rider rows.
--
-- Companion to migration 106. 106 stopped the bleeding (any new bad
-- insert now crashes loudly); this migration cleans up the rows that
-- already landed with the wrong mode.
--
-- Heuristic: any routine with mode='driver' AND available_seats IS NULL
-- is almost certainly a rider routine created via the web. Reasoning:
--
--   - The web client at SchedulePage.tsx writes:
--         available_seats: activeMode === 'driver' ? availableSeats : null
--     A driver routine ALWAYS has a non-null seat count (the form
--     requires it). The bug-affected rider routines therefore land
--     with available_seats = NULL but mode = 'driver'.
--
--   - iOS's RoutinesRepository.swift sets available_seats only on
--     driver routines; rider routines are NULL there too. iOS always
--     sets mode correctly, so iOS rider rows are already
--     (mode='rider', available_seats=NULL) and unaffected here.
--
--   - Pre-030 legacy driver routines (created before the seats column
--     existed) could in theory have NULL seats AND legitimately be
--     drivers. The risk is small enough that flipping them is the
--     right trade — a wrongly-flipped driver routine just stops
--     surfacing as a driver candidate; the user can republish.
--
-- After the UPDATE, we DELETE ride_suggestions rows whose
-- driver_routine_id points at a routine we just flipped. Those rows
-- were emitted by the engine when the routine was still
-- mis-classified as a driver; with the flip they're stale and would
-- keep surfacing the wrong card on rider home pages until expiry.
-- The on-write triggers + 5-minute backstop cron rebuild correct
-- rider-side suggestions for the flipped routines within minutes.
--
-- IMPORTANT: we do NOT delete every row in ride_suggestions. Doing
-- so would reset rider_notified_at / driver_notified_at on
-- correctly-paired rows and cause double pushes for matches users
-- already received. Targeted deletion preserves notification state
-- for everything that wasn't affected by the bug.
--
-- Idempotency: re-running the UPDATE is a no-op (after the first
-- run, the WHERE filter matches zero rows, so the CTE returns empty
-- and the DELETE removes nothing). Safe to apply twice.
--
-- Apply order: must run AFTER migration 106 (so the default is gone
-- and the suggestion-engine re-scan can't immediately re-create bad
-- rows from any in-flight client write).

BEGIN;

-- Flip the web-bug rider rows AND drop the stale suggestions that
-- referenced them as drivers — in one atomic CTE so a half-applied
-- migration can't leave the system in a partially-fixed state.
WITH flipped AS (
  UPDATE driver_routines
     SET mode = 'rider'
   WHERE mode = 'driver'
     AND available_seats IS NULL
  RETURNING id
)
DELETE FROM ride_suggestions
 WHERE driver_routine_id IN (SELECT id FROM flipped);

COMMIT;
