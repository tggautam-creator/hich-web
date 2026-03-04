import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { getServerEnv } from '../env.ts'

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
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
  })

  return response.successCount
}
