/**
 * Login — .edu Email Entry tests
 *
 * Verifies:
 *  1. Email input renders
 *  2. Error shown for non-.edu email
 *  3. No error for valid .edu email
 *  4. Green checkmark indicator for valid .edu email
 *  5. Submit button disabled when email is empty
 *  6. Submit button disabled when email is invalid
 *  7. Submit button enabled when email is valid .edu
 *  8. supabase.auth.signInWithOtp called with lowercased email on submit
 *  9. Navigates to /check-inbox with email in state after successful OTP send
 * 10. Server error shown when OTP call fails
 * 11. "Sign up" link navigates to /signup
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Login from '@/components/Login'

/* ── Mocks ──────────────────────────────────────────────────────────── */

const { mockSignInWithOtp, mockNavigate } = vi.hoisted(() => ({
  mockSignInWithOtp: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { signInWithOtp: mockSignInWithOtp },
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

/* ── Helpers ─────────────────────────────────────────────────────────── */

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
}

/* ── Login screen integration tests ────────────────────────────────── */

describe('Login screen', () => {
  beforeEach(() => {
    mockSignInWithOtp.mockReset()
    mockNavigate.mockReset()
  })

  it('renders the email input', () => {
    renderLogin()
    expect(screen.getByTestId('email-input')).toBeInTheDocument()
  })

  it('renders "Welcome back" heading', () => {
    renderLogin()
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })

  it('shows an error when a non-.edu email is typed', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), 'maya@gmail.com')
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert.textContent).toMatch(/\.edu/)
  })

  it('shows no error for a valid .edu email', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), 'maya@ucdavis.edu')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the green checkmark indicator for a valid .edu email', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), 'maya@ucdavis.edu')
    expect(screen.getByTestId('email-valid-indicator')).toBeInTheDocument()
  })

  it('submit button is disabled when email is empty', () => {
    renderLogin()
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('submit button is disabled for an invalid email', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), 'maya@gmail.com')
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('submit button is enabled for a valid .edu email', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), 'maya@ucdavis.edu')
    expect(screen.getByTestId('submit-button')).not.toBeDisabled()
  })

  it('calls signInWithOtp with the lowercased email on submit', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), 'Maya@UCDavis.EDU')
    await user.click(screen.getByTestId('submit-button'))
    expect(mockSignInWithOtp).toHaveBeenCalledWith({ email: 'maya@ucdavis.edu' })
  })

  it('navigates to /check-inbox with email after successful OTP send', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), 'maya@ucdavis.edu')
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/check-inbox', {
        state: { email: 'maya@ucdavis.edu' },
      })
    })
  })

  it('shows a server error when the OTP call fails', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: 'Rate limit exceeded' } })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), 'maya@ucdavis.edu')
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(screen.getByTestId('server-error')).toBeInTheDocument()
      expect(screen.getByTestId('server-error').textContent).toContain('Rate limit exceeded')
    })
  })

  it('"Sign up" link navigates to /signup', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByText('Sign up'))
    expect(mockNavigate).toHaveBeenCalledWith('/signup')
  })
})
