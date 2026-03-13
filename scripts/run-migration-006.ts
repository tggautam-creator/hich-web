import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const url = process.env['SUPABASE_URL']!
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']!
const sb = createClient(url, key, { auth: { persistSession: false } })

// Check if table already exists
const { error } = await sb.from('ride_schedules').select('id').limit(0)
if (!error) {
  console.log('ride_schedules table already exists — skipping migration.')
  process.exit(0)
}

console.log('ride_schedules table missing:', error.message)
console.log('')

const dir = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(resolve(dir, '../supabase/migrations/006_ride_schedules.sql'), 'utf-8')

console.log('Please run this SQL in the Supabase Dashboard SQL Editor:')
console.log('Dashboard → SQL Editor → New query → paste → Run')
console.log('')
console.log('='.repeat(60))
console.log(sql)
console.log('='.repeat(60))
