/**
 * APNs HTTP/2 client for Live Activity push-to-update (LIVE.2,
 * 2026-04-30). Talks directly to Apple's `api.push.apple.com` (or
 * `api.sandbox.push.apple.com` for dev) using a per-team `.p8` JWT
 * auth key — separate from the FCM-proxied APNs path used by
 * `lib/fcm.ts` for standard alert + data pushes.
 *
 * Why direct APNs (not FCM): ActivityKit mints a per-activity APNs
 * push token that's distinct from the device's FCM token. FCM can't
 * target it. Direct APNs is the only supported path for Live
 * Activity pushes.
 *
 * Env vars (all optional — module no-ops if any are missing so the
 * server still boots in environments that haven't set up the APNs
 * key yet):
 *   APNS_AUTH_KEY_PATH — absolute path to AuthKey_XXXXXXXXXX.p8
 *   APNS_KEY_ID         — 10-char Key ID from Apple Developer
 *   APNS_TEAM_ID        — 10-char Team ID (XFDWGTQH9M for Tago)
 *   APNS_BUNDLE_ID      — parent app bundle id (com.tago.rides)
 *   APNS_USE_SANDBOX    — "true" for dev (api.sandbox), "false"/unset
 *                          for prod (api.push). Defaults to true when
 *                          NODE_ENV !== 'production'.
 */
import apn from '@parse/node-apn'
import { existsSync } from 'fs'

import { supabaseAdmin } from './supabaseAdmin.ts'

interface ApnsEnv {
  authKeyPath: string
  keyId: string
  teamId: string
  bundleId: string
  production: boolean
}

let cached: { provider: apn.Provider; env: ApnsEnv } | null = null
let warmupTriedAt: number = 0

/**
 * Lazy-load the APNs provider. Returns null when env vars are missing
 * — callers no-op + log so the server stays usable without APNs.
 * Re-tries warmup at most every 60s if it failed previously, so a
 * mid-session env fix becomes effective on the next push.
 */
function getProvider(): { provider: apn.Provider; env: ApnsEnv } | null {
  if (cached) return cached
  const now = Date.now()
  if (now - warmupTriedAt < 60_000) return null
  warmupTriedAt = now

  const authKeyPath = process.env['APNS_AUTH_KEY_PATH']
  const keyId = process.env['APNS_KEY_ID']
  const teamId = process.env['APNS_TEAM_ID']
  const bundleId = process.env['APNS_BUNDLE_ID']

  if (!authKeyPath || !keyId || !teamId || !bundleId) {
    console.warn(
      '[APNs] Missing env vars (APNS_AUTH_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID) — Live Activity push-to-update disabled',
    )
    return null
  }

  if (!existsSync(authKeyPath)) {
    console.error(`[APNs] Auth key not found at ${authKeyPath}`)
    return null
  }

  // sandbox = development APNs server (development-signed builds).
  // production = production APNs server (App Store / TestFlight).
  // Default: sandbox for non-prod, prod otherwise. Override with
  // APNS_USE_SANDBOX=true|false.
  const explicit = process.env['APNS_USE_SANDBOX']
  const isProduction = explicit
    ? explicit.toLowerCase() !== 'true'
    : process.env['NODE_ENV'] === 'production'

  const provider = new apn.Provider({
    token: { key: authKeyPath, keyId, teamId },
    production: isProduction,
  })
  console.log(
    `[APNs] Provider initialized — bundle=${bundleId} keyId=${keyId} sandbox=${!isProduction}`,
  )

  cached = {
    provider,
    env: { authKeyPath, keyId, teamId, bundleId, production: isProduction },
  }
  return cached
}

/**
 * Push an update to a Live Activity. Returns `true` on success,
 * `false` if APNs rejected the token (Apple's `BadDeviceToken` /
 * `Unregistered` responses → row gets cleaned up). Network/auth
 * failures throw so the caller can decide to retry.
 *
 * `contentState` mirrors the iOS `RideActivityState` exactly. Apple's
 * Live Activity push contract:
 *   {
 *     aps: {
 *       timestamp: <unix-seconds>,
 *       event: "update",
 *       "content-state": { ...state... },
 *       "stale-date": <unix-seconds>,
 *       alert: { title, body }   // optional, drives lock-screen UX
 *     }
 *   }
 */
