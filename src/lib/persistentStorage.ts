/**
 * Persistent storage helpers for iOS PWA session survival.
 *
 * Two mechanisms:
 *  1. navigator.storage.persist() — tells iOS to not evict our IndexedDB/Cache data.
 *     Works best when the user has granted notification permission (FCM).
 *  2. Cache Storage mirror — stores the refresh token in the Cache API, which is
 *     shared between Safari and standalone PWA on iOS. Provides yet another
 *     recovery path if IndexedDB and localStorage are both wiped.
 */

import { authLog } from '@/lib/authLogger'

const CACHE_NAME = 'hich-auth-v1'
const CACHE_KEY = '/hich-auth-token'

/**
 * Request persistent storage from the browser.
 * On iOS, this is advisory — the OS may still evict data under memory pressure.
 * Best called after notification permission is granted (improves odds on iOS).
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist()
      authLog('cacheStorage', 'requestPersistentStorage', granted, granted ? 'granted' : 'denied by browser')
      return granted
    }
    authLog('cacheStorage', 'requestPersistentStorage', false, 'API not available')
  } catch (err) {
    authLog('cacheStorage', 'requestPersistentStorage', false, String(err))
  }
  return false
}

/**
 * Save the refresh token to Cache Storage.
 * Cache Storage survives force-kills and is shared between Safari and standalone PWA.
 */
export async function cacheRefreshToken(refreshToken: string): Promise<void> {
  try {
    if (typeof caches === 'undefined') {
      authLog('cacheStorage', 'cacheRefreshToken', false, 'Cache API not available')
      return
    }
    const cache = await caches.open(CACHE_NAME)
    await cache.put(
      new Request(CACHE_KEY),
      new Response(refreshToken, {
        headers: { 'Content-Type': 'text/plain', 'X-Timestamp': Date.now().toString() },
      }),
    )
    authLog('cacheStorage', 'cacheRefreshToken', true, `token length=${refreshToken.length}`)
  } catch (err) {
    authLog('cacheStorage', 'cacheRefreshToken', false, String(err))
  }
}

/**
 * Recover the refresh token from Cache Storage.
 * Returns null if no cached token or if the token is older than 30 days.
 */
export async function getCachedRefreshToken(): Promise<string | null> {
  try {
    if (typeof caches === 'undefined') {
      authLog('cacheStorage', 'getCachedRefreshToken', false, 'Cache API not available')
      return null
    }
    const cache = await caches.open(CACHE_NAME)
    const response = await cache.match(CACHE_KEY)
    if (!response) {
      authLog('cacheStorage', 'getCachedRefreshToken', false, 'no cached token found')
      return null
    }

    // Check age — reject tokens older than 30 days
    const timestamp = response.headers.get('X-Timestamp')
    if (timestamp) {
      const ageMs = Date.now() - Number(timestamp)
      const ageDays = Math.round(ageMs / (24 * 60 * 60 * 1000))
      if (ageMs > 30 * 24 * 60 * 60 * 1000) {
        await cache.delete(CACHE_KEY)
        authLog('cacheStorage', 'getCachedRefreshToken', false, `token expired (${ageDays} days old)`)
        return null
      }
      authLog('cacheStorage', 'getCachedRefreshToken', true, `token found (${ageDays} days old)`)
    } else {
      authLog('cacheStorage', 'getCachedRefreshToken', true, 'token found (no timestamp)')
    }

    return await response.text()
  } catch (err) {
    authLog('cacheStorage', 'getCachedRefreshToken', false, String(err))
    return null
  }
}

/**
 * Clear the cached refresh token (on sign-out).
 */
export async function clearCachedRefreshToken(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    const cache = await caches.open(CACHE_NAME)
    await cache.delete(CACHE_KEY)
    authLog('cacheStorage', 'clearCachedRefreshToken', true)
  } catch (err) {
    authLog('cacheStorage', 'clearCachedRefreshToken', false, String(err))
  }
}
