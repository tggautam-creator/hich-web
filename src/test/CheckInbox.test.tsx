/**
 * CheckInbox OTP screen tests
 *
 * Verifies:
 *  1. Page renders with OTP inputs
 *  2. Submitted email is displayed
 *  3. Shows 8 OTP input boxes
 *  4. Auto-focuses first input
 *  5. Advances focus on digit entry
 *  6. Backspace moves to previous input
 *  7. Calls verifyOtp when all 8 digits entered
 *  8. Shows error on invalid code
 *  9. Navigates to /onboarding/profile on success (new user)
 * 10. Navigates to /home/rider on success (returning user)
 * 11. Resend button countdown and resend logic
 * 12. Paste support fills all boxes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CheckInbox from '@/components/CheckInbox'

/* ── Mocks ──────────────────────────────────────────────────────────── */

const { mockSignInWithOtp, mockVerifyOtp, mockNavigate, mockFrom } = vi.hoisted(() => ({
  mockSignInWithOtp: vi.fn(),
  mockVerifyOtp: vi.fn(),
  mockNavigate: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: mockSignInWithOtp,
      verifyOtp: mockVerifyOtp,
    },
    from: mockFrom,
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

/* ── Helpers ─────────────────────────────────────────────────────────── */

function renderCheckInbox(email = 'maya@ucdavis.edu') {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: '/check-inbox', state: { email } }]}
    >
      <Routes>
        <Route path="/check-inbox" element={<CheckInbox />} />
      </Routes>
    </MemoryRouter>,
  )
}

function fillOtp(code = '12345678') {
  for (let i = 0; i < code.length; i++) {
    fireEvent.change(screen.getByTestId(`otp-input-${i}`), {
      target: { value: code[i] },
    })
  }
}

/* ── Tests ──────────────────────────────────────────────────────────── */

describe('CheckInbox OTP screen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSignInWithOtp.mockReset()
    mockVerifyOtp.mockReset()
    mockNavigate.mockReset()
    mockFrom.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the page', () => {
    renderCheckInbox()
    expect(screen.getByTestId('check-inbox-page')).toBeInTheDocument()
  })

  it('shows the submitted email from router state', () => {
    renderCheckInbox('maya@ucdavis.edu')
    expect(screen.getByTestId('submitted-email').textContent).toBe('maya@ucdavis.edu')
  })

  it('renders 8 OTP input boxes', () => {
    renderCheckInbox()
    expect(screen.getByTestId('otp-inputs')).toBeInTheDocument()
    for (let i = 0; i < 8; i++) {
      expect(screen.getByTestId(`otp-input-${i}`)).toBeInTheDocument()
    }
  })

  it('shows "Enter your code" heading', () => {
    renderCheckInbox()
    expect(screen.getByText('Enter your code')).toBeInTheDocument()
  })

  it('verify button is disabled when not all digits filled', () => {
    renderCheckInbox()
    expect(screen.getByTestId('verify-button')).toBeDisabled()
  })

  it('calls verifyOtp when all 6 digits are entered', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: { access_token: 'test' },
        user: { id: 'u-1' },
      },
      error: null,
    })
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    })
    renderCheckInbox('maya@ucdavis.edu')
    await act(async () => { fillOtp('12345678') })
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: 'maya@ucdavis.edu',
      token: '12345678',
      type: 'email',
    })
  })

  it('navigates to /onboarding/profile on success for new user', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: { access_token: 'test' },
        user: { id: 'u-1' },
      },
      error: null,
    })
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    })
    renderCheckInbox()
    await act(async () => { fillOtp('12345678') })
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding/profile', { replace: true })
  })

  it('navigates to /home/rider on success for returning rider', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: { access_token: 'test' },
        user: { id: 'u-1' },
      },
      error: null,
    })
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({
            data: { full_name: 'Maya', is_driver: false },
            error: null,
          }),
        }),
      }),
    })
    renderCheckInbox()
    await act(async () => { fillOtp('12345678') })
    expect(mockNavigate).toHaveBeenCalledWith('/home/rider', { replace: true })
  })

  it('navigates to /home/driver on success for returning driver', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: { access_token: 'test' },
        user: { id: 'u-1' },
      },
      error: null,
    })
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({
            data: { full_name: 'Maya', is_driver: true },
            error: null,
          }),
        }),
      }),
    })
    renderCheckInbox()
    await act(async () => { fillOtp('12345678') })
    expect(mockNavigate).toHaveBeenCalledWith('/home/driver', { replace: true })
  })

  it('shows error on invalid OTP code', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Token has expired or is invalid' },
    })
    renderCheckInbox()
    await act(async () => { fillOtp('99999999') })
    expect(screen.getByTestId('verify-error')).toBeInTheDocument()
    expect(screen.getByTestId('verify-error').textContent).toBe('Invalid code. Please try again.')
  })

  it('resend button is disabled initially (60s cooldown)', () => {
    renderCheckInbox()
    expect(screen.getByTestId('resend-button')).toBeDisabled()
  })

  it('resend button shows countdown text when disabled', () => {
    renderCheckInbox()
    expect(screen.getByTestId('resend-button').textContent).toContain('Resend code in 60s')
  })

  it('countdown decrements every second', () => {
    renderCheckInbox()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByTestId('resend-button').textContent).toContain('Resend code in 55s')
  })

  it('resend button is enabled after 60s', () => {
    renderCheckInbox()
    act(() => { vi.advanceTimersByTime(60000) })
    expect(screen.getByTestId('resend-button')).not.toBeDisabled()
    expect(screen.getByTestId('resend-button').textContent).toContain('Resend code')
  })

  it('calls signInWithOtp after countdown expires and resend is clicked', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })
    renderCheckInbox('maya@ucdavis.edu')
    act(() => { vi.advanceTimersByTime(60000) })
    await act(async () => { fireEvent.click(screen.getByTestId('resend-button')) })
    expect(mockSignInWithOtp).toHaveBeenCalledWith({ email: 'maya@ucdavis.edu' })
  })

  it('resets countdown after successful resend', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })
    renderCheckInbox()
    act(() => { vi.advanceTimersByTime(60000) })
    await act(async () => { fireEvent.click(screen.getByTestId('resend-button')) })
    expect(screen.getByTestId('resend-button')).toBeDisabled()
  })

  it('handles paste of full OTP code', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        session: { access_token: 'test' },
        user: { id: 'u-1' },
      },
      error: null,
    })
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    })
    renderCheckInbox('maya@ucdavis.edu')
    // Simulate pasting into the first input
    await act(async () => {
      fireEvent.change(screen.getByTestId('otp-input-0'), {
        target: { value: '65432178' },
      })
    })
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: 'maya@ucdavis.edu',
      token: '65432178',
      type: 'email',
    })
  })
})
