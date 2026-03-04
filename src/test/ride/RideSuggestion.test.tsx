/**
 * RideSuggestion tests
 *
 * Verifies:
 *  1. Shows loading spinner while fetching
 *  2. Displays rider name
 *  3. Displays rider rating
 *  4. Displays total fare and driver earnings
 *  5. Shows countdown text
 *  6. Accept button calls PATCH and navigates to messaging
 *  7. Decline button updates ride and navigates to driver home
 *  8. Auto-declines after 90 seconds
 *  9. Shows error state when ride fetch fails
 * 10. Shows fallback values when fare is null
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RideSuggestion from '@/components/ride/RideSuggestion'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockSingle, mockUpdate, mockUpdateEq, mockGetSession } = vi.hoisted(() => ({
  mockSingle: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateEq: vi.fn(),
  mockGetSession: vi.fn(),
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
      data: { session: { access_token: 'test-token' } },
    })
    mockUpdateEq.mockResolvedValue({ data: null, error: null })
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

  it('displays total fare and driver earnings', async () => {
    setupSuccess()
    renderWithRoute()

    await waitFor(() => {
      // 2500 cents → "$25.00"
      expect(screen.getByTestId('total-fare')).toHaveTextContent('$25.00')
      // 2500 - round(2500 * 0.15) = 2500 - 375 = 2125 → "$21.25"
      expect(screen.getByTestId('driver-earnings')).toHaveTextContent('$21.25')
    })
  })

  it('displays countdown text after load', async () => {
    setupSuccess()
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('countdown-text')).toHaveTextContent('90s to respond')
    })
  })

  it('Accept button calls PATCH and navigates to messaging', async () => {
    setupSuccess()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'accepted' }),
    })
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('accept-button')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('accept-button'))
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/rides/ride-123/accept',
      expect.objectContaining({ method: 'PATCH' }),
    )
    expect(mockNavigate).toHaveBeenCalledWith('/ride/messaging/ride-123', { replace: true })
  })

  it('Decline button updates ride and navigates to driver home', async () => {
    setupSuccess()
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('decline-button')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('decline-button'))
    })

    expect(mockUpdate).toHaveBeenCalledWith({ status: 'cancelled' })
    expect(mockNavigate).toHaveBeenCalledWith('/home/driver', { replace: true })
  })

  it('auto-declines after 90 seconds', async () => {
    vi.useFakeTimers()
    setupSuccess()
    renderWithRoute()

    // Flush the async fetch calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(screen.getByTestId('countdown-text')).toBeInTheDocument()

    // Advance past the 90s countdown
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000)
    })

    expect(mockUpdate).toHaveBeenCalledWith({ status: 'cancelled' })
    expect(mockNavigate).toHaveBeenCalledWith('/home/driver', { replace: true })
  })

  it('shows error when ride fetch fails', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('Could not load ride details')
    })
  })

  it('shows fallback values when fare is null', async () => {
    setupSuccess({ fare_cents: null })
    renderWithRoute()

    await waitFor(() => {
      expect(screen.getByTestId('total-fare')).toHaveTextContent('–')
      expect(screen.getByTestId('driver-earnings')).toHaveTextContent('–')
    })
  })
})
