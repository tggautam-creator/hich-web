import { supabaseAdmin } from './supabaseAdmin.ts'
import { sendFcmPush } from './fcm.ts'

// All trip_date/trip_time values across the app are tz-naive wall-clock
// strings in the user's local timezone — Davis, CA. Parsing them with the
// server's local TZ (which is UTC in production) shifts every comparison
// by 7-8 hours, firing "ride in 30 min" reminders at 1 AM and auto-
// cancelling rides overnight. Anchor cron logic to Pacific explicitly so
// behavior is correct regardless of where the host runs.
const RIDE_TIMEZONE = 'America/Los_Angeles'

/** Returns YYYY-MM-DD for the given instant as seen in RIDE_TIMEZONE. */
function getLocalDateString(date: Date): string {
  // en-CA formats as YYYY-MM-DD natively.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: RIDE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Returns HH:MM:SS (24h) for the given instant as seen in RIDE_TIMEZONE. */
function getLocalTimeString(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: RIDE_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

/** Returns the GMT offset string (e.g. "-07:00" / "-08:00") for the given
 *  YYYY-MM-DD as seen in RIDE_TIMEZONE. Handles DST transitions. */
function pacificOffsetForDate(yyyymmdd: string): string {
  // Probe at noon UTC of the date to avoid DST transition midnight edges.
  const probe = new Date(`${yyyymmdd}T12:00:00Z`)
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: RIDE_TIMEZONE,
    timeZoneName: 'longOffset',
  })
    .formatToParts(probe)
    .find((p) => p.type === 'timeZoneName')?.value
  const m = tzName?.match(/GMT([+-]\d{2}:\d{2})/)
  return m ? m[1] : '-08:00'
}

function parseScheduledRideDateTime(tripDate: string, tripTime: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tripDate)) return new Date(NaN)
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(tripTime)) return new Date(NaN)
  const time = tripTime.length === 5 ? `${tripTime}:00` : tripTime
  const offset = pacificOffsetForDate(tripDate)
  return new Date(`${tripDate}T${time}${offset}`)
}

export function shouldTreatScheduledRideAsExpired(
  ride: {
    status?: string
    schedule_id?: string | null
    trip_date?: string | null
    trip_time?: string | null
  },
  now = new Date(),
): boolean {
  if (!ride.status || !ride.schedule_id || !ride.trip_date || !ride.trip_time) return false

  const rideDateTime = parseScheduledRideDateTime(ride.trip_date, ride.trip_time)
  if (Number.isNaN(rideDateTime.getTime())) return false

  if (ride.status === 'requested') {
    return rideDateTime.getTime() <= now.getTime()
  }

  if (ride.status === 'accepted' || ride.status === 'coordinating') {
    return now.getTime() - rideDateTime.getTime() >= 2 * 60 * 60 * 1000
  }

  return false
}

/**
 * Checks for upcoming scheduled rides and sends dual reminders:
 * - 30-min reminder: sent when ride is 15–30 min away
 * - 15-min reminder: sent when ride is 0–15 min away
 *
 * Each reminder: FCM push + persistent in-app notification (visible in bell icon).
 * Designed to be called via a periodic endpoint (e.g. PM2 cron every 5 min).
 */
