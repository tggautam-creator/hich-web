#!/usr/bin/env tsx
/**
 * Delete a user and all their associated data from the database and Supabase Auth.
 * Usage: tsx server/scripts/deleteUser.ts <user_id>
 */

import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

const userId = process.argv[2]

if (!userId) {
  console.error('Error: User ID is required')
  console.error('Usage: tsx server/scripts/deleteUser.ts <user_id>')
  process.exit(1)
}

async function deleteUser(userId: string) {
  console.log(`Starting deletion for user: ${userId}`)

  try {
    // Delete in order (child records first)

    console.log('Deleting location_shares...')
    const { error: e1 } = await supabaseAdmin
      .from('location_shares')
      .delete()
      .eq('user_id', userId)
    if (e1) console.error('location_shares error:', e1.message)

    console.log('Deleting push_tokens...')
    const { error: e2 } = await supabaseAdmin
      .from('push_tokens')
      .delete()
      .eq('user_id', userId)
    if (e2) console.error('push_tokens error:', e2.message)

    console.log('Deleting notifications...')
    const { error: e3 } = await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('user_id', userId)
    if (e3) console.error('notifications error:', e3.message)

    console.log('Deleting ride_ratings (as rater)...')
    const { error: e4a } = await supabaseAdmin
      .from('ride_ratings')
      .delete()
      .eq('rater_id', userId)
    if (e4a) console.error('ride_ratings (rater) error:', e4a.message)

    console.log('Deleting ride_ratings (as rated)...')
    const { error: e4b } = await supabaseAdmin
      .from('ride_ratings')
      .delete()
      .eq('rated_id', userId)
    if (e4b) console.error('ride_ratings (rated) error:', e4b.message)

    console.log('Deleting ride_offers...')
    const { error: e5 } = await supabaseAdmin
      .from('ride_offers')
      .delete()
      .eq('driver_id', userId)
    if (e5) console.error('ride_offers error:', e5.message)

    console.log('Deleting ride_schedules...')
    const { error: e6 } = await supabaseAdmin
      .from('ride_schedules')
      .delete()
      .eq('user_id', userId)
    if (e6) console.error('ride_schedules error:', e6.message)

    console.log('Deleting messages...')
    const { error: e7 } = await supabaseAdmin
      .from('messages')
      .delete()
      .eq('sender_id', userId)
    if (e7) console.error('messages error:', e7.message)

    console.log('Deleting driver_routines...')
    const { error: e8 } = await supabaseAdmin
      .from('driver_routines')
      .delete()
      .eq('user_id', userId)
    if (e8) console.error('driver_routines error:', e8.message)

    console.log('Deleting transactions...')
    const { error: e9 } = await supabaseAdmin
      .from('transactions')
      .delete()
      .eq('user_id', userId)
    if (e9) console.error('transactions error:', e9.message)

    console.log('Deleting driver_locations...')
    const { error: e10 } = await supabaseAdmin
      .from('driver_locations')
      .delete()
      .eq('user_id', userId)
    if (e10) console.error('driver_locations error:', e10.message)

    console.log('Deleting rides (as rider)...')
    const { error: e11a } = await supabaseAdmin
      .from('rides')
      .delete()
      .eq('rider_id', userId)
    if (e11a) console.error('rides (rider) error:', e11a.message)

    console.log('Deleting rides (as driver)...')
    const { error: e11b } = await supabaseAdmin
      .from('rides')
      .delete()
      .eq('driver_id', userId)
    if (e11b) console.error('rides (driver) error:', e11b.message)

    console.log('Deleting vehicles...')
    const { error: e12 } = await supabaseAdmin
      .from('vehicles')
      .delete()
      .eq('user_id', userId)
    if (e12) console.error('vehicles error:', e12.message)

    console.log('Deleting user record...')
    const { error: e13 } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId)
    if (e13) console.error('users error:', e13.message)

    console.log('Deleting Supabase Auth user...')
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (authError) {
      console.error('Supabase Auth deletion error:', authError.message)
    } else {
      console.log('✓ Supabase Auth user deleted')
    }

    console.log('\n✓ User deletion complete. They can now sign up again.')
  } catch (err) {
    console.error('Unexpected error:', err)
    process.exit(1)
  }
}

deleteUser(userId)
