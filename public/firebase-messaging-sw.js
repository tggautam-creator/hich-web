// Firebase Cloud Messaging service worker.
// Handles background push notifications when the app is not in the foreground.
// Also forwards messages to the foreground via BroadcastChannel.

importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyB0DaCCCADt_W5M6zTef0QVKJwnFIMvBxM',
  authDomain: 'hich-6f501.firebaseapp.com',
  projectId: 'hich-6f501',
  messagingSenderId: '203477299887',
  appId: '1:203477299887:web:2939531c772f46f6c7da5a',
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
  const title = data.title ?? 'HICH'
  const body  = data.body  ?? 'You have a new notification'

  self.registration.showNotification(title, {
    body,
    icon: '/favicon.ico',
    data,
  })
})

// Handle notification click — navigate to the relevant page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data ?? {}

  let url = '/'
  if (data.type === 'board_request' && data.ride_id) {
    url = '/ride/board-review/' + data.ride_id
  } else if (data.type === 'new_message' && data.ride_id) {
    url = '/ride/messaging/' + data.ride_id
  } else if (data.type === 'ride_request' && data.ride_id) {
    url = '/ride/suggestion/' + data.ride_id
  } else if (data.type === 'board_accepted' && data.ride_id) {
    url = '/ride/messaging/' + data.ride_id
  } else if (data.type === 'ride_reminder' && data.ride_id) {
    url = '/ride/messaging/' + data.ride_id
  }

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
