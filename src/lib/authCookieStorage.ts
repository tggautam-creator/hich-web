/**
 * Cookie-based storage adapter for the Supabase auth client.
 *
 * On iOS, installed PWAs (Add to Home Screen) can have their localStorage
 * cleared when the app is force-killed from the app switcher. Cookies survive
 * this because the OS treats them as part of the browser's persistent store,
 * not the PWA's isolated storage. Swapping storage here fixes the logout-on-kill
 * issue without touching any server code or auth flow.
 *
 * Strategy:
 *  - Write to BOTH cookie and localStorage (belt and suspenders).
 *  - Read from cookie first; fall back to localStorage.
 *  - If the encoded session JSON exceeds the per-cookie byte limit (4 KB),
 *    skip the cookie write and rely on localStorage only for that call.
 *    (Typical Supabase sessions are 1–3 KB encoded, well within the limit.)
 */

const COOKIE_MAX_BYTES = 3800   // leave headroom under the 4096-byte per-cookie limit
const COOKIE_TTL_MS   = 7 * 24 * 60 * 60 * 1000   // 7 days — matches Supabase refresh-token lifetime

function getCookie(key: string): string | null {
  // Escape any regex special characters in the key before building the pattern
  const escaped = encodeURIComponent(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function setCookie(key: string, value: string): void {
  const encoded = encodeURIComponent(value)
  if (encoded.length > COOKIE_MAX_BYTES) return   // too large — skip cookie, localStorage handles it

  const expires = new Date(Date.now() + COOKIE_TTL_MS).toUTCString()
  const secure  = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie =
    `${encodeURIComponent(key)}=${encoded}; expires=${expires}; path=/; SameSite=Lax${secure}`
}

function deleteCookie(key: string): void {
  document.cookie =
    `${encodeURIComponent(key)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`
}

export const authCookieStorage = {
  getItem(key: string): string | null {
    return getCookie(key) ?? localStorage.getItem(key)
  },

  setItem(key: string, value: string): void {
    setCookie(key, value)
    try {
      localStorage.setItem(key, value)
    } catch {
      // localStorage quota exceeded — cookie is the fallback
    }
  },

  removeItem(key: string): void {
    deleteCookie(key)
    localStorage.removeItem(key)
  },
}
