import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AuthCallback from '@/components/auth/AuthCallback'

// ── Mocks ────────────────────────────────────────────────────────────────────
const { mockNavigate, mockOnAuthStateChange, mockGetSession } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: mockOnAuthStateChange,
      getSession: mockGetSession,
    },
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

// ── Tests ────────────────────────────────────────────────────────────────────
describe('AuthCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
    mockGetSession.mockResolvedValue({ data: { session: null } })
  })

  it('renders loading spinner', () => {
    renderPage()
    expect(screen.getByTestId('auth-callback-page')).toBeDefined()
    expect(screen.getByText('Signing you in…')).toBeDefined()
  })

  it('navigates to /onboarding/profile on SIGNED_IN event', () => {
    let capturedCallback: ((event: string) => void) | null = null
    mockOnAuthStateChange.mockImplementation(
      (callback: unknown) => {
        capturedCallback = callback as (event: string) => void
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    )
    renderPage()
    expect(capturedCallback).not.toBeNull()
    capturedCallback!('SIGNED_IN')
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding/profile', { replace: true })
  })

  it('navigates immediately if session already exists', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'abc', user: { id: '1' } } },
    })
    renderPage()
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/profile', { replace: true })
    })
  })

  it('does not navigate when no session and no SIGNED_IN event', async () => {
    renderPage()
    // Give async getSession a tick to resolve
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
