import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const sb = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

async function main() {
  // Cancel all non-completed/non-cancelled rides
  const { data: rides } = await sb
    .from('rides')
    .select('id, status')
    .not('status', 'in', '("completed","cancelled")')
  console.log('Rides to cancel:', rides?.length ?? 0)
  if (rides && rides.length > 0) {
    const { error } = await sb
      .from('rides')
      .update({ status: 'cancelled' })
      .in('id', rides.map((r: { id: string }) => r.id))
    if (error) console.error('Cancel rides error:', error)
    else console.log('Cancelled all active rides')
  }

  // Delete all ride_schedules
  const { data: scheds } = await sb.from('ride_schedules').select('id')
  console.log('Schedules to delete:', scheds?.length ?? 0)
  if (scheds && scheds.length > 0) {
    const { error } = await sb
      .from('ride_schedules')
      .delete()
      .in('id', scheds.map((s: { id: string }) => s.id))
    if (error) console.error('Delete schedules error:', error)
    else console.log('Deleted all schedules')
  }

  // Delete all notifications
  const { error: notifErr } = await sb
    .from('notifications')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (notifErr) console.error('Delete notifications error:', notifErr)
  else console.log('Deleted all notifications')

  // Delete all messages
  const { error: msgErr } = await sb
    .from('messages')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (msgErr) console.error('Delete messages error:', msgErr)
  else console.log('Deleted all messages')
}

main()
