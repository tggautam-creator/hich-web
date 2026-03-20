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
      return await navigator.storage.persist()
    }
  } catch {
    // Not supported or blocked
  }
  return false
}

/**
 * Save the refresh token to Cache Storage.
 * Cache Storage survives force-kills and is shared between Safari and standalone PWA.
 */
export async function cacheRefreshToken(refreshToken: string): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    const cache = await caches.open(CACHE_NAME)
    await cache.put(
      new Request(CACHE_KEY),
      new Response(refreshToken, {
        headers: { 'Content-Type': 'text/plain', 'X-Timestamp': Date.now().toString() },
      }),
    )
  } catch {
    // Cache API not available or quota exceeded
  }
}

/**
 * Recover the refresh token from Cache Storage.
 * Returns null if no cached token or if the token is older than 30 days.
 */
export async function getCachedRefreshToken(): Promise<string | null> {
  try {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open(CACHE_NAME)
    const response = await cache.match(CACHE_KEY)
    if (!response) return null

    // Check age — reject tokens older than 30 days
    const timestamp = response.headers.get('X-Timestamp')
    if (timestamp) {
      const age = Date.now() - Number(timestamp)
      if (age > 30 * 24 * 60 * 60 * 1000) {
        await cache.delete(CACHE_KEY)
        return null
      }
    }

    return await response.text()
  } catch {
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
  } catch {
    // ignore
  }
}
