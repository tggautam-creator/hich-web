import { supabaseAdmin } from './supabaseAdmin.ts'
import { sendFcmPush } from './fcm.ts'

function getLocalDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getLocalTimeString(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function parseScheduledRideDateTime(tripDate: string, tripTime: string): Date {
  const [yearStr, monthStr, dayStr] = tripDate.split('-')
  const [hourStr, minuteStr, secondStr = '0'] = tripTime.split(':')

  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const hour = Number(hourStr)
  const minute = Number(minuteStr)
  const second = Number(secondStr)

  if ([year, month, day, hour, minute, second].some((part) => Number.isNaN(part))) {
    return new Date(NaN)
  }

  return new Date(year, month - 1, day, hour, minute, second)
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
    .select('id, rider_id, driver_id, trip_date, trip_time, destination_name, reminder_30_sent, reminder_15_sent')
    .not('schedule_id', 'is', null)
    .in('status', ['accepted', 'coordinating'])
    .or('reminder_30_sent.eq.false,reminder_15_sent.eq.false')
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

    const rideDateTime = parseScheduledRideDateTime(ride.trip_date, ride.trip_time)
    if (isNaN(rideDateTime.getTime())) continue

    const minutesUntil = (rideDateTime.getTime() - now.getTime()) / (1000 * 60)

    // Skip rides more than 30 min away or more than 5 min past
    if (minutesUntil > 30 || minutesUntil < -5) continue

    const destName = ride.destination_name ?? 'your destination'
    const userIds = [ride.rider_id, ride.driver_id].filter(Boolean) as string[]

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
    .select('id, rider_id, driver_id, trip_date, trip_time, destination_name, schedule_id')
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

    // For today's rides, only expire if trip_time has passed
    if (ride.trip_date === todayDate && ride.trip_time > nowTime) continue

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
    .select('id, rider_id, driver_id, trip_date, trip_time, destination_name')
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

    const rideDateTime = parseScheduledRideDateTime(ride.trip_date, ride.trip_time)
    if (isNaN(rideDateTime.getTime())) continue

    const minutesSince = (now.getTime() - rideDateTime.getTime()) / (1000 * 60)

    // Only expire if more than 2 hours (120 min) past trip time
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
