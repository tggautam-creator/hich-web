import { createClient } from '@supabase/supabase-js'

const url = process.env['SUPABASE_URL'] ?? ''
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''
const s = createClient(url, key)

async function main() {
  const today = new Date().toISOString().split('T')[0] as string

  // Step 1: fetch schedules without join
  const { data: schedules, error } = await s
    .from('ride_schedules')
    .select('*')
    .gte('trip_date', today)
    .order('trip_date', { ascending: true })
    .limit(5)

  if (error) {
    console.log('ERROR:', JSON.stringify(error, null, 2))
    return
  }

  if (!schedules || schedules.length === 0) {
    console.log('No rides found')
    return
  }

  // Step 2: fetch user info
  const userIds = [...new Set(schedules.map((s: Record<string, unknown>) => s['user_id'] as string))]
  const { data: users } = await s
    .from('users')
    .select('id, full_name, avatar_url, rating_avg, is_driver')
    .in('id', userIds)

  const userMap = new Map(
    (users ?? []).map((u: Record<string, unknown>) => [u['id'] as string, u]),
  )

  const rides = schedules.map((s: Record<string, unknown>) => ({
    ...s,
    poster: userMap.get(s['user_id'] as string) ?? null,
  }))

  console.log('SUCCESS — rides found:', rides.length)
  console.log(JSON.stringify(rides, null, 2))
}

void main()
