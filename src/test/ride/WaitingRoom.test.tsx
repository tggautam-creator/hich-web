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
 *  9.  Subscribes to Realtime channel on mount
 * 10.  Navigates to /ride/messaging/:rideId when status changes to accepted
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
  },
}))

// ── Navigate mock ─────────────────────────────────────────────────────────────

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEST: PlaceSuggestion = {
  placeId: 'place-001',
  mainText: 'SFO Airport',
  secondaryText: 'San Francisco, CA',
  fullAddress: 'San Francisco International Airport',
}

const FARE_RANGE: FareRange = {
  low:  { fare_cents: 300, platform_fee_cents: 45, driver_earns_cents: 255 },
  high: { fare_cents: 400, platform_fee_cents: 60, driver_earns_cents: 340 },
}

const FARE_SINGLE: FareRange = {
  low:  { fare_cents: 350, platform_fee_cents: 53, driver_earns_cents: 297 },
  high: { fare_cents: 350, platform_fee_cents: 53, driver_earns_cents: 297 },
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

  it('cancel button updates ride to cancelled and navigates home', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTestId('cancel-button'))

    expect(mockUpdate).toHaveBeenCalledWith({ status: 'cancelled' })
    expect(mockEq).toHaveBeenCalledWith('id', RIDE_ID)
    expect(mockNavigate).toHaveBeenCalledWith('/home/rider', { replace: true })
  })

  // ── Redirect ───────────────────────────────────────────────────────────────

  it('redirects to /home/rider when no rideId in state', () => {
    renderPage({ destination: DEST, fareRange: FARE_RANGE })
    expect(mockNavigate).toHaveBeenCalledWith('/home/rider', { replace: true })
  })

  // ── Realtime subscription ──────────────────────────────────────────────────

  it('subscribes to Supabase Realtime channel on mount', () => {
    renderPage()
    expect(mockChannel).toHaveBeenCalledWith(`ride-status-${RIDE_ID}`)
    expect(mockOn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'UPDATE',
        table: 'rides',
        filter: `id=eq.${RIDE_ID}`,
      }),
      expect.any(Function),
    )
    expect(mockSubscribe).toHaveBeenCalled()
  })

  it('navigates to messaging window when ride status changes to accepted', () => {
    renderPage()

    act(() => {
      realtimeCallback?.({ new: { status: 'accepted' } })
    })

    expect(mockNavigate).toHaveBeenCalledWith(`/ride/messaging/${RIDE_ID}`, { replace: true })
  })

  it('removes channel on unmount', () => {
    const { unmount } = renderPage()
    unmount()
    expect(mockRemoveChannel).toHaveBeenCalled()
  })
})
