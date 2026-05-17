/**
 * Cross-screen snooze notification — the web equivalent of iOS
 * `NotificationCenter.default.post(name: .driverSnoozeChanged, ...)`.
 *
 * The driver can change their snooze state from several surfaces:
 *   - `RideRequestNotification` (decline-sheet snooze pill)
 *   - `RideSuggestion` (decline-sheet snooze pill)
 *   - `DriverHomePage` (Resume button)
 *
 * Whenever one of those POSTs `/api/rides/snooze` or DELETEs the same,
 * it fires `dispatchSnoozeChange` so any OTHER currently-mounted
 * screen — most importantly `DriverHomePage`'s top-bar pill — picks
 * the new state up instantly without waiting for a navigation /
 * re-mount. Matches iOS instant-update behavior.
 *
 * Carries an optional `snoozedUntil` Date — null means snooze was
 * cleared (Resume), a Date means it was set or extended.
 */

const EVENT_NAME = 'tago:driver-snoozed'

export interface SnoozeChangeDetail {
  snoozedUntil: Date | null
}

export function dispatchSnoozeChange(snoozedUntil: Date | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<SnoozeChangeDetail>(EVENT_NAME, {
      detail: { snoozedUntil },
    }),
  )
}

/**
 * Subscribe to snooze changes. Returns the unsubscribe function so
 * callers can pair it with `useEffect` cleanup directly.
 */
export function onSnoozeChange(
  handler: (detail: SnoozeChangeDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<SnoozeChangeDetail>).detail
    if (detail) handler(detail)
  }
  window.addEventListener(EVENT_NAME, listener)
  return () => window.removeEventListener(EVENT_NAME, listener)
}
