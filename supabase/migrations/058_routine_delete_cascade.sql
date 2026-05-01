-- 058_routine_delete_cascade.sql
--
-- Cascade-delete projected ride_schedules rows when their parent
-- driver_routines row is deleted. Without this trigger, deleting a
-- routine leaves the next 7 days of board posts orphaned — they
-- still appear on the ride board with `origin_place_id =
-- 'routine:{deleted-id}'`, accept rider requests, and only fall off
-- when each row's trip_date passes.
--
-- We can't add a real FOREIGN KEY because `origin_place_id` is a
-- generic TEXT column (also stores Google place_ids like
-- "ChIJ..." for one-time posts). Encoding the routine reference as
-- "routine:{uuid}" is intentional — see the projection in
-- /api/schedule/sync-routines and POST /api/schedule.
--
-- Bug surfaced 2026-04-28 by Tarun in the iOS Routines sheet QA pass:
-- "will deleting the routine will also delete the associated rides
-- on rideboard?" Answer was "no, today they stay until trip_date
-- passes". This migration closes that.

CREATE OR REPLACE FUNCTION delete_orphaned_routine_schedules()
RETURNS TRIGGER AS $$
DECLARE
  _schedule_ids UUID[];
BEGIN
  -- Match the projection prefix used by /api/schedule/sync-routines:
  --   origin_place_id := 'routine:{routine_id}'
  --   dest_place_id   := 'routine:{routine_id}:dest'
  -- Either column would match; origin is the canonical key.
  -- Capture the affected schedule ids first so we can also cancel
  -- any non-terminal rides linked to them (rides.schedule_id has
  -- ON DELETE SET NULL, so a naive cascade would leave phantom
  -- ride rows pointing at nothing).
  SELECT ARRAY_AGG(id) INTO _schedule_ids
  FROM ride_schedules
  WHERE origin_place_id = 'routine:' || OLD.id::text;

  IF _schedule_ids IS NOT NULL AND array_length(_schedule_ids, 1) > 0 THEN
    UPDATE rides
    SET status = 'cancelled'
    WHERE schedule_id = ANY(_schedule_ids)
      AND status NOT IN ('cancelled', 'completed');

    DELETE FROM ride_schedules
    WHERE id = ANY(_schedule_ids);
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS driver_routines_cascade_schedules ON driver_routines;
CREATE TRIGGER driver_routines_cascade_schedules
  AFTER DELETE ON driver_routines
  FOR EACH ROW
  EXECUTE FUNCTION delete_orphaned_routine_schedules();

COMMENT ON FUNCTION delete_orphaned_routine_schedules() IS
  'Cleans up projected ride_schedules rows when their parent driver_routines row is deleted. See migration 058 for context.';
