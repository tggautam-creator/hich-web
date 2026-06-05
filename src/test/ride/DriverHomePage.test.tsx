/**
 * DriverHomePage tests — iOS-parity vertical scroll layout (2026-06-05).
 *
 * Layout: sticky top bar (online/snoozed pill + TAGO DRIVER + bell)
 *         scroll content: greeting → "Find riders" hero → "Ride board"
 *           pill → "Get matched" card → "Suggested for you" card →
 *           bank info card → preferences card → "How it works" card
 *         bottom-docked: active-ride banner (when present) +
 *           bank slim banner (at cap) + online toggle / resume button +
 *           pending earnings pill (when present) + bottom nav
 *
 * GPS still posts to driver_locations every 30s while online; the
 * static driver-self map is gone (drivers don't need a map of where
 * they currently are on the home surface).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import DriverHomePage from '@/components/ride/DriverHomePage'

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
let mockProfile: {
  id: string
  full_name?: string | null
  stripe_onboarding_complete?: boolean
  wallet_balance?: number
  waive_caregiver_fee?: boolean
} | null = { id: 'driver-001', full_name: 'Dana Park', stripe_onboarding_complete: true }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: { profile: typeof mockProfile; refreshProfile: typeof mockRefreshProfile }) => unknown) =>
      selector({ profile: mockProfile, refreshProfile: mockRefreshProfile }),
  ),
}))

// ── Mock supabase ──────────────────────────────────────────────────────────────

const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null })
const mockUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null })
const mockMaybeSingle = vi.fn().mockResolvedValue({ data: { is_online: true }, error: null })

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (_table: string) => ({
      upsert: mockUpsert,
      update: (_payload: unknown) => ({ eq: mockUpdateEq }),
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

// ── Mock FCM (used by foreground push surfaces if loaded indirectly) ───
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

// SuggestedRidesHero uses React Query — stub here so this test file
// doesn't need a QueryClientProvider. Its dedicated tests live at
// src/test/suggestions/.
vi.mock('@/components/suggestions/SuggestedRidesHero', () => ({
  default: () => null,
}))

// DriverSuggestedForYouCard wraps useSuggestionsTop — stub the hook
// so the card always renders the empty state.
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
    mockProfile = { id: 'driver-001', full_name: 'Dana Park', stripe_onboarding_complete: true }
    mockMaybeSingle.mockResolvedValue({ data: { is_online: true }, error: null })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rides: [], count: 0, pending: [], total_cents: 0 }) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Page wrapper + chrome ──────────────────────────────────────────────────

  it('renders the page wrapper with default data-testid', () => {
    renderPage()
    expect(screen.getByTestId('driver-home-page')).toBeInTheDocument()
  })

  it('renders the top bar with TAGO DRIVER wordmark', () => {
    renderPage()
    expect(screen.getByTestId('top-bar')).toBeInTheDocument()
    expect(screen.getByTestId('top-bar').textContent).toContain('TAGO DRIVER')
  })

  it('renders the notifications bell in the top bar', () => {
    renderPage()
    expect(screen.getByTestId('notifications-bell')).toBeInTheDocument()
  })

  it('does not have a hamburger menu', () => {
    renderPage()
    expect(screen.queryByTestId('hamburger-menu')).not.toBeInTheDocument()
  })

  it('does not have a QR button', () => {
    renderPage()
    expect(screen.queryByTestId('qr-button')).not.toBeInTheDocument()
  })

  // ── Greeting ───────────────────────────────────────────────────────────────

  it('renders "Hi there, {firstName}!" when the profile has a name', () => {
    renderPage()
    expect(screen.getByTestId('driver-home-greeting')).toHaveTextContent('Hi there, Dana!')
  })

  it('renders "Hi there!" when the profile has no name', () => {
    mockProfile = { id: 'driver-001', full_name: null, stripe_onboarding_complete: true }
    renderPage()
    expect(screen.getByTestId('driver-home-greeting')).toHaveTextContent('Hi there!')
  })

  // ── Find riders hero + ride board pill ─────────────────────────────────────

  it('renders the "Find riders" primary hero', () => {
    renderPage()
    expect(screen.getByTestId('driver-home-find-riders-hero')).toBeInTheDocument()
  })

  it('Find riders hero tap navigates to /rides/board', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('driver-home-find-riders-hero'))
    expect(mockNavigate).toHaveBeenCalledWith('/rides/board', { state: { fromTab: 'drive' } })
  })

  it('Ride board pill navigates to /rides/board', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('driver-home-ride-board-pill'))
    expect(mockNavigate).toHaveBeenCalledWith('/rides/board', { state: { fromTab: 'drive' } })
  })

  // ── Get matched card ───────────────────────────────────────────────────────

  it('Add routine routes to /schedule with routine tripType', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('driver-home-add-routine'))
    expect(mockNavigate).toHaveBeenCalledWith('/schedule', { state: { tripType: 'routine' } })
  })

  it('Post a ride routes to /schedule', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('driver-home-post-trip'))
    expect(mockNavigate).toHaveBeenCalledWith('/schedule')
  })

  // ── Suggested for you ──────────────────────────────────────────────────────

  it('Suggested-for-you card shows empty state when there are no matches', () => {
    renderPage()
    expect(screen.getByText('Suggested for you')).toBeInTheDocument()
    expect(screen.getByTestId('driver-suggested-empty-state')).toBeInTheDocument()
  })

  // ── Bank info card ─────────────────────────────────────────────────────────

  it('Bank info card shows Wallet balance when bank is linked', () => {
    mockProfile = { id: 'driver-001', stripe_onboarding_complete: true, wallet_balance: 4250 }
    renderPage()
    const card = screen.getByTestId('driver-home-bank-info-card')
    expect(card.textContent).toContain('Wallet balance')
    expect(card.textContent).toContain('$42.50')
    expect(screen.queryByTestId('driver-home-bank-connect')).not.toBeInTheDocument()
  })

  it('Bank info card shows Connect bank CTA + progress bar when no bank', () => {
    mockProfile = { id: 'driver-001', stripe_onboarding_complete: false, wallet_balance: 2500 }
    renderPage()
    const card = screen.getByTestId('driver-home-bank-info-card')
    expect(card.textContent).toContain('Earnings waiting')
    expect(card.textContent).toContain('$25.00')
    expect(screen.getByTestId('driver-home-bank-connect')).toBeInTheDocument()
    expect(screen.getByTestId('driver-home-bank-progress')).toBeInTheDocument()
  })

  it('Bank Connect CTA navigates to /stripe/payouts', async () => {
    mockProfile = { id: 'driver-001', stripe_onboarding_complete: false }
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('driver-home-bank-connect'))
    expect(mockNavigate).toHaveBeenCalledWith('/stripe/payouts')
  })

  // ── Preferences card ───────────────────────────────────────────────────────

  it('Waive caregiver fee toggle reflects profile state', () => {
    mockProfile = {
      id: 'driver-001',
      stripe_onboarding_complete: true,
      waive_caregiver_fee: true,
    }
    renderPage()
    expect(screen.getByTestId('driver-home-waive-caregiver-toggle')).toBeChecked()
  })

  it('Toggling Waive caregiver fee writes to users table + refreshes profile', async () => {
    mockProfile = {
      id: 'driver-001',
      stripe_onboarding_complete: true,
      waive_caregiver_fee: false,
    }
    renderPage()
    const toggle = screen.getByTestId('driver-home-waive-caregiver-toggle')
    expect(toggle).not.toBeChecked()

    await act(async () => { fireEvent.click(toggle) })

    await waitFor(() => {
      expect(mockUpdateEq).toHaveBeenCalled()
    })
    expect(mockRefreshProfile).toHaveBeenCalled()
  })

  // ── GPS lifecycle ──────────────────────────────────────────────────────────

  it('calls clearWatch on unmount', () => {
    const { unmount } = renderPage()
    unmount()
    expect(mockClearWatch).toHaveBeenCalledTimes(1)
  })

  // ── GPS polling to driver_locations ────────────────────────────────────────

  it('posts GPS to driver_locations once online + after a fix', async () => {
    renderPage()
    fireGpsSuccess()
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
    fireGpsSuccess()
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
    fireGpsSuccess()
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
    await waitFor(() => {
      expect(screen.getByTestId('online-toggle')).not.toBeDisabled()
    })

    act(() => { fireEvent.click(screen.getByTestId('online-toggle')) })
    expect(screen.getByTestId('online-toggle').textContent).toContain('Offline')
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

  // ── F2: soft bank nudge ────────────────────────────────────────────────────

  it('does NOT show the slim bank banner under the cap (only the card)', () => {
    mockProfile = { id: 'driver-001', stripe_onboarding_complete: false }
    renderPage()
    // The slim banner is the bottom-docked one — only shown at the cap.
    expect(screen.queryByTestId('bank-setup-banner')).not.toBeInTheDocument()
    // The bank info card always renders + has its connect CTA when no bank.
    expect(screen.getByTestId('driver-home-bank-info-card')).toBeInTheDocument()
    expect(screen.getByTestId('driver-home-bank-connect')).toBeInTheDocument()
  })

  it('allows going online without bank setup (F2: soft nudge, not a gate)', async () => {
    mockProfile = { id: 'driver-001', stripe_onboarding_complete: false }
    mockMaybeSingle.mockResolvedValueOnce({ data: { is_online: false }, error: null })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('online-toggle')).not.toBeDisabled())

    act(() => { fireEvent.click(screen.getByTestId('online-toggle')) })

    expect(screen.queryByTestId('bank-required-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('online-indicator')).toHaveTextContent('Online')
  })

  // ── F3: $100 wallet cap gate ───────────────────────────────────────────────

  it('disables Go Online and swaps copy when wallet >= $100 without bank', async () => {
    mockProfile = { id: 'driver-001', stripe_onboarding_complete: false, wallet_balance: 10_000 }
    mockMaybeSingle.mockResolvedValueOnce({ data: { is_online: false }, error: null })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('online-toggle')).toBeDisabled()
    })
    expect(screen.getByTestId('online-toggle').textContent).toContain('Link a bank')
    expect(screen.getByTestId('bank-setup-banner').textContent).toContain('$100')
  })

  it('does NOT cap-gate when wallet is under $100 (soft nudge only)', async () => {
    mockProfile = { id: 'driver-001', stripe_onboarding_complete: false, wallet_balance: 5_000 }
    mockMaybeSingle.mockResolvedValueOnce({ data: { is_online: false }, error: null })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('online-toggle')).not.toBeDisabled()
    })
    expect(screen.getByTestId('online-toggle').textContent).toContain('Offline — tap')
  })

  // ── Snooze surfaces ─────────────────────────────────────────────────────

  it('renders snoozed indicator + Resume button when snoozed_until is in the future', async () => {
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_online: true, snoozed_until: inOneHour },
      error: null,
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('snoozed-indicator')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('online-indicator')).not.toBeInTheDocument()
    expect(screen.getByTestId('resume-snooze-button')).toBeInTheDocument()
    expect(screen.queryByTestId('online-toggle')).not.toBeInTheDocument()
  })

  it('treats an already-elapsed snoozed_until as not snoozed', async () => {
    const inThePast = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_online: false, snoozed_until: inThePast },
      error: null,
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('online-indicator')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('snoozed-indicator')).not.toBeInTheDocument()
    expect(screen.queryByTestId('resume-snooze-button')).not.toBeInTheDocument()
  })

  it('picks up cross-screen snooze event from the decline sheet (no remount needed)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_online: true, snoozed_until: null },
      error: null,
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('online-toggle')).toBeInTheDocument()
    })

    const inOneHour = new Date(Date.now() + 60 * 60 * 1000)
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('tago:driver-snoozed', {
          detail: { snoozedUntil: inOneHour },
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('snoozed-indicator')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('online-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('resume-snooze-button')).toBeInTheDocument()
  })

  it('Resume button DELETEs /api/rides/snooze and reverts to online toggle', async () => {
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockMaybeSingle.mockResolvedValueOnce({
      data: { is_online: true, snoozed_until: inOneHour },
      error: null,
    })
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url === '/api/rides/snooze' && opts?.method === 'DELETE') {
        return { ok: true, json: async () => ({ snoozed_until: null }) }
      }
      return { ok: true, json: async () => ({ rides: [], count: 0, pending: [], total_cents: 0 }) }
    })
    global.fetch = fetchMock as unknown as typeof fetch

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('resume-snooze-button')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('resume-snooze-button'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('online-toggle')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rides/snooze',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
