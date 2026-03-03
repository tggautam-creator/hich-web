/**
 * CheckInbox screen tests
 *
 * Verifies:
 *  1. Page renders
 *  2. Submitted email is displayed
 *  3. Resend button is disabled on initial render (60s cooldown)
 *  4. Resend button text shows countdown
 *  5. Countdown decrements every second
 *  6. Resend button is enabled after 60s
 *  7. Resend button stays disabled at 59s
 *  8. Navigates to /onboarding/profile on SIGNED_IN auth event
 *  9. Calls signInWithOtp after countdown and resend click
 * 10. Resets countdown to 60 after successful resend
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CheckInbox from '@/components/CheckInbox'

/* ── Mocks ──────────────────────────────────────────────────────────── */

const { mockSignInWithOtp, mockNavigate, mockOnAuthStateChange } = vi.hoisted(() => ({
  mockSignInWithOtp: vi.fn(),
  mockNavigate: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: mockSignInWithOtp,
      onAuthStateChange: mockOnAuthStateChange,
    },
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

/* ── Tests ──────────────────────────────────────────────────────────── */

describe('CheckInbox screen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSignInWithOtp.mockReset()
    mockNavigate.mockReset()
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
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

  it('resend button is disabled initially (60s cooldown)', () => {
    renderCheckInbox()
    expect(screen.getByTestId('resend-button')).toBeDisabled()
  })

  it('resend button shows countdown text when disabled', () => {
    renderCheckInbox()
    expect(screen.getByTestId('resend-button').textContent).toContain('Resend in 60s')
  })

  it('countdown decrements every second', () => {
    renderCheckInbox()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByTestId('resend-button').textContent).toContain('Resend in 55s')
  })

  it('resend button stays disabled at 59s', () => {
    renderCheckInbox()
    act(() => { vi.advanceTimersByTime(59000) })
    expect(screen.getByTestId('resend-button')).toBeDisabled()
  })

  it('resend button is enabled after 60s', () => {
    renderCheckInbox()
    act(() => { vi.advanceTimersByTime(60000) })
    expect(screen.getByTestId('resend-button')).not.toBeDisabled()
    expect(screen.getByTestId('resend-button').textContent).toContain('Resend email')
  })

  it('navigates to /onboarding/profile on SIGNED_IN auth event', () => {
    let capturedCallback: ((event: string) => void) | null = null
    mockOnAuthStateChange.mockImplementation(
      (callback: unknown) => {
        capturedCallback = callback as (event: string) => void
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    )
    renderCheckInbox()
    expect(capturedCallback).not.toBeNull()
    act(() => { capturedCallback!('SIGNED_IN') })
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding/profile')
  })

  it('calls signInWithOtp with the email after countdown expires and resend is clicked', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })
    renderCheckInbox('maya@ucdavis.edu')
    act(() => { vi.advanceTimersByTime(60000) })
    // fireEvent.click avoids userEvent async internals conflicting with fake timers
    await act(async () => { fireEvent.click(screen.getByTestId('resend-button')) })
    expect(mockSignInWithOtp).toHaveBeenCalledWith({ email: 'maya@ucdavis.edu' })
  })

  it('resets countdown to 60 after successful resend', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })
    renderCheckInbox()
    act(() => { vi.advanceTimersByTime(60000) })
    // await act flushes the async handleResend chain and the subsequent
    // phase-change useEffect that resets countdown — assert directly after
    await act(async () => { fireEvent.click(screen.getByTestId('resend-button')) })
    expect(screen.getByTestId('resend-button')).toBeDisabled()
  })
})
