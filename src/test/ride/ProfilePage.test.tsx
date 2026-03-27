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
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ProfilePage from '@/components/ride/ProfilePage'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn()
  return { mockFrom }
})

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
    avatar_url: null,
    stripe_customer_id: null,
    home_location: null,
    created_at: '2026-01-01T00:00:00Z',
  },
  mockSignOut: vi.fn().mockResolvedValue(undefined),
  mockRefreshProfile: vi.fn().mockResolvedValue(undefined),
}))

let currentProfile = { ...mockProfile }

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
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
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
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <ProfilePage />
    </MemoryRouter>,
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
      // Should have called supabase.from('users').update(...)
      expect(mockFrom).toHaveBeenCalledWith('users')
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

  it('hides saved routes section for non-drivers', async () => {
    currentProfile = { ...mockProfile, is_driver: false }
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('profile-page')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('routes-list')).not.toBeInTheDocument()
    expect(screen.queryByText('Saved Routes')).not.toBeInTheDocument()
  })

  // ── Sign out ────────────────────────────────────────────────────────────

  it('sign out button calls signOut and navigates', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('sign-out-button')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('sign-out-button'))

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
    })
  })
})
