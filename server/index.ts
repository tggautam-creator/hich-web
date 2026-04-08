import { app } from './app.ts'
import { getServerEnv, validateStripeEnv } from './env.ts'
import { checkUpcomingRides, expireMissedRides, expireStaleRequests } from './lib/scheduledReminders.ts'
import { checkActiveRides } from './lib/rideSafetyNet.ts'

const { PORT } = getServerEnv()
validateStripeEnv()

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason)
})

const server = app.listen(PORT, () => {
  console.log(`TAGO server listening on port ${PORT}`)
})

let reminderSweepRunning = false

async function runReminderSweep(reason: string): Promise<void> {
  if (reminderSweepRunning) return
  reminderSweepRunning = true

  try {
    console.log(`[cron/fallback] Starting reminder sweep (${reason})`)
    const [reminders, expiry, missed, safetyNet] = await Promise.all([
      checkUpcomingRides(),
      expireStaleRequests(),
      expireMissedRides(),
      checkActiveRides(),
    ])
    console.log(`[cron/fallback] Done: reminded=${reminders.reminded}, expired=${expiry.expired}, missed=${missed.expired}, safetyNet: checked=${safetyNet.checked} autoEnded=${safetyNet.autoEnded} reminders=${safetyNet.reminders}`)
  } catch (err) {
    console.error('[cron/fallback] Failed reminder sweep:', err)
  } finally {
    reminderSweepRunning = false
  }
}

const runningUnderPm2 = Boolean(process.env['PM2_HOME'] || process.env['pm_id'])
if (!runningUnderPm2) {
  void runReminderSweep('startup')
  const reminderInterval = setInterval(() => {
    void runReminderSweep('interval')
  }, 5 * 60 * 1000)
  reminderInterval.unref?.()
}

process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, closing server...')
  server.close(() => {
    console.log('[SHUTDOWN] Server closed')
    process.exit(0)
  })
})
