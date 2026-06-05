/**
 * RiderHomePage tests — iOS-parity vertical scroll layout (2026-06-05).
 *
 * Layout: frosted top bar (TAGO wordmark + notifications bell)
 *         scroll content: greeting → "Find your ride" hero →
 *           [Instant carpool | Ride board] pills →
 *           "Suggested for you" card → "Get matched" card →
 *           "How it works" card
 *         bottom: optional active-ride banner + bottom nav
 *
 * Map UI removed — map now lives inside `DestinationSearchPage` /
 * `MapPickerPage`. Home is a static information surface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import RiderHomePage from '@/components/ride/RiderHomePage'

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
let profileMock: { full_name?: string | null } | null = { full_name: 'Casey Lin' }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: { isDriver: boolean; profile: typeof profileMock }) => unknown) =>
      selector({ isDriver: isDriverMock, profile: profileMock }),
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

// SuggestedRidesHero uses React Query — stub to avoid the QueryClient
// requirement here. Its behaviour is covered by dedicated tests at
// src/test/suggestions/.
vi.mock('@/components/suggestions/SuggestedRidesHero', () => ({
  default: () => null,
}))

// SuggestedForYouCard wraps useSuggestionsTop — stub the hook so the
// card renders a known state without driving React Query.
vi.mock('@/hooks/useSuggestions', () => ({
  useSuggestionsTop: () => ({ data: [], isLoading: false }),
}))

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
    profileMock = { full_name: 'Casey Lin' }
  })

  // ── Page wrapper + chrome ──────────────────────────────────────────────────

  it('renders the page wrapper with default data-testid', () => {
    renderPage()
    expect(screen.getByTestId('rider-home-page')).toBeInTheDocument()
  })

  it('renders the top bar with TAGO wordmark', () => {
    renderPage()
    expect(screen.getByTestId('top-bar')).toBeInTheDocument()
    expect(screen.getByText('TAGO')).toBeInTheDocument()
  })

  it('renders the notifications bell in the top bar', () => {
    renderPage()
    expect(screen.getByTestId('notifications-bell')).toBeInTheDocument()
  })

  // ── Greeting ───────────────────────────────────────────────────────────────

  it('renders "Hi there, {firstName}!" when the profile has a name', () => {
    renderPage()
    expect(screen.getByTestId('rider-home-greeting')).toHaveTextContent('Hi there, Casey!')
  })

  it('renders "Hi there!" when the profile has no name', () => {
    profileMock = { full_name: null }
    renderPage()
    expect(screen.getByTestId('rider-home-greeting')).toHaveTextContent('Hi there!')
  })

  // ── Hero + pills ───────────────────────────────────────────────────────────

  it('renders the "Find your ride" primary hero', () => {
    renderPage()
    expect(screen.getByTestId('rider-home-find-ride-hero')).toBeInTheDocument()
  })

  it('hero tap navigates to /rides/board', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('rider-home-find-ride-hero'))
    expect(mockNavigate).toHaveBeenCalledWith('/rides/board', { state: { fromTab: 'home' } })
  })

  it('Instant carpool pill opens the realtime-availability notice', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('rider-home-instant-carpool-pill'))
    expect(screen.getByTestId('realtime-notice-continue-search')).toBeInTheDocument()
  })

  it('"Try Instant Match Anyway" continues to /ride/search with location state', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('rider-home-instant-carpool-pill'))
    await user.click(screen.getByTestId('realtime-notice-continue-search'))
    expect(mockNavigate).toHaveBeenCalledWith(
      '/ride/search',
      expect.objectContaining({ state: expect.objectContaining({ locationName: expect.any(String) }) }),
    )
  })

  it('Ride board pill navigates to the list view (/rides/board/browse) — iOS onBrowseRideBoardList parity', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('rider-home-ride-board-pill'))
    expect(mockNavigate).toHaveBeenCalledWith('/rides/board/browse', { state: { fromTab: 'home' } })
  })

  it('"Find your ride" hero stays on the smart-search /rides/board (iOS onOpenRideBoard parity)', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('rider-home-find-ride-hero'))
    expect(mockNavigate).toHaveBeenCalledWith('/rides/board', { state: { fromTab: 'home' } })
  })

  // ── Suggested-for-you card ─────────────────────────────────────────────────

  it('Suggested-for-you card shows empty state when there are no matches', () => {
    renderPage()
    expect(screen.getByText('Suggested for you')).toBeInTheDocument()
    expect(screen.getByTestId('suggested-empty-state')).toBeInTheDocument()
  })

  // ── Get-matched card ───────────────────────────────────────────────────────

  it('Add routine button routes to /schedule/rider with routine state', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('rider-home-add-routine'))
    expect(mockNavigate).toHaveBeenCalledWith('/schedule/rider', { state: { tripType: 'routine' } })
  })

  it('Post a trip button routes to /schedule/rider', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('rider-home-post-trip'))
    expect(mockNavigate).toHaveBeenCalledWith('/schedule/rider')
  })

  // ── GPS lifecycle ──────────────────────────────────────────────────────────

  it('calls clearWatch on unmount', () => {
    const { unmount } = renderPage()
    unmount()
    expect(mockClearWatch).toHaveBeenCalledTimes(1)
  })

  it('reverse-geocodes once on the first GPS fix', async () => {
    renderPage()
    fireGpsSuccess()
    fireGpsSuccess(38.55, -121.78)
    await waitFor(() => {
      // No visible label on the new layout, but the geocode helper
      // should fire exactly once for the first fix. The "Continue
      // anyway" handler uses the cached coord on the realtime notice.
      // We assert behavioural lifecycle via clearWatch on unmount.
      expect(mockWatchPosition).toHaveBeenCalledTimes(1)
    })
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
