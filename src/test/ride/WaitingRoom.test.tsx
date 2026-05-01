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
 *  7.  Cancel calls API and navigates to confirm page with state preserved
 *  8.  Redirects to /home/rider when no rideId in state
 *  9.  Subscribes to Realtime broadcast channel on mount
 * 10.  Shows driver choosing dropoff state when ride_accepted broadcast received
 * 11.  Unsubscribes from channel on unmount
 * 12.  Shows cancel toast when driver_cancelled broadcast is received during dropoff phase
 * 13.  Shows cancel toast when driver_cancelled received in finding phase (Path C)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import WaitingRoom from '@/components/ride/WaitingRoom'
import type { FareRange } from '@/lib/fare'
import type { PlaceSuggestion } from '@/lib/places'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockChannel, mockSubscribe, mockRemoveChannel, mockGetSession } = vi.hoisted(() => ({
  mockChannel:       vi.fn(),
  mockSubscribe:     vi.fn(),
  mockRemoveChannel: vi.fn(),
  mockGetSession:    vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
    from: (table: string) => {
      if (table === 'rides') {
        // Two query shapes hit this table:
        //  1. poll status         → select('status, driver_id').eq(id).single()
        //  2. trust-badge count   → select('id', {count}).eq(driver_id).eq(status)
        return {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count === 'exact') {
              return {
                eq: () => ({ eq: () => Promise.resolve({ count: 0, data: null, error: null }) }),
              }
            }
            return {
              eq: () => ({
                single: () => Promise.resolve({ data: { status: 'requested', driver_id: null }, error: null }),
              }),
            }
          },
        }
      }
      if (table === 'ride_offers') {
        return {
          select: () => ({
            eq: (_col: string, _val: string) => ({
              eq: () => Promise.resolve({ data: [], error: null }),
              in: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }
      }
      if (table === 'users') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
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

// ── Google Maps stubs ─────────────────────────────────────────────────────────

vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({ children }: { children?: React.ReactNode }) => <div data-testid="mock-map">{children}</div>,
  AdvancedMarker: () => null,
}))
vi.mock('@/components/map/RoutePreview', () => ({
  RoutePolyline: () => null,
  MapBoundsFitter: () => null,
}))
vi.mock('@/lib/mapConstants', () => ({ MAP_ID: 'test-map-id' }))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEST: PlaceSuggestion = {
  placeId: 'place-001',
  mainText: 'SFO Airport',
  secondaryText: 'San Francisco, CA',
  fullAddress: 'San Francisco International Airport',
}

const FARE_RANGE: FareRange = {
  low:  { fare_cents: 300, platform_fee_cents: 45, driver_earns_cents: 255, gas_cost_cents: 87, time_cost_cents: 75, distance_km: 10, distance_miles: 6.2, duration_min: 15, mpg: 25, gas_price_per_gallon: 3.50 },
  high: { fare_cents: 400, platform_fee_cents: 60, driver_earns_cents: 340, gas_cost_cents: 150, time_cost_cents: 100, distance_km: 15, distance_miles: 9.3, duration_min: 20, mpg: 25, gas_price_per_gallon: 3.50 },
}

const FARE_SINGLE: FareRange = {
  low:  { fare_cents: 350, platform_fee_cents: 53, driver_earns_cents: 297, gas_cost_cents: 120, time_cost_cents: 90, distance_km: 12, distance_miles: 7.5, duration_min: 18, mpg: 25, gas_price_per_gallon: 3.50 },
  high: { fare_cents: 350, platform_fee_cents: 53, driver_earns_cents: 297, gas_cost_cents: 120, time_cost_cents: 90, distance_km: 12, distance_miles: 7.5, duration_min: 18, mpg: 25, gas_price_per_gallon: 3.50 },
}

const RIDE_ID = 'ride-abc-123'

// ── Helpers ───────────────────────────────────────────────────────────────────

type BroadcastCb = (payload: Record<string, unknown>) => void
const waitingHandlers: Record<string, BroadcastCb> = {}
const chatHandlers: Record<string, BroadcastCb> = {}

function setupMocks() {
  for (const key of Object.keys(waitingHandlers)) delete waitingHandlers[key]
  for (const key of Object.keys(chatHandlers)) delete chatHandlers[key]

  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
  })

  let channelCount = 0
  mockChannel.mockImplementation(() => {
    const isWaiting = channelCount === 0
    channelCount++
    const handlers = isWaiting ? waitingHandlers : chatHandlers
    const channelObj: Record<string, unknown> = {
      on: vi.fn().mockImplementation((_event: string, opts: { event: string }, cb: BroadcastCb) => {
        handlers[opts.event] = cb
        return channelObj
      }),
      subscribe: mockSubscribe,
    }
    return channelObj
  })

  mockSubscribe.mockReturnValue({ id: 'chan-1' })
  mockRemoveChannel.mockResolvedValue(undefined)
}

function renderPage(state?: Record<string, unknown>) {
  const locState = state ?? {
    destination: DEST,
    fareRange: FARE_RANGE,
    rideId: RIDE_ID,
    originLat: 37.7749,
    originLng: -122.4194,
    destinationLat: 37.6213,
    destinationLng: -122.3790,
  }
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

  afterEach(() => {
    vi.restoreAllMocks()
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
    renderPage({ destination: DEST, fareRange: FARE_SINGLE, rideId: RIDE_ID, originLat: 37.77, originLng: -122.42, destinationLat: 37.62, destinationLng: -122.38 })
    expect(screen.getByTestId('fare-display')).toHaveTextContent('$3.50')
  })

  // ── Cancel ─────────────────────────────────────────────────────────────────

  it('shows cancel button', () => {
    renderPage()
    expect(screen.getByTestId('cancel-button')).toBeInTheDocument()
  })

  it('cancel button calls API and navigates to /home/rider', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('cancel-button'))

    // Allow the async handleCancel to complete
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(`/api/rides/${RIDE_ID}/cancel`),
      expect.objectContaining({ method: 'PATCH' }),
    )
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
    expect(mockSubscribe).toHaveBeenCalled()
  })

  it('shows driver choosing dropoff state when ride_accepted broadcast received and auto-selected', async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ride_id: RIDE_ID, status: 'accepted', driver_name: 'Jane' }), { status: 200 }),
    )
    renderPage()

    // Simulate ride_accepted broadcast
    act(() => {
      waitingHandlers['ride_accepted']?.({
        payload: { ride_id: RIDE_ID, driver_id: 'driver-001', driver_name: 'Jane' },
      })
    })

    // WaitingRoom waits 15s after first acceptance before auto-selecting
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    // Flush multiple microtask cycles to allow:
    // 1. getSession to resolve
    // 2. fetch to be called
    // 3. response.json() to resolve
    // 4. setPhase to be called
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }

    expect(screen.getByTestId('driver-choosing-dropoff')).toBeInTheDocument()
    expect(screen.getByTestId('driver-choosing-dropoff')).toHaveTextContent('Jane')
    fetchSpy.mockRestore()
    vi.useRealTimers()
  })

  it('shows cancel toast when driver_cancelled received in dropoff phase', async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ride_id: RIDE_ID, status: 'accepted', driver_name: 'Jane' }), { status: 200 }),
    )
    renderPage()

    // Accept → auto-select → enter dropoff phase
    act(() => {
      waitingHandlers['ride_accepted']?.({
        payload: { ride_id: RIDE_ID, driver_id: 'driver-001', driver_name: 'Jane' },
      })
    })

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }

    expect(screen.getByTestId('driver-choosing-dropoff')).toBeInTheDocument()

    // Now simulate driver cancellation
    act(() => {
      waitingHandlers['driver_cancelled']?.({
        payload: { ride_id: RIDE_ID, cancelled_driver_id: 'driver-001', standby_count: 0 },
      })
    })

    // Should be back to finding phase with toast
    expect(screen.getByTestId('status-text')).toHaveTextContent('Finding you a driver')
    expect(screen.getByTestId('cancel-toast')).toBeInTheDocument()

    fetchSpy.mockRestore()
    vi.useRealTimers()
  })

  it('shows cancel toast when driver_cancelled received in finding phase (Path C)', () => {
    renderPage()

    // Simulate driver cancellation while still in 'finding' phase (before any auto-select)
    act(() => {
      waitingHandlers['driver_cancelled']?.({
        payload: { ride_id: RIDE_ID, cancelled_driver_id: 'driver-001', standby_count: 0 },
      })
    })

    // Should stay in finding phase and show a toast
    expect(screen.getByTestId('status-text')).toHaveTextContent('Finding you a driver')
    expect(screen.getByTestId('cancel-toast')).toHaveTextContent('A driver cancelled')
  })

  it('removes channel on unmount', () => {
    const { unmount } = renderPage()
    unmount()
    expect(mockRemoveChannel).toHaveBeenCalled()
  })
})
