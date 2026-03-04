/**
 * Landing page tests
 *
 * Verifies:
 *  1. HICH brand renders
 *  2. "Sign up" CTA button renders
 *  3. "Log in" CTA button renders
 *  4. Trust strip renders with all three claims
 *  5. "Sign up" CTA navigates to /signup
 *  6. "Log in" CTA navigates to /login
 *  7. data-testid prop is respected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Landing from '@/components/Landing'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )
}

describe('Landing page', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('renders the HICH brand name', () => {
    renderLanding()
    expect(screen.getByText('HICH')).toBeInTheDocument()
  })

  it('renders "Sign up" CTA button', () => {
    renderLanding()
    const btn = screen.getByTestId('cta-signup')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('Sign up')
  })

  it('renders "Log in" CTA button', () => {
    renderLanding()
    const btn = screen.getByTestId('cta-login')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('Log in')
  })

  it('renders trust strip with all three claims', () => {
    renderLanding()
    const strip = screen.getByTestId('trust-strip')
    expect(strip).toBeInTheDocument()
    expect(strip.textContent).toContain('.edu verified')
    expect(strip.textContent).toContain('QR-confirmed rides')
    expect(strip.textContent).toContain('Fare splitting')
  })

  it('"Sign up" navigates to /signup', async () => {
    const user = userEvent.setup()
    renderLanding()
    await user.click(screen.getByTestId('cta-signup'))
    expect(mockNavigate).toHaveBeenCalledWith('/signup')
  })

  it('"Log in" navigates to /login', async () => {
    const user = userEvent.setup()
    renderLanding()
    await user.click(screen.getByTestId('cta-login'))
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })

  it('renders with a data-testid when provided', () => {
    render(
      <MemoryRouter>
        <Landing data-testid="custom-id" />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('custom-id')).toBeInTheDocument()
  })
})
