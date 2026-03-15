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

/* eslint-disable no-console */

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

// ── Dedup guard ──────────────────────────────────────────────────────────────

let _pendingToken: Promise<string | null> | null = null

/**
 * Request notification permission, get FCM token, and save it to push_tokens.
 * Deduplicates concurrent calls — only the first runs, the rest await the same promise.
 * Returns the token string if successful, null otherwise.
 */
export function requestAndSaveFcmToken(): Promise<string | null> {
  if (_pendingToken) return _pendingToken
  _pendingToken = _doRequestAndSaveToken().finally(() => { _pendingToken = null })
  return _pendingToken
}

async function _doRequestAndSaveToken(): Promise<string | null> {
  const msg = init()
  if (!msg) {
    console.warn('[FCM] Not configured or not supported')
    return null
  }

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      console.warn('[FCM] Notification permission denied:', permission)
      return null
    }

    const token = await getToken(msg, {
      vapidKey: env.FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.register(
        '/firebase-messaging-sw.js',
      ),
    })

    if (!token) {
      console.warn('[FCM] getToken returned empty')
      return null
    }

    console.log('[FCM] Token obtained, saving...')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // Upsert: one token per user. Uses onConflict on user_id.
    const { error } = await supabase
      .from('push_tokens')
      .upsert(
        { user_id: user.id, token },
        { onConflict: 'user_id' },
      )

    if (error) {
      console.error('[FCM] Failed to save token:', error.message)
    } else {
      console.log('[FCM] Token saved successfully')
    }

    return token
  } catch (err) {
    console.error('[FCM] Error:', err)
    return null
  }
}

/**
 * Listen for foreground push messages.
 * Uses Firebase onMessage + a BroadcastChannel fallback from the service worker.
 * Returns an unsubscribe function, or null if FCM is not available.
 */
export function onForegroundMessage(
  callback: (payload: { title?: string; body?: string; data?: Record<string, string> }) => void,
): (() => void) | null {
  const msg = init()
  if (!msg) {
    console.warn('[FCM] onForegroundMessage: messaging not available')
    return null
  }

  console.log('[FCM] Foreground message listener registered')

  // Dedup: track recently seen message IDs to avoid double-firing
  const seen = new Set<string>()
  const dedup = (data: Record<string, string>, source: string) => {
    const id = data.ride_id ?? data.message_id ?? JSON.stringify(data)
    if (seen.has(id)) return
    seen.add(id)
    // Clean up after 10s
    setTimeout(() => seen.delete(id), 10_000)
    console.log(`[FCM] Foreground message received (${source}):`, data)
    callback({
      title: data.title,
      body:  data.body,
      data,
    })
  }

  // Primary: Firebase SDK onMessage
  const unsubFirebase = onMessage(msg, (payload) => {
    const data = payload.data ?? {}
    dedup(data, 'onMessage')
  })

  // Fallback: BroadcastChannel from service worker
  const channel = new BroadcastChannel('fcm-foreground')
  const handleBroadcast = (event: MessageEvent) => {
    if (event.data?.type !== 'fcm-push') return
    const data = event.data.data ?? {}
    dedup(data, 'BroadcastChannel')
  }
  channel.addEventListener('message', handleBroadcast)

  return () => {
    unsubFirebase()
    channel.removeEventListener('message', handleBroadcast)
    channel.close()
  }
}