export async function checkUpcomingRides(): Promise<{ checked: number; reminded: number }> {
  const now = new Date()
  const thirtyMinLater = new Date(now.getTime() + 30 * 60 * 1000)

  const todayDate = getLocalDateString(now)
  const tomorrowDate = getLocalDateString(thirtyMinLater)

  // Query rides that still have at least one unsent reminder
  const { data: rides, error } = await supabaseAdmin
    .from('rides')
    .select('id, rider_id, driver_id, trip_date, trip_time, destination_name, reminder_30_sent, reminder_15_sent, reminder_today_sent, time_flexible')
    .not('schedule_id', 'is', null)
    .in('status', ['accepted', 'coordinating'])
    .or('reminder_30_sent.eq.false,reminder_15_sent.eq.false,reminder_today_sent.eq.false')
    .in('trip_date', [todayDate, tomorrowDate])

  if (error) {
    console.error('[reminders] Failed to query upcoming rides:', error.message)
    return { checked: 0, reminded: 0 }
  }

  if (!rides || rides.length === 0) {
    return { checked: 0, reminded: 0 }
  }

  let reminded = 0

  for (const ride of rides) {
    if (!ride.trip_date || !ride.trip_time) continue

    const isFlex = ride.time_flexible === true
    const destName = ride.destination_name ?? 'your destination'
    const userIds = [ride.rider_id, ride.driver_id].filter(Boolean) as string[]

    // ── Anytime path: ONE 9 AM reminder on the trip date ─────────────
    // The 30/15-min reminders are noise for flex rides — they fire
    // off the noon placeholder. Replace with a single morning push.
    if (isFlex) {
      if (ride.reminder_today_sent) continue
      // Only fire when (a) trip_date is today AND (b) local clock is
      // past 9 AM. Trip dates in the future stay queued; dates in
      // the past won't be picked up because the SQL filter only
      // includes today + tomorrow.
      if (ride.trip_date !== todayDate) continue
      if (nowTime < '09:00:00') continue

      const title = 'Today\'s the day!'
      const body = `Your scheduled ride to ${destName} is anytime today. Open Tago when you're ready to head out.`
      await sendReminderNotification(ride.id, userIds, title, body)
      await supabaseAdmin.from('rides').update({ reminder_today_sent: true }).eq('id', ride.id)
      reminded++
      continue
    }

    // ── Specific-time path (existing) ────────────────────────────────
    const rideDateTime = parseScheduledRideDateTime(ride.trip_date, ride.trip_time)
    if (isNaN(rideDateTime.getTime())) continue

    const minutesUntil = (rideDateTime.getTime() - now.getTime()) / (1000 * 60)

    // Skip rides more than 30 min away or more than 5 min past
    if (minutesUntil > 30 || minutesUntil < -5) continue

    // 30-min reminder: ride is 15–30 min away
    if (!ride.reminder_30_sent && minutesUntil > 0 && minutesUntil <= 30) {
      const title = 'Ride in 30 minutes'
      const body = `Your ride to ${destName} starts in ~${Math.round(minutesUntil)} min.`

      await sendReminderNotification(ride.id, userIds, title, body)
      await supabaseAdmin.from('rides').update({ reminder_30_sent: true }).eq('id', ride.id)
      reminded++
    }

    // 15-min reminder: ride is 0–15 min away (or just past within 5 min grace)
    if (!ride.reminder_15_sent && minutesUntil <= 15) {
      const title = 'Ride starting soon!'
      const body = minutesUntil > 0
        ? `Your ride to ${destName} starts in ~${Math.round(minutesUntil)} min. Head to pickup!`
        : `Your ride to ${destName} is now. Head to pickup!`

      await sendReminderNotification(ride.id, userIds, title, body)
      await supabaseAdmin.from('rides').update({ reminder_15_sent: true }).eq('id', ride.id)

      // Also mark 30-min as sent (in case it was missed due to timing)
      if (!ride.reminder_30_sent) {
        await supabaseAdmin.from('rides').update({ reminder_30_sent: true }).eq('id', ride.id)
      }

      reminded++
    }
  }

  console.log(`[reminders] Checked ${rides.length} rides, sent ${reminded} reminders`)
  return { checked: rides.length, reminded }
}

/**
 * Sends FCM push + persists in-app notification for ride reminders.
 */
async function sendReminderNotification(
  rideId: string,
  userIds: string[],
  title: string,
  body: string,
): Promise<void> {
  // Fetch push tokens for all participants
  const { data: tokenRows } = await supabaseAdmin
    .from('push_tokens')
    .select('token')
    .in('user_id', userIds)

  const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)

  if (tokens.length > 0) {
    await sendFcmPush(tokens, {
      title,
      body,
      data: { type: 'ride_reminder', ride_id: rideId },
    })
  }

  // Persist in-app notification for each user (visible in notifications bell)
  for (const userId of userIds) {
    void supabaseAdmin.from('notifications').insert({
      user_id: userId,
      type: 'ride_reminder',
      title,
      body,
      data: { ride_id: rideId },
    }).then(({ error: notifErr }) => {
      if (notifErr) console.error(`[reminders] Failed to persist notification for ${userId}:`, notifErr.message)
    })
  }
}

/**
 * Expires stale board requests where trip_time has passed.
 * Rides in 'requested' status whose trip_date + trip_time < NOW are set to 'expired'.
 * Sends FCM push + persistent notification + Realtime broadcast to the requester.
 */
