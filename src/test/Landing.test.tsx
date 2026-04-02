/**
 * Landing page tests
 *
 * Verifies:
 *  1. TAGO brand renders
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

  it('renders the TAGO brand name', () => {
    renderLanding()
    expect(screen.getByTestId('landing-logo')).toBeInTheDocument()
    expect(screen.getByTestId('landing-logo').textContent).toContain('TAGO')
  })

  it('renders "Get started" CTA button', () => {
    renderLanding()
    const btn = screen.getByTestId('cta-signup')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('Get started')
  })

  it('renders "I have an account" CTA button', () => {
    renderLanding()
    const btn = screen.getByTestId('cta-login')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('I have an account')
  })

  it('renders trust strip with all three claims', () => {
    renderLanding()
    const strip = screen.getByTestId('trust-strip')
    expect(strip).toBeInTheDocument()
    expect(strip.textContent).toContain('Verified community')
    expect(strip.textContent).toContain('Instant matching')
    expect(strip.textContent).toContain('Automatic payments')
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
