/**
 * One-shot dev helper: backfill Suggested Rides for ALL existing
 * schedules + routines in the [today, today+14] window.
 *
 * The engine's on-write trigger only fires from POST /schedule/:id/
 * compute-route (and POST /api/rider-routines). The 5-min backstop
 * cron only picks up rows created in the last hour. So anything that
 * was posted BEFORE the suggestion engine was deployed (or older than
 * an hour at deploy time) is invisible to the engine until manually
 * scanned. This script catches them.
 *
 * Safe to re-run: the engine's Layer 5 memoization (Filter Layer 5)
 * + the UNIQUE index on ride_suggestions prevent duplicate writes.
 * Re-running just produces "0 new" logs for already-scanned pairs.
 *
 * Usage:
 *   tsx server/scripts/backfillSuggestions.ts
 *
 * Expected output:
 *   [backfill] Scanning 12 schedules + 4 driver routines + 1 rider routine…
 *   [backfill] schedule abc12345… → inserted=2 skipped=0
 *   [backfill] driverRoutine def67890… → inserted=5 skipped=1
 *   [backfill] Done. total inserted=18 total skipped=4
 */
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { scanForPost, scanForRoutine } from '../lib/suggestionEngine.ts'

function todayISO(): string {
  return new Date().toISOString().split('T')[0]!
}

function dateNDaysFromNow(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]!
}

async function main(): Promise<void> {
  const today = todayISO()
  const horizon = dateNDaysFromNow(14)

  // 1. All schedules whose trip_date is in the window.
  const { data: schedRows, error: schedErr } = await supabaseAdmin
    .from('ride_schedules')
    .select('id')
    .gte('trip_date', today)
    .lte('trip_date', horizon)
    .order('trip_date', { ascending: true })

  if (schedErr) {
    console.error('[backfill] schedule fetch failed:', schedErr.message)
    process.exit(1)
  }
  const schedules = (schedRows ?? []) as Array<{ id: string }>

  // 2. All active driver routines (engine expands them across 14 dates).
  const { data: driverRows, error: driverErr } = await supabaseAdmin
    .from('driver_routines')
    .select('id')
    .eq('is_active', true)
    .or(`end_date.is.null,end_date.gte.${today}`)

  if (driverErr) {
    console.error('[backfill] driver_routines fetch failed:', driverErr.message)
    process.exit(1)
  }
  const driverRoutines = (driverRows ?? []) as Array<{ id: string }>

  // 3. All active rider routines.
  const { data: riderRows, error: riderErr } = await supabaseAdmin
    .from('rider_routines')
    .select('id')
    .eq('is_active', true)
    .or(`end_date.is.null,end_date.gte.${today}`)

  if (riderErr) {
    console.error('[backfill] rider_routines fetch failed:', riderErr.message)
    process.exit(1)
  }
  const riderRoutines = (riderRows ?? []) as Array<{ id: string }>

  console.log(
    `[backfill] Scanning ${schedules.length} schedules + `
    + `${driverRoutines.length} driver routines + `
    + `${riderRoutines.length} rider routines…`,
  )

  let totalInserted = 0
  let totalSkipped = 0

  for (const row of schedules) {
    const result = await scanForPost(row.id)
    totalInserted += result.inserted
    totalSkipped += result.skipped
    console.log(`[backfill] schedule ${row.id.slice(0, 8)}… → inserted=${result.inserted} skipped=${result.skipped}`)
  }

  for (const row of driverRoutines) {
    const result = await scanForRoutine(row.id, 'driver')
    totalInserted += result.inserted
    totalSkipped += result.skipped
    console.log(`[backfill] driverRoutine ${row.id.slice(0, 8)}… → inserted=${result.inserted} skipped=${result.skipped}`)
  }

  for (const row of riderRoutines) {
    const result = await scanForRoutine(row.id, 'rider')
    totalInserted += result.inserted
    totalSkipped += result.skipped
    console.log(`[backfill] riderRoutine ${row.id.slice(0, 8)}… → inserted=${result.inserted} skipped=${result.skipped}`)
  }

  console.log(`[backfill] Done. total inserted=${totalInserted} total skipped=${totalSkipped}`)
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
