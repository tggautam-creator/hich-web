/**
 * Cron script: check for upcoming scheduled rides and send reminder notifications.
 * Also expires stale ride requests whose trip time has passed.
 * Run by PM2 every 5 minutes via ecosystem.config.cjs.
 * Exits after completion (autorestart: false, cron_restart triggers next run).
 */
import { checkUpcomingRides, expireStaleRequests } from '../lib/scheduledReminders.ts'

async function main() {
  console.log('[cron/reminders] Starting check...')
  const [reminders, expiry] = await Promise.all([
    checkUpcomingRides(),
    expireStaleRequests(),
  ])
  console.log(`[cron/reminders] Done: reminded=${reminders.reminded}, expired=${expiry.expired}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[cron/reminders] Fatal error:', err)
  process.exit(1)
})