export async function sendLiveActivityUpdate(
  token: string,
  contentState: Record<string, unknown>,
  options?: {
    alertTitle?: string
    alertBody?: string
    /**
     * After this timestamp the system marks the activity stale and
     * dims the lock-screen card (still visible — just not auth as
     * fresh). Defaults to 1h from now, matching the iOS
     * `staleDate` we set when the activity was created.
     */
    staleSeconds?: number
    /**
     * Hint to Apple about how to score this against other concurrent
     * activities for Dynamic Island prominence. 0 = least, 100 = most.
     * Live Activity convention is 100 for the rider's active ride.
     */
    relevanceScore?: number
  },
): Promise<boolean> {
  const ctx = getProvider()
  if (!ctx) return false

  const notification = new apn.Notification()
  notification.topic = `${ctx.env.bundleId}.push-type.liveactivity`
  notification.pushType = 'liveactivity'
  notification.priority = 10
  notification.expiry = Math.floor(Date.now() / 1000) + 3600 // 1h

  const stale = options?.staleSeconds ?? 3600
  const payload = {
    timestamp: Math.floor(Date.now() / 1000),
    event: 'update',
    'content-state': contentState,
    'stale-date': Math.floor(Date.now() / 1000) + stale,
    'relevance-score': options?.relevanceScore ?? 100,
  } as Record<string, unknown>

  if (options?.alertTitle || options?.alertBody) {
    payload.alert = {
      title: options.alertTitle ?? '',
      body: options.alertBody ?? '',
    }
  }

  notification.rawPayload = { aps: payload }

  try {
    const result = await ctx.provider.send(notification, token)
    if (result.failed.length > 0) {
      const failure = result.failed[0]
      const reason = failure.response?.reason ?? failure.error?.message ?? 'unknown'
      console.error(`[APNs] Live Activity push failed token=${token.slice(0, 8)}… reason=${reason}`)
      // Apple's contract: 410 + BadDeviceToken / Unregistered means
      // the activity ended on the device. Clean up so we don't keep
      // pushing dead tokens.
      if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
        await supabaseAdmin
          .from('live_activity_tokens' as never)
          .delete()
          .eq('push_token', token)
      }
      return false
    }
    return true
  } catch (err) {
    console.error('[APNs] Live Activity push errored:', err)
    return false
  }
}

/**
 * End a Live Activity remotely (`event: "end"` payload). Used when
 * the ride completes server-side BEFORE the iOS app has a chance to
 * call `Activity.end(...)` itself — e.g. a driver ends the ride from
 * the device while the rider's iPhone is locked.
 */
export async function sendLiveActivityEnd(
  token: string,
  finalState: Record<string, unknown>,
): Promise<boolean> {
  const ctx = getProvider()
  if (!ctx) return false

  const notification = new apn.Notification()
  notification.topic = `${ctx.env.bundleId}.push-type.liveactivity`
  notification.pushType = 'liveactivity'
  notification.priority = 10
  notification.expiry = Math.floor(Date.now() / 1000) + 60

  notification.rawPayload = {
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event: 'end',
      'content-state': finalState,
      'dismissal-date': Math.floor(Date.now() / 1000), // dismiss immediately
    },
  }

  try {
    const result = await ctx.provider.send(notification, token)
    if (result.failed.length > 0) return false
    // Always clean up after end push — token is invalid now.
    await supabaseAdmin
      .from('live_activity_tokens' as never)
      .delete()
      .eq('push_token', token)
    return true
  } catch (err) {
    console.error('[APNs] Live Activity end errored:', err)
    return false
  }
}

/**
 * Convenience: look up token(s) for a ride and push an update to
 * each one. Used by ride-status hooks + driver-location broadcast
 * relays in `routes/rides.ts` etc.
 */
export async function pushLiveActivityUpdateForRide(
  rideId: string,
  contentState: Record<string, unknown>,
  options?: Parameters<typeof sendLiveActivityUpdate>[2],
): Promise<number> {
  const { data: rows } = await supabaseAdmin
    .from('live_activity_tokens' as never)
    .select('push_token')
    .eq('ride_id', rideId)

  const tokens = ((rows ?? []) as { push_token: string }[]).map(
    (r) => r.push_token,
  )
  if (tokens.length === 0) return 0

  let succeeded = 0
  await Promise.all(
    tokens.map(async (t) => {
      const ok = await sendLiveActivityUpdate(t, contentState, options)
      if (ok) succeeded++
    }),
  )
  return succeeded
}

/**
 * Convenience: end every Live Activity bound to a ride. Used when
 * the ride hits a terminal state (completed, cancelled).
 */
export async function endLiveActivitiesForRide(
  rideId: string,
  finalState: Record<string, unknown>,
): Promise<number> {
  const { data: rows } = await supabaseAdmin
    .from('live_activity_tokens' as never)
    .select('push_token')
    .eq('ride_id', rideId)

  const tokens = ((rows ?? []) as { push_token: string }[]).map(
    (r) => r.push_token,
  )
  if (tokens.length === 0) return 0

  let succeeded = 0
  await Promise.all(
    tokens.map(async (t) => {
      const ok = await sendLiveActivityEnd(t, finalState)
      if (ok) succeeded++
    }),
  )
  return succeeded
}
