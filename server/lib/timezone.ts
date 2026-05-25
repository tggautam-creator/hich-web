/**
 * Server-side timezone helpers.
 *
 * The Tago user base is anchored in California (Davis primarily; Bay
 * Area + Sacramento secondarily). Admin metrics that bucket events
 * "by day" (signups today, rides today, etc.) need to roll over at
 * **local midnight**, not UTC midnight.
 *
 * Pre-2026-05-25 the admin code used `new Date().toISOString().slice(0,
 * 10)` which produces a UTC date. On the Vercel / EC2 hosts that's
 * 8 hours ahead of PT during PST (7 during PDT), so "today" rolled
 * over at 4–5 PM PT and the admin Overview chart appeared to "reset"
 * mid-afternoon. Fix is to bucket by America/Los_Angeles instead.
 *
 * Database TIMESTAMPTZ storage is unchanged — only the day-bucketing
 * read path uses local time.
 */

export const APP_TIMEZONE = 'America/Los_Angeles'

/**
 * Format a `Date` as `YYYY-MM-DD` in the app's local timezone
 * (America/Los_Angeles, handles PST/PDT automatically via the runtime
 * tz database).
 *
 * Uses `Intl.DateTimeFormat` with `en-CA` locale — that combo
 * produces `YYYY-MM-DD` natively (en-CA's default short date is ISO
 * order), so no manual zero-padding gymnastics.
 *
 * Examples:
 *   toLocalDateString(new Date('2026-05-25T07:00:00Z'))   // → '2026-05-25' (12 AM PT)
 *   toLocalDateString(new Date('2026-05-25T06:59:59Z'))   // → '2026-05-24' (11:59 PM PT)
 */
export function toLocalDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/**
 * The ISO-8601 UTC instant that corresponds to midnight LOCAL time on
 * the given local-date string. Used as the lower-bound `gte` filter
 * when counting "events on date D" against a TIMESTAMPTZ column.
 *
 * Conceptually:
 *   local 'YYYY-MM-DD' 00:00 in APP_TIMEZONE  →  UTC instant
 *
 * Example: localDateStartIso('2026-05-25') during PDT (UTC-7)
 *   → '2026-05-25T07:00:00.000Z'
 *
 * Implementation uses the Intl-formatter offset trick: format the
 * "intended" UTC date in the target timezone, diff the result from
 * the input, and apply the inverse offset. Avoids pulling in a
 * heavy tz library for this one calculation.
 */
export function localDateStartIso(localDate: string): string {
  // Parse YYYY-MM-DD into Y/M/D ints (no Date.parse — it's tz-fragile).
  const parts = localDate.split('-')
  if (parts.length !== 3) {
    throw new Error(`localDateStartIso: invalid date '${localDate}'`)
  }
  const yyyy = Number(parts[0])
  const mm = Number(parts[1])
  const dd = Number(parts[2])

  // Start by treating Y/M/D as if it were a UTC instant — that gives
  // us a candidate. Then check what wall-clock time that instant
  // actually maps to in APP_TIMEZONE, and shift by the difference.
  const candidate = new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0))
  const offsetMs = candidate.getTime() - tzMidnightUtcMs(candidate)
  return new Date(candidate.getTime() + offsetMs).toISOString()
}

/**
 * UTC ISO string at midnight-PT of the local day containing the
 * given instant (defaults to now). Use as the lower bound when
 * filtering "events that happened today" against a TIMESTAMPTZ
 * column, where "today" is the local-time day.
 */
export function startOfLocalDayIso(d: Date = new Date()): string {
  return localDateStartIso(toLocalDateString(d))
}

/**
 * UTC ISO string at midnight-PT, `n` LOCAL DAYS before the given
 * instant's local day (defaults to now). Use as the lower bound for
 * "last N days" rolling-window queries.
 *
 * NOT a simple instant - 86400000ms × n: DST transitions make some
 * local days 23 or 25 hours long, but the user's mental model of
 * "the past 7 days" is calendar days, not hours. We bucket by
 * calendar day and trust the runtime tz database.
 */
export function daysAgoLocalIso(d: Date = new Date(), n: number): string {
  const localToday = toLocalDateString(d)
  // Parse local-today, subtract n days at the date level, re-format.
  const parts = localToday.split('-')
  const yyyy = Number(parts[0])
  const mm = Number(parts[1])
  const dd = Number(parts[2])
  // Use UTC math to subtract days — the result is interpreted as a
  // local-date string, so any DST quirks resolve when
  // `localDateStartIso` re-runs the Intl tz lookup.
  const startUtc = Date.UTC(yyyy, mm - 1, dd) - n * 24 * 60 * 60 * 1000
  const target = new Date(startUtc)
  const shiftedLocal = [
    String(target.getUTCFullYear()).padStart(4, '0'),
    String(target.getUTCMonth() + 1).padStart(2, '0'),
    String(target.getUTCDate()).padStart(2, '0'),
  ].join('-')
  return localDateStartIso(shiftedLocal)
}

/**
 * Add `n` calendar days to a `YYYY-MM-DD` local-date string. Used
 * when ticking through chart x-axis buckets.
 */
export function addLocalDays(localDate: string, n: number): string {
  const parts = localDate.split('-')
  const yyyy = Number(parts[0])
  const mm = Number(parts[1])
  const dd = Number(parts[2])
  const startUtc = Date.UTC(yyyy, mm - 1, dd) + n * 24 * 60 * 60 * 1000
  const target = new Date(startUtc)
  return [
    String(target.getUTCFullYear()).padStart(4, '0'),
    String(target.getUTCMonth() + 1).padStart(2, '0'),
    String(target.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * Given an arbitrary instant, return the UTC ms of the SAME calendar
 * day's local midnight. Inverse helper used by `localDateStartIso`.
 */
function tzMidnightUtcMs(instant: Date): number {
  // Format the instant as Y/M/D + h/m/s in APP_TIMEZONE.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant)

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const yyyy = get('year')
  const mm = get('month')
  const dd = get('day')
  const hh = get('hour') % 24  // some locales emit 24 for midnight
  const mi = get('minute')
  const ss = get('second')

  // Reconstruct that wall-clock as a UTC instant — gives the offset
  // we need.
  return Date.UTC(yyyy, mm - 1, dd, hh, mi, ss)
}
