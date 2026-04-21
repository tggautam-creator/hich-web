import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BankOnboardPrompt from '@/components/ride/BankOnboardPrompt'

vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(),
}))

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderWith(balance: number, hasBank: boolean) {
  return render(
    <MemoryRouter>
      <BankOnboardPrompt walletBalanceCents={balance} hasBank={hasBank} />
    </MemoryRouter>,
  )
}

describe('BankOnboardPrompt (F4)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockNavigate.mockReset()
  })

  it('does not render when bank is already linked', () => {
    renderWith(2500, true)
    expect(screen.queryByTestId('bank-onboard-prompt')).not.toBeInTheDocument()
  })

  it('does not render when wallet balance is zero', () => {
    renderWith(0, false)
    expect(screen.queryByTestId('bank-onboard-prompt')).not.toBeInTheDocument()
  })

  it('renders when balance > 0 and bank is not linked', () => {
    renderWith(1500, false)
    expect(screen.getByTestId('bank-onboard-prompt')).toBeInTheDocument()
    expect(screen.getByTestId('bank-onboard-prompt').textContent).toContain('$15.00')
  })

  it('hides after dismiss and stays hidden at same balance', () => {
    const { rerender } = renderWith(1500, false)
    fireEvent.click(screen.getByTestId('bank-onboard-prompt-dismiss'))
    expect(screen.queryByTestId('bank-onboard-prompt')).not.toBeInTheDocument()

    // Re-mount at the same balance — still dismissed.
    rerender(
      <MemoryRouter>
        <BankOnboardPrompt walletBalanceCents={1500} hasBank={false} />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('bank-onboard-prompt')).not.toBeInTheDocument()
  })

  it('re-appears after a new earning bump following dismissal', () => {
    const { rerender } = renderWith(1500, false)
    fireEvent.click(screen.getByTestId('bank-onboard-prompt-dismiss'))

    // New ride completes, balance grew — prompt should return.
    rerender(
      <MemoryRouter>
        <BankOnboardPrompt walletBalanceCents={2500} hasBank={false} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('bank-onboard-prompt')).toBeInTheDocument()
  })

  it('navigates to /stripe/payouts on accept', () => {
    renderWith(2500, false)
    fireEvent.click(screen.getByTestId('bank-onboard-prompt-accept'))
    expect(mockNavigate).toHaveBeenCalledWith('/stripe/payouts')
  })
})
