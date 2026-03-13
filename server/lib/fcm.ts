import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { getServerEnv } from '../env.ts'
import { supabaseAdmin } from './supabaseAdmin.ts'

interface FcmPayload {
  title: string
  body: string
  data: Record<string, string>
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

  // Send as data-only messages so the foreground onMessage handler always fires.
  // If we include 'notification', the service worker may intercept it
  // and the in-app handler never sees it.
  const response = await messaging.sendEachForMulticast({
    tokens,
    data: {
      ...payload.data,
      title: payload.title,
      body: payload.body,
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
