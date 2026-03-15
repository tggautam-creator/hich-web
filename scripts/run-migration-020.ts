import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  { auth: { persistSession: false } },
)

async function main() {
  // Check if column exists
  const { error } = await sb.from('rides').select('driver_destination').limit(0)
  if (!error) {
    console.log('✓ Column driver_destination already exists')
    return
  }

  console.log('Column missing:', error.message)
  console.log('\nApplying migration 020_driver_destination...')

  // Apply the migration via Supabase Management API (rpc)
  const { error: rpcErr } = await sb.rpc('exec_sql', {
    query: `
      ALTER TABLE rides
        ADD COLUMN IF NOT EXISTS driver_destination geometry(Point, 4326),
        ADD COLUMN IF NOT EXISTS driver_destination_name text,
        ADD COLUMN IF NOT EXISTS driver_route_polyline text;
    `,
  })

  if (rpcErr) {
    console.log('\nCould not apply automatically:', rpcErr.message)
    console.log('\nPlease run this SQL in the Supabase Dashboard SQL Editor:')
    console.log('Dashboard → SQL Editor → New query → paste → Run\n')
    console.log('='.repeat(60))
    console.log(`
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS driver_destination geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS driver_destination_name text,
  ADD COLUMN IF NOT EXISTS driver_route_polyline text;
`)
    console.log('='.repeat(60))
    return
  }

  console.log('✓ Migration applied successfully')
}

main().catch(console.error)
