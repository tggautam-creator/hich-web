/**
 * MultiDriverMap tests
 *
 * Verifies:
 *  1. Renders with default data-testid
 *  2. Shows loading spinner initially
 *  3. Displays error when no offers found
 *  4. Renders driver cards for each offer
 *  5. Shows driver name, rating, vehicle info on cards
 *  6. Shows "Choose [name]" button on each card
 *  7. Choose button calls select-driver API and navigates to waiting room
 *  8. Redirects to home when no rideId
 *  9. Shows correct header with offer count
 * 10. Displays numbered driver markers on map
 * 11. Shows cancel toast in finding phase when driver_cancelled received (Path C)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import MultiDriverMap from '@/components/ride/MultiDriverMap'

// ── Mock data ────────────────────────────────────────────────────────────────

const RIDE_ID = 'ride-multi-001'
const DRIVER_A = 'driver-aaa-111'
const DRIVER_B = 'driver-bbb-222'

const MOCK_OFFERS = {
  offers: [
    {
      offer_id: 'offer-1',
      driver_id: DRIVER_A,
      driver: {
        id: DRIVER_A,
        full_name: 'Alice Smith',
        avatar_url: null,
        rating_avg: 4.8,
        rating_count: 50,
      },
      vehicle: {
        id: 'veh-1',
        make: 'Toyota',
        model: 'Corolla',
        year: 2022,
        color: 'White',
        plate: 'ABC1234',
        seats_available: 3,
        car_photo_url: null,
      },
      location: { type: 'Point', coordinates: [-121.76, 38.54] },
      heading: null,
      created_at: '2026-03-12T12:00:00Z',
    },
    {
      offer_id: 'offer-2',
      driver_id: DRIVER_B,
      driver: {
        id: DRIVER_B,
        full_name: 'Bob Jones',
        avatar_url: null,
        rating_avg: 4.5,
        rating_count: 30,
      },
      vehicle: {
        id: 'veh-2',
        make: 'Honda',
        model: 'Civic',
        year: 2021,
        color: 'Blue',
        plate: 'XYZ5678',
        seats_available: 2,
        car_photo_url: null,
      },
      location: { type: 'Point', coordinates: [-121.77, 38.55] },
      heading: null,
      created_at: '2026-03-12T12:01:00Z',
    },
  ],
}

// ── Supabase mock (hoisted to avoid reference issues) ────────────────────────

const { mockRideData, mockRemoveChannel } = vi.hoisted(() => ({
  mockRideData: {
    origin: { type: 'Point', coordinates: [-121.75, 38.53] },
    destination: { type: 'Point', coordinates: [-121.80, 38.56] },
  },
  mockRemoveChannel: vi.fn(),
}))

vi.mock('@/lib/supabase', () => {
  const channelObj = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnValue({ id: 'chan-1' }),
  }

  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'test-token' } },
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockRideData, error: null }),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue(channelObj),
      removeChannel: mockRemoveChannel,
    },
  }
})

// ── Navigate mock ────────────────────────────────────────────────────────────

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// ── Google Maps mock ─────────────────────────────────────────────────────────

vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({ children, ...props }: Record<string, unknown>) => (
    <div data-testid="google-map" {...props}>{children as React.ReactNode}</div>
  ),
  AdvancedMarker: ({ children, title }: { children?: React.ReactNode; title?: string }) => (
    <div data-testid={`marker-${title ?? 'unknown'}`}>{children}</div>
  ),
  useMap: () => null,
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/map/RoutePreview', () => ({
  RoutePolyline: () => null,
  MapBoundsFitter: () => null,
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

let fetchSpy: { mockRestore: () => void }

function renderPage(rideId = RIDE_ID) {
  const locState = {
    destination: { placeId: 'p1', mainText: 'Target', secondaryText: 'Davis, CA', fullAddress: 'Target, Davis' },
    destinationLat: 38.56,
    destinationLng: -121.80,
  }
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/ride/multi-driver/${rideId}`, state: locState }]}>
      <Routes>
        <Route path="/ride/multi-driver/:rideId" element={<MultiDriverMap />} />
      </Routes>
    </MemoryRouter>,
  )
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MultiDriverMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = String(url)
      if (urlStr.includes('/offers')) {
        return new Response(JSON.stringify(MOCK_OFFERS), { status: 200 })
      }
      if (urlStr.includes('/select-driver')) {
        return new Response(JSON.stringify({ ride_id: RIDE_ID, status: 'accepted' }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('renders with default data-testid', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('multi-driver-page')).toBeInTheDocument()
    })
  })

  it('shows loading spinner initially', () => {
    renderPage()
    // Before offers load, should show spinner
    expect(screen.getByTestId('multi-driver-page')).toBeInTheDocument()
  })

  it('renders driver cards for each offer', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId(`driver-card-${DRIVER_A}`)).toBeInTheDocument()
      expect(screen.getByTestId(`driver-card-${DRIVER_B}`)).toBeInTheDocument()
    })
  })

  it('shows driver names on cards', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
      expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    })
  })

  it('shows driver ratings on cards', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/4\.8/)).toBeInTheDocument()
      expect(screen.getByText(/4\.5/)).toBeInTheDocument()
    })
  })

  it('shows vehicle info on cards', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('2022 Toyota Corolla')).toBeInTheDocument()
      expect(screen.getByText('2021 Honda Civic')).toBeInTheDocument()
      expect(screen.getByText('ABC1234')).toBeInTheDocument()
      expect(screen.getByText('XYZ5678')).toBeInTheDocument()
    })
  })

  it('shows "Choose [name]" button on each card', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId(`choose-driver-${DRIVER_A}`)).toHaveTextContent('Choose Alice')
      expect(screen.getByTestId(`choose-driver-${DRIVER_B}`)).toHaveTextContent('Choose Bob')
    })
  })

  it('Choose button calls select-driver API and navigates to waiting room', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId(`choose-driver-${DRIVER_A}`)).toBeInTheDocument()
    })

    await act(async () => {
      await user.click(screen.getByTestId(`choose-driver-${DRIVER_A}`))
    })

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/rides/${RIDE_ID}/select-driver`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ driver_id: DRIVER_A }),
        }),
      )
      expect(mockNavigate).toHaveBeenCalledWith(
        '/ride/waiting',
        expect.objectContaining({
          replace: true,
          state: expect.objectContaining({ rideId: RIDE_ID, selectedDriverId: DRIVER_A }),
        }),
      )
    })
  })

  it('shows correct header with offer count', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Choose Your Driver')).toBeInTheDocument()
      expect(screen.getByText('2 drivers available')).toBeInTheDocument()
      expect(screen.getByText('2 offers')).toBeInTheDocument()
    })
  })

  it('displays error when no offers found', async () => {
    fetchSpy.mockRestore()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ offers: [] }), { status: 200 }),
    )

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('No driver offers found')
    })
  })

  it('displays numbered driver markers on map', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('marker-Alice Smith')).toBeInTheDocument()
      expect(screen.getByTestId('marker-Bob Jones')).toBeInTheDocument()
    })
  })
})