export async function expireStaleRequests(): Promise<{ checked: number; expired: number }> {
  const { realtimeBroadcast } = await import('./realtimeBroadcast.ts')
  const now = new Date()
  const todayDate = getLocalDateString(now)
  const nowTime = getLocalTimeString(now) // HH:MM:SS

  // Find requested rides whose trip has already passed
  const { data: rides, error } = await supabaseAdmin
    .from('rides')
    .select('id, rider_id, driver_id, trip_date, trip_time, destination_name, schedule_id, time_flexible')
    .not('schedule_id', 'is', null)
    .eq('status', 'requested')
    .not('trip_date', 'is', null)
    .not('trip_time', 'is', null)
    .lte('trip_date', todayDate)

  if (error) {
    console.error('[expiry] Failed to query stale requests:', error.message)
    return { checked: 0, expired: 0 }
  }

  if (!rides || rides.length === 0) {
    return { checked: 0, expired: 0 }
  }

  let expired = 0

  for (const ride of rides) {
    if (!ride.trip_date || !ride.trip_time) continue

    const isFlex = ride.time_flexible === true

    // Anytime rides stay valid the entire trip date — only expire
    // once the date itself is in the past. The SQL `.lte` window
    // already includes today, so explicitly skip flex rides whose
    // trip_date is still today.
    if (isFlex && ride.trip_date === todayDate) continue

    // Specific-time rides: on today, only expire if trip_time has passed
    if (!isFlex && ride.trip_date === todayDate && ride.trip_time > nowTime) continue

    // Update status to cancelled so the ride disappears from active views.
    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'cancelled' })
      .eq('id', ride.id)

    if (updateErr) {
      console.error(`[expiry] Failed to expire ride ${ride.id}:`, updateErr.message)
      continue
    }

    const requesterId = ride.rider_id ?? ride.driver_id
    if (!requesterId) continue

    const destName = ride.destination_name ?? 'the posted ride'

    // Send FCM push to requester
    const { data: tokenRows } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('user_id', requesterId)

    const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)

    if (tokens.length > 0) {
      await sendFcmPush(tokens, {
        title: 'Request Expired',
        body: `Your ride request for ${destName} has expired — the driver didn't respond in time.`,
        data: { type: 'request_expired', ride_id: ride.id },
      })
    }

    // Persist notification
    void supabaseAdmin.from('notifications').insert({
      user_id: requesterId,
      type: 'board_declined',
      title: 'Request Expired',
      body: `Your ride request expired — the trip time has passed.`,
      data: { ride_id: ride.id },
    }).then(({ error: notifErr }) => {
      if (notifErr) console.error('Failed to persist expiry notification:', notifErr.message)
    })

    // Broadcast via Realtime so the UI updates
    void realtimeBroadcast(`board:${requesterId}`, 'request_expired', {
      ride_id: ride.id,
    })

    expired++
  }

  console.log(`[expiry] Checked ${rides.length} rides, expired ${expired}`)
  return { checked: rides.length, expired }
}

/**
 * Expires confirmed rides (accepted/coordinating) that were never started
 * and are more than 2 hours past their scheduled trip time.
 * Notifies both rider and driver.
 */
