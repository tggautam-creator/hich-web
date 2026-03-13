import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AuthGuard from '@/components/auth/AuthGuard'

// ── Mock the auth store ───────────────────────────────────────────────────────
// We mock the entire module so AuthGuard reads from our controlled state
// rather than touching Supabase in tests.

const { mockUseAuthStore } = vi.hoisted(() => ({
  mockUseAuthStore: vi.fn(),
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: mockUseAuthStore,
}))

// Mock Google Maps APIProvider to a simple passthrough
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/lib/env', () => ({
  env: { GOOGLE_MAPS_KEY: 'test-key' },
}))

// Stub out RideRequestNotification — it pulls in FCM/Supabase which need env vars
vi.mock('@/components/ride/RideRequestNotification', () => ({
  default: () => null,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeUser    = { id: 'user-1', email: 'maya@ucdavis.edu' }
const fakeSession = { access_token: 'tok', user: fakeUser }
const fakeProfile = {
  id:                 'user-1',
  email:              'maya@ucdavis.edu',
  full_name:          'Maya Johnson',
  phone:              '+15551234567',
  avatar_url:         null,
  wallet_balance:     0,
  stripe_customer_id: null,
  is_driver:          false,
  rating_avg:         null,
  rating_count:       0,
  home_location:      null,
  created_at:         '2024-01-01T00:00:00Z',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type StoreOverrides = {
  user?: unknown
  session?: unknown
  profile?: unknown
  isLoading?: boolean
  isDriver?: boolean
  initialize?: () => () => void
  signOut?: () => Promise<void>
  refreshProfile?: () => Promise<void>
}

function mockStore(overrides: StoreOverrides = {}) {
  mockUseAuthStore.mockReturnValue({
    user:          null,
    session:       null,
    profile:       null,
    isLoading:     false,
    isDriver:      false,
    initialize:    vi.fn(() => vi.fn()),   // returns a mock cleanup fn
    signOut:       vi.fn(),
    refreshProfile: vi.fn(),
    ...overrides,
  })
}

/**
 * Renders AuthGuard inside a MemoryRouter with a minimal route tree:
 *  - /signup            → public (redirect target)
 *  - /onboarding/profile → public-ish (onboarding redirect target)
 *  - /onboarding/location → guarded onboarding route
 *  - /home/rider        → guarded app route
 */
function renderGuard(initialPath = '/home/rider') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        {/* Public routes — redirect targets */}
        <Route path="/signup"              element={<div>Signup Page</div>} />
        <Route path="/onboarding/profile"  element={<div>Profile Page</div>} />

        {/* Guarded routes */}
        <Route element={<AuthGuard />}>
          <Route path="/onboarding/location" element={<div>Location Page</div>} />
          <Route path="/onboarding/vehicle"  element={<div>Vehicle Page</div>} />
          <Route path="/home/rider"          element={<div>Rider Home</div>} />
          <Route path="/home/driver"         element={<div>Driver Home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => { vi.clearAllMocks() })

describe('AuthGuard — loading state', () => {
  it('shows a loading spinner while isLoading is true', () => {
    mockStore({ isLoading: true })
    renderGuard()
    expect(screen.getByTestId('auth-guard-loading')).toBeDefined()
  })

  it('accepts a custom data-testid for the loading spinner', () => {
    mockStore({ isLoading: true })
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AuthGuard data-testid="my-guard" />}>
            <Route path="/" element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('my-guard')).toBeDefined()
  })
})

describe('AuthGuard — unauthenticated', () => {
  it('redirects to /signup when there is no session', () => {
    mockStore({ session: null, isLoading: false })
    renderGuard('/home/rider')
    expect(screen.getByText('Signup Page')).toBeDefined()
  })
})

describe('AuthGuard — authenticated but profile incomplete', () => {
  it('redirects to /onboarding/profile when session exists but profile is null', () => {
    mockStore({ session: fakeSession, profile: null, isLoading: false })
    renderGuard('/home/rider')
    expect(screen.getByText('Profile Page')).toBeDefined()
  })

  it('redirects to /onboarding/profile when full_name is null on the profile', () => {
    mockStore({
      session:   fakeSession,
      profile:   { ...fakeProfile, full_name: null },
      isLoading: false,
    })
    renderGuard('/home/rider')
    expect(screen.getByText('Profile Page')).toBeDefined()
  })

  it('allows /onboarding/profile through (no redirect loop) even with null full_name', () => {
    // /onboarding/profile is a PUBLIC route in our test tree (render target for redirects)
    // When the guard redirects there, the public route renders — no infinite loop.
    mockStore({
      session:   fakeSession,
      profile:   null,
      isLoading: false,
    })
    renderGuard('/home/rider')
    // Should land on Profile Page (the public redirect target), not loop
    expect(screen.getByText('Profile Page')).toBeDefined()
    // Should NOT be the rider home
    expect(screen.queryByText('Rider Home')).toBeNull()
  })

  it('allows onboarding paths through even when full_name is null', () => {
    mockStore({
      session:   fakeSession,
      profile:   { ...fakeProfile, full_name: null },
      isLoading: false,
    })
    renderGuard('/onboarding/location')
    expect(screen.getByText('Location Page')).toBeDefined()
  })

  it('allows /onboarding/vehicle through even when full_name is null', () => {
    mockStore({
      session:   fakeSession,
      profile:   { ...fakeProfile, full_name: null },
      isLoading: false,
    })
    renderGuard('/onboarding/vehicle')
    expect(screen.getByText('Vehicle Page')).toBeDefined()
  })
})

describe('AuthGuard — authenticated with complete profile', () => {
  it('renders the requested guarded route', () => {
    mockStore({ session: fakeSession, profile: fakeProfile, isLoading: false })
    renderGuard('/home/rider')
    expect(screen.getByText('Rider Home')).toBeDefined()
  })

  it('renders driver home when authenticated as driver', () => {
    const driverProfile = { ...fakeProfile, is_driver: true }
    mockStore({ session: fakeSession, profile: driverProfile, isLoading: false, isDriver: true })
    renderGuard('/home/driver')
    expect(screen.getByText('Driver Home')).toBeDefined()
  })
})

describe('AuthGuard — lifecycle', () => {
  it('calls initialize() on mount', () => {
    const mockInitialize = vi.fn(() => vi.fn())
    mockStore({ isLoading: true, initialize: mockInitialize })
    renderGuard()
    expect(mockInitialize).toHaveBeenCalledOnce()
  })

  it('calls the cleanup returned by initialize() on unmount', () => {
    const mockCleanup    = vi.fn()
    const mockInitialize = vi.fn(() => mockCleanup)
    mockStore({ isLoading: true, initialize: mockInitialize })
    const { unmount } = renderGuard()
    unmount()
    expect(mockCleanup).toHaveBeenCalledOnce()
  })
})
