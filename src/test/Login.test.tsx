/**
 * Login — email + password tests
 *
 * Verifies:
 *  1.  Email input renders
 *  2.  Password input renders
 *  3.  "Welcome back" heading present
 *  4.  Error shown for non-.edu email
 *  5.  No error for valid .edu email
 *  6.  Green checkmark indicator for valid .edu email
 *  7.  Submit button disabled when email is empty
 *  8.  Submit button disabled when email is invalid
 *  9.  Submit button disabled when password is empty (valid email, no password)
 * 10.  Submit button enabled when valid .edu email AND password both entered
 * 11.  Calls signInWithPassword with lowercased email + password
 * 12.  Navigates to /home/rider on success
 * 13.  Shows "Incorrect email or password" for invalid-credentials error
 * 14.  Shows raw server error message for other errors
 * 15.  "Sign up" button navigates to /signup
 * 16.  "Forgot password?" link navigates to /forgot-password
 * 17.  "Use magic link" button calls signInWithOtp
 * 18.  "Use magic link" button disabled when email invalid
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Login from '@/components/Login'

/* ── Mocks ──────────────────────────────────────────────────────────── */

const { mockSignInWithPassword, mockSignInWithOtp, mockNavigate, mockGetUser, mockSingle } = vi.hoisted(() => ({
  mockSignInWithPassword: vi.fn(),
  mockSignInWithOtp:      vi.fn(),
  mockNavigate:           vi.fn(),
  mockGetUser:            vi.fn(),
  mockSingle:             vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signInWithOtp:      mockSignInWithOtp,
      getUser:            mockGetUser,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockSingle,
        }),
      }),
    }),
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

const EDU_EMAIL = 'maya@ucdavis.edu'
const PASSWORD  = 'secret123'

/* ── Tests ──────────────────────────────────────────────────────────── */

describe('Login screen', () => {
  beforeEach(() => {
    mockSignInWithPassword.mockReset()
    mockSignInWithOtp.mockReset()
    mockNavigate.mockReset()
    mockGetUser.mockReset()
    mockSingle.mockReset()
    // Default: completed rider profile
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } })
    mockSingle.mockResolvedValue({ data: { full_name: 'Maya Test', is_driver: false }, error: null })
  })

  // ── Rendering ────────────────────────────────────────────────────────

  it('renders the email input', () => {
    renderLogin()
    expect(screen.getByTestId('email-input')).toBeInTheDocument()
  })

  it('renders the password input', () => {
    renderLogin()
    expect(screen.getByTestId('password-input')).toBeInTheDocument()
  })

  it('renders "Welcome back" heading', () => {
    renderLogin()
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })

  // ── Email validation ─────────────────────────────────────────────────

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
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    // The specific error message should not appear (the valid-indicator is fine)
    expect(screen.queryByText('Please use your .edu university email address.')).toBeNull()
  })

  it('shows the green checkmark indicator for a valid .edu email', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    expect(screen.getByTestId('email-valid-indicator')).toBeInTheDocument()
  })

  // ── Submit button disabled states ────────────────────────────────────

  it('submit button is disabled when email is empty', () => {
    renderLogin()
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('submit button is disabled for an invalid (non-.edu) email', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), 'maya@gmail.com')
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('submit button is disabled when email is valid but password is empty', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    // Password field untouched — button must still be disabled
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('submit button is enabled when both email is valid .edu and password is entered', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    await user.type(screen.getByTestId('password-input'), PASSWORD)
    expect(screen.getByTestId('submit-button')).not.toBeDisabled()
  })

  // ── Submit behaviour ─────────────────────────────────────────────────

  it('calls signInWithPassword with the lowercased email and password', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), 'Maya@UCDavis.EDU')
    await user.type(screen.getByTestId('password-input'), PASSWORD)
    await user.click(screen.getByTestId('submit-button'))
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email:    'maya@ucdavis.edu',
      password: PASSWORD,
    })
  })

  it('navigates to /home/rider when user is not a driver', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null })
    mockSingle.mockResolvedValue({ data: { full_name: 'Maya Test', is_driver: false }, error: null })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    await user.type(screen.getByTestId('password-input'), PASSWORD)
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/home/rider')
    })
  })

  it('navigates to /home/driver when user is a driver', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null })
    mockSingle.mockResolvedValue({ data: { full_name: 'Maya Test', is_driver: true }, error: null })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    await user.type(screen.getByTestId('password-input'), PASSWORD)
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/home/driver')
    })
  })
  it('navigates to /onboarding/profile when profile is incomplete', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null })
    mockSingle.mockResolvedValue({ data: null, error: { message: 'No rows' } })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    await user.type(screen.getByTestId('password-input'), PASSWORD)
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/profile')
    })
  })
  // ── Error handling ───────────────────────────────────────────────────

  it('shows "Incorrect email or password" for invalid-credentials error', async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    await user.type(screen.getByTestId('password-input'), 'wrongpass1')
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      const alert = screen.getByTestId('server-error')
      expect(alert).toBeInTheDocument()
      expect(alert.textContent).toContain('Incorrect email or password')
    })
  })

  it('shows the raw server error message for other auth errors', async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: 'Rate limit exceeded' },
    })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    await user.type(screen.getByTestId('password-input'), PASSWORD)
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(screen.getByTestId('server-error').textContent).toContain('Rate limit exceeded')
    })
  })

  // ── Navigation ───────────────────────────────────────────────────────

  it('"Sign up" button navigates to /signup', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByText('Sign up'))
    expect(mockNavigate).toHaveBeenCalledWith('/signup')
  })

  // ── Forgot password + magic link ───────────────────────────────────

  it('"Forgot password?" link navigates to /forgot-password', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByTestId('forgot-password-link'))
    expect(mockNavigate).toHaveBeenCalledWith('/forgot-password')
  })

  it('"Use magic link" button is disabled when email is invalid', () => {
    renderLogin()
    expect(screen.getByTestId('magic-link-button')).toBeDisabled()
  })

  it('"Use magic link" calls signInWithOtp and navigates to /check-inbox', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    await user.click(screen.getByTestId('magic-link-button'))
    await waitFor(() => {
      expect(mockSignInWithOtp).toHaveBeenCalledWith({
        email: 'maya@ucdavis.edu',
        options: { emailRedirectTo: expect.stringContaining('/auth/callback') },
      })
    })
    expect(mockNavigate).toHaveBeenCalledWith('/check-inbox', {
      state: { email: 'maya@ucdavis.edu' },
    })
  })
})