export async function expireMissedRides(): Promise<{ checked: number; expired: number }> {
  const { realtimeBroadcast } = await import('./realtimeBroadcast.ts')
  const now = new Date()
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
  const todayDate = getLocalDateString(now)
  const yesterdayDate = getLocalDateString(twoHoursAgo)

  // Find confirmed rides whose trip time is more than 2 hours ago
  const { data: rides, error } = await supabaseAdmin
    .from('rides')
    .select('id, rider_id, driver_id, trip_date, trip_time, destination_name, time_flexible')
    .not('schedule_id', 'is', null)
    .in('status', ['accepted', 'coordinating'])
    .not('trip_date', 'is', null)
    .not('trip_time', 'is', null)
    .in('trip_date', [todayDate, yesterdayDate])

  if (error) {
    console.error('[missed] Failed to query missed rides:', error.message)
    return { checked: 0, expired: 0 }
  }

  if (!rides || rides.length === 0) {
    return { checked: 0, expired: 0 }
  }

  let expired = 0

  for (const ride of rides) {
    if (!ride.trip_date || !ride.trip_time) continue

    const isFlex = ride.time_flexible === true

    let minutesSince: number
    if (isFlex) {
      // Anytime rides: anchor expiry to END of the trip date
      // (next day midnight in local time). We treat 23:59:59 of the
      // trip_date as the effective deadline so any time during the
      // day stays valid; 2h grace then carries into ~02:00 the next
      // morning before auto-cancel.
      const endOfDay = parseScheduledRideDateTime(ride.trip_date, '23:59:59')
      if (isNaN(endOfDay.getTime())) continue
      minutesSince = (now.getTime() - endOfDay.getTime()) / (1000 * 60)
    } else {
      const rideDateTime = parseScheduledRideDateTime(ride.trip_date, ride.trip_time)
      if (isNaN(rideDateTime.getTime())) continue
      minutesSince = (now.getTime() - rideDateTime.getTime()) / (1000 * 60)
    }

    // Only expire if more than 2 hours (120 min) past the deadline
    if (minutesSince < 120) continue

    const { error: updateErr } = await supabaseAdmin
      .from('rides')
      .update({ status: 'cancelled' })
      .eq('id', ride.id)

    if (updateErr) {
      console.error(`[missed] Failed to expire ride ${ride.id}:`, updateErr.message)
      continue
    }

    const destName = ride.destination_name ?? 'your destination'
    const userIds = [ride.rider_id, ride.driver_id].filter(Boolean) as string[]

    // Notify both parties
    const { data: tokenRows } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .in('user_id', userIds)

    const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)

    if (tokens.length > 0) {
      await sendFcmPush(tokens, {
        title: 'Ride Missed',
        body: `Your ride to ${destName} was not started and has expired.`,
        data: { type: 'ride_missed', ride_id: ride.id },
      })
    }

    // Persist notification for both users
    for (const userId of userIds) {
      void supabaseAdmin.from('notifications').insert({
        user_id: userId,
        type: 'ride_missed',
        title: 'Ride Missed',
        body: `Your ride to ${destName} was not started and has expired.`,
        data: { ride_id: ride.id },
      }).then(({ error: notifErr }) => {
        if (notifErr) console.error(`[missed] Failed to persist notification for ${userId}:`, notifErr.message)
      })
    }

    // Broadcast so any open chat UI updates
    for (const userId of userIds) {
      void realtimeBroadcast(`myrides:${userId}`, 'ride_status_changed', {
        ride_id: ride.id,
        status: 'cancelled',
      })
    }

    expired++
  }

  console.log(`[missed] Checked ${rides.length} rides, expired ${expired}`)
  return { checked: rides.length, expired }
}

/**
 * Daily-cron projection of every active driver_routine into the next
 * 7 days of `ride_schedules`. Closes the gap where the per-user
 * `/api/schedule/sync-routines` endpoint only fires when a user opens
 * the Routines sheet — without this cron, a routine for "every Monday
 * 8am" stops projecting after the user stops opening the app.
 *
 * Idempotent on three layers:
 *   1. Skip-dates tombstone (migration 057 — user explicitly deleted
 *      this date for this routine).
 *   2. (date|time|route) dedup against existing ride_schedules rows.
 *   3. Self-skip if the routine was deactivated.
 *
 * Anchors "today" to America/Los_Angeles (matches the rest of the
 * scheduled-reminder helpers + the routine UX expectation that "today"
 * means the user's local calendar day, not server UTC).
 *
 * Called from `GET /api/schedule/check-reminders` (PM2 cron, every
 * 5 min — daily firing is OK because the projection is idempotent so
 * running it more often than needed is just a no-op after the first
 * pass each day).
 */
