// Firebase Cloud Messaging service worker.
// Handles background push notifications when the app is not in the foreground.
// Also forwards messages to the foreground via BroadcastChannel.
//
// The Firebase config below uses `__FIREBASE_*__` placeholders that get
// replaced at dev-serve + build time by the `firebaseMessagingSwEnvPlugin`
// in `vite.config.ts`. The replacement reads from the same env loaded by
// the rest of the Vite app, so dev mode (npm run dev → --mode dev →
// .env.dev) gets the `tago-dev-e3ade` project and prod build (npm run
// build → .env / .env.production) gets `hich-6f501`. Without this
// plugin, the SW would hardcode prod and dev web clients would
// silently register FCM tokens against the wrong project (cross-project
// token bug). See WEB_PARITY_REPORT W-T0-5.

importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: '__FIREBASE_API_KEY__',
  authDomain: '__FIREBASE_AUTH_DOMAIN__',
  projectId: '__FIREBASE_PROJECT_ID__',
  messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
  appId: '__FIREBASE_APP_ID__',
})

const messaging = firebase.messaging()

// BroadcastChannel for reliable foreground delivery
const channel = new BroadcastChannel('fcm-foreground')

// Listen to the raw push event so we can forward to the foreground
self.addEventListener('push', (event) => {
  // Try to forward data to the foreground app via BroadcastChannel
  let data = {}
  try {
    const json = event.data?.json()
    data = json?.data ?? {}
  } catch {
    // not JSON
  }
  channel.postMessage({ type: 'fcm-push', data })
})

// Handle background messages (app not focused).
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message received:', payload)
  const data  = payload.data ?? {}
  const title = data.title ?? 'TAGO'
  const body  = data.body  ?? 'You have a new notification'

  self.registration.showNotification(title, {
    body,
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    data,
  })
})

function extractNotificationData(notification) {
  const raw = notification?.data ?? {}

  if (raw && typeof raw === 'object') {
    if (typeof raw.type === 'string') {
      return raw
    }

    if (raw.data && typeof raw.data === 'object') {
      return raw.data
    }

    // Some FCM/browser combinations wrap payloads under FCM_MSG.
    if (raw.FCM_MSG && typeof raw.FCM_MSG === 'object') {
      const wrapped = raw.FCM_MSG
      if (wrapped.data && typeof wrapped.data === 'object') {
        return wrapped.data
      }
    }
  }

  return {}
}

// Handle notification click — navigate to the relevant page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = extractNotificationData(event.notification)

  const inferredType = typeof data.type === 'string'
    ? data.type
    : (event.notification.title === 'Ride Board Request' ? 'board_request' : null)

  // Default to notifications so users land in an actionable context,
  // even if a browser drops custom data from the notification payload.
  let url = '/notifications'
  if (inferredType === 'board_request' && data.ride_id) {
    url = '/ride/board-review/' + data.ride_id
  } else if (inferredType === 'new_message' && data.ride_id) {
    url = '/ride/messaging/' + data.ride_id
  } else if (inferredType === 'ride_request' && data.ride_id) {
    url = '/ride/suggestion/' + data.ride_id
  } else if (inferredType === 'board_accepted' && data.ride_id) {
    url = '/ride/messaging/' + data.ride_id
  } else if (inferredType === 'board_declined') {
    url = '/notifications'
  } else if (inferredType === 'ride_reminder' && data.ride_id) {
    url = '/ride/messaging/' + data.ride_id
  }

  console.log('[SW] notificationclick route:', { url, inferredType, data })

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a window is already open, navigate it
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus()
          client.navigate(url)
          return
        }
      }
      // Otherwise open a new window
      return clients.openWindow(url)
    })
  )
})
