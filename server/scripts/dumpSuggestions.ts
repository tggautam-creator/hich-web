/**
 * Dev helper: dump the current ride_suggestions table contents.
 * Used to verify the engine is writing rows.
 *
 * Usage:
 *   tsx --env-file=.env.dev server/scripts/dumpSuggestions.ts
 */
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

async function main(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('ride_suggestions')
    .select('id, rider_user_id, driver_user_id, trip_date, match_type, relevance_score, rider_status, driver_status, rider_notified_at, driver_notified_at, notified_via_instant, created_at, match_signals')
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    console.error('error:', error.message)
    process.exit(1)
  }

  const rows = data ?? []
  console.log(`Found ${rows.length} suggestion rows:`)
  for (const r of rows as Array<{
    id: string
    rider_user_id: string
    driver_user_id: string
    trip_date: string
    match_type: string
    relevance_score: number
    rider_status: string
    driver_status: string
    rider_notified_at: string | null
    driver_notified_at: string | null
    notified_via_instant: boolean
    created_at: string
    match_signals: { classification?: string }
  }>) {
    console.log(
      `  ${r.id.slice(0, 8)} | ${r.trip_date} | ${r.match_type} `
      + `| score=${r.relevance_score.toFixed(2)} `
      + `| class=${r.match_signals.classification ?? '?'} `
      + `| rider=${r.rider_status} (notif=${r.rider_notified_at ? 'yes' : 'no'}) `
      + `| driver=${r.driver_status} (notif=${r.driver_notified_at ? 'yes' : 'no'})`,
    )
  }
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error('fatal:', err)
  process.exit(1)
})
