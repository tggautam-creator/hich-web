/**
 * DriverHomePage tests
 *
 * Layout: frosted top bar (online/offline pill + HICH DRIVER + bell)
 *         full-screen map with GPS green dot
 *         ride board button
 *         bottom nav
 *
 * GPS polling: posts to driver_locations every 10s when online
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import DriverHomePage from '@/components/ride/DriverHomePage'

// ── Mock @vis.gl/react-google-maps ────────────────────────────────────────────

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Map: ({ children, 'data-testid': tid }: { children?: React.ReactNode; 'data-testid'?: string; [k: string]: unknown }) => (
    <div data-testid={tid ?? 'map-container'}>{children}</div>
  ),
  AdvancedMarker: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

// ── Mock env ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/env', () => ({
  env: {
    GOOGLE_MAPS_KEY: 'test-key',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  },
}))

// ── Mock authStore ─────────────────────────────────────────────────────────────

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: { profile: { id: string } | null }) => unknown) =>
      selector({ profile: { id: 'driver-001' } }),
  ),
}))

// ── Mock supabase ──────────────────────────────────────────────────────────────

const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null })

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: mockUpsert,
    }),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}))

// ── Mock FCM (used by RideRequestNotification) ───────────────────────────────

vi.mock('@/lib/fcm', () => ({
  onForegroundMessage: () => () => { /* unsubscribe stub */ },
  requestAndSaveFcmToken: vi.fn(),
}))

// ── Mock react-router-dom navigate ───────────────────────────────────────────

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// ── Geolocation mock ──────────────────────────────────────────────────────────

type GeoSuccessCallback = (pos: GeolocationPosition) => void
type GeoErrorCallback   = (err: GeolocationPositionError) => void

interface WatchPositionArgs {
  success: GeoSuccessCallback
  error:   GeoErrorCallback
}

let capturedWatch: WatchPositionArgs | null = null

const mockWatchPosition = vi.fn(
  (success: GeoSuccessCallback, error: GeoErrorCallback) => {
    capturedWatch = { success, error }
    return 1
  },
)
const mockClearWatch = vi.fn()

Object.defineProperty(global.navigator, 'geolocation', {
  value: { watchPosition: mockWatchPosition, clearWatch: mockClearWatch },
  configurable: true,
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <DriverHomePage />
    </MemoryRouter>,
  )
}

function fireGpsSuccess(lat = 38.54, lng = -121.77) {
  act(() => {
    capturedWatch?.success({
      coords: {
        latitude: lat, longitude: lng, accuracy: 10,
        altitude: null, altitudeAccuracy: null, heading: null, speed: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition)
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DriverHomePage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    capturedWatch = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders the page wrapper with default data-testid', () => {
    renderPage()
    expect(screen.getByTestId('driver-home-page')).toBeInTheDocument()
  })

  it('renders the map container', () => {
    renderPage()
    expect(screen.getByTestId('map-container')).toBeInTheDocument()
  })

  // ── GPS / green dot ────────────────────────────────────────────────────────

  it('does NOT show the green dot before a GPS fix', () => {
    renderPage()
    expect(screen.queryByTestId('green-dot-marker')).not.toBeInTheDocument()
  })

  it('shows the green dot after a GPS fix is received', () => {
    renderPage()
    fireGpsSuccess()
    expect(screen.getByTestId('green-dot-marker')).toBeInTheDocument()
  })

  it('calls clearWatch on unmount', () => {
    const { unmount } = renderPage()
    unmount()
    expect(mockClearWatch).toHaveBeenCalledTimes(1)
  })

  // ── GPS polling ────────────────────────────────────────────────────────────

  it('posts GPS to driver_locations immediately on mount when online', () => {
    renderPage()
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'driver-001',
        location: expect.objectContaining({ type: 'Point' }),
      }),
      { onConflict: 'user_id' },
    )
  })

  it('posts GPS every 30 seconds while online', () => {
    renderPage()
    mockUpsert.mockClear()

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(mockUpsert).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(mockUpsert).toHaveBeenCalledTimes(2)
  })

  it('stops GPS polling on unmount', () => {
    const { unmount } = renderPage()
    mockUpsert.mockClear()
    unmount()

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  // ── Online/offline toggle ──────────────────────────────────────────────────

  it('shows online status by default', () => {
    renderPage()
    expect(screen.getByTestId('online-toggle').textContent).toContain('Online')
  })

  it('toggles to offline when clicked', () => {
    renderPage()

    act(() => {
      fireEvent.click(screen.getByTestId('online-toggle'))
    })

    expect(screen.getByTestId('online-toggle').textContent).toContain('Offline')
  })

  // ── Top bar ────────────────────────────────────────────────────────────────

  it('renders the top bar with HICH DRIVER wordmark', () => {
    renderPage()
    expect(screen.getByTestId('top-bar')).toBeInTheDocument()
    expect(screen.getByTestId('top-bar').textContent).toContain('HICH DRIVER')
  })

  it('does not have a hamburger menu', () => {
    renderPage()
    expect(screen.queryByTestId('hamburger-menu')).not.toBeInTheDocument()
  })

  it('does not have a QR button', () => {
    renderPage()
    expect(screen.queryByTestId('qr-button')).not.toBeInTheDocument()
  })

  // ── Bottom nav ─────────────────────────────────────────────────────────────

  it('renders the bottom navigation bar', () => {
    renderPage()
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument()
  })

  it('rider tab navigates to /home/rider', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('home-tab'))
    expect(mockNavigate).toHaveBeenCalledWith('/home/rider')
  })

  it('payment tab navigates to /payment/methods', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('payment-tab'))
    expect(mockNavigate).toHaveBeenCalledWith('/payment/methods')
  })

  it('profile tab navigates to /profile', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('profile-tab'))
    expect(mockNavigate).toHaveBeenCalledWith('/profile')
  })
})
