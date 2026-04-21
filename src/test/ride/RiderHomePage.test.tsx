/**
 * RiderHomePage tests
 *
 * Layout: frosted top bar (TAGO wordmark + notifications bell)
 *         full-screen map with GPS blue dot
 *         stacked search card + ride board button above bottom nav
 *         bottom nav: Home (active) | Drive | Wallet | Profile
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import RiderHomePage from '@/components/ride/RiderHomePage'

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

let isDriverMock = false

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: { isDriver: boolean }) => unknown) =>
      selector({ isDriver: isDriverMock }),
  ),
}))

// ── Mock geocode ──────────────────────────────────────────────────────────────

vi.mock('@/lib/geocode', () => ({
  reverseGeocode: vi.fn().mockResolvedValue('UC Davis, Davis'),
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
      <RiderHomePage />
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

describe('RiderHomePage', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    mockWatchPosition.mockClear()
    mockClearWatch.mockClear()
    capturedWatch = null
    isDriverMock  = false
  })

  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders the page wrapper with default data-testid', () => {
    renderPage()
    expect(screen.getByTestId('rider-home-page')).toBeInTheDocument()
  })

  it('renders the map container', () => {
    renderPage()
    expect(screen.getByTestId('map-container')).toBeInTheDocument()
  })

  // ── GPS / blue dot ─────────────────────────────────────────────────────────

  it('does NOT show the blue dot before a GPS fix', () => {
    renderPage()
    expect(screen.queryByTestId('blue-dot-marker')).not.toBeInTheDocument()
  })

  it('shows the blue dot after a GPS fix is received', () => {
    renderPage()
    fireGpsSuccess()
    expect(screen.getByTestId('blue-dot-marker')).toBeInTheDocument()
  })

  it('calls clearWatch on unmount', () => {
    const { unmount } = renderPage()
    unmount()
    expect(mockClearWatch).toHaveBeenCalledTimes(1)
  })

  // ── Top bar ────────────────────────────────────────────────────────────────

  it('renders the top bar', () => {
    renderPage()
    expect(screen.getByTestId('top-bar')).toBeInTheDocument()
  })

  it('renders the notifications bell in the top bar', () => {
    renderPage()
    expect(screen.getByTestId('notifications-bell')).toBeInTheDocument()
  })

  // ── Search card (From + Where to?) ─────────────────────────────────────────

  it('renders the search card with "Where to?" text', () => {
    renderPage()
    const bar = screen.getByTestId('search-bar')
    expect(bar).toBeInTheDocument()
    expect(bar.textContent).toContain('Where to?')
  })

  it('renders the from-label showing default location', () => {
    renderPage()
    const label = screen.getByTestId('from-label')
    expect(label.textContent).toContain('Current Location')
  })

  it('updates from-label after GPS fix with reverse-geocoded name', async () => {
    renderPage()
    fireGpsSuccess()
    await waitFor(() => {
      expect(screen.getByTestId('from-label').textContent).toContain('UC Davis, Davis')
    })
  })

  it('clicking the search card shows the availability notice and continues to /ride/search', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('search-bar'))
    expect(screen.getByTestId('realtime-notice-continue-search')).toBeInTheDocument()
    await user.click(screen.getByTestId('realtime-notice-continue-search'))
    expect(mockNavigate).toHaveBeenCalledWith('/ride/search', expect.objectContaining({ state: expect.objectContaining({ locationName: expect.any(String) }) }))
  })

  it('renders the ride board button', () => {
    renderPage()
    expect(screen.getByTestId('ride-board-button')).toBeInTheDocument()
  })

  it('clicking the ride board button navigates to /rides/board', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('ride-board-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/rides/board', { state: { fromTab: 'home' } })
  })

  // ── Bottom nav ─────────────────────────────────────────────────────────────

  it('renders the bottom navigation bar', () => {
    renderPage()
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument()
  })

  it('home tab has active (primary blue) styling', () => {
    renderPage()
    expect(screen.getByTestId('home-tab').className).toContain('text-primary')
  })

  it('drive tab navigates to /home/driver when the user is already a driver', async () => {
    isDriverMock = true
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('driver-tab'))
    expect(mockNavigate).toHaveBeenCalledWith('/home/driver')
  })

  it('drive tab navigates to /become-driver when the user is not yet a driver', async () => {
    isDriverMock = false
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('driver-tab'))
    expect(mockNavigate).toHaveBeenCalledWith('/become-driver')
  })

  it('payment tab navigates to /wallet', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('payment-tab'))
    expect(mockNavigate).toHaveBeenCalledWith('/wallet')
  })

  it('profile tab navigates to /profile', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('profile-tab'))
    expect(mockNavigate).toHaveBeenCalledWith('/profile')
  })

  // ── Custom testId ──────────────────────────────────────────────────────────

  it('forwards a custom data-testid to the root wrapper', () => {
    render(
      <MemoryRouter>
        <RiderHomePage data-testid="my-custom-id" />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('my-custom-id')).toBeInTheDocument()
  })
})
