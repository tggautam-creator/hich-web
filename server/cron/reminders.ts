/**
 * Cron script: check for upcoming scheduled rides and send reminder notifications.
 * Also expires stale ride requests whose trip time has passed.
 * Also runs ride safety net: GPS divergence detection + max duration auto-end.
 * Run by PM2 every minute via ecosystem.config.cjs.
 * Exits after completion (autorestart: false, cron_restart triggers next run).
 */
import { checkUpcomingRides, expireStaleRequests, expireMissedRides } from '../lib/scheduledReminders.ts'
import { checkActiveRides } from '../lib/rideSafetyNet.ts'

async function main() {
  console.log('[cron/reminders] Starting check...')
  const [reminders, expiry, missed, safetyNet] = await Promise.all([
    checkUpcomingRides(),
    expireStaleRequests(),
    expireMissedRides(),
    checkActiveRides(),
  ])
  console.log(`[cron/reminders] Done: reminded=${reminders.reminded}, expired=${expiry.expired}, missed=${missed.expired}, safetyNet: checked=${safetyNet.checked} autoEnded=${safetyNet.autoEnded} reminders=${safetyNet.reminders}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[cron/reminders] Fatal error:', err)
  process.exit(1)
})
