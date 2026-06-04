/**
 * PM2 cron entry point. Runs every 5 minutes via `cron_restart` in
 * `ecosystem.config.cjs`, executes the canonical sweep list, exits.
 *
 * The task list lives in `runAllSweeps.ts` so this file and the
 * in-process fallback in `server/index.ts::runReminderSweep` share
 * one source of truth. Before 2026-06-04 this file kept its own
 * hand-maintained subset, which silently drifted from the in-process
 * list — see `runAllSweeps.ts` header for the bug history
 * (syncAllRoutines 2026-05-13, welcome emails 2026-06-04).
 *
 * Adding a new periodic task: edit `runAllSweeps.ts`. Period. Both
 * entry points pick it up automatically.
 */
import { runAllSweeps } from './runAllSweeps.ts'

async function main() {
  await runAllSweeps('pm2-cron')
  process.exit(0)
}

main().catch((err) => {
  console.error('[cron/reminders] Fatal error:', err)
  process.exit(1)
})
