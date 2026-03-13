import { createClient } from '@supabase/supabase-js'
import admin from 'firebase-admin'
import { readFileSync } from 'fs'

// Init Firebase Admin
const sa = JSON.parse(readFileSync('./firebase-service-account.json', 'utf-8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })

// Get driver's token from DB
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const { data: tokens, error } = await supabase
  .from('push_tokens')
  .select('token')
  .eq('user_id', 'f520e948-37f7-4528-952b-2a2b0f31f384')

if (error || !tokens?.length) {
  console.error('No tokens found:', error)
  process.exit(1)
}

console.log(`Found ${tokens.length} token(s) for driver`)
const token = tokens[0].token
console.log('Token prefix:', token.substring(0, 30) + '...')

// Send a test data-only message
try {
  // Test 1: data-only (should go to onMessage/BroadcastChannel in foreground)
  const result1 = await admin.messaging().send({
    token,
    data: {
      type: 'ride_request',
      ride_id: 'test-data-' + Date.now(),
      title: 'Data-Only Test',
      body: 'This is a data-only push',
      rider_name: 'Test Rider',
      destination: 'Test Destination',
      distance_km: '5',
      estimated_earnings_cents: '850',
    },
  })
  console.log('DATA-ONLY SUCCESS - Message ID:', result1)

  // Test 2: with notification field (should show OS notification)
  const result2 = await admin.messaging().send({
    token,
    notification: {
      title: 'HICH Test Notification',
      body: 'If you see this, FCM is working!',
    },
    data: {
      type: 'test',
      ride_id: 'test-notif-' + Date.now(),
    },
    webpush: {
      fcmOptions: {
        link: 'http://localhost:5173/home/driver',
      },
    },
  })
  console.log('NOTIFICATION SUCCESS - Message ID:', result2)
} catch (err) {
  console.error('FAILED:', err)
}

process.exit(0)
