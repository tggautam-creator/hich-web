/**
 * TransactionHistoryPage tests — dedicated wallet sub-page (2026-06-05).
 *
 * iOS reference: ios/Tago/Features/Payment/TransactionHistoryPage.swift
 *
 * Covers:
 *  - Day-grouped sections (Today / Yesterday / Mon DD)
 *  - First-page render via /api/wallet/transactions
 *  - Row tap routes to /wallet/transaction/:id
 *  - Empty + error (with Retry) + loading states
 *  - Back nav routes to /wallet
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TransactionHistoryPage from '@/components/ride/TransactionHistoryPage'

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  },
}))

const profileRef: { current: Record<string, unknown> } = { current: { id: 'user-001', is_driver: false } }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { profile: profileRef.current }
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

// Tests use absolute dates so they don't depend on the test clock.
// Three rows: two on 2026-06-05 and one on 2026-06-04 — verifies the
// section grouping splits them by day.
const today = '2026-06-05T14:30:00Z'
const todayEarlier = '2026-06-05T08:15:00Z'
const yesterday = '2026-06-04T19:00:00Z'

const mockTx = [
  { id: 'tx-1', type: 'topup', amount_cents: 2000, balance_after_cents: 2000, description: 'Added $20', created_at: today },
  { id: 'tx-2', type: 'fare_debit', amount_cents: -850, balance_after_cents: 1150, description: null, created_at: todayEarlier },
  { id: 'tx-3', type: 'fare_credit', amount_cents: 1200, balance_after_cents: 2350, description: null, counterparty_name: 'Sam', ride_id: 'r-1', created_at: yesterday },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/wallet/history']}>
      <Routes>
        <Route path="/wallet/history" element={<TransactionHistoryPage />} />
        <Route path="/wallet" element={<div data-testid="wallet-page-mock">Wallet</div>} />
        <Route path="/wallet/transaction/:id" element={<div data-testid="tx-detail-page">Detail</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-06-05T15:00:00Z'))
  profileRef.current = { id: 'user-001', is_driver: false }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ transactions: mockTx, next_cursor: null }),
  }))
  // jsdom doesn't ship IntersectionObserver — stub it so the
  // infinite-scroll wiring doesn't throw during render.
  vi.stubGlobal('IntersectionObserver', class {
    observe = vi.fn()
    disconnect = vi.fn()
    unobserve = vi.fn()
    takeRecords = vi.fn(() => [])
  })
})

describe('TransactionHistoryPage', () => {
  it('renders the page wrapper', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-history-page')).toBeInTheDocument()
    })
  })

  it('day-groups rows into Today and Yesterday sections', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-history-section-today')).toBeInTheDocument()
    })
    expect(screen.getByTestId('transaction-history-section-yesterday')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
  })

  it('renders all returned transactions', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByTestId('transaction-item')).toHaveLength(3)
    })
  })

  it('tapping a row navigates to /wallet/transaction/:id', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByTestId('transaction-item').length).toBeGreaterThan(0)
    })
    fireEvent.click(screen.getAllByTestId('transaction-item')[0])
    await waitFor(() => {
      expect(screen.getByTestId('tx-detail-page')).toBeInTheDocument()
    })
  })

  it('shows the empty state when no transactions return', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ transactions: [], next_cursor: null }),
    }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-history-empty')).toBeInTheDocument()
    })
  })

  it('shows the error banner + Retry when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-history-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('transaction-history-retry')).toBeInTheDocument()
  })

  it('back button routes to /wallet', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-history-back')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('transaction-history-back'))
    await waitFor(() => {
      expect(screen.getByTestId('wallet-page-mock')).toBeInTheDocument()
    })
  })

  it('marks credit rows green and debit rows red', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByTestId('transaction-amount')).toHaveLength(3)
    })
    const amounts = screen.getAllByTestId('transaction-amount')
    // Order: tx-1 (today, topup +$20), tx-2 (todayEarlier, debit −$8.50), tx-3 (yesterday, credit +$12)
    expect(amounts[0].className).toContain('text-success')
    expect(amounts[1].className).toContain('text-danger')
    expect(amounts[2].className).toContain('text-success')
  })

  // ── On-focus refetch (iOS scenePhase parity) ───────────────────────

  it('reloads the first page on visibilitychange to visible', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ transactions: mockTx, next_cursor: null }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    renderPage()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const firstCallCount = fetchSpy.mock.calls.length

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() => {
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(firstCallCount)
    })
  })

  it('does not show "That\'s everything." footer for short histories', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByTestId('transaction-item').length).toBe(3)
    })
    // iOS gates the footer on count >= 8 — short histories shouldn't show it.
    expect(screen.queryByTestId('transaction-history-end')).not.toBeInTheDocument()
  })
})
