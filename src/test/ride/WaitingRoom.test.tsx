/**
 * WaitingRoom tests
 *
 * Verifies:
 *  1.  Renders with default data-testid
 *  2.  Shows "Finding you a driver…" status text
 *  3.  Displays destination name
 *  4.  Displays fare range
 *  5.  Displays single fare when range collapses
 *  6.  Cancel button present
 *  7.  Cancel updates ride to cancelled and navigates home
 *  8.  Redirects to /home/rider when no rideId in state
 *  9.  Subscribes to Realtime broadcast channel on mount
 * 10.  Navigates to /ride/messaging/:rideId when ride_accepted broadcast received
 * 11.  Unsubscribes from channel on unmount
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import WaitingRoom from '@/components/ride/WaitingRoom'
import type { FareRange } from '@/lib/fare'
import type { PlaceSuggestion } from '@/lib/places'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockChannel, mockOn, mockSubscribe, mockRemoveChannel, mockUpdate, mockEq } = vi.hoisted(() => ({
  mockChannel:       vi.fn(),
  mockOn:            vi.fn(),
  mockSubscribe:     vi.fn(),
  mockRemoveChannel: vi.fn(),
  mockUpdate:        vi.fn(),
  mockEq:            vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
    from: () => ({ update: mockUpdate }),
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
}))

// ── Navigate mock ─────────────────────────────────────────────────────────────

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// ── AuthStore mock ────────────────────────────────────────────────────────────

const PROFILE_ID = 'user-rider-001'

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: { profile: { id: string } | null }) => unknown) =>
      selector({ profile: { id: PROFILE_ID } }),
  ),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEST: PlaceSuggestion = {
  placeId: 'place-001',
  mainText: 'SFO Airport',
  secondaryText: 'San Francisco, CA',
  fullAddress: 'San Francisco International Airport',
}

const FARE_RANGE: FareRange = {
  low:  { fare_cents: 300, platform_fee_cents: 45, driver_earns_cents: 255, base_cents: 100, gas_cost_cents: 87, time_cost_cents: 75, distance_km: 10, distance_miles: 6.2, duration_min: 15, mpg: 25, gas_price_per_gallon: 3.50 },
  high: { fare_cents: 400, platform_fee_cents: 60, driver_earns_cents: 340, base_cents: 100, gas_cost_cents: 150, time_cost_cents: 100, distance_km: 15, distance_miles: 9.3, duration_min: 20, mpg: 25, gas_price_per_gallon: 3.50 },
}

const FARE_SINGLE: FareRange = {
  low:  { fare_cents: 350, platform_fee_cents: 53, driver_earns_cents: 297, base_cents: 100, gas_cost_cents: 120, time_cost_cents: 90, distance_km: 12, distance_miles: 7.5, duration_min: 18, mpg: 25, gas_price_per_gallon: 3.50 },
  high: { fare_cents: 350, platform_fee_cents: 53, driver_earns_cents: 297, base_cents: 100, gas_cost_cents: 120, time_cost_cents: 90, distance_km: 12, distance_miles: 7.5, duration_min: 18, mpg: 25, gas_price_per_gallon: 3.50 },
}

const RIDE_ID = 'ride-abc-123'

// ── Helpers ───────────────────────────────────────────────────────────────────

let realtimeCallback: ((payload: Record<string, unknown>) => void) | null = null

function setupMocks() {
  realtimeCallback = null

  mockOn.mockImplementation((_event: string, _opts: unknown, cb: (payload: Record<string, unknown>) => void) => {
    realtimeCallback = cb
    return { subscribe: mockSubscribe }
  })
  mockSubscribe.mockReturnValue({ id: 'chan-1' })
  mockChannel.mockReturnValue({ on: mockOn })
  mockRemoveChannel.mockResolvedValue(undefined)
  mockEq.mockResolvedValue({ data: null, error: null })
  mockUpdate.mockReturnValue({ eq: mockEq })
}

function renderPage(state?: Record<string, unknown>) {
  const locState = state ?? { destination: DEST, fareRange: FARE_RANGE, rideId: RIDE_ID }
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/ride/waiting', state: locState }]}>
      <WaitingRoom />
    </MemoryRouter>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WaitingRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders with default data-testid', () => {
    renderPage()
    expect(screen.getByTestId('waiting-room-page')).toBeInTheDocument()
  })

  it('shows "Finding you a driver…" status text', () => {
    renderPage()
    expect(screen.getByTestId('status-text')).toHaveTextContent('Finding you a driver')
  })

  it('displays the destination name', () => {
    renderPage()
    expect(screen.getByTestId('destination-name')).toHaveTextContent('SFO Airport')
  })

  it('displays fare range when low and high differ', () => {
    renderPage()
    expect(screen.getByTestId('fare-display')).toHaveTextContent('$3.00–$4.00')
  })

  it('displays single fare when range collapses', () => {
    renderPage({ destination: DEST, fareRange: FARE_SINGLE, rideId: RIDE_ID })
    expect(screen.getByTestId('fare-display')).toHaveTextContent('$3.50')
  })

  // ── Cancel ─────────────────────────────────────────────────────────────────

  it('shows cancel button', () => {
    renderPage()
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument()
  })

  it('cancel button calls API and navigates home', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('cancel-button'))

    expect(fetchSpy).toHaveBeenCalledWith(`/api/rides/${RIDE_ID}/cancel`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(mockNavigate).toHaveBeenCalledWith('/home/rider', { replace: true })
    fetchSpy.mockRestore()
  })

  // ── Redirect ───────────────────────────────────────────────────────────────

  it('redirects to /home/rider when no rideId in state', () => {
    renderPage({ destination: DEST, fareRange: FARE_RANGE })
    expect(mockNavigate).toHaveBeenCalledWith('/home/rider', { replace: true })
  })

  // ── Realtime subscription ──────────────────────────────────────────────────

  it('subscribes to Supabase Realtime broadcast channel on mount', () => {
    renderPage()
    expect(mockChannel).toHaveBeenCalledWith(`waiting:${PROFILE_ID}`)
    expect(mockOn).toHaveBeenCalledWith(
      'broadcast',
      { event: 'ride_accepted' },
      expect.any(Function),
    )
    expect(mockSubscribe).toHaveBeenCalled()
  })

  it('navigates to messaging window when ride_accepted broadcast received', async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ride_id: RIDE_ID, status: 'accepted' }), { status: 200 }),
    )
    renderPage()

    act(() => {
      realtimeCallback?.({ payload: { ride_id: RIDE_ID, driver_id: 'driver-001' } })
    })

    // WaitingRoom waits 15s after first acceptance before auto-selecting
    await act(async () => {
      vi.advanceTimersByTime(15000)
    })

    expect(mockNavigate).toHaveBeenCalledWith(
      `/ride/messaging/${RIDE_ID}`,
      expect.objectContaining({ replace: true }),
    )
    fetchSpy.mockRestore()
    vi.useRealTimers()
  })

  it('removes channel on unmount', () => {
    const { unmount } = renderPage()
    unmount()
    expect(mockRemoveChannel).toHaveBeenCalled()
  })
})
