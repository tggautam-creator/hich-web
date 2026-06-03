/**
 * v1.3 Sprint 11 Slice 4b — safetyWarningResponseApi unit tests.
 *
 * Pins the server contract + error code mapping. The overlay
 * branches on `isStaleResponseTap` to silently dismiss when the
 * counterparty responded first — wrong mapping would surface a
 * scary red error to the user (iOS hit this bug 2026-05-24).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  helpComposedBody,
  isStaleResponseTap,
  postSafetyWarningResponse,
  SafetyWarningResponseApiError,
} from '@/lib/safetyWarningResponseApi'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok' } },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
})

// ── postSafetyWarningResponse ──────────────────────────────────────

describe('postSafetyWarningResponse', () => {
  it('POSTs body { action } and returns the parsed response on 200', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, action: 'rider_in_car', ride_ended: false }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await postSafetyWarningResponse('ride-1', 'rider_in_car')
    expect(result).toEqual({ ok: true, action: 'rider_in_car', ride_ended: false })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/rides/ride-1/safety-warning-response',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'rider_in_car' }),
      }),
    )
  })

  it('rider_left returns ride_ended:true + fare_cents (server fared via endRideForSafety)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, action: 'rider_left', ride_ended: true, fare_cents: 750 }),
    }))
    const result = await postSafetyWarningResponse('ride-1', 'rider_left')
    expect(result.ride_ended).toBe(true)
    expect(result.fare_cents).toBe(750)
  })

  it('help_requested returns share_token + trusted_contacts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        action: 'help_requested',
        ride_ended: false,
        share_token: 'tk_'.padEnd(64, 'a'),
        share_expires_at: '2026-06-03T15:00:00.000Z',
        trusted_contacts: [
          { id: 'c-1', name: 'Mom', phone: '+15551112222' },
          { id: 'c-2', name: 'Roommate', phone: '+15552223333' },
        ],
      }),
    }))
    const result = await postSafetyWarningResponse('ride-1', 'help_requested')
    expect(result.share_token).toMatch(/^tk_/)
    expect(result.trusted_contacts).toHaveLength(2)
  })

  it('maps 409 NO_ACTIVE_WARNING into SafetyWarningResponseApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'NO_ACTIVE_WARNING', message: 'No active divergence warning' } }),
    }))
    await expect(postSafetyWarningResponse('ride-1', 'rider_in_car'))
      .rejects.toMatchObject({ code: 'NO_ACTIVE_WARNING', status: 409 })
  })

  it('maps 403 WRONG_ROLE into SafetyWarningResponseApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'WRONG_ROLE', message: "riders can't tap driver_in_car" } }),
    }))
    await expect(postSafetyWarningResponse('ride-1', 'driver_in_car'))
      .rejects.toMatchObject({ code: 'WRONG_ROLE', status: 403 })
  })

  it('throws UNAUTHENTICATED when no session exists', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    await expect(postSafetyWarningResponse('ride-1', 'rider_in_car'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('throws NETWORK on fetch rejection (offline / DNS fail)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(postSafetyWarningResponse('ride-1', 'rider_in_car'))
      .rejects.toMatchObject({ code: 'NETWORK' })
  })
})

// ── isStaleResponseTap ─────────────────────────────────────────────

describe('isStaleResponseTap', () => {
  it('returns true for 409 NO_ACTIVE_WARNING (other party responded first)', () => {
    const err = new SafetyWarningResponseApiError('NO_ACTIVE_WARNING', 'No active', 409)
    expect(isStaleResponseTap(err)).toBe(true)
  })

  it('returns true for 409 NOT_ACTIVE (ride already ended)', () => {
    const err = new SafetyWarningResponseApiError('NOT_ACTIVE', 'Ride not active', 409)
    expect(isStaleResponseTap(err)).toBe(true)
  })

  it('returns false for 403 WRONG_ROLE — not a stale tap, real config error', () => {
    const err = new SafetyWarningResponseApiError('WRONG_ROLE', 'Wrong role', 403)
    expect(isStaleResponseTap(err)).toBe(false)
  })

  it('returns false for 409 with a different code', () => {
    const err = new SafetyWarningResponseApiError('UNKNOWN', 'Unknown', 409)
    expect(isStaleResponseTap(err)).toBe(false)
  })

  it('returns false for non-API errors', () => {
    expect(isStaleResponseTap(new Error('network'))).toBe(false)
    expect(isStaleResponseTap(null)).toBe(false)
  })
})

// ── helpComposedBody ───────────────────────────────────────────────

describe('helpComposedBody', () => {
  it('matches iOS RideSafetyCheckOverlay.helpComposedBody verbatim', () => {
    expect(helpComposedBody('https://tagorides.com/track/abc'))
      .toBe("I'm using Tago and might need help. Live tracking link (expires in 4 hrs): https://tagorides.com/track/abc")
  })
})
