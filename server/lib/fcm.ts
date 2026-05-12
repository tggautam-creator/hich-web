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
 * Notification category — drives the per-user `notification_preferences`
 * filter applied before send. `'rides'` covers ride-lifecycle pushes
 * (accepted / cancelled / payment / pickup-reminders / messages / safety
 * alerts) — anything operationally critical to a trip in flight.
 * `'promos'` covers marketing / referral / new-feature pushes. Defaults
 * to `'rides'` so existing call sites filter against the right flag
 * without code changes.
 *
 * Email + SMS preferences live in the same table but aren't routed
 * through `sendFcmPush` — they go via the Supabase `auth.email`
 * dispatcher / Twilio respectively, and each owns its own filter.
 */
export type FcmCategory = 'rides' | 'promos'

/**
 * Sends FCM push notifications via the Firebase Admin SDK (HTTP v1 API).
 * Honours each token-owner's `notification_preferences` row — tokens
 * whose user has explicitly opted out of `category` are dropped before
 * the multicast. Returns the number of successfully delivered messages.
 */
export async function sendFcmPush(
  tokens: string[],
  payload: FcmPayload,
  category: FcmCategory = 'rides',
): Promise<number> {
  if (tokens.length === 0) return 0

  // Filter against notification_preferences before fanning out. Skip
  // the lookup entirely if the user toggled an entire category off —
  // saves one round-trip on the most common (everyone-opted-in) case.
  const filteredTokens = await filterByPreferences(tokens, category)
  if (filteredTokens.length === 0) {
    console.log(`[FCM] All ${tokens.length} tokens opted out of "${category}" — skipping send.`)
    return 0
  }
  if (filteredTokens.length < tokens.length) {
    console.log(
      `[FCM] Filtered ${tokens.length - filteredTokens.length} opted-out token(s) for "${category}".`,
    )
  }

  const messaging = getMessaging()

  // 2026-05-01 — derive a `collapse_key` (FCM / Android) +
  // `apns-collapse-id` (APNs / iOS) from the payload data so retry
  // loops + parallel emit paths don't stack duplicate banners on the
  // user's lock screen. iOS replaces a banner-already-on-screen
  // when a new push arrives with the same `apns-collapse-id`; FCM
  // does the same on Android with `collapse_key`. The 26 ride-related
  // emit sites in `routes/rides.ts` all set `data.type` + (usually)
  // `data.ride_id`, so deriving here is no caller-side change.
  //
  // Format: `${type}_${ride_id}` when both fields exist, else just
  // `${type}` (e.g. `schedule_match` with no specific ride). Truncated
  // to 64 chars to stay inside APNs' limit.
  const collapseId = ((): string | undefined => {
    const type = payload.data['type']
    const rideId = payload.data['ride_id']
    if (!type) return undefined
    const raw = rideId ? `${type}_${rideId}` : type
    return raw.length > 64 ? raw.slice(0, 64) : raw
  })()

  // Web: the service worker reads `data` and calls `showNotification`
  // itself, so we MUST keep the data-only payload for browsers (adding
  // a top-level `notification` block would let the FCM SDK auto-display
  // and double up with the SW).
  // iOS: data-only pushes are silent — APNs needs an `aps.alert` to
  // render a banner. Inject the alert into `apns.payload.aps` directly
  // so iOS gets a visible notification + sound while the web flow stays
  // untouched. Tokens for both platforms can ride the same multicast.
  const response = await messaging.sendEachForMulticast({
    tokens: filteredTokens,
    data: {
      ...payload.data,
      title: payload.title,
      body: payload.body,
    },
    android: collapseId ? { collapseKey: collapseId } : undefined,
    apns: {
      // Push priority 10 (immediate) is the default for alert pushes;
      // setting it explicitly alongside `apns-collapse-id` is required
      // by Apple — collapse-id is silently ignored without it.
      headers: collapseId
        ? { 'apns-collapse-id': collapseId, 'apns-priority': '10' }
        : undefined,
      payload: {
        aps: {
          alert: { title: payload.title, body: payload.body },
          sound: 'default',
          ...(payload.category ? { category: payload.category } : {}),
          // Time-sensitive interruption breaks through Focus modes
          // (Do Not Disturb, Driving, Sleep). Critical for both:
          //  - RIDE_REQUEST: drivers miss earnings if they don't see
          //    the request within ~30s, and many keep DND on while
          //    on the road.
          //  - BOARD_REQUEST: same urgency for scheduled-ride requests.
          // Other categories (payment, schedule_match, etc.) stay at
          // the default `active` level — they're informational.
          // Requires the `com.apple.developer.usernotifications.time-
          // sensitive` entitlement on the iOS app, which we ship in
          // both Tago.entitlements + Tago.Release.entitlements.
          ...(payload.category === 'RIDE_REQUEST' || payload.category === 'BOARD_REQUEST'
            ? { 'interruption-level': 'time-sensitive' as const }
            : {}),
          // Group banners by ride so multiple events for the same
          // ride collapse into one stack on the lock screen rather
          // than carpet-bombing the user. Falls back to type when
          // no ride_id (e.g. promo / topup notifications).
          ...(payload.data['ride_id']
            ? { 'thread-id': `ride-${payload.data['ride_id']}` }
            : payload.data['type']
              ? { 'thread-id': payload.data['type'] }
              : {}),
        },
      },
    },
  })

  console.log(`[FCM] sendEachForMulticast: ${response.successCount} success, ${response.failureCount} failure`)

  // Auto-cleanup tokens that can never succeed:
  //  - registration-token-not-registered  → app uninstalled / token rotated
  //  - invalid-registration-token         → token malformed / corrupted
  //  - mismatched-credential              → token issued by a DIFFERENT
  //    Firebase project than the server's service account is for. Used
  //    to leak indefinitely because the cleanup list didn't include it.
  //    Symptom: drivers with a dev-bundle token (project A) AND a
  //    prod-bundle token (project B) saw partial-success multicasts;
  //    drivers with ONLY a wrong-project token saw zero pushes.
  //    Surfaced 2026-05-06 — see EC2 PM2 logs.
  //  - third-party-auth-error             → APNs/web-push auth failed,
  //    typically same root cause (cross-project send) wrapped under a
  //    different SDK error code.
  const staleTokens: string[] = []
  response.responses.forEach((r, i) => {
    if (r.error) {
      // Always log the code alongside the message so future regressions
      // are easy to triage from PM2 logs without re-grepping the SDK.
      console.error(
        `[FCM] Token ${i} error: code=${r.error.code} message=${r.error.message}`,
      )
      const code = r.error.code
      // ONLY delete tokens for receiver-side errors (the token itself
      // is dead / belongs to a different project). NEVER delete on
      // `third-party-auth-error` — that's a SENDER-SIDE problem (our
      // APNs key / web-push key is invalid or missing in Firebase
      // Console). Treating it as a stale-token signal silently wipes
      // valid TestFlight tokens whenever the prod APNs `.p8` is
      // mis-uploaded, which is exactly what happened in the
      // 2026-05-06 → 2026-05-11 window (logs showed "Removing 1 stale
      // token(s)" after every push failure even though the device
      // tokens themselves were fine). The fix for an auth error is to
      // upload the right key in Firebase Console — not to drop user
      // tokens. Errors stay loud in pm2 logs above so the misconfig
      // is visible.
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/mismatched-credential'
      ) {
        staleTokens.push(filteredTokens[i])
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

/**
 * Sends a SILENT data-only push (`content-available: 1`, no `aps.alert`).
 * iOS wakes a backgrounded / suspended app for ~30s of background time;
 * the app receives the payload via
 * `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`
 * without surfacing any banner / sound to the user.
 *
 * Used by the ride-request "wake-up step" — when a rider hits Request,
 * we fan out a silent push to every `is_online=true` driver so their
 * app can grab a fresh GPS fix and upsert `driver_locations` before the
 * geo-matcher runs. Without this, drivers who toggled Online and then
 * left the app sit with a stale `recorded_at` and the matcher's 5-min
 * freshness gate quietly skips them — making the rider's "Reached N
 * drivers" count smaller than the actual reachable pool.
 *
 * Differences from `sendFcmPush`:
 *   - No `aps.alert`, no `aps.sound`, no `aps.category` — silent only.
 *   - `apns-push-type: background` + `apns-priority: 5`. Apple REQUIRES
 *     this combination for content-available pushes; alert priority 10
 *     pushes ignore `content-available` on iOS 13+.
 *   - Skips `filterByPreferences` — this is a system mechanic, not a
 *     user-visible push, so opting out of "rides" pushes shouldn't
 *     prevent the matcher from finding the driver.
 *   - Stale-token auto-cleanup behaves the same as `sendFcmPush` so
 *     unregistered devices don't leak.
 *
 * Apple budgets silent pushes to ~2–3 per device per hour. Don't
 * call this on a tight loop — only on user-initiated triggers like
 * a ride request.
 */
export async function sendSilentFcmPush(
  tokens: string[],
  data: Record<string, string>,
): Promise<number> {
  if (tokens.length === 0) return 0
  const messaging = getMessaging()

  const response = await messaging.sendEachForMulticast({
    tokens,
    data: {
      ...data,
      // Tag the payload so the iOS router can dispatch it to the
      // wake-up handler without colliding with the existing
      // `type: ride_request` ride-fanout pushes.
      type: data['type'] ?? 'wake_up',
    },
    apns: {
      headers: {
        'apns-push-type': 'background',
        'apns-priority': '5',
      },
      payload: {
        aps: {
          'content-available': 1,
        },
      },
    },
  })

  console.log(
    `[FCM:silent] sendEachForMulticast: ${response.successCount} success, ${response.failureCount} failure (of ${tokens.length})`,
  )

  const staleTokens: string[] = []
  response.responses.forEach((r, i) => {
    if (r.error) {
      // See the matching note in `sendFcmPush` — `third-party-auth-error`
      // is sender-side and must NOT trigger token deletion.
      const code = r.error.code
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/mismatched-credential'
      ) {
        const stale = tokens[i]
        if (stale) staleTokens.push(stale)
      }
    }
  })

  if (staleTokens.length > 0) {
    console.log(`[FCM:silent] Removing ${staleTokens.length} stale token(s)`)
    await supabaseAdmin
      .from('push_tokens')
      .delete()
      .in('token', staleTokens)
  }

  return response.successCount
}

/**
 * Drop tokens whose owning user has opted out of `category` in their
 * `notification_preferences` row. Missing preference rows are treated
 * as "opted in" (the table defaults to `push_rides=true,
 * push_promos=true`) so a brand-new user gets functional pushes
 * before the row is materialised.
 *
 * Implementation note: two single-table reads keep the SQL within
 * what supabase-js can express without an RPC; a JOIN would be
 * tighter but requires a custom function. Two reads at small N is
 * fine — `push_tokens` is keyed on the IN list and
 * `notification_preferences` is keyed on user_id with a primary key,
 * so both queries hit indexes.
 */
async function filterByPreferences(
  tokens: string[],
  category: FcmCategory,
): Promise<string[]> {
  const { data: tokenRows, error: tokenErr } = await supabaseAdmin
    .from('push_tokens')
    .select('token, user_id')
    .in('token', tokens)
  if (tokenErr || !tokenRows || tokenRows.length === 0) {
    if (tokenErr) {
      console.error('[FCM] filterByPreferences: push_tokens lookup failed', tokenErr)
    }
    // On lookup failure or empty rows, send to whatever the caller
    // passed — better to over-deliver than to silently drop pushes.
    return tokens
  }

  const userIDs = Array.from(new Set(tokenRows.map((r) => r.user_id as string)))
  const { data: prefRowsRaw, error: prefErr } = await supabaseAdmin
    // Cast `notification_preferences` to `never` because the generated
    // Database type doesn't yet include this table (added in migration
    // 055 outside the type-gen run). Same pattern as the upsert in
    // `routes/users.ts`.
    .from('notification_preferences' as never)
    .select('user_id, push_rides, push_promos')
    .in('user_id', userIDs)
  if (prefErr) {
    console.error('[FCM] filterByPreferences: prefs lookup failed', prefErr)
    return tokens
  }

  type PrefRow = { user_id: string; push_rides: boolean; push_promos: boolean }
  const prefRows = (prefRowsRaw ?? []) as PrefRow[]

  const flag: 'push_rides' | 'push_promos' =
    category === 'promos' ? 'push_promos' : 'push_rides'
  const optedOut = new Set<string>()
  for (const row of prefRows) {
    if (row[flag] === false) {
      optedOut.add(row.user_id)
    }
  }
  if (optedOut.size === 0) return tokens

  return tokenRows
    .filter((r) => !optedOut.has(r.user_id as string))
    .map((r) => r.token as string)
}
