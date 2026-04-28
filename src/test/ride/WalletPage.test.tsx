/**
 * WalletPage tests
 *
 * Verifies:
 *  1. Shows loading spinner initially
 *  2. Shows wallet balance formatted as dollars
 *  3. Add Funds button navigates to /wallet/add
 *  4. Transaction list renders items
 *  5. Empty state when no transactions
 *  6. Topup shows green +amount
 *  7. Fare debit shows red −amount
 *  8. Back button exists
 *  9. Cents display correctly ($12.50 not $12.5)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WalletPage from '@/components/ride/WalletPage'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  },
}))

const profileRef: { current: Record<string, unknown> } = { current: { id: 'user-001', wallet_balance: 2350 } }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { profile: profileRef.current, refreshProfile: async () => {} }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
}))

// ── Fetch mock ────────────────────────────────────────────────────────────────

const mockTransactions = [
  {
    id: 'tx-1',
    type: 'topup',
    amount_cents: 2000,
    balance_after_cents: 2000,
    description: 'Added $20.00 to wallet',
    created_at: '2026-03-01T10:00:00Z',
  },
  {
    id: 'tx-2',
    type: 'fare_debit',
    amount_cents: -850,
    balance_after_cents: 1150,
    description: null,
    created_at: '2026-03-02T14:30:00Z',
  },
  {
    id: 'tx-3',
    type: 'fare_credit',
    amount_cents: 1200,
    balance_after_cents: 2350,
    description: null,
    created_at: '2026-03-02T14:30:00Z',
  },
]

let fetchResponse: { ok: boolean; json: () => Promise<unknown> }

beforeEach(() => {
  fetchResponse = {
    ok: true,
    json: () => Promise.resolve({ transactions: mockTransactions }),
  }

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResponse))
  profileRef.current = { id: 'user-001', wallet_balance: 2350 }
})

function renderWallet() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/wallet']}>
        <Routes>
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/wallet/add" element={<div data-testid="add-funds-page">Add Funds</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WalletPage', () => {
  it('shows wallet balance formatted as dollars', async () => {
    renderWallet()
    const balance = screen.getByTestId('wallet-balance')
    expect(balance.textContent).toBe('$23.50')
  })

  it('shows Add Funds button', () => {
    renderWallet()
    expect(screen.getByTestId('add-funds-button')).toBeInTheDocument()
  })

  it('navigates to /wallet/add when Add Funds is clicked', async () => {
    renderWallet()
    fireEvent.click(screen.getByTestId('add-funds-button'))
    await waitFor(() => {
      expect(screen.getByTestId('add-funds-page')).toBeInTheDocument()
    })
  })

  it('shows transaction list after loading', async () => {
    renderWallet()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-list')).toBeInTheDocument()
    })
    const items = screen.getAllByTestId('transaction-item')
    expect(items).toHaveLength(3)
  })

  it('shows empty state when no transactions', async () => {
    fetchResponse = {
      ok: true,
      json: () => Promise.resolve({ transactions: [] }),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResponse))

    renderWallet()
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })
    // Slice 10: rider-default profile lands on the "Top up to ride
    // fee-free" variant with an Add Funds CTA.
    expect(screen.getByText('Top up to ride fee-free')).toBeInTheDocument()
    expect(screen.getByTestId('empty-state-add-funds')).toBeInTheDocument()
  })

  it('displays topup as green +amount', async () => {
    renderWallet()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-list')).toBeInTheDocument()
    })
    const amounts = screen.getAllByTestId('transaction-amount')
    // First transaction is topup $20.00
    expect(amounts[0].textContent).toBe('+$20.00')
    expect(amounts[0].className).toContain('text-success')
  })

  it('displays fare_debit as red −amount', async () => {
    renderWallet()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-list')).toBeInTheDocument()
    })
    const amounts = screen.getAllByTestId('transaction-amount')
    // Second transaction is fare_debit
    expect(amounts[1].textContent).toBe('−$8.50')
    expect(amounts[1].className).toContain('text-danger')
  })

  it('displays fare_credit as green +amount', async () => {
    renderWallet()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-list')).toBeInTheDocument()
    })
    const amounts = screen.getAllByTestId('transaction-amount')
    // Third transaction is fare_credit $12.00
    expect(amounts[2].textContent).toBe('+$12.00')
    expect(amounts[2].className).toContain('text-success')
  })

  it('shows bottom navigation with payment tab', () => {
    renderWallet()
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument()
    expect(screen.getByTestId('payment-tab')).toBeInTheDocument()
  })

  it('displays zero balance correctly', () => {
    profileRef.current = { id: 'user-001', wallet_balance: 0 }
    renderWallet()
    expect(screen.getByTestId('wallet-balance').textContent).toBe('$0.00')
  })

  it('shows loading spinner initially', () => {
    // Make fetch hang to keep loading state
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    renderWallet()
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  // F6 — Pre-bank wallet UX labels
  it('tags driver earnings with "Link bank to withdraw" when no bank is linked', async () => {
    profileRef.current = {
      id: 'user-001',
      wallet_balance: 2350,
      is_driver: true,
      stripe_onboarding_complete: false,
    }
    renderWallet()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-list')).toBeInTheDocument()
    })
    const tags = screen.getAllByTestId('tx-pending-payout-tag')
    // fare_credit tx should be tagged; topup + fare_debit should not.
    expect(tags.length).toBe(1)
    expect(tags[0].textContent).toContain('Link bank to withdraw')
  })

  it('does NOT tag earnings once bank is linked', async () => {
    profileRef.current = {
      id: 'user-001',
      wallet_balance: 2350,
      is_driver: true,
      stripe_onboarding_complete: true,
    }
    renderWallet()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-list')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('tx-pending-payout-tag')).not.toBeInTheDocument()
  })

  it('does NOT tag earnings for riders (non-drivers)', async () => {
    profileRef.current = {
      id: 'user-001',
      wallet_balance: 2350,
      is_driver: false,
      stripe_onboarding_complete: false,
    }
    renderWallet()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-list')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('tx-pending-payout-tag')).not.toBeInTheDocument()
  })
})
