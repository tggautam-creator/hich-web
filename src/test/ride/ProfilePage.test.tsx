/**
 * ProfilePage tests
 *
 * Verifies:
 *  1.  Renders with default data-testid
 *  2.  Shows user name and email
 *  3.  Shows phone when present
 *  4.  Edit button opens edit form with name and phone inputs
 *  5.  Save updates user via Supabase and exits edit mode
 *  6.  Cancel exits edit mode without saving
 *  7.  Shows validation error when name is empty
 *  8.  Shows saved routes for drivers
 *  9.  Shows "No saved routes yet" when driver has no routines
 * 10.  Toggle route calls Supabase update and toggles status
 * 11.  Delete route removes it from the list
 * 12.  Hides saved routes section for non-drivers
 * 13.  Sign out button calls signOut and navigates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ProfilePage from '@/components/ride/ProfilePage'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockFrom, mockProfileFetch } = vi.hoisted(() => {
  const mockFrom = vi.fn()
  // v1.3 Sprint 12 Slice 5a — profile writes route through
  // POST /api/users/me/profile via the shared profileApi helper.
  const mockProfileFetch = vi.fn().mockResolvedValue({ id: 'user-001' })
  return { mockFrom, mockProfileFetch }
})

vi.mock('@/lib/profileApi', () => ({
  updateMyProfile: mockProfileFetch,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/avatar.jpg' } }),
      }),
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

// v1.3 — `mockProfile` typed loose so tests can extend it with the
// accessibility fields (has_accessibility_needs / accessibility_profile
// / waive_caregiver_fee) without TS narrowing the literal shape.
interface MockProfile {
  id: string
  email: string
  full_name: string
  phone: string
  wallet_balance: number
  is_driver: boolean
  rating_avg: number
  rating_count: number
  avatar_url: string | null
  stripe_customer_id: string | null
  home_location: unknown
  created_at: string
  has_accessibility_needs?: boolean
  accessibility_profile?: {
    needs_wheelchair?: boolean
    needs_caregiver?: boolean
    other_notes?: string | null
  }
  waive_caregiver_fee?: boolean
}

const { mockProfile, mockSignOut, mockRefreshProfile } = vi.hoisted(() => ({
  mockProfile: {
    id: 'user-001',
    email: 'test@uni.edu',
    full_name: 'Test User',
    phone: '+15551234567',
    wallet_balance: 5000,
    is_driver: true,
    rating_avg: 4.7,
    rating_count: 15,
    avatar_url: null as string | null,
    stripe_customer_id: null as string | null,
    home_location: null as unknown,
    created_at: '2026-01-01T00:00:00Z',
  } as MockProfile,
  mockSignOut: vi.fn().mockResolvedValue(undefined),
  mockRefreshProfile: vi.fn().mockResolvedValue(undefined),
}))

let currentProfile: MockProfile = { ...mockProfile }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        profile: currentProfile,
        signOut: mockSignOut,
        refreshProfile: mockRefreshProfile,
      }),
  ),
}))

// v1.3 Sprint 11 Slice 2 — TrustedContactsSection now mounts
// unconditionally on ProfilePage (universal feature, no
// accessibility gate). Its useMyTrustedContacts() hook needs a
// QueryClientProvider that this test file doesn't set up. Stub
// the section out — its own tests in
// src/test/profile/TrustedContactsSection.test.tsx cover the
// behaviour.
vi.mock('@/components/profile/TrustedContactsSection', () => ({
  default: () => <div data-testid="trusted-contacts-section-stub" />,
}))

// CaregiversSection uses `useMyCaregivers` (React Query) and mounts
// only when `has_accessibility_needs === true`. Tests that flip that
// flag (e.g. "clears all sub-fields when the top toggle is turned
// off") otherwise crash the tree because this file doesn't wrap with
// QueryClientProvider. Stub the section out — its own tests live in
// src/test/profile/CaregiversSection.test.tsx.
vi.mock('@/components/profile/CaregiversSection', () => ({
  default: () => <div data-testid="caregivers-section-stub" />,
}))

// v1.3 Sprint 12 Slice 5b — useMyStats is a React Query hook; this
// test file doesn't wrap with QueryClientProvider. Stub the hook to
// return undefined data so TrustBadges falls back to the cached
// profile values the test fixtures already supply. The hook's own
// behaviour is covered by src/test/hooks/useMyStats.test.tsx.
vi.mock('@/hooks/useMyStats', () => ({
  useMyStats: () => ({ data: undefined, error: null, isLoading: false }),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_ROUTINES = [
  {
    id: 'route-001',
    user_id: 'user-001',
    route_name: 'Campus to Downtown',
    origin: { type: 'Point', coordinates: [-121.75, 38.54] },
    destination: { type: 'Point', coordinates: [-121.80, 38.56] },
    destination_bearing: 270,
    direction_type: 'one_way',
    day_of_week: [1, 3, 5],
    departure_time: '08:30:00',
    arrival_time: null,
    origin_address: 'UC Davis',
    dest_address: 'Downtown Davis',
    is_active: true,
    created_at: '2026-01-15T00:00:00Z',
  },
  {
    id: 'route-002',
    user_id: 'user-001',
    route_name: 'Home to Work',
    origin: { type: 'Point', coordinates: [-121.70, 38.50] },
    destination: { type: 'Point', coordinates: [-121.85, 38.58] },
    destination_bearing: 315,
    direction_type: 'roundtrip',
    day_of_week: [1, 2, 3, 4, 5],
    departure_time: null,
    arrival_time: '09:00:00',
    origin_address: 'Home',
    dest_address: 'Office',
    is_active: false,
    created_at: '2026-01-10T00:00:00Z',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupMocks(opts: { routines?: typeof MOCK_ROUTINES; rides?: unknown[] } = {}) {
  const { routines = MOCK_ROUTINES, rides = [] } = opts

  // Build chain for each .from() call
  mockFrom.mockImplementation((table: string) => {
    if (table === 'driver_routines') {
      // select → eq → order chain for loading routines
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: routines, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }
    }
    if (table === 'users') {
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }
    }
    if (table === 'vehicles') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }
    }
    if (table === 'rides') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: rides, error: null }),
              }),
            }),
          }),
        }),
      }
    }
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }
  })
}

function renderPage() {
  // ProfilePage now uses useQueryClient directly (for on-focus
  // invalidation), so we need a real provider here. useMyStats is
  // still mocked above so no actual network query runs.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/profile']}>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentProfile = { ...mockProfile }
    setupMocks()
    // Mock fetch for /api/addresses calls
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ addresses: [] }),
    }))
  })

  // ── Basic rendering ─────────────────────────────────────────────────────

  it('renders with default data-testid', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('profile-page')).toBeInTheDocument()
    })
  })

  it('shows user name and email', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('profile-name')).toHaveTextContent('Test User')
      expect(screen.getByTestId('profile-email')).toHaveTextContent('test@uni.edu')
    })
  })

  it('shows phone when present', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('profile-phone')).toHaveTextContent('+15551234567')
    })
  })

  // ── Edit mode ───────────────────────────────────────────────────────────

  it('edit button opens edit form with name and phone inputs', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('edit-profile-button')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('edit-profile-button'))

    expect(screen.getByTestId('edit-name-input')).toHaveValue('Test User')
    expect(screen.getByTestId('edit-phone-input')).toHaveValue('+15551234567')
  })

  it('save updates user via Supabase and exits edit mode', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('edit-profile-button')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('edit-profile-button'))
    const nameInput = screen.getByTestId('edit-name-input')
    await user.clear(nameInput)
    await user.type(nameInput, 'New Name')

    await user.click(screen.getByTestId('save-profile-button'))

    await waitFor(() => {
      // v1.3 Sprint 12 Slice 5a — save now routes through
      // POST /api/users/me/profile via updateMyProfile.
      expect(mockProfileFetch).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'New Name' }),
      )
      // Should have exited edit mode — name display visible again
      expect(screen.getByTestId('profile-name')).toBeInTheDocument()
    })
  })

  it('cancel exits edit mode without saving', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('edit-profile-button')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('edit-profile-button'))
    expect(screen.getByTestId('edit-name-input')).toBeInTheDocument()

    await user.click(screen.getByTestId('cancel-edit-button'))
    expect(screen.getByTestId('profile-name')).toBeInTheDocument()
    expect(screen.queryByTestId('edit-name-input')).not.toBeInTheDocument()
  })

  it('shows validation error when name is empty', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('edit-profile-button')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('edit-profile-button'))
    const nameInput = screen.getByTestId('edit-name-input')
    await user.clear(nameInput)

    await user.click(screen.getByTestId('save-profile-button'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-error')).toHaveTextContent('Name is required')
    })
  })

  // ── Saved routes ────────────────────────────────────────────────────────

  it('shows saved routes for drivers', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('routes-list')).toBeInTheDocument()
      expect(screen.getByTestId('route-route-001')).toBeInTheDocument()
      expect(screen.getByTestId('route-route-002')).toBeInTheDocument()
    })

    expect(screen.getByText('Campus to Downtown')).toBeInTheDocument()
    expect(screen.getByText('Home to Work')).toBeInTheDocument()
    expect(screen.getByTestId('route-status-route-001')).toHaveTextContent('Active')
    expect(screen.getByTestId('route-status-route-002')).toHaveTextContent('Paused')
  })

  it('shows "No saved routes yet" when driver has no routines', async () => {
    setupMocks({ routines: [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('no-routes')).toHaveTextContent('No saved routes yet')
    })
  })

  it('toggle route calls Supabase update and toggles status', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('toggle-route-route-001')).toBeInTheDocument()
    })

    // Route 001 is active — toggle should pause it
    expect(screen.getByTestId('toggle-route-route-001')).toHaveTextContent('Pause')

    await act(async () => {
      await user.click(screen.getByTestId('toggle-route-route-001'))
    })

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('driver_routines')
      expect(screen.getByTestId('route-status-route-001')).toHaveTextContent('Paused')
    })
  })

  it('delete route removes it from the list', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('route-route-002')).toBeInTheDocument()
    })

    await act(async () => {
      await user.click(screen.getByTestId('delete-route-route-002'))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('route-route-002')).not.toBeInTheDocument()
    })
  })

  it('hides saved routines section for non-drivers when they have no rider routines', async () => {
    // v1.3 — Saved Routines section is now visible for ANY user with
    // routines (rider OR driver). Non-drivers with zero routines
    // still don't see the section since there's nothing to render +
    // no need to clutter their profile with an empty state.
    currentProfile = { ...mockProfile, is_driver: false }
    setupMocks({ routines: [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('profile-page')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('routes-list')).not.toBeInTheDocument()
    expect(screen.queryByText('Saved Routines')).not.toBeInTheDocument()
  })

  it('shows saved routines section for non-drivers when they have rider routines (v1.3)', async () => {
    // Non-driver with at least one rider routine sees the section
    // + can manage their routines from Profile (matches iOS
    // ProfileRoutinesSection.swift). Previously web hid this whole
    // section behind is_driver.
    currentProfile = { ...mockProfile, is_driver: false }
    const riderRoutine = { ...MOCK_ROUTINES[0], mode: 'rider' as const }
    setupMocks({ routines: [riderRoutine] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Saved Routines')).toBeInTheDocument()
    })
    expect(screen.getByTestId('routes-list')).toBeInTheDocument()
    expect(screen.getByTestId(`route-mode-${riderRoutine.id}`)).toHaveTextContent('Rider')
    expect(screen.getByTestId('add-routine-button')).toBeInTheDocument()
  })

  // ── Accessibility editor (v1.3, iOS parity) ───────────────────────────
  // Mirrors iOS EditProfileSheet accessNeedsSection + waiveCaregiverFeeSection.
  // Pin the editor's render gating + the save-fold of all three fields.

  it('shows the accessibility editor only in edit mode', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('edit-profile-button')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('profile-accessibility-editor')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('edit-profile-button'))
    expect(screen.getByTestId('profile-accessibility-editor')).toBeInTheDocument()
  })

  it('seeds the editor from profile + sends has_accessibility_needs + accessibility_profile on save', async () => {
    currentProfile = {
      ...mockProfile,
      has_accessibility_needs: true,
      accessibility_profile: {
        needs_wheelchair: true,
        needs_caregiver: false,
        other_notes: null,
      },
    }
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('edit-profile-button')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('edit-profile-button'))

    // Seeded — top toggle ON + wheelchair sub-toggle ON.
    expect((screen.getByTestId('edit-has-accessibility-needs') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByTestId('edit-needs-wheelchair') as HTMLInputElement).checked).toBe(true)

    // Save without changes — request body MUST carry both fields.
    await user.click(screen.getByTestId('save-profile-button'))
    await waitFor(() => {
      expect(mockProfileFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          has_accessibility_needs: true,
          accessibility_profile: expect.objectContaining({
            needs_wheelchair: true,
            needs_caregiver: false,
            other_notes: null,
          }),
        }),
      )
    })
  })

  it('clears all sub-fields when the top toggle is turned off', async () => {
    currentProfile = {
      ...mockProfile,
      has_accessibility_needs: true,
      accessibility_profile: {
        needs_wheelchair: true,
        needs_caregiver: true,
        other_notes: 'I have a service dog',
      },
    }
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('edit-profile-button')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('edit-profile-button'))
    await user.click(screen.getByTestId('edit-has-accessibility-needs'))
    await user.click(screen.getByTestId('save-profile-button'))
    await waitFor(() => {
      expect(mockProfileFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          has_accessibility_needs: false,
          accessibility_profile: {
            needs_wheelchair: false,
            needs_caregiver: false,
            other_notes: null,
          },
        }),
      )
    })
  })

  it('shows the waive-caregiver-fee toggle only for drivers + sends the value on save', async () => {
    currentProfile = { ...mockProfile, is_driver: true, waive_caregiver_fee: false }
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('edit-profile-button')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('edit-profile-button'))

    expect(screen.getByTestId('edit-waive-caregiver-fee')).toBeInTheDocument()
    await user.click(screen.getByTestId('edit-waive-caregiver-fee'))
    await user.click(screen.getByTestId('save-profile-button'))
    await waitFor(() => {
      expect(mockProfileFetch).toHaveBeenCalledWith(
        expect.objectContaining({ waive_caregiver_fee: true }),
      )
    })
  })

  it('hides the waive-caregiver-fee toggle for non-drivers', async () => {
    currentProfile = { ...mockProfile, is_driver: false }
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('edit-profile-button')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('edit-profile-button'))
    expect(screen.queryByTestId('edit-waive-caregiver-fee')).not.toBeInTheDocument()
  })

  // ── iOS-parity hero + quick links ───────────────────────────────────

  it('renders the sticky top bar + iOS-parity hero', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('profile-top-bar')).toBeInTheDocument()
    })
    expect(screen.getByTestId('profile-hero')).toBeInTheDocument()
    expect(screen.getByTestId('profile-hero').textContent).toContain('Test User')
  })

  it('renders the registered driver pill in the hero for drivers', async () => {
    currentProfile = { ...currentProfile, is_driver: true }
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('profile-registered-driver-pill')).toBeInTheDocument()
    })
  })

  it('does NOT render the registered driver pill for non-drivers', async () => {
    currentProfile = { ...currentProfile, is_driver: false }
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('profile-hero')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('profile-registered-driver-pill')).not.toBeInTheDocument()
  })

  it('renders the Quick Links card with Payment Methods + Profile Details', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('profile-quick-links')).toBeInTheDocument()
    })
    const card = screen.getByTestId('profile-quick-links')
    expect(card.contains(screen.getByTestId('payment-methods-link'))).toBe(true)
    expect(card.contains(screen.getByTestId('profile-details-button'))).toBe(true)
  })

  it('includes the Payouts link in Quick Links only for drivers', async () => {
    currentProfile = { ...currentProfile, is_driver: true }
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('payouts-link')).toBeInTheDocument()
    })
    expect(screen.getByTestId('profile-quick-links').contains(screen.getByTestId('payouts-link'))).toBe(true)
  })

  // ── On-focus refetch (iOS scenePhase parity) ──────────────────────

  it('refreshes profile on visibilitychange to visible', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('profile-name')).toBeInTheDocument()
    })
    mockRefreshProfile.mockClear()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() => {
      expect(mockRefreshProfile).toHaveBeenCalled()
    })
  })

  // ── Version footer + section order ──────────────────────────────────

  it('renders the version footer with the TAGO wordmark + version', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('profile-version-footer')).toBeInTheDocument()
    })
    const footer = screen.getByTestId('profile-version-footer')
    expect(footer.textContent).toContain('TAGO')
    expect(footer.textContent).toMatch(/web v[\d.]+/)
  })

  it('renders Trusted Contacts before Saved Places (iOS safety-first section order)', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('saved-places-section')).toBeInTheDocument()
    })
    const trusted = screen.getByTestId('trusted-contacts-section-stub')
    const saved = screen.getByTestId('saved-places-section')
    expect(trusted.compareDocumentPosition(saved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // ── Sign out ────────────────────────────────────────────────────────────

  it('sign out button opens the confirmation modal (iOS confirmationDialog parity)', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('sign-out-button')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('sign-out-button'))
    expect(screen.getByTestId('sign-out-confirm-sheet')).toBeInTheDocument()
    // Modal opens; sign-out must NOT fire until the user confirms.
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('Cancel on the sign-out modal closes it without signing out', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('sign-out-button')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('sign-out-button'))
    await user.click(screen.getByTestId('sign-out-confirm-cancel'))
    expect(screen.queryByTestId('sign-out-confirm-sheet')).not.toBeInTheDocument()
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('Confirming the sign-out modal calls signOut and navigates', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('sign-out-button')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('sign-out-button'))
    await user.click(screen.getByTestId('sign-out-confirm-yes'))

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
    })
  })
})
