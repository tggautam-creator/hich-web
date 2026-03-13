import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AuthCallback from '@/components/auth/AuthCallback'

// ── Mocks ────────────────────────────────────────────────────────────────────
const { mockNavigate, mockOnAuthStateChange, mockGetSession, mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: mockOnAuthStateChange,
      getSession: mockGetSession,
      getUser: mockGetUser,
    },
    from: mockFrom,
  },
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

// ── Helpers ──────────────────────────────────────────────────────────────────
function renderPage() {
  return render(
    <MemoryRouter>
      <AuthCallback />
    </MemoryRouter>,
  )
}

/** Helper: set up mockFrom to return a profile with the given full_name */
function mockProfileLookup(fullName: string | null) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: fullName ? { full_name: fullName } : null, error: null }),
      }),
    }),
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('AuthCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockGetUser.mockResolvedValue({ data: { user: null } })
    mockProfileLookup(null)
  })

  it('renders loading spinner', () => {
    renderPage()
    expect(screen.getByTestId('auth-callback-page')).toBeDefined()
    expect(screen.getByText('Signing you in…')).toBeDefined()
  })

  it('navigates to /reset-password on PASSWORD_RECOVERY event', () => {
    let capturedCallback: ((event: string) => void) | null = null
    mockOnAuthStateChange.mockImplementation(
      (callback: unknown) => {
        capturedCallback = callback as (event: string) => void
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    )
    renderPage()
    expect(capturedCallback).not.toBeNull()
    capturedCallback!('PASSWORD_RECOVERY')
    expect(mockNavigate).toHaveBeenCalledWith('/reset-password', { replace: true })
  })

  it('navigates to /home/rider on SIGNED_IN when user has profile', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileLookup('Jane Smith')

    let capturedCallback: ((event: string) => void) | null = null
    mockOnAuthStateChange.mockImplementation(
      (callback: unknown) => {
        capturedCallback = callback as (event: string) => void
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    )
    renderPage()
    capturedCallback!('SIGNED_IN')
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/home/rider', { replace: true })
    })
  })

  it('navigates to /onboarding/profile on SIGNED_IN when user has no profile', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileLookup(null)

    let capturedCallback: ((event: string) => void) | null = null
    mockOnAuthStateChange.mockImplementation(
      (callback: unknown) => {
        capturedCallback = callback as (event: string) => void
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    )
    renderPage()
    capturedCallback!('SIGNED_IN')
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/profile', { replace: true })
    })
  })

  it('navigates immediately if session already exists (existing profile)', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'abc', user: { id: '1' } } },
    })
    mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } })
    mockProfileLookup('Jane Smith')

    renderPage()
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/home/rider', { replace: true })
    })
  })

  it('does not navigate when no session and no auth event', async () => {
    renderPage()
    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('unsubscribes from auth state change on unmount', () => {
    const mockUnsubscribe = vi.fn()
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    })
    const { unmount } = renderPage()
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalled()
  })
})
