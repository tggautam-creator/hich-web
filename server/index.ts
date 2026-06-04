import { app } from './app.ts'
import { getServerEnv, validateStripeEnv } from './env.ts'
import { startRideEtaTick } from './lib/rideEtaTick.ts'
import { runAllSweeps } from './cron/runAllSweeps.ts'

const env = getServerEnv()
const { PORT, STRIPE_SECRET_KEY, SUPABASE_URL, FIREBASE_SERVICE_ACCOUNT_PATH } = env
validateStripeEnv()

// Fail-fast prod-env guards. When NODE_ENV=production, every infra
// pointer MUST resolve to the production project. Bug history that
// motivated each check:
//
//  - **Stripe key (existing):** test-mode `sk_test_*` on a prod server
//    quietly converts real rider payments into test charges and lets
//    real drivers see "earnings" that never deposit. Caused the Phase
//    3a cross-environment contamination incident.
//  - **Supabase project URL:** a prod server pointed at the dev
//    Supabase project would write all rides / wallet / users rows
//    into the dev database. iOS Release builds (prod Firebase tokens)
//    paired with a dev-pointing server have no overlap — drivers
//    appear offline, fares disappear, FCM tokens 404.
//  - **Firebase service account file:** the `.dev.json` key signs FCM
//    pushes for `tago-dev-e3ade`. Used on prod, every push to prod
//    iOS / web tokens returns `mismatched-credential` and is silently
//    dropped. Hit this exact failure mode 2026-05-11 (W-T0-5 bug).
//
// Each guard logs the offending value (or its key suffix for secrets)
// then exits, so the PM2 restart loop surfaces the problem instead of
// running silently broken.
const isProdEnv = process.env['NODE_ENV'] === 'production'
const isTestKey = STRIPE_SECRET_KEY.startsWith('sk_test_')
if (isProdEnv && isTestKey) {
  console.error('[FATAL] sk_test_* secret in NODE_ENV=production. Refusing to start.')
  process.exit(1)
}

if (isProdEnv) {
  // Production Supabase hostname is pinned in Tago.Release.xcconfig +
  // .env.prod. Anything else (especially the dev project
  // `krcwdzwqahcpqsoauttf`) means env-file mix-up.
  const PROD_SUPABASE_HOST = 'pdxtswlaxqbqkrfwailf.supabase.co'
  const supabaseHost = new URL(SUPABASE_URL).host
  if (supabaseHost !== PROD_SUPABASE_HOST) {
    console.error(
      `[FATAL] SUPABASE_URL=${supabaseHost} in NODE_ENV=production. ` +
      `Expected ${PROD_SUPABASE_HOST}. Refusing to start to prevent writing to the wrong project.`,
    )
    process.exit(1)
  }
  // Dev service account file lives at `./firebase-service-account.dev.json`.
  // The prod file is `./firebase-service-account.json`. If the dev one is
  // pointed at on prod, every FCM push fails with mismatched-credential.
  if (FIREBASE_SERVICE_ACCOUNT_PATH.endsWith('.dev.json')) {
    console.error(
      `[FATAL] FIREBASE_SERVICE_ACCOUNT_PATH=${FIREBASE_SERVICE_ACCOUNT_PATH} ` +
      `in NODE_ENV=production. The dev key signs for tago-dev-e3ade; prod tokens are on hich-6f501. Refusing to start.`,
    )
    process.exit(1)
  }
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
    // Canonical sweep list lives in cron/runAllSweeps.ts so the PM2
    // cron worker (server/cron/reminders.ts) runs the exact same set.
    // See that file's header for the history of why both entry points
    // share one source of truth.
    await runAllSweeps(`fallback:${reason}`)
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
