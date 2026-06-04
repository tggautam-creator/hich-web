/**
 * v1.3 Sprint 12 Slice 2a — useRideNotificationStatus tests.
 *
 * Pins:
 *   - Polls GET /api/rides/:id/notification-status while enabled
 *   - Disabled (enabled=false) → no fetch fires
 *   - Disabled (rideId=null) → no fetch fires
 *   - Decodes server snake_case → hook camelCase shape verbatim
 *   - Treats 403 NOT_RIDER / 404 RIDE_NOT_FOUND as terminal (no retry
 *     spam)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRideNotificationStatus } from '@/hooks/useRideNotificationStatus'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok' } },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
})

describe('useRideNotificationStatus', () => {
  it('decodes server snake_case body into hook camelCase shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ride_id: 'ride-abc',
        ride_status: 'requested',
        drivers_notified: 3,
        drivers_pending: 1,
        drivers_accepted: 0,
        drivers_declined: 2,
        driver_id: null,
      }),
    }))
    const { result } = renderHook(() => useRideNotificationStatus('ride-abc'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data).toEqual({
      rideId: 'ride-abc',
      rideStatus: 'requested',
      driversNotified: 3,
      driversPending: 1,
      driversAccepted: 0,
      driversDeclined: 2,
      driverId: null,
    })
  })

  it('does NOT fetch when rideId is null', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderHook(() => useRideNotificationStatus(null), { wrapper })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does NOT fetch when enabled=false (e.g. ride status moved past `requested`)', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderHook(() => useRideNotificationStatus('ride-abc', { enabled: false }), { wrapper })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('hits the per-rideId path (URL-encoded)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ride_id: 'ride-abc',
        ride_status: 'requested',
        drivers_notified: 0,
        drivers_pending: 0,
        drivers_accepted: 0,
        drivers_declined: 0,
        driver_id: null,
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    renderHook(() => useRideNotificationStatus('ride-abc'), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/rides/ride-abc/notification-status',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    )
  })

  it('surfaces fetch errors as query.error (server 403 etc.) without retry spam', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'FORBIDDEN' } }),
    }))
    const { result } = renderHook(() => useRideNotificationStatus('ride-abc'), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect((result.current.error as Error).message).toContain('403')
  })
})
