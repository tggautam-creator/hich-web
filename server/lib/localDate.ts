/**
 * Canonical Tago-local (America/Los_Angeles) date helpers.
 *
 * WHY THIS EXISTS (2026-06-09): `trip_date`, `end_date`, and
 * `event_date` columns store the USER'S wall-clock calendar date with
 * no timezone info — a Davis student posting a ride "for tomorrow"
 * means tomorrow in Pacific Time. Several server paths were comparing
 * those columns against `new Date().toISOString().split('T')[0]`,
 * which is the UTC calendar date. UTC rolls to the next day at
 * 4 PM PST / 5 PM PDT, so for the entire California evening:
 *
 *   - `scanForPost`'s window guard rejected same-day posts as
 *     "in the past" (suggestion engine silently dead every evening)
 *   - suggestion expiry (`expires_at` = UTC midnight) deleted
 *     same-day suggestions at 4-5 PM — before the evening trip
 *   - "A ride match for today" push copy fired on tomorrow's trips
 *   - /board and /my-posts fallbacks (clients not sending
 *     `client_date`) dropped same-day posts from the board
 *
 * `server/lib/scheduledReminders.ts` had already solved this with a
 * private `getLocalDateString` helper (RIDE_TIMEZONE) — this module
 * lifts that proven implementation into a shared home so every
 * trip-date comparison uses the same clock.
 *
 * RULE: any comparison against `trip_date` / `end_date` /
 * `event_date` MUST use these helpers (or a client-provided
 * `client_date`, which is even better because it works for users
 * travelling outside California). Internal bookkeeping that just
 * needs a consistent day-bucket (API-usage quotas, Stripe
 * idempotency day-keys, analytics lookbacks) can stay UTC.
 *
 * Single-timezone assumption: Tago operates at UC Davis. If we ever
 * expand to a campus outside Pacific Time, "the app's timezone"
 * stops being a constant and these helpers need a per-user or
 * per-campus timezone instead. Grep for TAGO_TZ when that day comes.
 */

export const TAGO_TZ = 'America/Los_Angeles'

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TAGO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TAGO_TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** YYYY-MM-DD for the given instant, in Pacific Time. (en-CA formats ISO natively.) */
export function getLocalDateString(date: Date): string {
  return dateFmt.format(date)
}

/** HH:MM:SS for the given instant, in Pacific Time. */
export function getLocalTimeString(date: Date): string {
  return timeFmt.format(date)
}

/** Today's YYYY-MM-DD in Pacific Time. */
export function localTodayISO(): string {
  return dateFmt.format(new Date())
}

/**
 * YYYY-MM-DD in Pacific Time, n×24h from now (n may be negative).
 * Date arithmetic via fixed 24h steps is DST-safe for calendar-day
 * purposes — the only drift window is the two transition hours a
 * year, and trip-date windows don't care about those.
 */
export function localDateNDaysFromNow(n: number): string {
  return dateFmt.format(new Date(Date.now() + n * 86_400_000))
}

/**
 * UTC instant (ISO string) when the Pacific calendar day `dateISO`
 * is over — used for `expires_at` on date-scoped rows so they live
 * through the user's whole evening.
 *
 * Implementation: next day at 08:00 UTC = midnight PST / 1 AM PDT.
 * In summer the row lives one extra hour past PT midnight; it can
 * never expire early. Exact-PT-midnight isn't worth a DST lookup
 * table for an expiry boundary.
 */
export function endOfLocalDayISO(dateISO: string): string {
  const d = new Date(dateISO + 'T08:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}
