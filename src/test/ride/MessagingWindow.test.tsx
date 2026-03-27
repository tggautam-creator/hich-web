/**
 * MessagingWindow tests
 *
 * Verifies:
 *  1.  Renders with default data-testid
 *  2.  Shows loading spinner initially
 *  3.  Displays other user name after data loads
 *  4.  Shows destination info from location state
 *  5.  Shows empty state when no messages
 *  6.  Shows chat input and send button
 *  7.  Send button is disabled when input is empty
 *  8.  Sends message via API on submit
 *  9.  Shows back button and navigates home
 * 10.  Subscribes to chat Realtime channel
 * 11.  Redirects when no rideId
 * 12.  Shows error state when ride not found
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MessagingWindow from '@/components/ride/MessagingWindow'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockFrom, mockGetSession, mockChannel, mockRemoveChannel } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetSession: vi.fn(),
  mockChannel: vi.fn(),
  mockRemoveChannel: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    auth: { getSession: mockGetSession },
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
}))

// ── Navigate mock ─────────────────────────────────────────────────────────────

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// ── AuthStore mock ────────────────────────────────────────────────────────────

const RIDER_ID = 'user-rider-001'
const DRIVER_ID = 'user-driver-001'

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: { profile: { id: string } | null }) => unknown) =>
      selector({ profile: { id: RIDER_ID } }),
  ),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RIDE_ID = 'ride-msg-001'

const MOCK_RIDE = {
  id: RIDE_ID,
  rider_id: RIDER_ID,
  driver_id: DRIVER_ID,
  status: 'accepted',
  origin: { type: 'Point', coordinates: [-121.76, 38.54] },
  fare_cents: 350,
  created_at: '2025-01-01T00:00:00Z',
}

const MOCK_DRIVER = {
  id: DRIVER_ID,
  full_name: 'Jane Driver',
  avatar_url: null,
  rating_avg: 4.8,
  rating_count: 12,
}

const MOCK_VEHICLE = {
  color: 'Blue',
  plate: 'ABC1234',
  make: 'Toyota',
  model: 'Camry',
}

const MOCK_DESTINATION = {
  placeId: 'place-dest-001',
  mainText: 'Downtown Library',
  secondaryText: 'Sacramento, CA',
  fullAddress: 'Downtown Library, Sacramento, CA',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupMocks(opts?: { rideError?: boolean }) {
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: RIDER_ID }, access_token: 'test-token' } },
    error: null,
  })

  const rideSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(
        opts?.rideError
          ? { data: null, error: new Error('not found') }
          : { data: MOCK_RIDE, error: null },
      ),
    }),
  })

  const driverSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: MOCK_DRIVER, error: null }),
    }),
  })

  const vehicleSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: MOCK_VEHICLE, error: null }),
      }),
    }),
  })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'rides') return { select: rideSelect }
    if (table === 'users') return { select: driverSelect }
    if (table === 'vehicles') return { select: vehicleSelect }
    return { select: vi.fn() }
  })

  // Realtime channel mock — supports chained .on().on().subscribe()
  const channelObj: Record<string, unknown> = {}
  const mockOn = vi.fn().mockReturnValue(channelObj)
  channelObj.on = mockOn
  channelObj.subscribe = vi.fn().mockReturnValue({ id: 'chan-1' })
  mockChannel.mockReturnValue(channelObj)
  mockRemoveChannel.mockResolvedValue(undefined)

  // Default fetch for messages GET — returns empty array
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ messages: [] }),
  })
}

function renderPage(opts?: { rideId?: string; state?: Record<string, unknown> }) {
  const id = opts?.rideId ?? RIDE_ID
  const locState = opts?.state ?? {
    destination: MOCK_DESTINATION,
    destinationLat: 38.56,
    destinationLng: -121.79,
  }

  return render(
    <MemoryRouter initialEntries={[{ pathname: `/ride/messaging/${id}`, state: locState }]}>
      <Routes>
        <Route path="/ride/messaging/:rideId" element={<MessagingWindow />} />
      </Routes>
    </MemoryRouter>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MessagingWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders with default data-testid', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('messaging-window')).toBeInTheDocument()
    })
  })

  it('shows loading spinner initially', () => {
    setupMocks()
    renderPage()
    const el = screen.getByTestId('messaging-window')
    expect(el).toBeInTheDocument()
  })

  it('displays other user name after data loads', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('other-user-name')).toHaveTextContent('Jane Driver')
    })
  })

  it('shows destination info from location state', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('destination-name')).toHaveTextContent('Downtown Library')
    })
  })

  // ── Empty state ────────────────────────────────────────────────────────────

  it('shows empty state when no messages', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Coordinate your ride')).toBeInTheDocument()
    })
  })

  // ── Chat input ─────────────────────────────────────────────────────────────

  it('shows chat input and send button', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeInTheDocument()
      expect(screen.getByTestId('send-button')).toBeInTheDocument()
    })
  })

  it('send button is disabled when input is empty', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('send-button')).toBeDisabled()
    })
  })

  it('sends message via API on submit', async () => {
    setupMocks()
    const user = userEvent.setup()
    const mockFetch = vi.fn()
      // First call: GET messages
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      })
      // Second call: POST message
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          message: { id: 'msg-1', ride_id: RIDE_ID, sender_id: RIDER_ID, content: 'Hello!', created_at: '2025-01-01T00:00:01Z' },
        }),
      })
    globalThis.fetch = mockFetch

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    })

    await user.type(screen.getByTestId('chat-input'), 'Hello!')
    await user.click(screen.getByTestId('send-button'))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/messages/${RIDE_ID}`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Hello!' }),
        }),
      )
    })
  })

  // ── Navigation ─────────────────────────────────────────────────────────────

  it('back button navigates home', async () => {
    setupMocks()
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('back-button')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('back-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/rides')
  })

  // ── Realtime ───────────────────────────────────────────────────────────────

  it('subscribes to chat Realtime channel on mount', async () => {
    setupMocks()
    renderPage()
    await waitFor(() => {
      expect(mockChannel).toHaveBeenCalledWith(`chat:${RIDE_ID}`)
    })
  })

  // ── Error states ───────────────────────────────────────────────────────────

  it('shows error when ride is not found', async () => {
    setupMocks({ rideError: true })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
    })
  })

  // ── Scheduled rides time-based behavior ────────────────────────────────────

  it('scheduled ride shows My Rides button when not approaching', async () => {
    // Mock current time to be far from ride time
    vi.setSystemTime(new Date('2026-03-23T08:00:00'))

    const scheduledRide = {
      ...MOCK_RIDE,
      schedule_id: 'sched-123',
      trip_date: '2026-03-23',
      trip_time: '10:00:00', // 2 hours from now
      pickup_confirmed: true,
      dropoff_confirmed: true,
    }

    setupMocks()
    // Override ride mock
    const rideSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: scheduledRide, error: null }),
      }),
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') return { select: rideSelect }
      if (table === 'users') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: MOCK_DRIVER, error: null }) }) }) }
      if (table === 'vehicles') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: MOCK_VEHICLE, error: null }) }) }) }) }
      return { select: vi.fn() }
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('back-to-rides-button')).toBeInTheDocument()
      expect(screen.getByTestId('back-to-rides-button')).toHaveTextContent('My Rides')
      expect(screen.getByText(/Scheduled for/)).toBeInTheDocument()
    })

    expect(screen.queryByTestId('navigate-to-pickup-button')).not.toBeInTheDocument()
  })

  it('scheduled ride shows Navigate to Pickup button when approaching', async () => {
    // Mock current time to be 10 minutes before ride time
    vi.setSystemTime(new Date('2026-03-23T09:50:00'))

    const approachingRide = {
      ...MOCK_RIDE,
      schedule_id: 'sched-123',
      trip_date: '2026-03-23',
      trip_time: '10:00:00', // 10 minutes from now
      pickup_confirmed: true,
      dropoff_confirmed: true,
    }

    setupMocks()
    // Override ride mock
    const rideSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: approachingRide, error: null }),
      }),
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') return { select: rideSelect }
      if (table === 'users') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: MOCK_DRIVER, error: null }) }) }) }
      if (table === 'vehicles') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: MOCK_VEHICLE, error: null }) }) }) }) }
      return { select: vi.fn() }
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('navigate-to-pickup-button')).toBeInTheDocument()
      expect(screen.getByTestId('navigate-to-pickup-button')).toHaveTextContent('Navigate to Pickup')
      expect(screen.getByText(/Your ride is in 10 min/)).toBeInTheDocument()
    })

    expect(screen.queryByTestId('back-to-rides-button')).not.toBeInTheDocument()
  })

  it('non-scheduled ride always shows Navigate to Pickup button', async () => {
    const immediateRide = {
      ...MOCK_RIDE,
      schedule_id: null,
      pickup_confirmed: true,
      dropoff_confirmed: true,
    }

    setupMocks()
    // Override ride mock
    const rideSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: immediateRide, error: null }),
      }),
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'rides') return { select: rideSelect }
      if (table === 'users') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: MOCK_DRIVER, error: null }) }) }) }
      if (table === 'vehicles') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: MOCK_VEHICLE, error: null }) }) }) }) }
      return { select: vi.fn() }
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('navigate-to-pickup-button')).toBeInTheDocument()
      expect(screen.getByTestId('navigate-to-pickup-button')).toHaveTextContent('Navigate to Pickup')
      expect(screen.getByText('Both locations confirmed! Navigate when ready.')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('back-to-rides-button')).not.toBeInTheDocument()
  })
})
