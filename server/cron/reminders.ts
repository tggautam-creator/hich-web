/**
 * Cron script: check for upcoming scheduled rides and send reminder notifications.
 * Run by PM2 every 5 minutes via ecosystem.config.cjs.
 * Exits after completion (autorestart: false, cron_restart triggers next run).
 */
import { checkUpcomingRides } from '../lib/scheduledReminders.ts'

async function main() {
  console.log('[cron/reminders] Starting check...')
  const result = await checkUpcomingRides()
  console.log(`[cron/reminders] Done: checked=${result.checked}, reminded=${result.reminded}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[cron/reminders] Fatal error:', err)
  process.exit(1)
})
