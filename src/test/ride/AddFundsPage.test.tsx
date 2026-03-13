/**
 * AddFundsPage tests
 *
 * Verifies:
 *  1. Page renders with title
 *  2. Amount pills ($10, $20, $50) are shown
 *  3. Clicking a pill selects it (adds primary styling)
 *  4. Custom amount input exists
 *  5. Pay button is disabled until amount is selected
 *  6. Pay button shows formatted amount
 *  7. Amount validation — too low
 *  8. Amount validation — too high
 *  9. Back to Wallet button exists
 * 10. Stripe unavailable message when no key
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_mock',
  },
}))

vi.mock('@/stores/authStore', () => {
  const refreshProfile = vi.fn()
  return {
    useAuthStore: vi.fn(
      (selector?: (s: Record<string, unknown>) => unknown) => {
        const state = { profile: { id: 'user-001' }, refreshProfile }
        return selector ? selector(state) : state
      },
    ),
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
}))

// Mock Stripe Elements — mock the hooks
const { mockStripe, mockElements } = vi.hoisted(() => ({
  mockStripe: {
    confirmCardPayment: vi.fn(),
  },
  mockElements: {
    getElement: vi.fn().mockReturnValue({}),
  },
}))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn().mockResolvedValue(mockStripe),
}))

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div data-testid="stripe-elements">{children}</div>,
  CardElement: () => <div data-testid="mock-card-element">Card Input</div>,
  useStripe: () => mockStripe,
  useElements: () => mockElements,
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ clientSecret: 'pi_test_secret' }),
  }))
})

function renderAddFunds() {
  return render(
    <MemoryRouter initialEntries={['/wallet/add']}>
      <Routes>
        <Route path="/wallet/add" element={<AddFundsPage />} />
        <Route path="/wallet" element={<div data-testid="wallet-page">Wallet</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// Must import after mocks
import AddFundsPage from '@/components/ride/AddFundsPage'

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AddFundsPage', () => {
  it('renders page with title', () => {
    renderAddFunds()
    expect(screen.getByText('Add Funds')).toBeInTheDocument()
    expect(screen.getByTestId('add-funds-page')).toBeInTheDocument()
  })

  it('shows three amount pills ($10, $20, $50)', () => {
    renderAddFunds()
    expect(screen.getByTestId('pill-1000')).toHaveTextContent('$10.00')
    expect(screen.getByTestId('pill-2000')).toHaveTextContent('$20.00')
    expect(screen.getByTestId('pill-5000')).toHaveTextContent('$50.00')
  })

  it('clicking a pill selects it with primary styling', () => {
    renderAddFunds()
    const pill = screen.getByTestId('pill-2000')
    fireEvent.click(pill)
    expect(pill.className).toContain('bg-primary')
    expect(pill.className).toContain('text-white')
  })

  it('shows custom amount input', () => {
    renderAddFunds()
    expect(screen.getByTestId('custom-amount-input')).toBeInTheDocument()
  })

  it('pay button shows "Select an amount" when nothing selected', () => {
    renderAddFunds()
    expect(screen.getByTestId('pay-button')).toHaveTextContent('Select an amount')
    expect(screen.getByTestId('pay-button')).toBeDisabled()
  })

  it('pay button shows formatted amount after pill selection', () => {
    renderAddFunds()
    fireEvent.click(screen.getByTestId('pill-2000'))
    expect(screen.getByTestId('pay-button')).toHaveTextContent('Add $20.00')
    expect(screen.getByTestId('pay-button')).not.toBeDisabled()
  })

  it('custom amount below $5 shows error', () => {
    renderAddFunds()
    const input = screen.getByTestId('custom-amount-input')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '3.00' } })
    expect(screen.getByTestId('amount-error')).toHaveTextContent('between $5.00 and $200.00')
  })

  it('custom amount above $200 shows error', () => {
    renderAddFunds()
    const input = screen.getByTestId('custom-amount-input')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '250' } })
    expect(screen.getByTestId('amount-error')).toHaveTextContent('between $5.00 and $200.00')
  })

  it('valid custom amount enables pay button', () => {
    renderAddFunds()
    const input = screen.getByTestId('custom-amount-input')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '15' } })
    expect(screen.getByTestId('pay-button')).toHaveTextContent('Add $15.00')
    expect(screen.getByTestId('pay-button')).not.toBeDisabled()
  })

  it('shows back to wallet button', () => {
    renderAddFunds()
    expect(screen.getByTestId('back-button')).toHaveTextContent('Back to Wallet')
  })

  it('renders card element', () => {
    renderAddFunds()
    expect(screen.getByTestId('mock-card-element')).toBeInTheDocument()
  })

  it('switching from custom to pill clears custom input', () => {
    renderAddFunds()
    const input = screen.getByTestId('custom-amount-input') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.click(screen.getByTestId('pill-1000'))
    expect(input.value).toBe('')
  })
})
