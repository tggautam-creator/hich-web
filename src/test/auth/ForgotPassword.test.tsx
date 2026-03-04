/**
 * ForgotPassword tests
 *
 *  1.  Renders page wrapper
 *  2.  Renders email input
 *  3.  Submit disabled for non-.edu email
 *  4.  Submit enabled for valid .edu email
 *  5.  Calls resetPasswordForEmail with lowercased email
 *  6.  Shows success message after successful send
 *  7.  Shows server error on failure
 *  8.  Back button navigates to /login
 *  9.  "Back to login" button in success state navigates to /login
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ForgotPassword from '@/components/auth/ForgotPassword'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockResetPasswordForEmail, mockNavigate } = vi.hoisted(() => ({
  mockResetPasswordForEmail: vi.fn(),
  mockNavigate:              vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { resetPasswordForEmail: mockResetPasswordForEmail },
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
      <ForgotPassword />
    </MemoryRouter>,
  )
}

const EDU_EMAIL = 'maya@ucdavis.edu'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ForgotPassword', () => {
  beforeEach(() => {
    mockResetPasswordForEmail.mockReset()
    mockNavigate.mockReset()
  })

  it('renders page wrapper', () => {
    renderPage()
    expect(screen.getByTestId('forgot-password-page')).toBeInTheDocument()
  })

  it('renders the email input', () => {
    renderPage()
    expect(screen.getByTestId('email-input')).toBeInTheDocument()
  })

  it('submit button is disabled for non-.edu email', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('email-input'), 'maya@gmail.com')
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('submit button is enabled for valid .edu email', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    expect(screen.getByTestId('submit-button')).not.toBeDisabled()
  })

  it('calls resetPasswordForEmail with the lowercased email', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('email-input'), 'Maya@UCDavis.EDU')
    await user.click(screen.getByTestId('submit-button'))
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('maya@ucdavis.edu')
  })

  it('shows success message after successful send', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(screen.getByTestId('success-message')).toBeInTheDocument()
    })
    expect(screen.getByText('Check your email')).toBeInTheDocument()
  })

  it('shows server error on failure', async () => {
    mockResetPasswordForEmail.mockResolvedValue({
      error: { message: 'Rate limit exceeded' },
    })
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => {
      expect(screen.getByTestId('server-error').textContent).toContain('Rate limit exceeded')
    })
  })

  it('back button navigates to /login', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByTestId('back-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })

  it('"Back to login" in success state navigates to /login', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByTestId('email-input'), EDU_EMAIL)
    await user.click(screen.getByTestId('submit-button'))
    await waitFor(() => screen.getByTestId('back-to-login-button'))
    await user.click(screen.getByTestId('back-to-login-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })
})