export async function syncAllRoutines(): Promise<{ users: number; inserted: number }> {
  // Pull every active routine in one round-trip. Filter out users
  // with zero routines. Each row carries skip_dates so we tombstone
  // correctly per (routine, date) without a join.
  const { data: routines, error } = await supabaseAdmin
    .from('driver_routines')
    .select('id, user_id, route_name, direction_type, day_of_week, departure_time, arrival_time, origin_address, dest_address, skip_dates')
    .eq('is_active', true)

  if (error) {
    console.error('[sync-cron] Failed to load active routines:', error.message)
    return { users: 0, inserted: 0 }
  }

  if (!routines || routines.length === 0) return { users: 0, inserted: 0 }

  // Group by user so we can read each user's existing schedules in
  // one batched query per user.
  const byUser = new Map<string, typeof routines>()
  for (const r of routines) {
    const list = byUser.get(r.user_id as string) ?? []
    list.push(r)
    byUser.set(r.user_id as string, list)
  }

  // Anchor "today" to LA — matches RIDE_TIMEZONE used throughout
  // this file. UTC math after that point makes day-of-week stable.
  const now = new Date()
  const todayLocal = getLocalDateString(now) // YYYY-MM-DD
  const [tyStr, tmStr, tdStr] = todayLocal.split('-') as [string, string, string]
  const todayY = Number(tyStr); const todayM = Number(tmStr); const todayD = Number(tdStr)
  const today = new Date(Date.UTC(todayY, todayM - 1, todayD))
  const todayDow = today.getUTCDay()
  const weekOut = new Date(today)
  weekOut.setUTCDate(today.getUTCDate() + 7)
  const todayStr = todayLocal
  const weekOutStr = `${weekOut.getUTCFullYear()}-${String(weekOut.getUTCMonth() + 1).padStart(2, '0')}-${String(weekOut.getUTCDate()).padStart(2, '0')}`

  let totalInserted = 0
  let usersTouched = 0

  for (const [userId, userRoutines] of byUser.entries()) {
    // Existing rows for the next 7 days for this user — used to dedup
    // by (date | time | route_name) without re-inserting duplicates.
    const { data: existing } = await supabaseAdmin
      .from('ride_schedules')
      .select('trip_date, trip_time, route_name')
      .eq('user_id', userId)
      .gte('trip_date', todayStr)
      .lte('trip_date', weekOutStr)

    const existingKeys = new Set(
      (existing ?? []).map((s: Record<string, unknown>) =>
        `${s['trip_date'] as string}|${s['trip_time'] as string}|${s['route_name'] as string}`,
      ),
    )

    // Mode lookup (one query per user, cheap).
    const { data: userRow } = await supabaseAdmin
      .from('users')
      .select('is_driver')
      .eq('id', userId)
      .single()
    const mode: 'driver' | 'rider' = userRow?.is_driver ? 'driver' : 'rider'

    const inserts: Array<{
      user_id: string; mode: 'driver' | 'rider'; route_name: string;
      origin_place_id: string; origin_address: string;
      dest_place_id: string; dest_address: string;
      direction_type: 'one_way' | 'roundtrip'; trip_date: string;
      time_type: 'departure' | 'arrival'; trip_time: string;
    }> = []

    for (const r of userRoutines as Array<Record<string, unknown>>) {
      const skipSet = new Set((r['skip_dates'] as string[] | null) ?? [])
      const departureTime = r['departure_time'] as string | null
      const arrivalTime = r['arrival_time'] as string | null
      const timeStr = departureTime ?? arrivalTime ?? '08:00:00'
      const timeType: 'departure' | 'arrival' = departureTime ? 'departure' : 'arrival'
      const routeName = r['route_name'] as string
      const directionType = r['direction_type'] as 'one_way' | 'roundtrip'
      const originAddr = (r['origin_address'] as string | null) ?? routeName
      const destAddr = (r['dest_address'] as string | null) ?? routeName
      const dows = (r['day_of_week'] as number[] | null) ?? []
      const routineID = r['id'] as string

      for (const dow of dows) {
        let daysUntil = dow - todayDow
        if (daysUntil < 0) daysUntil += 7
        if (daysUntil === 0) daysUntil = 7

        const nextDate = new Date(today)
        nextDate.setUTCDate(today.getUTCDate() + daysUntil)
        if (nextDate > weekOut) continue

        const dateStr = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDate.getUTCDate()).padStart(2, '0')}`
        if (skipSet.has(dateStr)) continue
        const key = `${dateStr}|${timeStr}|${routeName}`
        if (existingKeys.has(key)) continue
        existingKeys.add(key)

        inserts.push({
          user_id: userId,
          mode,
          route_name: routeName,
          origin_place_id: `routine:${routineID}`,
          origin_address: originAddr,
          dest_place_id: `routine:${routineID}:dest`,
          dest_address: destAddr,
          direction_type: directionType,
          trip_date: dateStr,
          time_type: timeType,
          trip_time: timeStr,
        })
      }
    }

    if (inserts.length > 0) {
      const { error: insertErr } = await supabaseAdmin
        .from('ride_schedules')
        .insert(inserts)
      if (insertErr) {
        console.error(`[sync-cron] insert failed user=${userId}:`, insertErr.message)
        continue
      }
      totalInserted += inserts.length
      usersTouched++
    }
  }

  console.log(`[sync-cron] Synced routines for ${usersTouched} user(s), inserted ${totalInserted} row(s)`)
  return { users: usersTouched, inserted: totalInserted }
}
