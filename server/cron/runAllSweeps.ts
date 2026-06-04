/**
 * Shared cron-task fan-out.
 *
 * Why this exists:
 *   Before 2026-06-04 the full sweep list lived inline in
 *   `server/index.ts::runReminderSweep` (the in-process fallback that
 *   fires every 5 min when not under PM2). PM2's cron worker
 *   (`server/cron/reminders.ts`) had its own hand-maintained subset.
 *   Every time someone added a new task to the in-process fallback
 *   without also updating the PM2 cron, that task silently died on
 *   prod the moment it shipped:
 *     - 2026-05-13: syncAllRoutines was added inline; routines stopped
 *       projecting on prod until the routines audit caught it.
 *     - 2026-06-02: trySweepWelcomeEmails was added inline; welcome
 *       emails to new users never sent on prod (surfaced 2026-06-04
 *       when Tarun noticed signups weren't getting the welcome email).
 *
 *   The fix is to keep the canonical sweep list in ONE place. Both
 *   entry points import this function. Adding a task means editing
 *   here — period. Future drift becomes impossible.
 *
 * Idempotency note:
 *   Every task in here has its own dedup (UNIQUE indexes, time
 *   windows, internal counters). Running the whole list every 5 min
 *   is cheap when there's no work to do. Self-gated tasks (daily
 *   stories/poster/brief — gated >=7 AM PT once/day; weekly review —
 *   Monday-only after 9 AM PT) make their own decisions about whether
 *   to do real work or no-op.
 *
 * Defensive isolation:
 *   Every task is wrapped in `.catch()` so a failure in one branch
 *   can't poison the Promise.all via rejection. The cron sweep would
 *   otherwise stop halfway and leave later tasks (e.g. the welcome
 *   email sweep at the end) silently skipped.
 */
import {
  checkUpcomingRides,
  clearExpiredSnoozes,
  clearStaleOnlineFlags,
  expireMissedRides,
  expirePendingBoardOffers,
  expireStaleRequests,
  syncAllRoutines,
} from '../lib/scheduledReminders.ts'
import { checkActiveRides } from '../lib/rideSafetyNet.ts'
import { sendPendingPaymentNudges } from '../jobs/paymentDunning.ts'
import {
  dispatchSuggestionNotifications,
  expireStaleSuggestions,
  runSuggestionBackstopScan,
} from '../lib/suggestionEngine.ts'
import { tryGenerateDailyStories } from '../lib/marketing/storyGenerator.ts'
import { tryGenerateDailyPoster } from '../lib/marketing/posterGenerator.ts'
import { tryGenerateDailyBriefing } from '../lib/marketing/dailyFocusGenerator.ts'
import { tryGenerateAndSendWeeklyReview } from '../lib/marketing/weeklyReviewGenerator.ts'
import { trySweepWelcomeEmails } from '../lib/email/welcomeEmailSweep.ts'

export async function runAllSweeps(reason: string): Promise<void> {
  console.log(`[cron] Starting sweep (${reason})`)
  const [
    reminders,
    expiry,
    missed,
    safetyNet,
    sync,
    dunning,
    snooze,
    staleOnline,
    offerExpiry,
    suggestBackstop,
    suggestPushes,
    suggestExpired,
    marketingStories,
    marketingPosters,
    marketingBrief,
    marketingWeekly,
    welcomeEmails,
  ] = await Promise.all([
    checkUpcomingRides(),
    expireStaleRequests(),
    expireMissedRides(),
    checkActiveRides(),
    syncAllRoutines(),
    sendPendingPaymentNudges().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] dunning failed: ${msg}`)
      return { scanned: 0, nudged: 0, skipped: 0, errors: [] }
    }),
    clearExpiredSnoozes().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] snooze sweep failed: ${msg}`)
      return { cleared: 0, notified: 0 }
    }),
    clearStaleOnlineFlags().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] stale-online sweep failed: ${msg}`)
      return { cleared: 0, notified: 0 }
    }),
    expirePendingBoardOffers().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] offer-expiry sweep failed: ${msg}`)
      return { checked: 0, expired: 0 }
    }),
    runSuggestionBackstopScan().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] suggestion backstop scan failed: ${msg}`)
      return { scanned: 0, inserted: 0 }
    }),
    dispatchSuggestionNotifications().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] suggestion notifications failed: ${msg}`)
      return { pushed: 0, deferred: 0, suppressed: 0 }
    }),
    expireStaleSuggestions().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] suggestion expiry failed: ${msg}`)
      return { deleted: 0 }
    }),
    tryGenerateDailyStories().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] marketing stories failed: ${msg}`)
      return { generated: false, reason: 'error' }
    }),
    tryGenerateDailyPoster().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] marketing posters failed: ${msg}`)
      return { generated: false, reason: 'error' }
    }),
    tryGenerateDailyBriefing().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] marketing brief failed: ${msg}`)
      return { generated: false, reason: 'error' }
    }),
    tryGenerateAndSendWeeklyReview().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] marketing weekly review failed: ${msg}`)
      return { generated: false, sent: false, reason: 'error' }
    }),
    trySweepWelcomeEmails().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] welcome email sweep failed: ${msg}`)
      return { attempted: 0, sent: 0, failed: 0, reason: 'error' }
    }),
  ])
  console.log(
    `[cron] Done: reminded=${reminders.reminded}, expired=${expiry.expired}, ` +
    `missed=${missed.expired}, safetyNet: checked=${safetyNet.checked} ` +
    `autoEnded=${safetyNet.autoEnded} reminders=${safetyNet.reminders}, ` +
    `sync: users=${sync.users} inserted=${sync.inserted}, ` +
    `dunning: scanned=${dunning.scanned} nudged=${dunning.nudged}, ` +
    `snooze: cleared=${snooze.cleared} notified=${snooze.notified}, ` +
    `staleOnline: cleared=${staleOnline.cleared} notified=${staleOnline.notified}, ` +
    `offerExpiry: checked=${offerExpiry.checked} expired=${offerExpiry.expired}, ` +
    `suggestions: backstop=${suggestBackstop.scanned}/${suggestBackstop.inserted} ` +
    `pushes=${suggestPushes.pushed}/${suggestPushes.deferred}/${suggestPushes.suppressed} ` +
    `expired=${suggestExpired.deleted}, ` +
    `marketingStories: ${marketingStories.generated ? 'generated' : 'skipped'}/${marketingStories.reason}, ` +
    `marketingPosters: ${marketingPosters.generated ? 'generated' : 'skipped'}/${marketingPosters.reason}, ` +
    `marketingBrief: ${marketingBrief.generated ? 'generated' : 'skipped'}/${marketingBrief.reason}, ` +
    `marketingWeekly: ${marketingWeekly.generated ? 'generated' : 'skipped'}+` +
    `${marketingWeekly.sent ? 'sent' : 'unsent'}/${marketingWeekly.reason}, ` +
    `welcomeEmails: ${welcomeEmails.sent}/${welcomeEmails.attempted}` +
    `${welcomeEmails.failed > 0 ? `(failed=${welcomeEmails.failed})` : ''}`,
  )
}
