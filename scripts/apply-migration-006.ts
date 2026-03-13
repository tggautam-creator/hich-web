import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const url = process.env['SUPABASE_URL']!
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']!
const projectRef = url.replace('https://', '').replace('.supabase.co', '')

const dir = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(resolve(dir, '../supabase/migrations/006_ride_schedules.sql'), 'utf-8')

// Use the Supabase pg REST endpoint to run raw SQL
const resp = await fetch(`${url}/rest/v1/rpc/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
})

// Try via the /pg endpoint (available on newer Supabase)
const pgResp = await fetch(`https://${projectRef}.supabase.co/pg/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    apikey: key,
  },
  body: JSON.stringify({ query: sql }),
})

if (pgResp.ok) {
  console.log('Migration executed via pg endpoint!')
} else {
  console.log('pg endpoint returned:', pgResp.status, await pgResp.text())
  console.log('')
  console.log('Trying via supabase-js rpc...')
  
  // Alternative: call a postgres function
  // Since raw SQL won't work, provide instructions
}

// Verify
const sb = createClient(url, key, { auth: { persistSession: false } })
const { error: checkErr } = await sb.from('ride_schedules').select('id').limit(0)
if (!checkErr) {
  console.log('\nride_schedules table now exists!')
} else {
  console.log('\nTable still missing.')
  console.log('')
  console.log('Please run this SQL in the Supabase Dashboard:')
  console.log(`https://supabase.com/dashboard/project/${projectRef}/sql/new`)
  console.log('')
  console.log('='.repeat(60))
  console.log(sql)
  console.log('='.repeat(60))
}
