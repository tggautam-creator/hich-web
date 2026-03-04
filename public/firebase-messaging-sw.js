// Firebase Cloud Messaging service worker.
// Handles background push notifications when the app is not in the foreground.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

// Firebase config is injected at runtime via the query string from the registration call,
// but the compat SDK also auto-picks up from the main app if same origin.
// We initialise with a minimal placeholder — the real config comes from the client.
firebase.initializeApp({
  apiKey: 'placeholder',
  projectId: 'placeholder',
  messagingSenderId: 'placeholder',
  appId: 'placeholder',
})

const messaging = firebase.messaging()

// Handle background messages (app not focused)
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? 'HICH'
  const body  = payload.notification?.body  ?? 'You have a new notification'

  self.registration.showNotification(title, {
    body,
    icon: '/favicon.ico',
    data: payload.data,
  })
})
