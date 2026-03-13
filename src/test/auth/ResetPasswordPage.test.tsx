import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ResetPasswordPage from '@/components/auth/ResetPasswordPage'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockUpdateUser, mockNavigate } = vi.hoisted(() => ({
  mockUpdateUser: vi.fn(),
  mockNavigate:   vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { updateUser: mockUpdateUser },
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>,
  )
}

const VALID_PASSWORD = 'securePass1'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mockUpdateUser.mockReset()
    mockNavigate.mockReset()
  })

  it('renders page wrapper', () => {
    renderPage()
    expect(screen.getByTestId('reset-password-page')).toBeInTheDocument()
  })

  it('renders password and confirm inputs', () => {
    renderPage()
    expect(screen.getByTestId('password-input')).toBeInTheDocument()
    expect(screen.getByTestId('confirm-password-input')).toBeInTheDocument()
  })

  it('shows error when password is too short', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('password-input'), 'short1')
    await user.type(screen.getByTestId('confirm-password-input'), 'short1')
    await user.click(screen.getByTestId('submit-button'))
    expect(screen.getByTestId('field-error')).toBeInTheDocument()
    expect(screen.getByTestId('field-error').textContent).toContain('at least 8 characters')
  })

  it('shows error when password has no number', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('password-input'), 'NoNumberPass')
    await user.type(screen.getByTestId('confirm-password-input'), 'NoNumberPass')
    await user.click(screen.getByTestId('submit-button'))
    expect(screen.getByTestId('field-error')).toBeInTheDocument()
    expect(screen.getByTestId('field-error').textContent).toContain('at least one number')
  })

  it('shows error when passwords do not match', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('password-input'), VALID_PASSWORD)
    await user.type(screen.getByTestId('confirm-password-input'), 'differentPass1')
    await user.click(screen.getByTestId('submit-button'))
    expect(screen.getByTestId('field-error')).toBeInTheDocument()
    expect(screen.getByTestId('field-error').textContent).toContain('do not match')
  })

  it('calls updateUser and shows success on valid submit', async () => {
    mockUpdateUser.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('password-input'), VALID_PASSWORD)
    await user.type(screen.getByTestId('confirm-password-input'), VALID_PASSWORD)
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(screen.getByTestId('success-message')).toBeInTheDocument()
    })
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: VALID_PASSWORD })
  })

  it('shows server error on failure', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'Token expired' } })
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('password-input'), VALID_PASSWORD)
    await user.type(screen.getByTestId('confirm-password-input'), VALID_PASSWORD)
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(screen.getByTestId('server-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('server-error').textContent).toContain('Token expired')
  })

  it('back button navigates to /login', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('back-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })

  it('"Go to login" in success state navigates to /login', async () => {
    mockUpdateUser.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('password-input'), VALID_PASSWORD)
    await user.type(screen.getByTestId('confirm-password-input'), VALID_PASSWORD)
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => screen.getByTestId('go-to-login-button'))
    await user.click(screen.getByTestId('go-to-login-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })
})
