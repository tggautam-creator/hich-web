/**
 * PWA detection utilities and install prompt interception.
 */

// ── Detection ────────────────────────────────────────────────────────────────

/** True when the app is running as an installed PWA (standalone mode). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mqMatch = typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: standalone)').matches
    : false
  return mqMatch || (navigator as unknown as { standalone?: boolean }).standalone === true
}

/** True on iOS devices (iPhone, iPad, iPod). */
export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

/** True on mobile devices (iOS or Android). */
export function isMobile(): boolean {
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent)
}

/** True on Android devices. */
export function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent)
}

/**
 * Detect which browser the user is running.
 * Order matters — check more specific UA strings first.
 */
export type BrowserType = 'safari' | 'chrome' | 'firefox' | 'samsung' | 'edge' | 'opera' | 'other'

export function detectBrowser(): BrowserType {
  const ua = navigator.userAgent
  // Samsung Internet (contains "SamsungBrowser")
  if (/samsungbrowser/i.test(ua)) return 'samsung'
  // Opera (contains "OPR" or "Opera")
  if (/opr|opera/i.test(ua)) return 'opera'
  // Edge (contains "Edg" — not "Edge" which was the old one)
  if (/edg/i.test(ua)) return 'edge'
  // Firefox
  if (/firefox|fxios/i.test(ua)) return 'firefox'
  // Chrome (must check after Edge/Opera/Samsung which also contain "Chrome")
  if (/chrome|crios/i.test(ua)) return 'chrome'
  // Safari (must be last — many browsers contain "Safari")
  if (/safari/i.test(ua)) return 'safari'
  return 'other'
}

// ── beforeinstallprompt interception ─────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', ((e: Event) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
  }) as EventListener)
}

/**
 * Trigger the native install prompt (Android Chrome only).
 * Returns true if the user accepted, false if dismissed or unavailable.
 */
export async function triggerInstallPrompt(): Promise<boolean> {
  if (!deferredPrompt) return false
  await deferredPrompt.prompt()
  const { outcome } = await deferredPrompt.userChoice
  deferredPrompt = null
  return outcome === 'accepted'
}

/** Whether a deferred install prompt is available (Android). */
export function hasInstallPrompt(): boolean {
  return deferredPrompt !== null
}

// ── Navigation URL helper ───────────────────────────────────────────────────

/**
 * Build a navigation URL that opens the native map app.
 * - iOS: `maps:` scheme → opens Apple Maps natively (uses current location as origin automatically)
 * - Android/Desktop: Google Maps URL with origin → Android offers to open in installed map app
 */
export function getNavigationUrl(
  destLat: number,
  destLng: number,
  mode: 'driving' | 'walking' | 'transit' = 'driving',
  originLat?: number,
  originLng?: number,
): string {
  if (isIos()) {
    const dirflg = mode === 'walking' ? 'w' : mode === 'transit' ? 'r' : 'd'
    const origin = originLat != null && originLng != null ? `&saddr=${originLat},${originLng}` : ''
    return `maps:?daddr=${destLat},${destLng}${origin}&dirflg=${dirflg}`
  }
  const origin = originLat != null && originLng != null ? `&origin=${originLat},${originLng}` : ''
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${destLat},${destLng}&travelmode=${mode}`
}
