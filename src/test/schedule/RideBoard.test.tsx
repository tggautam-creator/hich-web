/**
 * RideBoard tests
 *
 * Verifies:
 *  1.  Renders with default data-testid
 *  2.  Renders ride cards when data loads
 *  3.  Shows empty state when no rides
 *  4.  Own rides do not show contact button
 *  5.  Shows "Request This Ride" / "Offer to Drive" labels
 *  6.  Opens confirmation sheet on contact button click
 *  7.  Sends POST /api/schedule/request via confirmation sheet → enters waiting state
 *  8.  Shows error when request fails
 *  9.  Passes user location in board fetch
 * 10.  Filters rides by destination when typing in search bar
 * 11.  Shows search-aware empty state when no rides match
 * 12.  Clears search and shows all rides when clear button is clicked
 * 13.  Renders the Post Ride FAB
 * 14.  Renders the search bar
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RideBoard from '@/components/schedule/RideBoard'

// ── Mock react-router-dom ─────────────────────────────────────────────────────

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: '/rides/board', search: '', hash: '', key: 'default' }),
}))

// ── Mock auth store ──────────────────────────────────────────────────────────

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      profile: { id: 'current-user' },
      isDriver: false,
    }),
}))

// ── Mock Supabase (with channel for Realtime) ────────────────────────────────

const { mockChannel, mockRemoveChannel } = vi.hoisted(() => ({
  mockChannel: vi.fn(),
  mockRemoveChannel: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
}))

beforeEach(() => {
  // Channel mock returns a chainable object
  const channelObj = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  }
  mockChannel.mockReturnValue(channelObj)
})

// ── Mock BottomNav ───────────────────────────────────────────────────────────

vi.mock('@/components/ui/BottomNav', () => ({
  default: () => <div data-testid="bottom-nav" />,
}))

// ── Mock geolocation ─────────────────────────────────────────────────────────

const mockGetCurrentPosition = vi.fn()

beforeEach(() => {
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition: mockGetCurrentPosition },
    writable: true,
    configurable: true,
  })
  mockGetCurrentPosition.mockImplementation((success: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
    success({ coords: { latitude: 38.54, longitude: -121.76 } })
  })
})

// ── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockNavigate.mockReset()
})

// ── Sample data ──────────────────────────────────────────────────────────────

const DRIVER_RIDE = {
  id: 'sched-1',
  user_id: 'driver-abc',
  mode: 'driver',
  route_name: 'Davis to SF',
  origin_address: 'Davis, CA',
  dest_address: 'San Francisco, CA',
  direction_type: 'one_way',
  trip_date: '2026-04-01',
  time_type: 'departure',
  trip_time: '08:30:00',
  created_at: '2026-03-10T00:00:00Z',
  poster: { id: 'driver-abc', full_name: 'Ahmed', avatar_url: null, rating_avg: 4.8, is_driver: true },
}

const RIDER_RIDE = {
  id: 'sched-2',
  user_id: 'rider-xyz',
  mode: 'rider',
  route_name: 'Davis to Oakland',
  origin_address: 'Davis, CA',
  dest_address: 'Oakland, CA',
  direction_type: 'one_way',
  trip_date: '2026-04-02',
  time_type: 'arrival',
  trip_time: '14:00:00',
  created_at: '2026-03-10T01:00:00Z',
  poster: { id: 'rider-xyz', full_name: 'Maya', avatar_url: null, rating_avg: 4.5, is_driver: false },
}

const OWN_RIDE = {
  ...DRIVER_RIDE,
  id: 'sched-own',
  user_id: 'current-user',
  poster: { id: 'current-user', full_name: 'You', avatar_url: null, rating_avg: 0, is_driver: false },
}

function setupBoardFetch(rides = [DRIVER_RIDE, RIDER_RIDE]) {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/schedule/board')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ rides }),
      })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RideBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with default data-testid', async () => {
    setupBoardFetch()
    render(<RideBoard />)
    expect(screen.getByTestId('ride-board')).toBeInTheDocument()
  })

  it('renders ride cards after loading', async () => {
    setupBoardFetch()
    render(<RideBoard />)

    await waitFor(() => {
      expect(screen.getAllByTestId('ride-card')).toHaveLength(2)
    })

    expect(screen.getByText('Ahmed')).toBeInTheDocument()
    expect(screen.getByText('Maya')).toBeInTheDocument()
  })

  it('shows empty state when no rides', async () => {
    setupBoardFetch([])
    render(<RideBoard />)

    await waitFor(() => {
      expect(screen.getByText('No rides posted yet. Be the first!')).toBeInTheDocument()
    })
  })

  it('does not show contact button on own rides', async () => {
    setupBoardFetch([OWN_RIDE])
    render(<RideBoard />)

    await waitFor(() => {
      expect(screen.getByText('Your posted ride')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('contact-button')).not.toBeInTheDocument()
  })

  it('shows "Request This Ride" for driver posts and "Offer to Drive" for rider posts', async () => {
    setupBoardFetch()
    render(<RideBoard />)

    await waitFor(() => {
      expect(screen.getByText('Request This Ride')).toBeInTheDocument()
      expect(screen.getByText('Offer to Drive')).toBeInTheDocument()
    })
  })

  it('opens confirmation sheet when contact button is clicked', async () => {
    const user = userEvent.setup()
    setupBoardFetch()
    render(<RideBoard />)

    await waitFor(() => {
      expect(screen.getByText('Request This Ride')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Request This Ride'))

    // Confirmation sheet should appear with enrichment fields
    expect(screen.getByTestId('confirm-sheet')).toBeInTheDocument()
    expect(screen.getByTestId('mode-destination')).toBeInTheDocument()
    expect(screen.getByTestId('mode-flexible')).toBeInTheDocument()
    expect(screen.getByTestId('confirm-send-button')).toHaveTextContent('Send Request')
  })

  it('sends POST via confirmation sheet and shows success message', async () => {
    const user = userEvent.setup()
    setupBoardFetch()
    render(<RideBoard />)

    await waitFor(() => {
      expect(screen.getByText('Request This Ride')).toBeInTheDocument()
    })

    // Click contact button to open confirmation sheet
    await user.click(screen.getByText('Request This Ride'))
    expect(screen.getByTestId('confirm-sheet')).toBeInTheDocument()

    // Setup the request mock AFTER board loads
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url === '/api/schedule/request' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ride_id: 'ride-new-001' }),
        })
      }
      if (typeof url === 'string' && url.startsWith('/api/schedule/board')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ rides: [DRIVER_RIDE, RIDER_RIDE] }),
        })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    })

    // Select flexible mode so button is enabled
    await user.click(screen.getByTestId('mode-flexible'))

    // Click "Send Request" in the confirmation sheet
    await user.click(screen.getByTestId('confirm-send-button'))

    // Should show success message (not waiting state)
    await waitFor(() => {
      expect(screen.getByTestId('success-message')).toBeInTheDocument()
    })
  })

  it('shows error when request fails', async () => {
    const user = userEvent.setup()
    setupBoardFetch()
    render(<RideBoard />)

    await waitFor(() => {
      expect(screen.getByText('Request This Ride')).toBeInTheDocument()
    })

    // Open confirmation sheet
    await user.click(screen.getByText('Request This Ride'))

    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url === '/api/schedule/request' && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: { message: 'Schedule not found' } }),
        })
      }
      if (typeof url === 'string' && url.startsWith('/api/schedule/board')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ rides: [DRIVER_RIDE, RIDER_RIDE] }),
        })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    })

    // Select flexible mode so button is enabled
    await user.click(screen.getByTestId('mode-flexible'))

    // Click "Send Request"
    await user.click(screen.getByTestId('confirm-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-error')).toHaveTextContent('Schedule not found')
    })
  })

  it('passes user location in board fetch for relevance sorting', async () => {
    setupBoardFetch()
    render(<RideBoard />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    // Check that the board fetch included lat/lng params
    const boardCall = mockFetch.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).startsWith('/api/schedule/board'),
    )
    expect(boardCall).toBeDefined()
    const url = boardCall?.[0] as string
    expect(url).toContain('lat=38.54')
    expect(url).toContain('lng=-121.76')
  })

  // ── Search filtering tests ─────────────────────────────────────────────

  it('filters rides by destination when typing in search bar', async () => {
    const user = userEvent.setup()
    setupBoardFetch()
    render(<RideBoard />)

    await waitFor(() => {
      expect(screen.getAllByTestId('ride-card')).toHaveLength(2)
    })

    // Type "San Francisco" — only the driver ride matches
    await user.type(screen.getByTestId('board-search-input'), 'San Francisco')

    expect(screen.getAllByTestId('ride-card')).toHaveLength(1)
    expect(screen.getByText('Ahmed')).toBeInTheDocument()
  })

  it('shows search-aware empty state when no rides match', async () => {
    const user = userEvent.setup()
    setupBoardFetch()
    render(<RideBoard />)

    await waitFor(() => {
      expect(screen.getAllByTestId('ride-card')).toHaveLength(2)
    })

    await user.type(screen.getByTestId('board-search-input'), 'Sacramento')

    expect(screen.queryByTestId('ride-card')).not.toBeInTheDocument()
    expect(screen.getByText(/No rides matching "Sacramento"/)).toBeInTheDocument()
  })

  it('clears search and shows all rides when clear button is clicked', async () => {
    const user = userEvent.setup()
    setupBoardFetch()
    render(<RideBoard />)

    await waitFor(() => {
      expect(screen.getAllByTestId('ride-card')).toHaveLength(2)
    })

    await user.type(screen.getByTestId('board-search-input'), 'San Francisco')
    expect(screen.getAllByTestId('ride-card')).toHaveLength(1)

    await user.click(screen.getByTestId('board-search-clear'))
    expect(screen.getAllByTestId('ride-card')).toHaveLength(2)
  })

  it('renders the Post Ride FAB', async () => {
    setupBoardFetch()
    render(<RideBoard />)
    expect(screen.getByTestId('post-ride-fab')).toBeInTheDocument()
  })

  it('renders the search bar', async () => {
    setupBoardFetch()
    render(<RideBoard />)
    expect(screen.getByTestId('board-search-input')).toBeInTheDocument()
  })
})
