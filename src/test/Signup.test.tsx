/**
 * Signup — .edu Email Entry tests
 *
 * Verifies:
 *  1. Email input renders
 *  2. Error shown for non-.edu email
 *  3. No error for valid .edu email
 *  4. Green checkmark indicator for valid .edu email
 *  5. Checkmark hidden for invalid email
 *  6. Submit button disabled when email is empty
 *  7. Submit button disabled when email is invalid
 *  8. Submit button enabled when email is valid .edu
 *  9. supabase.auth.signInWithOtp called with lowercased email on submit
 * 10. Navigates to /check-inbox with email in state after successful OTP send
 * 11. Server error shown when OTP call fails
 * 12. isValidEduEmail helper — boundary cases
 * 13. Redirects to /login with pre-filled email when email already exists
 * 14. Does NOT call signInWithOtp when email already exists
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Signup from '@/components/Signup'
import { isValidEduEmail } from '@/lib/validation'

/* ── Mocks ──────────────────────────────────────────────────────────── */

// vi.hoisted ensures these are initialised before vi.mock hoisting runs
const { mockSignInWithOtp, mockNavigate } = vi.hoisted(() => ({
  mockSignInWithOtp: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: mockSignInWithOtp,
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

/* ── Helpers ─────────────────────────────────────────────────────────── */

function renderSignup() {
  return render(
    <MemoryRouter>
      <Signup />
    </MemoryRouter>,
  )
}

/* ── isValidEduEmail unit tests ─────────────────────────────────────── */

describe('isValidEduEmail', () => {
  it('accepts standard .edu addresses', () => {
    expect(isValidEduEmail('maya@ucdavis.edu')).toBe(true)
    expect(isValidEduEmail('ahmed@berkeley.edu')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isValidEduEmail('Maya@UCDavis.EDU')).toBe(true)
  })

  it('rejects non-.edu domains', () => {
    expect(isValidEduEmail('maya@gmail.com')).toBe(false)
    expect(isValidEduEmail('maya@ucdavis.com')).toBe(false)
  })

  it('rejects addresses missing @', () => {
    expect(isValidEduEmail('notanemail.edu')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidEduEmail('')).toBe(false)
  })

  it('rejects addresses where .edu is not the TLD', () => {
    expect(isValidEduEmail('maya@edu.example.com')).toBe(false)
  })
})

/* ── Signup screen integration tests ───────────────────────────────── */

describe('Signup screen', () => {
  beforeEach(() => {
    mockSignInWithOtp.mockReset()
    mockNavigate.mockReset()
    // Default: server says email does not exist
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ exists: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  it('renders the email input', () => {
    renderSignup()
    expect(screen.getByTestId('email-input')).toBeInTheDocument()
  })

  it('shows an error when a non-.edu email is typed', async () => {
    const user = userEvent.setup()
    renderSignup()
    await user.type(screen.getByTestId('email-input'), 'maya@gmail.com')
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert.textContent).toMatch(/\.edu/)
  })

  it('shows no error for a valid .edu email', async () => {
    const user = userEvent.setup()
    renderSignup()
    await user.type(screen.getByTestId('email-input'), 'maya@ucdavis.edu')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the green checkmark indicator for a valid .edu email', async () => {
    const user = userEvent.setup()
    renderSignup()
    await user.type(screen.getByTestId('email-input'), 'maya@ucdavis.edu')
    expect(screen.getByTestId('email-valid-indicator')).toBeInTheDocument()
  })

  it('hides the checkmark indicator for an invalid email', async () => {
    const user = userEvent.setup()
    renderSignup()
    await user.type(screen.getByTestId('email-input'), 'maya@gmail.com')
    expect(screen.queryByTestId('email-valid-indicator')).toBeNull()
  })

  it('submit button is disabled when email is empty', () => {
    renderSignup()
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('submit button is disabled for an invalid email', async () => {
    const user = userEvent.setup()
    renderSignup()
    await user.type(screen.getByTestId('email-input'), 'maya@gmail.com')
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('submit button is enabled for a valid .edu email', async () => {
    const user = userEvent.setup()
    renderSignup()
    await user.type(screen.getByTestId('email-input'), 'maya@ucdavis.edu')
    expect(screen.getByTestId('submit-button')).not.toBeDisabled()
  })

  it('calls signInWithOtp with the lowercased email on submit', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderSignup()
    await user.type(screen.getByTestId('email-input'), 'Maya@UCDavis.EDU')
    await user.click(screen.getByTestId('submit-button'))
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'maya@ucdavis.edu',
    })
  })

  it('navigates to /check-inbox with email after successful OTP send', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderSignup()
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
    renderSignup()
    await user.type(screen.getByTestId('email-input'), 'maya@ucdavis.edu')
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(screen.getByTestId('server-error')).toBeInTheDocument()
      expect(screen.getByTestId('server-error').textContent).toContain('Rate limit exceeded')
    })
  })

  // ── Email already exists — auto-redirect to /login ─────────────────

  it('redirects to /login with email when email already exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ exists: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const user = userEvent.setup()
    renderSignup()
    await user.type(screen.getByTestId('email-input'), 'maya@ucdavis.edu')
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', {
        state: { email: 'maya@ucdavis.edu' },
        replace: true,
      })
    })
  })

  it('does NOT call signInWithOtp when email already exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ exists: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const user = userEvent.setup()
    renderSignup()
    await user.type(screen.getByTestId('email-input'), 'maya@ucdavis.edu')
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', expect.anything())
    })
    expect(mockSignInWithOtp).not.toHaveBeenCalled()
  })
})
