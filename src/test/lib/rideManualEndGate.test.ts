/**
 * v1.3 Sprint 11 Slice 5 — rideManualEndGate unit tests.
 *
 * Pins the CLAUDE.md hard rule (Phase 3.4, 2026-05-23): "End ride
 * without QR" stays hidden until elapsed >5min AND gpsDistance
 * >1km. Without the gate, a rider could end the ride 100m in and
 * pay only the $5 minimum (anti-fraud risk).
 *
 * Also pins the server contract — POSTs body `{ reason: 'manual_end' }`
 * so the server's `/safety-end` handler stamps
 * `end_reason='manual_end'` (NOT `rider_safety_button` —
 * that's reserved for the overlay's got-out branch).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  manualEndEligible,
  MIN_DISTANCE_METRES,
  MIN_ELAPSED_SECONDS,
  ManualEndApiError,
  postManualEnd,
} from '@/lib/rideManualEndGate'

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

// ── manualEndEligible — gate predicate ───────────────────────────

describe('manualEndEligible', () => {
  it('uses MIN_ELAPSED_SECONDS=300 (5 minutes) and MIN_DISTANCE_METRES=1000 (1 km) per CLAUDE.md hard rule', () => {
    expect(MIN_ELAPSED_SECONDS).toBe(300)
    expect(MIN_DISTANCE_METRES).toBe(1000)
  })

  it('returns FALSE when both thresholds are far below', () => {
    expect(manualEndEligible(100, 500)).toBe(false)
  })

  it('returns FALSE when elapsed is below the threshold (>1km but <5min)', () => {
    expect(manualEndEligible(60, 5000)).toBe(false)
  })

  it('returns FALSE when distance is below the threshold (>5min but <1km)', () => {
    expect(manualEndEligible(600, 100)).toBe(false)
  })

  it('returns FALSE at exactly the elapsed threshold but distance below', () => {
    expect(manualEndEligible(300, 999)).toBe(false)
  })

  it('returns FALSE at exactly the distance threshold but elapsed below', () => {
    expect(manualEndEligible(299, 1000)).toBe(false)
  })

  it('returns TRUE when BOTH thresholds are exactly met', () => {
    expect(manualEndEligible(300, 1000)).toBe(true)
  })

  it('returns TRUE when BOTH thresholds are exceeded', () => {
    expect(manualEndEligible(900, 5000)).toBe(true)
  })

  it('treats null / undefined / NaN inputs as 0 (not eligible)', () => {
    expect(manualEndEligible(null, 5000)).toBe(false)
    expect(manualEndEligible(900, null)).toBe(false)
    expect(manualEndEligible(undefined, 5000)).toBe(false)
    expect(manualEndEligible(NaN, NaN)).toBe(false)
  })
})

// ── postManualEnd — POST contract ────────────────────────────────

describe('postManualEnd', () => {
  it("POSTs body { reason: 'manual_end' } (NOT rider_left/driver_left — those are reserved for the overlay's got-out branch)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, ride_ended: true, fare_cents: 750, end_reason: 'manual_end' }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await postManualEnd('ride-1')
    expect(result.ride_ended).toBe(true)
    expect(result.fare_cents).toBe(750)
    expect(result.end_reason).toBe('manual_end')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/rides/ride-1/safety-end',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'manual_end' }),
      }),
    )
  })

  it('returns ManualEndResult with fare_cents=null when server omits it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, ride_ended: true, end_reason: 'manual_end' }),
    }))
    const result = await postManualEnd('ride-1')
    expect(result.fare_cents).toBeNull()
  })

  it('throws ManualEndApiError on 403 NOT_PARTICIPANT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'NOT_PARTICIPANT', message: 'Not your ride' } }),
    }))
    await expect(postManualEnd('ride-1')).rejects.toBeInstanceOf(ManualEndApiError)
    await expect(postManualEnd('ride-1')).rejects.toMatchObject({ code: 'NOT_PARTICIPANT', status: 403 })
  })

  it('throws ManualEndApiError on 409 NOT_ACTIVE (ride already ended)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'NOT_ACTIVE', message: "Ride status is 'completed'" } }),
    }))
    await expect(postManualEnd('ride-1')).rejects.toMatchObject({ code: 'NOT_ACTIVE', status: 409 })
  })

  it('throws UNAUTHENTICATED when no session exists', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    await expect(postManualEnd('ride-1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('throws NETWORK on fetch rejection (offline / DNS fail)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(postManualEnd('ride-1')).rejects.toMatchObject({ code: 'NETWORK' })
  })
})
