/**
 * DropoffSelection tests
 *
 * Verifies:
 *  1. Redirects to driver home if missing location state
 *  2. Shows loading skeleton on mount
 *  3. Calls driver-destination endpoint with correct body
 *  4. Shows "Drop off at rider's destination" option always
 *  5. Displays transit station suggestions after loading
 *  6. Selecting rider's destination navigates to messaging
 *  7. Selecting a station calls suggest-transit-dropoff
 *  8. Shows error with retry on API failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DropoffSelection from '@/components/ride/DropoffSelection'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockGetSession, mockRideSingle, mockOfferMaybeSingle } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRideSingle: vi.fn(),
  mockOfferMaybeSingle: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
    },
    from: (table: string) => {
      if (table === 'rides') {
        return {
          select: () => ({
            eq: () => ({ single: mockRideSingle }),
          }),
        }
      }
      if (table === 'ride_offers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: mockOfferMaybeSingle }),
            }),
          }),
        }
      }
      return {}
    },
  },
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

// ── Google Maps mock ──────────────────────────────────────────────────────────
vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({ children, ...props }: Record<string, unknown>) => <div data-testid="google-map" {...props}>{children as React.ReactNode}</div>,
  AdvancedMarker: ({ children, ...props }: Record<string, unknown>) => <div data-testid="map-marker" {...props}>{children as React.ReactNode}</div>,
  useMap: () => null,
}))

// ── Analytics mock ───────────────────────────────────────────────────────────
vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(),
}))

// ── Fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()

// ── State for routes ──────────────────────────────────────────────────────────

const LOCATION_STATE = {
  driverDestLat: 37.3382,
  driverDestLng: -121.8863,
  driverDestName: 'San Jose, CA',
  riderName: 'Jane Doe',
  riderDestName: 'Stanford University',
  riderDestLat: 37.4275,
  riderDestLng: -122.1697,
  pickupLat: 38.5449,
  pickupLng: -121.7405,
}

const MOCK_SUGGESTIONS = [
  {
    station_name: 'Diridon Station',
    station_lat: 37.3297,
    station_lng: -121.9021,
    station_place_id: 'place-1',
    station_address: '65 Cahill St, San Jose',
    transit_options: [
      { type: 'RAIL', icon: 'Rail', line_name: 'Caltrain', total_minutes: 35, walk_minutes: 5 },
    ],
    ride_with_driver_minutes: 15,
    walk_to_station_minutes: 3,
    driver_detour_minutes: 2,
    transit_to_dest_minutes: 35,
    total_rider_minutes: 53,
    rider_progress_pct: 72,
    transit_polyline: null,
  },
]

function renderWithState(state: Record<string, unknown> | null = LOCATION_STATE) {
  const entry = state
    ? { pathname: '/ride/dropoff/ride-123', state }
    : '/ride/dropoff/ride-123'
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/ride/dropoff/:rideId" element={<DropoffSelection />} />
        <Route path="/home/driver" element={<div>Driver Home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DropoffSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token', user: { id: 'driver-123' } } },
    })
    // Default: no recovery data — redirect to home for missing-state tests
    mockRideSingle.mockResolvedValue({ data: null, error: null })
    mockOfferMaybeSingle.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('redirects to driver home if missing location state and no DB recovery', async () => {
    // mockRideSingle and mockOfferMaybeSingle return null (set in beforeEach)
    renderWithState(null)
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/home/driver', { replace: true })
    })
  })

  it('shows loading skeleton on mount', () => {
    mockFetch.mockReturnValue(new Promise(() => undefined))
    renderWithState()

    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument()
  })

  it('always shows "Drop off at rider\'s destination" option', () => {
    mockFetch.mockReturnValue(new Promise(() => undefined))
    renderWithState()

    expect(screen.getByTestId('rider-dest-option')).toBeInTheDocument()
    expect(screen.getByTestId('rider-dest-option')).toHaveTextContent('Stanford University')
  })

  it('calls driver-destination endpoint with correct body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [], polyline: null }),
    })
    renderWithState()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/rides/ride-123/driver-destination',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            destination_lat: 37.3382,
            destination_lng: -121.8863,
            destination_name: 'San Jose, CA',
          }),
        }),
      )
    })
  })

  it('displays transit station suggestions after loading', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: MOCK_SUGGESTIONS, polyline: 'abc123' }),
    })
    renderWithState()

    await waitFor(() => {
      expect(screen.getByText('Diridon Station')).toBeInTheDocument()
      expect(screen.getByText('72% of the way')).toBeInTheDocument()
    })
  })

  it('selecting rider\'s destination opens confirmation modal', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: MOCK_SUGGESTIONS, polyline: null }),
    })
    renderWithState()

    await waitFor(() => {
      expect(screen.getByTestId('rider-dest-option')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('rider-dest-option'))

    // Should show confirmation modal with confirm button, not navigate immediately
    await waitFor(() => {
      expect(screen.getByText('Confirm Dropoff')).toBeInTheDocument()
      expect(screen.getByText('Go Back')).toBeInTheDocument()
    })
  })

  it('selecting a station calls suggest-transit-dropoff', async () => {
    // First call: driver-destination, second: suggest-transit-dropoff
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ suggestions: MOCK_SUGGESTIONS, polyline: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ride_id: 'ride-123' }),
      })
    renderWithState()

    await waitFor(() => {
      expect(screen.getByText('Diridon Station')).toBeInTheDocument()
    })

    // First click selects the card (auto-selected as idx=0), second click confirms
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('transit-station-option')[0])
    })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/rides/ride-123/suggest-transit-dropoff',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('shows error with retry on API failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'Maps API key not configured' } }),
    })
    renderWithState()

    await waitFor(() => {
      expect(screen.getByTestId('dropoff-error')).toBeInTheDocument()
      expect(screen.getByText('Maps API key not configured')).toBeInTheDocument()
    })
  })

  it('shows no-suggestions message when API returns empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [], polyline: null }),
    })
    renderWithState()

    await waitFor(() => {
      expect(screen.getByTestId('no-suggestions')).toBeInTheDocument()
    })
  })
})
