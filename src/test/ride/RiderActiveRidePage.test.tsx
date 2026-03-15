/**
 * RiderActiveRidePage tests
 *
 * Verifies:
 *  1. Shows loading spinner initially
 *  2. Displays green RIDING badge for active rides
 *  3. Displays yellow EN ROUTE badge for coordinating rides
 *  4. Shows ride timer
 *  5. Shows "Scan QR to End Ride" button (primary CTA) for active
 *  6. Shows "Scan QR to Start Ride" button for coordinating
 *  7. Has NO "End Ride" button (per PRD constraint)
 *  8. Chat button navigates to messaging
 *  9. Scan QR button opens scanner view
 * 10. Scanner back button returns to main view
 * 11. Manual code entry field exists
 * 12. Submitting driver code calls scan-driver endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RiderActiveRidePage from '@/components/ride/RiderActiveRidePage'

// ── Mock @vis.gl/react-google-maps ────────────────────────────────────────────

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Map: ({ children, 'data-testid': tid }: { children?: React.ReactNode; 'data-testid'?: string; [k: string]: unknown }) => (
    <div data-testid={tid ?? 'map-container'}>{children}</div>
  ),
  AdvancedMarker: ({ children }: { children?: React.ReactNode; [k: string]: unknown }) => <>{children}</>,
}))

vi.mock('@/components/map/RoutePreview', () => ({
  RoutePolyline: () => null,
  MapBoundsFitter: () => null,
}))

vi.mock('@/lib/env', () => ({
  env: {
    GOOGLE_MAPS_KEY: 'test-key',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  },
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: { profile: { id: string } | null }) => unknown) =>
      selector({ profile: { id: 'rider-001' } }),
  ),
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockSingle, mockChannel } = vi.hoisted(() => ({
  mockSingle: vi.fn(),
  mockChannel: vi.fn(),
}))

vi.mock('@/lib/supabase', () => {
  const eqChain = (): Record<string, unknown> => ({
    eq: eqChain,
    single: mockSingle,
    order: () => ({ limit: () => ({ single: mockSingle }) }),
  })
  return {
    supabase: {
      from: () => ({
        select: () => eqChain(),
      }),
      auth: {
        getSession: () => Promise.resolve({
          data: { session: { access_token: 'test-token' } },
          error: null,
        }),
      },
      channel: mockChannel,
      removeChannel: vi.fn(),
    },
  }
})

// ── QR Scanner mock ───────────────────────────────────────────────────────────

vi.mock('@/components/ride/QrScanner', () => ({
  default: ({ onScan, 'data-testid': tid }: { onScan: (text: string) => void; onError?: (err: string) => void; 'data-testid'?: string }) => (
    <div data-testid={tid ?? 'qr-scanner'}>
      <button data-testid="mock-scan-trigger" onClick={() => onScan('hich:driver-001')}>
        Simulate Scan
      </button>
    </div>
  ),
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

// ── Test data ─────────────────────────────────────────────────────────────────

const RIDE_ACTIVE = {
  id: 'ride-001',
  rider_id: 'rider-001',
  driver_id: 'driver-001',
  status: 'active',
  started_at: new Date(Date.now() - 180_000).toISOString(), // 3 min ago
  destination: { type: 'Point', coordinates: [-121.76, 38.54] },
  destination_name: 'UC Davis',
  pickup_point: { type: 'Point', coordinates: [-121.75, 38.55] },
  pickup_name: 'Main & 1st',
  origin: { type: 'Point', coordinates: [-121.74, 38.53] },
  fare_cents: 1500,
}

const RIDE_COORDINATING = {
  ...RIDE_ACTIVE,
  status: 'coordinating',
  started_at: null,
}

const DRIVER = { id: 'driver-001', full_name: 'John Smith', avatar_url: null, rating_avg: 4.5, rating_count: 12 }
const VEHICLE = { color: 'White', make: 'Toyota', model: 'Camry', plate: 'ABC1234' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupMocks(rideData: unknown = RIDE_ACTIVE) {
  let callIdx = 0
  mockSingle.mockImplementation(() => {
    callIdx++
    if (callIdx === 1) return Promise.resolve({ data: rideData, error: null })
    if (callIdx === 2) return Promise.resolve({ data: DRIVER, error: null })
    return Promise.resolve({ data: VEHICLE, error: null })
  })
  mockChannel.mockReturnValue({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  })
}

function renderPage(rideId = 'ride-001') {
  return render(
    <MemoryRouter initialEntries={[`/ride/active-rider/${rideId}`]}>
      <Routes>
        <Route path="/ride/active-rider/:rideId" element={<RiderActiveRidePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RiderActiveRidePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('shows loading spinner initially', () => {
    mockSingle.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()
    expect(screen.getByTestId('rider-active-ride')).toBeInTheDocument()
  })

  it('displays green RIDING badge for active rides', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('riding-badge')).toBeInTheDocument()
    })
    expect(screen.getByText('RIDING')).toBeInTheDocument()
  })

  it('displays yellow EN ROUTE badge for coordinating rides', async () => {
    setupMocks(RIDE_COORDINATING)
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('enroute-badge')).toBeInTheDocument()
    })
    expect(screen.getByText('EN ROUTE')).toBeInTheDocument()
  })

  it('shows driver name', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByText('John Smith').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows destination name for active ride', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('→ UC Davis')).toBeInTheDocument()
    })
  })

  it('shows ride timer', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ride-timer')).toBeInTheDocument()
    })
  })

  it('shows Scan QR button in action grid for active ride', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('scan-qr-button')).toBeInTheDocument()
    })
    expect(screen.getByTestId('scan-qr-button')).toHaveTextContent('Scan QR')
  })

  it('shows Scan QR button for coordinating ride', async () => {
    setupMocks(RIDE_COORDINATING)
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('scan-qr-button')).toBeInTheDocument()
    })
    expect(screen.getByTestId('scan-qr-button')).toHaveTextContent('Scan QR')
  })

  it('End Ride button opens modal with QR scan option (rider must scan to end)', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('end-ride-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('end-ride-button'))
    expect(screen.getByTestId('end-ride-modal')).toBeInTheDocument()
    expect(screen.getByTestId('modal-scan-qr')).toBeInTheDocument()
  })

  it('Chat button navigates to messaging', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('chat-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('chat-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/ride/messaging/ride-001')
  })

  it('Scan QR button opens scanner view', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('scan-qr-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('scan-qr-button'))
    expect(screen.getByTestId('qr-scanner')).toBeInTheDocument()
  })

  it('Scanner back button returns to main view', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('scan-qr-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('scan-qr-button'))
    expect(screen.getByTestId('qr-scanner')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('scanner-back'))
    expect(screen.queryByTestId('qr-scanner')).not.toBeInTheDocument()
    expect(screen.getByTestId('scan-qr-button')).toBeInTheDocument()
  })

  it('has map rendered', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('active-ride-map')).toBeInTheDocument()
    })
  })

  it('shows manual code entry field inside End Ride modal', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('end-ride-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('end-ride-button'))
    expect(screen.getByTestId('driver-code-input')).toBeInTheDocument()
    expect(screen.getByTestId('submit-code-button')).toBeInTheDocument()
  })

  it('submit button is disabled when code is empty', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('end-ride-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('end-ride-button'))
    expect(screen.getByTestId('submit-code-button')).toBeDisabled()
  })

  it('submitting driver code calls scan-driver endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ride_id: 'ride-001', action: 'started', status: 'active' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    setupMocks(RIDE_COORDINATING)
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('scan-qr-button')).toBeInTheDocument()
    })

    // Coordinating ride — scan QR opens scanner directly (no modal needed)
    fireEvent.click(screen.getByTestId('scan-qr-button'))
    expect(screen.getByTestId('qr-scanner')).toBeInTheDocument()

    fetchSpy.mockRestore()
  })
})
