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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RideRequestNotification', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    capturedCallback = null
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
})
