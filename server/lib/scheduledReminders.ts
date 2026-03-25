import { supabaseAdmin } from './supabaseAdmin.ts'
import { sendFcmPush } from './fcm.ts'

/**
 * Checks for upcoming scheduled rides (within 30 min) that haven't had
 * a reminder sent yet. Sends FCM push to both rider and driver.
 *
 * Designed to be called via a periodic endpoint (e.g. PM2 cron every 5 min).
 */
export async function checkUpcomingRides(): Promise<{ checked: number; reminded: number }> {
  const now = new Date()
  const thirtyMinLater = new Date(now.getTime() + 30 * 60 * 1000)

  // Format as YYYY-MM-DD and HH:MM:SS for comparison
  const todayDate = now.toISOString().slice(0, 10)
  const tomorrowDate = thirtyMinLater.toISOString().slice(0, 10)

  // Query rides that:
  // 1. Have a schedule_id (are scheduled rides)
  // 2. Are in accepted/coordinating status (both parties committed)
  // 3. Haven't had a reminder sent
  // 4. Trip date is today or tomorrow (for rides near midnight)
  const { data: rides, error } = await supabaseAdmin
    .from('rides')
    .select('id, rider_id, driver_id, trip_date, trip_time, destination_name')
    .not('schedule_id', 'is', null)
    .in('status', ['accepted', 'coordinating'])
    .eq('reminder_sent', false)
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

    const rideDateTime = new Date(`${ride.trip_date}T${ride.trip_time}`)
    if (isNaN(rideDateTime.getTime())) continue

    const minutesUntil = (rideDateTime.getTime() - now.getTime()) / (1000 * 60)

    // Only send reminder for rides 0-30 min away (including just-past within 5 min grace)
    if (minutesUntil > 30 || minutesUntil < -5) continue

    const destName = ride.destination_name ?? 'your destination'
    const timeLabel = minutesUntil > 0
      ? `in ${Math.round(minutesUntil)} minutes`
      : 'now'

    // Collect user IDs to notify
    const userIds = [ride.rider_id, ride.driver_id].filter(Boolean) as string[]

    // Fetch push tokens for both users
    const { data: tokenRows } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .in('user_id', userIds)

    const tokens = (tokenRows ?? []).map((t: { token: string }) => t.token)

    if (tokens.length > 0) {
      await sendFcmPush(tokens, {
        title: 'Ride starting soon!',
        body: `Your ride to ${destName} is ${timeLabel}. Time to head to pickup!`,
        data: { type: 'ride_reminder', ride_id: ride.id },
      })
    }

    // Mark reminder as sent
    await supabaseAdmin
      .from('rides')
      .update({ reminder_sent: true })
      .eq('id', ride.id)

    reminded++
  }

  console.log(`[reminders] Checked ${rides.length} rides, sent ${reminded} reminders`)
  return { checked: rides.length, reminded }
}
