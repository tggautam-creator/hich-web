/**
 * Cron script: check for upcoming scheduled rides and send reminder notifications.
 * Also expires stale ride requests whose trip time has passed.
 * Also runs ride safety net: GPS divergence detection + max duration auto-end.
 * Also projects active driver_routines into the rolling 7-day ride_schedules
 *   window so a routine for "every Monday 8am" keeps repopulating the board
 *   even if the user never opens the Routines sheet. Without this call,
 *   `syncAllRoutines()` only fired from the `if (!runningUnderPm2)` fallback
 *   in `server/index.ts` — which never runs on prod because EC2 is under PM2.
 *   Surfaced 2026-05-13 via the routines audit; before this fix, routines
 *   stopped projecting once the initial submission-time 7-day projection
 *   rolled past unless a user manually opened the Routines view.
 * Run by PM2 every 5 minutes via ecosystem.config.cjs.
 * Exits after completion (autorestart: false, cron_restart triggers next run).
 */
import {
  checkUpcomingRides,
  expireStaleRequests,
  expireMissedRides,
  syncAllRoutines,
} from '../lib/scheduledReminders.ts'
import { checkActiveRides } from '../lib/rideSafetyNet.ts'

async function main() {
  console.log('[cron/reminders] Starting check...')
  const [reminders, expiry, missed, safetyNet, routineSync] = await Promise.all([
    checkUpcomingRides(),
    expireStaleRequests(),
    expireMissedRides(),
    checkActiveRides(),
    // `syncAllRoutines` is idempotent on three layers (skip_dates
    // tombstone, (date|time|route) dedup, is_active filter), so
    // running every 5 min is cheap — after the first pass each day
    // the inserts collapse to zero.
    syncAllRoutines(),
  ])
  console.log(`[cron/reminders] Done: reminded=${reminders.reminded}, expired=${expiry.expired}, missed=${missed.expired}, safetyNet: checked=${safetyNet.checked} autoEnded=${safetyNet.autoEnded} reminders=${safetyNet.reminders}, routineSync: users=${routineSync.users} inserted=${routineSync.inserted}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[cron/reminders] Fatal error:', err)
  process.exit(1)
})
