/**
 * Analytics wrapper tests.
 *
 * Verifies:
 *  1. initAnalytics() calls posthog.init when key is present
 *  2. initAnalytics() is a no-op when key is absent
 *  3. trackEvent() captures events when initialized
 *  4. trackEvent() is a no-op when not initialized
 *  5. identifyUser() calls posthog.identify
 *  6. resetAnalytics() calls posthog.reset
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock posthog-js
const mockInit = vi.fn()
const mockCapture = vi.fn()
const mockIdentify = vi.fn()
const mockReset = vi.fn()

vi.mock('posthog-js', () => ({
  default: {
    init: mockInit,
    capture: mockCapture,
    identify: mockIdentify,
    reset: mockReset,
  },
}))

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset module state between tests
    vi.resetModules()
  })

  it('initAnalytics calls posthog.init when VITE_POSTHOG_KEY is set', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key_123')
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://test.posthog.com')

    const { initAnalytics } = await import('@/lib/analytics')
    initAnalytics()

    expect(mockInit).toHaveBeenCalledWith('phc_test_key_123', {
      api_host: 'https://test.posthog.com',
      autocapture: false,
      capture_pageview: false,
      persistence: 'localStorage',
    })

    vi.unstubAllEnvs()
  })

  it('initAnalytics is a no-op when VITE_POSTHOG_KEY is absent', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '')

    const { initAnalytics } = await import('@/lib/analytics')
    initAnalytics()

    expect(mockInit).not.toHaveBeenCalled()

    vi.unstubAllEnvs()
  })

  it('trackEvent captures events when initialized', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key_123')

    const { initAnalytics, trackEvent } = await import('@/lib/analytics')
    initAnalytics()
    trackEvent('ride_requested', { ride_id: '123' })

    expect(mockCapture).toHaveBeenCalledWith('ride_requested', { ride_id: '123' })

    vi.unstubAllEnvs()
  })

  it('trackEvent is a no-op when not initialized', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '')

    const { trackEvent } = await import('@/lib/analytics')
    trackEvent('ride_requested', { ride_id: '123' })

    expect(mockCapture).not.toHaveBeenCalled()

    vi.unstubAllEnvs()
  })

  it('identifyUser calls posthog.identify when initialized', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key_123')

    const { initAnalytics, identifyUser } = await import('@/lib/analytics')
    initAnalytics()
    identifyUser('user-1', { is_driver: true, edu_domain: 'ucdavis.edu' })

    expect(mockIdentify).toHaveBeenCalledWith('user-1', {
      is_driver: true,
      edu_domain: 'ucdavis.edu',
    })

    vi.unstubAllEnvs()
  })

  it('resetAnalytics calls posthog.reset when initialized', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key_123')

    const { initAnalytics, resetAnalytics } = await import('@/lib/analytics')
    initAnalytics()
    resetAnalytics()

    expect(mockReset).toHaveBeenCalled()

    vi.unstubAllEnvs()
  })

  it('does not double-initialize', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_key_123')

    const { initAnalytics } = await import('@/lib/analytics')
    initAnalytics()
    initAnalytics()

    expect(mockInit).toHaveBeenCalledTimes(1)

    vi.unstubAllEnvs()
  })
})
