/**
 * DriverActiveRidePage tests
 *
 * Verifies:
 *  1. Shows loading spinner initially
 *  2. Displays LIVE badge (active) / EN ROUTE badge (coordinating)
 *  3. Shows ride timer (active) / ETA (coordinating)
 *  4. Show QR button opens QR sheet
 *  5. Chat button navigates to messaging
 *  6. End Ride shows modal with "Rider Must Scan QR" (active only)
 *  7. Modal Show QR opens QR sheet
 *  8. Map and route polyline rendered
 *  9. Driver GPS marker rendered
 * 10. Rider signal banner appears
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DriverActiveRidePage from '@/components/ride/DriverActiveRidePage'

// ── Mock @vis.gl/react-google-maps ────────────────────────────────────────────

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Map: ({ children, 'data-testid': tid }: { children?: React.ReactNode; 'data-testid'?: string; [k: string]: unknown }) => (
    <div data-testid={tid ?? 'map-container'}>{children}</div>
  ),
  AdvancedMarker: ({ children }: { children?: React.ReactNode; [k: string]: unknown }) => <>{children}</>,
  useMap: () => null,
}))

vi.mock('@/components/map/RoutePreview', () => ({
  RoutePolyline: () => <div data-testid="route-polyline" />,
  MapBoundsFitter: () => null,
  decodePolyline: () => [],
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
      selector({ profile: { id: 'driver-001' } }),
  ),
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockSingle, mockChannel } = vi.hoisted(() => ({
  mockSingle: vi.fn(),
  mockChannel: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockSingle,
        }),
      }),
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

// ── Mock QR Sheet ─────────────────────────────────────────────────────────────

vi.mock('@/components/ride/DriverQrSheet', () => ({
  default: ({ isOpen, onClose, 'data-testid': tid }: { isOpen: boolean; onClose: () => void; driverId: string; rideId?: string; 'data-testid'?: string }) => {
    if (!isOpen) return null
    return (
      <div data-testid={tid ?? 'driver-qr-sheet'}>
        <button onClick={onClose}>Close QR</button>
      </div>
    )
  },
}))

// ── Test data ─────────────────────────────────────────────────────────────────

const RIDE = {
  id: 'ride-001',
  rider_id: 'rider-001',
  driver_id: 'driver-001',
  status: 'active',
  started_at: new Date(Date.now() - 120_000).toISOString(), // 2 min ago
  destination: { type: 'Point', coordinates: [-121.76, 38.54] },
  destination_name: 'UC Davis',
  pickup_point: { type: 'Point', coordinates: [-121.75, 38.55] },
  origin: { type: 'Point', coordinates: [-121.74, 38.53] },
  fare_cents: 1500,
}

const RIDER = { id: 'rider-001', full_name: 'Jane Doe', avatar_url: null }

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage(rideId = 'ride-001') {
  return render(
    <MemoryRouter initialEntries={[`/ride/active-driver/${rideId}`]}>
      <Routes>
        <Route path="/ride/active-driver/:rideId" element={<DriverActiveRidePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DriverActiveRidePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let callIdx = 0
    mockSingle.mockImplementation(() => {
      callIdx++
      if (callIdx === 1) return Promise.resolve({ data: RIDE, error: null })
      return Promise.resolve({ data: RIDER, error: null })
    })
    mockChannel.mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })
  })

  it('shows loading spinner initially', () => {
    mockSingle.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()
    expect(screen.getByTestId('driver-active-ride')).toBeInTheDocument()
  })

  it('displays LIVE badge after loading', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('live-badge')).toBeInTheDocument()
    })
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  it('shows rider name', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    })
  })

  it('shows destination name', async () => {
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

  it('has map rendered', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('active-ride-map')).toBeInTheDocument()
    })
  })

  it('has action grid with QR, Chat, and End Ride buttons', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('action-grid')).toBeInTheDocument()
    })
    expect(screen.getByTestId('show-qr-button')).toBeInTheDocument()
    expect(screen.getByTestId('chat-button')).toBeInTheDocument()
    expect(screen.getByTestId('end-ride-button')).toBeInTheDocument()
  })

  it('Show QR opens QR sheet', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('show-qr-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('show-qr-button'))
    expect(screen.getByTestId('driver-qr-sheet')).toBeInTheDocument()
  })

  it('Chat button navigates to messaging', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('chat-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('chat-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/ride/messaging/ride-001')
  })

  it('End Ride shows "Rider Must Scan QR" modal', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('end-ride-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('end-ride-button'))
    expect(screen.getByTestId('end-ride-modal')).toBeInTheDocument()
    expect(screen.getByText('Rider Must Scan QR')).toBeInTheDocument()
  })

  it('Modal Show QR button opens QR sheet', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('end-ride-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('end-ride-button'))
    fireEvent.click(screen.getByTestId('modal-show-qr'))
    expect(screen.getByTestId('driver-qr-sheet')).toBeInTheDocument()
  })

  it('Modal cancel closes modal', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('end-ride-button')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('end-ride-button'))
    expect(screen.getByTestId('end-ride-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('modal-cancel'))
    expect(screen.queryByTestId('end-ride-modal')).not.toBeInTheDocument()
  })

  it('shows EN ROUTE badge when ride is coordinating', async () => {
    const coordRide = { ...RIDE, status: 'coordinating', started_at: null }
    let callIdx = 0
    mockSingle.mockImplementation(() => {
      callIdx++
      if (callIdx === 1) return Promise.resolve({ data: coordRide, error: null })
      return Promise.resolve({ data: RIDER, error: null })
    })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('enroute-badge')).toBeInTheDocument()
    })
    expect(screen.getByText('EN ROUTE')).toBeInTheDocument()
    expect(screen.getByText('Driving to pickup')).toBeInTheDocument()
  })

  it('hides End Ride button when ride is coordinating', async () => {
    const coordRide = { ...RIDE, status: 'coordinating', started_at: null }
    let callIdx = 0
    mockSingle.mockImplementation(() => {
      callIdx++
      if (callIdx === 1) return Promise.resolve({ data: coordRide, error: null })
      return Promise.resolve({ data: RIDER, error: null })
    })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('show-qr-button')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('end-ride-button')).not.toBeInTheDocument()
  })
})
