import { app } from './app.ts'
import { getServerEnv, validateStripeEnv } from './env.ts'
import { checkUpcomingRides, clearExpiredSnoozes, clearStaleOnlineFlags, expireMissedRides, expireStaleRequests, syncAllRoutines } from './lib/scheduledReminders.ts'
import { checkActiveRides } from './lib/rideSafetyNet.ts'
import { startRideEtaTick } from './lib/rideEtaTick.ts'
import { sendPendingPaymentNudges } from './jobs/paymentDunning.ts'

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
    const [reminders, expiry, missed, safetyNet, sync, dunning, snooze, staleOnline] = await Promise.all([
      checkUpcomingRides(),
      expireStaleRequests(),
      expireMissedRides(),
      checkActiveRides(),
      syncAllRoutines(),
      // Z4b (2026-04-30) — wire the 24/48/72h payment-dunning cron
      // into the auto-sweep. Bucket logic + UNIQUE constraint on
      // `payment_nudges (ride_id, bucket)` mean firing every 5 min
      // can't double-push: only one pass per ride per bucket sends
      // a nudge, the rest no-op via INSERT 23505. Defensive .catch()
      // so a query error in this branch doesn't tank the other
      // sweeps via Promise.all rejection.
      sendPendingPaymentNudges().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[cron/fallback] dunning failed: ${msg}`)
        return { scanned: 0, nudged: 0, skipped: 0, errors: [] }
      }),
      // 2026-05-01 — clear expired driver snoozes + fire "you're
      // back online" FCM push. Layer 1 of the 4-layer snooze-expiry
      // fix; iOS local Timer (layer 2) handles sub-second feedback,
      // this cron is the source of truth in case the app was killed
      // during the snooze window.
      clearExpiredSnoozes().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[cron/fallback] snooze sweep failed: ${msg}`)
        return { cleared: 0, notified: 0 }
      }),
      // 2026-05-04 — flip is_online=false on driver_locations rows
      // whose recorded_at is older than 6h. Replaces the per-request
      // freshness filter the matcher used to apply on Stage 1
      // fallback (removed same day to unblock force-quit drivers).
      clearStaleOnlineFlags().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[cron/fallback] stale-online sweep failed: ${msg}`)
        return { cleared: 0, notified: 0 }
      }),
    ])
    console.log(`[cron/fallback] Done: reminded=${reminders.reminded}, expired=${expiry.expired}, missed=${missed.expired}, safetyNet: checked=${safetyNet.checked} autoEnded=${safetyNet.autoEnded} reminders=${safetyNet.reminders}, sync: users=${sync.users} inserted=${sync.inserted}, dunning: scanned=${dunning.scanned} nudged=${dunning.nudged}, snooze: cleared=${snooze.cleared} notified=${snooze.notified}, staleOnline: cleared=${staleOnline.cleared} notified=${staleOnline.notified}`)
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

// LIVE.5 (2026-04-30) — server-driven ETA tick for the rider's
// Live Activity. 30s cadence; no-ops when no Live Activity tokens
// are registered. Skipped under PM2 in case the user runs multi-
// worker setups where only one process should own the ticker.
if (!runningUnderPm2) {
  startRideEtaTick()
}

process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, closing server...')
  server.close(() => {
    console.log('[SHUTDOWN] Server closed')
    process.exit(0)
  })
})
