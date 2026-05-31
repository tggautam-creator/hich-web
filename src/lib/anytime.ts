/**
 * "Anytime ride scheduled for today" predicate + banner copy helpers.
 *
 * Mirrors iOS `ActiveRidesEndpoint.swift::isAnytimeToday` and
 * `TodaysAnytimeBanner.swift::bannerDestinationHeadline`. Used by
 * the Rides-tab `TodaysAnytimeBanner` (Sprint 9 Slice 1) — the
 * in-app reinforcement of the server's 9 AM "Today's the day"
 * push fired from `lib/scheduledReminders.ts` for rides with
 * `time_flexible = true` AND `trip_date == today`.
 *
 * `trip_date` is a wall-clock `YYYY-MM-DD` string with no
 * time/tz component. Parsing it as UTC and comparing against a
 * local `now` shifts the date by the user's offset, so a
 * negative-offset zone (e.g. PDT) reads "today" as yesterday.
 * The predicate parses in LOCAL tz to match iOS exactly.
 */

interface AnytimeRideLike {
  time_flexible?: boolean | null
  trip_date?: string | null
  schedule?: {
    trip_date?: string | null
    dest_address?: string | null
  } | null
  destination_name?: string | null
}

/** Parse a YYYY-MM-DD wall-clock string in the LOCAL timezone. */
function parseLocalDate(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(year, month - 1, day)
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * True for an Anytime (`time_flexible == true`) ride whose
 * `trip_date` is today in the local timezone. Falls back from
 * `schedule.trip_date` to the ride's own `trip_date` to match
 * iOS (`schedule?.tripDate ?? tripDate`). `now` is injected for
 * deterministic testing.
 */
export function isAnytimeToday(
  ride: AnytimeRideLike,
  now: Date = new Date(),
): boolean {
  if (ride.time_flexible !== true) return false
  const raw = ride.schedule?.trip_date ?? ride.trip_date ?? null
  if (raw == null) return false
  const parsed = parseLocalDate(raw)
  if (parsed == null) return false
  return sameLocalDay(parsed, now)
}

/**
 * Concrete destination phrase for the banner subhead. Picks
 * `schedule.dest_address` first, falls back to `destination_name`,
 * then to null so the banner uses generic copy. Trims to the
 * first comma-separated segment so the subhead doesn't wrap
 * ("Sacramento, CA" → "Sacramento"). Matches iOS
 * `bannerDestinationHeadline`.
 */
export function bannerDestinationHeadline(ride: AnytimeRideLike): string | null {
  const raw = ride.schedule?.dest_address ?? ride.destination_name ?? null
  if (raw == null || raw.length === 0) return null
  const head = raw.split(',')[0]?.trim()
  if (head == null || head.length === 0) return null
  return head
}
