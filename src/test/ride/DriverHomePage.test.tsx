/**
 * DriverHomePage tests
 *
 * Layout: frosted top bar (online/offline pill + TAGO DRIVER + bell)
 *         full-screen map with GPS green dot
 *         ride board button
 *         bottom nav
 *
 * GPS polling: posts to driver_locations every 10s when online
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
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

const mockRefreshProfile = vi.fn().mockResolvedValue(undefined)
let mockProfile: { id: string; stripe_onboarding_complete?: boolean } | null = { id: 'driver-001', stripe_onboarding_complete: true }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: { profile: typeof mockProfile; refreshProfile: typeof mockRefreshProfile }) => unknown) =>
      selector({ profile: mockProfile, refreshProfile: mockRefreshProfile }),
  ),
}))

// ── Mock supabase ──────────────────────────────────────────────────────────────

const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null })
// By default return is_online: true so tests that expect "online by default" still pass
const mockMaybeSingle = vi.fn().mockResolvedValue({ data: { is_online: true }, error: null })

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: mockUpsert,
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
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
    vi.clearAllMocks()
    capturedWatch = null
    mockProfile = { id: 'driver-001', stripe_onboarding_complete: true }
    mockMaybeSingle.mockResolvedValue({ data: { is_online: true }, error: null })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rides: [], count: 0 }) })
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

  it('posts GPS to driver_locations once online state is loaded', async () => {
    renderPage()
    // Wait for the maybeSingle() fetch to resolve and set isOnline = true
    await waitFor(() => {
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'driver-001',
          location: expect.objectContaining({ type: 'Point' }),
        }),
        { onConflict: 'user_id' },
      )
    })
  })

  it('posts GPS every 30 seconds while online', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderPage()
    // Wait for online state to load
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled())
    mockUpsert.mockClear()

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(mockUpsert).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(mockUpsert).toHaveBeenCalledTimes(2)
  })

  it('stops GPS polling on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { unmount } = renderPage()
    // Wait for online state to load
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled())
    mockUpsert.mockClear()
    unmount()

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  // ── Online/offline toggle ──────────────────────────────────────────────────

  it('shows online status once online state is loaded from DB', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('online-toggle').textContent).toContain('Online')
    })
  })

  it('toggles to offline when clicked', async () => {
    renderPage()
    // Wait for online state to load first
    await waitFor(() => {
      expect(screen.getByTestId('online-toggle')).not.toBeDisabled()
    })

    act(() => { fireEvent.click(screen.getByTestId('online-toggle')) })
    expect(screen.getByTestId('online-toggle').textContent).toContain('Offline')
  })

  // ── Top bar ────────────────────────────────────────────────────────────────

  it('renders the top bar with TAGO DRIVER wordmark', () => {
    renderPage()
    expect(screen.getByTestId('top-bar')).toBeInTheDocument()
    expect(screen.getByTestId('top-bar').textContent).toContain('TAGO DRIVER')
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
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('home-tab'))
    expect(mockNavigate).toHaveBeenCalledWith('/home/rider')
  })

  it('payment tab navigates to /payment/methods', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('payment-tab'))
    expect(mockNavigate).toHaveBeenCalledWith('/payment/methods')
  })

  it('profile tab navigates to /profile', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('profile-tab'))
    expect(mockNavigate).toHaveBeenCalledWith('/profile')
  })

  // ── Bank setup banner ──────────────────────────────────────────────────────

  it('shows bank setup banner when stripe_onboarding_complete is false', () => {
    mockProfile = { id: 'driver-001', stripe_onboarding_complete: false }
    renderPage()
    expect(screen.getByTestId('bank-setup-banner')).toBeInTheDocument()
    expect(screen.getByTestId('setup-bank-button')).toBeInTheDocument()
  })

  it('hides bank setup banner when stripe_onboarding_complete is true', () => {
    mockProfile = { id: 'driver-001', stripe_onboarding_complete: true }
    renderPage()
    expect(screen.queryByTestId('bank-setup-banner')).not.toBeInTheDocument()
  })

  it('blocks going online without bank setup and shows the bank dialog', async () => {
    mockProfile = { id: 'driver-001', stripe_onboarding_complete: false }
    renderPage()

    // Wait for online state to load (button becomes enabled)
    await waitFor(() => expect(screen.getByTestId('online-toggle')).not.toBeDisabled())

    // Toggle — should be blocked, bank dialog should appear instead
    act(() => { fireEvent.click(screen.getByTestId('online-toggle')) })
    expect(screen.getByTestId('bank-required-dialog')).toBeInTheDocument()
    // Should NOT have gone online
    expect(screen.getByTestId('online-indicator')).toHaveTextContent('Offline')
  })
})
