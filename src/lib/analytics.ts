/**
 * Analytics — thin wrapper around PostHog.
 *
 * All event tracking goes through this file so we have a single
 * point of control. In test/dev or when VITE_POSTHOG_KEY is absent,
 * all calls are no-ops.
 */
import posthog from 'posthog-js'

const POSTHOG_KEY = import.meta.env['VITE_POSTHOG_KEY'] as string | undefined
const POSTHOG_HOST = (import.meta.env['VITE_POSTHOG_HOST'] as string | undefined) || 'https://us.i.posthog.com'

let initialized = false

export function initAnalytics(): void {
  if (!POSTHOG_KEY || initialized) return
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    persistence: 'localStorage',
  })
  initialized = true
}

export function identifyUser(userId: string, traits: Record<string, unknown>): void {
  if (!initialized) return
  posthog.identify(userId, traits)
}

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return
  posthog.capture(event, properties)
}

export function resetAnalytics(): void {
  if (!initialized) return
  posthog.reset()
}
