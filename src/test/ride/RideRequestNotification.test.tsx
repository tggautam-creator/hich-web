/**
 * RideRequestNotification tests
 *
 * Verifies:
 *  1. Does not render sheet when there is no notification
 *  2. Shows banner when ride_request message arrives
 *  3. Displays rider name from payload
 *  4. Displays destination from payload
 *  5. Displays distance from payload
 *  6. Displays formatted earnings from payload
 *  7. Shows fallback values when payload fields are missing
 *  8. View Details navigates to /ride/suggestion/:rideId and dismisses
 *  9. Dismiss button dismisses the banner
 * 10. Auto-dismisses after 90 seconds
 * 11. Ignores non-ride_request messages
 * 12. Countdown displays seconds remaining
 * 13. Shows decline toast for board_declined messages
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RideRequestNotification from '@/components/ride/RideRequestNotification'

// ── FCM mock ──────────────────────────────────────────────────────────────────

type FcmCallback = (payload: {
  title?: string
  body?: string
  data?: Record<string, string>
}) => void

let capturedCallback: FcmCallback | null = null

const { mockUnsubscribe, mockOn, mockSubscribe, mockRemoveChannel } = vi.hoisted(() => ({
  mockUnsubscribe: vi.fn(),
  mockOn: vi.fn(),
  mockSubscribe: vi.fn(),
  mockRemoveChannel: vi.fn(),
}))

vi.mock('@/lib/fcm', () => ({
  onForegroundMessage: (cb: FcmCallback) => {
    capturedCallback = cb
    return mockUnsubscribe
  },
}))

// ── Supabase mock (Realtime) ──────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => ({
      on: mockOn.mockReturnThis(),
      subscribe: mockSubscribe.mockReturnThis(),
    }),
    removeChannel: mockRemoveChannel,
  },
}))

// ── Auth store mock ───────────────────────────────────────────────────────────
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string }; isDriver: boolean }) => unknown) =>
    selector({ profile: { id: 'driver-123' }, isDriver: true }),
}))

// ── Driver pending-offer helper mock (Slice 2b) ──────────────────────────────
const { mockFetchDriverPendingOffer } = vi.hoisted(() => ({
  mockFetchDriverPendingOffer: vi.fn(),
}))
vi.mock('@/lib/driverPendingOfferApi', () => ({
  fetchDriverPendingOffer: mockFetchDriverPendingOffer,
}))

// ── Navigate mock ─────────────────────────────────────────────────────────────

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderComponent() {
  return render(
    <MemoryRouter>
      <div id="portal-root" />
      <RideRequestNotification />
    </MemoryRouter>,
  )
}

const RIDE_REQUEST_PAYLOAD = {
  title: 'New Ride Request',
  body: 'Someone needs a ride',
  data: {
    type: 'ride_request',
    ride_id: 'ride-abc-123',
    rider_name: 'Alice',
    destination: 'Downtown',
    distance_km: '8.5',
    estimated_earnings_cents: '1250',
  },
}

const BOARD_DECLINED_PAYLOAD = {
  title: 'Request Declined',
  body: 'Your ride request was declined. Try another ride on the board!',
  data: {
    type: 'board_declined',
    ride_id: 'ride-def-456',
  },
}

function triggerRideRequest(
  overrides: Partial<typeof RIDE_REQUEST_PAYLOAD> = {},
) {
  const payload = { ...RIDE_REQUEST_PAYLOAD, ...overrides }
  if (overrides.data) {
    payload.data = { ...RIDE_REQUEST_PAYLOAD.data, ...overrides.data }
  }
  act(() => {
    capturedCallback?.(payload)
  })
}

function triggerBoardDeclined() {
  act(() => {
    capturedCallback?.(BOARD_DECLINED_PAYLOAD)
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RideRequestNotification', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    capturedCallback = null
    mockFetchDriverPendingOffer.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not render sheet content when there is no notification', () => {
    renderComponent()
    expect(screen.queryByTestId('ride-request-content')).not.toBeInTheDocument()
  })

  it('shows banner when ride_request message arrives', () => {
    renderComponent()
    triggerRideRequest()
    expect(screen.getByTestId('ride-request-notification')).toBeInTheDocument()
    expect(screen.getByTestId('ride-request-content')).toBeInTheDocument()
  })

  it('displays rider name from payload', () => {
    renderComponent()
    triggerRideRequest()
    expect(screen.getByTestId('rider-name')).toHaveTextContent('Alice')
  })

  it('displays destination from payload', () => {
    renderComponent()
    triggerRideRequest()
    expect(screen.getByTestId('notification-destination')).toHaveTextContent('Downtown')
  })

  it('displays distance from payload', () => {
    renderComponent()
    triggerRideRequest()
    expect(screen.getByTestId('notification-distance')).toHaveTextContent('5.3 mi')
  })

  it('displays formatted earnings from payload', () => {
    renderComponent()
    triggerRideRequest()
    // 1250 cents → "$12.50"
    expect(screen.getByTestId('notification-earnings')).toHaveTextContent('$12.50')
  })

  it('shows fallback values when payload fields are missing', () => {
    renderComponent()
    act(() => {
      capturedCallback?.({
        data: {
          type: 'ride_request',
          ride_id: 'ride-xyz',
        },
      })
    })
    expect(screen.getByTestId('rider-name')).toHaveTextContent('A rider')
    expect(screen.getByTestId('notification-destination')).toHaveTextContent('Nearby destination')
    expect(screen.getByTestId('notification-distance')).toHaveTextContent('–')
    expect(screen.getByTestId('notification-earnings')).toHaveTextContent('–')
  })

  it('View Details navigates to /ride/suggestion/:rideId and dismisses', () => {
    renderComponent()
    triggerRideRequest()

    act(() => {
      fireEvent.click(screen.getByTestId('view-details-button'))
    })

    expect(mockNavigate).toHaveBeenCalledWith('/ride/suggestion/ride-abc-123', {
      state: {
        riderName: 'Alice',
        destination: 'Downtown',
        distanceKm: '8.5',
        estimatedEarnings: '$12.50',
        originLat: '',
        originLng: '',
        destinationLat: '',
        destinationLng: '',
        originAddress: '',
      },
    })
    expect(screen.queryByTestId('ride-request-content')).not.toBeInTheDocument()
  })

  it('Dismiss button dismisses the banner', () => {
    renderComponent()
    triggerRideRequest()

    expect(screen.getByTestId('ride-request-content')).toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByLabelText('Dismiss'))
    })

    expect(screen.queryByTestId('ride-request-content')).not.toBeInTheDocument()
  })

  it('auto-dismisses after 90 seconds', () => {
    renderComponent()
    triggerRideRequest()

    expect(screen.getByTestId('ride-request-content')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(90_000)
    })

    expect(screen.queryByTestId('ride-request-content')).not.toBeInTheDocument()
  })

  it('ignores non-ride_request messages', () => {
    renderComponent()

    act(() => {
      capturedCallback?.({
        title: 'Other',
        body: 'Something else',
        data: { type: 'chat_message' },
      })
    })

    expect(screen.queryByTestId('ride-request-content')).not.toBeInTheDocument()
  })

  it('shows a decline toast for board_declined messages', () => {
    renderComponent()
    triggerBoardDeclined()

    expect(screen.getByText('Request Declined')).toBeInTheDocument()
    expect(screen.getByText('Your ride request was declined. Try another ride on the board!')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('declined-browse-board'))
    expect(mockNavigate).toHaveBeenCalledWith('/rides/board')
  })

  it('countdown displays seconds remaining', () => {
    renderComponent()
    triggerRideRequest()

    expect(screen.getByTestId('countdown')).toHaveTextContent('90s')

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(screen.getByTestId('countdown')).toHaveTextContent('85s')
  })

  it('unsubscribes from FCM on unmount', () => {
    const { unmount } = renderComponent()
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalled()
  })

  it('registers a foreground message listener on mount', () => {
    renderComponent()
    expect(capturedCallback).not.toBeNull()
  })

  // ── Slice 2b — Driver PWA-after-kill resume ──────────────────────────────
  // Pins the bootstrapPendingOffer wiring: GET /api/rides/driver-pending-offer
  // result is funnelled through handleRideRequest with the same payload
  // shape an FCM ride_request push would carry. Mirrors iOS
  // `RideRequestListener.bootstrapPendingOffer`.
  describe('bootstrapPendingOffer (resume after PWA kill)', () => {
    it('rehydrates the banner when /driver-pending-offer returns an offer', async () => {
      mockFetchDriverPendingOffer.mockResolvedValueOnce({
        rideId: 'ride-resume-001',
        offerCreatedAt: '2026-06-03T17:00:00.000Z',
        riderName: 'Casey',
        riderAvatarUrl: '',
        riderRating: 4.8,
        riderRatingCount: 12,
        originName: 'Library',
        destination: 'Dorm A',
        originLat: 32.71,
        originLng: -117.16,
        destinationLat: 32.78,
        destinationLng: -117.13,
        estimatedEarningsCents: 642,
        distanceKm: 3.4,
        savedDestinationLat: null,
        savedDestinationLng: null,
        savedDestinationName: null,
      })

      renderComponent()
      // Flush the microtask + bootstrap promise chain.
      await act(async () => { await Promise.resolve() })
      await act(async () => { await Promise.resolve() })

      expect(mockFetchDriverPendingOffer).toHaveBeenCalled()
      expect(screen.getByTestId('ride-request-notification')).toBeInTheDocument()
      expect(screen.getByTestId('rider-name')).toHaveTextContent('Casey')
      expect(screen.getByTestId('notification-destination')).toHaveTextContent('Dorm A')
      // 642 cents → "$6.42"
      expect(screen.getByTestId('notification-earnings')).toHaveTextContent('$6.42')
    })

    it('does not render the banner when /driver-pending-offer returns null', async () => {
      mockFetchDriverPendingOffer.mockResolvedValue(null)
      renderComponent()
      await act(async () => { await Promise.resolve() })
      await act(async () => { await Promise.resolve() })
      expect(mockFetchDriverPendingOffer).toHaveBeenCalled()
      expect(screen.queryByTestId('ride-request-notification')).not.toBeInTheDocument()
    })

    it('dedups against an FCM push for the same ride_id (single banner)', async () => {
      mockFetchDriverPendingOffer.mockResolvedValueOnce({
        rideId: 'ride-dedup-001',
        offerCreatedAt: '2026-06-03T17:00:00.000Z',
        riderName: 'Casey',
        riderAvatarUrl: '',
        riderRating: 5,
        riderRatingCount: 1,
        originName: 'Library',
        destination: 'Dorm A',
        originLat: null,
        originLng: null,
        destinationLat: null,
        destinationLng: null,
        estimatedEarningsCents: 800,
        distanceKm: null,
        savedDestinationLat: null,
        savedDestinationLng: null,
        savedDestinationName: null,
      })

      renderComponent()
      await act(async () => { await Promise.resolve() })
      await act(async () => { await Promise.resolve() })

      // FCM push for the SAME ride fires next — must not double-render.
      triggerRideRequest({ data: { ...RIDE_REQUEST_PAYLOAD.data, ride_id: 'ride-dedup-001' } })

      expect(screen.getAllByTestId('ride-request-notification')).toHaveLength(1)
    })

    it('re-fires the fetch when the PWA returns to foreground (visibilitychange)', async () => {
      renderComponent()
      await act(async () => { await Promise.resolve() })
      const initialCalls = mockFetchDriverPendingOffer.mock.calls.length

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await act(async () => { await Promise.resolve() })

      expect(mockFetchDriverPendingOffer.mock.calls.length).toBeGreaterThan(initialCalls)
    })
  })
})
