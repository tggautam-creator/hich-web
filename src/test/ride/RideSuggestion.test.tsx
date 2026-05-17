/**
 * RideSuggestion tests
 *
 * Verifies:
 *  1. Shows loading spinner while fetching
 *  2. Displays rider name
 *  3. Displays rider rating
 *  4. Shows countdown text
 *  5. Accept button is disabled until destination is selected
 *  6. Decline button navigates to driver home without cancelling ride
 *  7. Auto-declines after 150 seconds
 *  8. Shows error state when ride fetch fails
 *  9. Shows destination input with explanation
 * 10. Shows standby screen immediately when driver already has a standby offer
 * 11. Shows standby screen immediately when driver has a pending offer with destination (renewal case)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RideSuggestion from '@/components/ride/RideSuggestion'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockSingle, mockUpdate, mockUpdateEq, mockGetSession, mockMaybySingle } = vi.hoisted(() => ({
  mockSingle: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateEq: vi.fn(),
  mockGetSession: vi.fn(),
  mockMaybySingle: vi.fn(),
}))

const RIDER = {
  id: 'rider-456',
  full_name: 'Jane Doe',
  avatar_url: null,
  rating_avg: 4.8,
  rating_count: 12,
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'rides') {
        return {
          select: () => ({
            eq: () => ({
              single: mockSingle,
            }),
          }),
          update: (data: Record<string, unknown>) => {
            mockUpdate(data)
            return { eq: mockUpdateEq }
          },
        }
      }
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: RIDER, error: null }),
            }),
          }),
        }
      }
      if (table === 'driver_routines') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'ride_offers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: mockMaybySingle,
              }),
            }),
          }),
        }
      }
      return {}
    },
    auth: {
      getSession: mockGetSession,
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

// ── FCM mock ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/fcm', () => ({
  onForegroundMessage: () => null,
}))

// ── Google Maps mock ──────────────────────────────────────────────────────────
vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({ children, ...props }: Record<string, unknown>) => <div data-testid="google-map" {...props}>{children as React.ReactNode}</div>,
  AdvancedMarker: ({ children, ...props }: Record<string, unknown>) => <div data-testid="map-marker" {...props}>{children as React.ReactNode}</div>,
  useMap: () => null,
}))

// ── Directions mock ───────────────────────────────────────────────────────────
vi.mock('@/lib/directions', () => ({
  getDirectionsByLatLng: vi.fn().mockResolvedValue(null),
}))

// ── Fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()

// ── Helpers ───────────────────────────────────────────────────────────────────

const RIDE = {
  id: 'ride-123',
  rider_id: 'rider-456',
  driver_id: null,
  vehicle_id: null,
  status: 'requested',
  origin: { type: 'Point', coordinates: [-121.74, 38.54] },
  destination: { type: 'Point', coordinates: [-122.42, 37.77] },
  destination_name: 'San Francisco',
  destination_bearing: null,
  pickup_point: null,
  pickup_note: null,
  dropoff_point: null,
  fare_cents: 2500,
  started_at: null,
  ended_at: null,
  created_at: '2026-01-01T00:00:00Z',
}

function setupSuccess(rideOverrides: Record<string, unknown> = {}) {
  mockSingle.mockResolvedValue({ data: { ...RIDE, ...rideOverrides }, error: null })
}

function renderWithRoute(rideId = 'ride-123') {
  return render(
    <MemoryRouter initialEntries={[`/ride/suggestion/${rideId}`]}>
      <Routes>
        <Route path="/ride/suggestion/:rideId" element={<RideSuggestion />} />
        <Route path="/home/driver" element={<div>Driver Home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RideSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token', user: { id: 'driver-123' } } },
    })
    mockUpdateEq.mockResolvedValue({ data: null, error: null })
    // Default: no existing offer → show form normally
    mockMaybySingle.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows loading spinner while fetching', () => {
    mockSingle.mockReturnValue(new Promise(() => undefined))
    renderWithRoute()
    expect(screen.getByTestId('ride-suggestion')).toBeInTheDocument()
  })

  it('displays rider name after loading', async () => {
    setupSuccess()
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('rider-name')).toHaveTextContent('Jane Doe')
    })
  })

  it('displays rider rating', async () => {
    setupSuccess()
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('rider-rating')).toHaveTextContent('4.8')
    })
  })

  it('displays countdown text after load', async () => {
    setupSuccess()
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('countdown-text')).toHaveTextContent('150s')
    })
  })

  it('shows destination input with explanation', async () => {
    setupSuccess()
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('driver-destination-card')).toBeInTheDocument()
      expect(screen.getByTestId('driver-dest-input')).toBeInTheDocument()
    })
  })

  it('Accept button is disabled until destination is selected', async () => {
    setupSuccess()
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('accept-button')).toBeInTheDocument()
    })

    // Without a destination, button should be disabled
    expect(screen.getByTestId('accept-button')).toBeDisabled()
    expect(screen.getByTestId('accept-button')).toHaveTextContent('Enter destination first')
  })

  it('Decline button opens the reason sheet; submitting from "Just decline" navigates home', async () => {
    // Sprint 2 W-T1-D1 — tapping Decline now opens DeclineReasonSheet
    // instead of immediately cancelling. The legacy silent-decline
    // path still exists for the auto-decline countdown (covered by
    // the separate "auto-declines after 150 seconds" test below).
    setupSuccess()
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('decline-button')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('decline-button'))
    })

    // Sheet should be visible; nav should NOT have happened yet
    expect(screen.getByTestId('decline-reason-sheet')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalledWith('/home/driver', expect.anything())

    // Tap "Just decline" — no reason, no snooze. Should navigate.
    await act(async () => {
      fireEvent.click(screen.getByTestId('decline-skip'))
    })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/home/driver', { replace: true })
  })

  it('auto-declines after 150 seconds', async () => {
    vi.useFakeTimers()
    setupSuccess()
    renderWithRoute()

    // Flush the async fetch calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(screen.getByTestId('countdown-text')).toBeInTheDocument()

    // Advance past the 150s countdown
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150_000)
    })

    // Auto-decline should also not cancel the ride, just navigate away
    expect(mockNavigate).toHaveBeenCalledWith('/home/driver', { replace: true })
  })

  it('shows error when ride fetch fails', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('Could not load ride details')
    })
  })

  it('shows standby screen immediately when driver already has a standby offer', async () => {
    setupSuccess()
    // Simulate driver already being on standby (rider selected another driver)
    mockMaybySingle.mockResolvedValue({
      data: { status: 'standby', driver_destination: { type: 'Point', coordinates: [-121.9, 38.5] } },
      error: null,
    })
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('standby-home-button')).toBeInTheDocument()
    })
    // Form should not be shown
    expect(screen.queryByTestId('driver-destination-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('accept-button')).not.toBeInTheDocument()
  })

  it('shows standby screen immediately when driver has a pending offer with destination set (renewal case)', async () => {
    setupSuccess()
    // Simulate renewal: offer reverted from standby → pending, destination already submitted
    mockMaybySingle.mockResolvedValue({
      data: { status: 'pending', driver_destination: { type: 'Point', coordinates: [-121.9, 38.5] } },
      error: null,
    })
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('standby-home-button')).toBeInTheDocument()
    })
    // Form and accept button should not be shown
    expect(screen.queryByTestId('driver-destination-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('accept-button')).not.toBeInTheDocument()
    // Renewal message should be shown
    expect(screen.getByText(/previous driver cancelled.*Your offer is active/i)).toBeInTheDocument()
  })
})
