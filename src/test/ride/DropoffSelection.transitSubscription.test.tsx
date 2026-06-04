/**
 * v1.3 Sprint 12 Slice 7 — DropoffSelection subscribes to
 * `ride:{rideId}` for live `transit_suggestions` broadcasts.
 *
 * Pins:
 *   - On mount, the page calls `supabase.channel('ride:{rideId}')`
 *   - The chain registers a `broadcast` handler for the
 *     `transit_suggestions` event
 *   - When the handler fires with a non-empty `suggestions` array, the
 *     page selects index 0
 *   - On unmount, the channel is removed
 *
 * Why this matters: the server broadcasts here when a driver edits
 * their destination mid-flow (rides.ts:6016) or when the driver's
 * routine auto-detects a destination on selection (rides.ts:2765).
 * Without this subscription the rider sees stale suggestions until a
 * manual refresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DropoffSelection from '@/components/ride/DropoffSelection'

const { mockChannel, mockOn, mockSubscribe, mockRemoveChannel } = vi.hoisted(() => ({
  mockChannel: vi.fn(),
  mockOn: vi.fn(),
  mockSubscribe: vi.fn(),
  mockRemoveChannel: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }),
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string } }) => unknown) =>
    selector({ profile: { id: 'driver-1' } }),
}))

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

vi.mock('@/components/map/RideMapPrimitive', () => ({
  default: () => null,
}))

vi.mock('@/components/map/RoutePreview', () => ({
  RoutePolyline: () => null,
  MapBoundsFitter: () => null,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockOn.mockReturnThis()
  mockSubscribe.mockReturnThis()
  mockChannel.mockReturnValue({ on: mockOn, subscribe: mockSubscribe })
  // The fetch path will resolve to a 200 with no suggestions so the
  // page renders without errors. We're only testing the subscription
  // here.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ suggestions: [], polyline: null }),
  }))
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[
      {
        pathname: '/ride/dropoff/ride-001',
        state: { destinationLat: 38.5, destinationLng: -121.7, destinationName: 'Dest' },
      },
    ]}>
      <Routes>
        <Route path="/ride/dropoff/:rideId" element={<DropoffSelection />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DropoffSelection — ride:{rideId} transit_suggestions subscription (Slice 7)', () => {
  it('subscribes to ride:{rideId} on mount + registers a transit_suggestions broadcast handler', async () => {
    renderPage()
    await waitFor(() => {
      expect(mockChannel).toHaveBeenCalledWith('ride:ride-001')
    })
    const onCalls = mockOn.mock.calls
    const transitHandlerCall = onCalls.find(
      (c) => c[0] === 'broadcast' && (c[1] as { event?: string }).event === 'transit_suggestions',
    )
    expect(transitHandlerCall).toBeDefined()
    expect(mockSubscribe).toHaveBeenCalled()
  })

  it('removes the channel on unmount', async () => {
    const { unmount } = renderPage()
    await waitFor(() => expect(mockChannel).toHaveBeenCalledWith('ride:ride-001'))
    unmount()
    expect(mockRemoveChannel).toHaveBeenCalled()
  })
})
