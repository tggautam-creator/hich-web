import { app } from './app.ts'
import { getServerEnv, validateStripeEnv } from './env.ts'
import { checkUpcomingRides, expireMissedRides, expireStaleRequests } from './lib/scheduledReminders.ts'
import { checkActiveRides } from './lib/rideSafetyNet.ts'

const env = getServerEnv()
const { PORT, STRIPE_SECRET_KEY, SUPABASE_URL } = env
validateStripeEnv()

// Fail-fast guard: refuse to boot a prod build with test Stripe keys.
// This is the safety belt for the cross-environment contamination that
// caused real-driver wallets to fill up with test-mode "earnings" — see
// /Users/tarungautam/.claude/plans/scenario-2-stripe-purring-hollerith.md.
const isProdEnv = process.env['NODE_ENV'] === 'production'
const isTestKey = STRIPE_SECRET_KEY.startsWith('sk_test_')
if (isProdEnv && isTestKey) {
  console.error('[FATAL] sk_test_* secret in NODE_ENV=production. Refusing to start.')
  process.exit(1)
}
// Log the resolved mode + DB host on every boot so deploy logs surface
// any env mismatch immediately.
console.log(`[boot] Stripe=${isTestKey ? 'TEST' : 'LIVE'} · supabase=${new URL(SUPABASE_URL).host}`)

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
