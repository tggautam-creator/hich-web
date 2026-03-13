import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

async function main() {
  const { data: rides, error } = await supabase
    .from('rides')
    .select('id, status, created_at, destination_name, trip_date')
    .in('status', ['requested', 'accepted', 'coordinating'])
    .order('created_at', { ascending: false })

  if (error) { console.error(error); return }
  
  console.log(`Found ${rides?.length ?? 0} stale rides:`)
  for (const r of rides ?? []) {
    console.log(`  ${r.id} | ${r.status} | ${r.created_at} | ${r.destination_name ?? 'no dest'} | trip: ${r.trip_date ?? 'none'}`)
  }

  if (!rides || rides.length === 0) return

  const ids = rides.map((r: { id: string }) => r.id)
  const { error: updateErr } = await supabase
    .from('rides')
    .update({ status: 'cancelled' })
    .in('id', ids)

  if (updateErr) {
    console.error('Failed to cancel:', updateErr)
  } else {
    console.log(`\nCancelled ${ids.length} stale rides.`)
  }
}

main()
