import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { getServerEnv } from '../env.ts'
import { supabaseAdmin } from './supabaseAdmin.ts'

interface FcmPayload {
  title: string
  body: string
  data: Record<string, string>
  /**
   * Optional iOS notification-category identifier. When set, iOS surfaces
   * the action buttons registered against this category in
   * `UNUserNotificationCenter.setNotificationCategories(...)`. Used today
   * for `BOARD_REQUEST` (Accept / Decline buttons on the lock-screen
   * banner so a driver can act without opening Tago). Web ignores this
   * field; only `apns.payload.aps.category` consumes it.
   */
  category?: string
}

function getMessaging(): admin.messaging.Messaging {
  if (!admin.apps.length) {
    const { FIREBASE_SERVICE_ACCOUNT_PATH } = getServerEnv()
    const serviceAccount = JSON.parse(
      readFileSync(FIREBASE_SERVICE_ACCOUNT_PATH, 'utf-8'),
    ) as admin.ServiceAccount
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  }
  return admin.messaging()
}

/**
 * Sends FCM push notifications via the Firebase Admin SDK (HTTP v1 API).
 * Returns the number of successfully delivered messages.
 */
export async function sendFcmPush(
  tokens: string[],
  payload: FcmPayload,
): Promise<number> {
  if (tokens.length === 0) return 0

  const messaging = getMessaging()

  // Web: the service worker reads `data` and calls `showNotification`
  // itself, so we MUST keep the data-only payload for browsers (adding
  // a top-level `notification` block would let the FCM SDK auto-display
  // and double up with the SW).
  // iOS: data-only pushes are silent — APNs needs an `aps.alert` to
  // render a banner. Inject the alert into `apns.payload.aps` directly
  // so iOS gets a visible notification + sound while the web flow stays
  // untouched. Tokens for both platforms can ride the same multicast.
  const response = await messaging.sendEachForMulticast({
    tokens,
    data: {
      ...payload.data,
      title: payload.title,
      body: payload.body,
    },
    apns: {
      payload: {
        aps: {
          alert: { title: payload.title, body: payload.body },
          sound: 'default',
          ...(payload.category ? { category: payload.category } : {}),
        },
      },
    },
  })

  console.log(`[FCM] sendEachForMulticast: ${response.successCount} success, ${response.failureCount} failure`)

  // Auto-cleanup stale tokens (NotRegistered, InvalidRegistration, etc.)
  const staleTokens: string[] = []
  response.responses.forEach((r, i) => {
    if (r.error) {
      console.error(`[FCM] Token ${i} error:`, r.error.message)
      const code = r.error.code
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        staleTokens.push(tokens[i])
      }
    }
  })

  if (staleTokens.length > 0) {
    console.log(`[FCM] Removing ${staleTokens.length} stale token(s)`)
    await supabaseAdmin
      .from('push_tokens')
      .delete()
      .in('token', staleTokens)
  }

  return response.successCount
}
