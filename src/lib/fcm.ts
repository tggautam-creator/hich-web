/**
 * Frontend Firebase Cloud Messaging setup.
 *
 * - Lazily initialises Firebase app + messaging
 * - Requests notification permission
 * - Retrieves FCM token
 * - Saves/refreshes token in push_tokens table
 *
 * Gracefully no-ops if Firebase env vars are missing or
 * if the browser doesn't support notifications.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getMessaging, getToken, onMessage, type Messaging } from 'firebase/messaging'
import { env } from './env'
import { supabase } from './supabase'

// ── Singleton state ──────────────────────────────────────────────────────────

let app: FirebaseApp | null = null
let messaging: Messaging | null = null

function isConfigured(): boolean {
  return Boolean(
    env.FIREBASE_API_KEY &&
    env.FIREBASE_PROJECT_ID &&
    env.FIREBASE_MESSAGING_SENDER_ID &&
    env.FIREBASE_APP_ID,
  )
}

function init(): Messaging | null {
  if (messaging) return messaging
  if (!isConfigured()) return null
  if (typeof window === 'undefined' || !('Notification' in window)) return null

  app = initializeApp({
    apiKey:            env.FIREBASE_API_KEY,
    authDomain:        env.FIREBASE_AUTH_DOMAIN,
    projectId:         env.FIREBASE_PROJECT_ID,
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             env.FIREBASE_APP_ID,
  })

  messaging = getMessaging(app)
  return messaging
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Request notification permission, get FCM token, and save it to push_tokens.
 * Safe to call multiple times — deduplicates via the UNIQUE constraint.
 * Returns the token string if successful, null otherwise.
 */
export async function requestAndSaveFcmToken(): Promise<string | null> {
  const msg = init()
  if (!msg) return null

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return null

    const token = await getToken(msg, {
      vapidKey: env.FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.register(
        '/firebase-messaging-sw.js',
      ),
    })

    if (!token) return null

    // Save to push_tokens (upsert via onConflict)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    await supabase
      .from('push_tokens')
      .upsert(
        { user_id: user.id, token },
        { onConflict: 'user_id,token' },
      )

    return token
  } catch {
    return null
  }
}

/**
 * Listen for foreground push messages.
 * Returns an unsubscribe function, or null if FCM is not available.
 */
export function onForegroundMessage(
  callback: (payload: { title?: string; body?: string; data?: Record<string, string> }) => void,
): (() => void) | null {
  const msg = init()
  if (!msg) return null

  return onMessage(msg, (payload) => {
    callback({
      title: payload.notification?.title,
      body:  payload.notification?.body,
      data:  payload.data,
    })
  })
}
