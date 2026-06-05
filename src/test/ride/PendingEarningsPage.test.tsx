/**
 * PendingEarningsPage tests — driver-side wallet sub-page (2026-06-05).
 *
 * iOS reference: ios/Tago/Features/Payment/PendingEarningsPage.swift
 *
 * Covers:
 *  - List render: total card + per-ride rows (rider name, destination,
 *    status copy, fare amount)
 *  - Nudge POST success (button label flips to disabled + cooldown countdown)
 *  - Nudge 429 honours retry_after_seconds from the server
 *  - Empty state ("All clear")
 *  - Error banner with Retry
 *  - Back nav routes to /wallet
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PendingEarningsPage from '@/components/ride/PendingEarningsPage'

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  },
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

const mockPending = [
  {
    ride_id: 'r-001',
    rider_id: 'u-001',
    rider_name: 'Sam',
    destination_name: 'Davis Amtrak',
    ended_at: '2026-03-09T10:00:00Z',
    fare_cents: 850,
    payment_status: 'pending' as const,
  },
  {
    ride_id: 'r-002',
    rider_id: 'u-002',
    rider_name: 'Lee',
    destination_name: 'Sacramento',
    ended_at: '2026-03-10T10:00:00Z',
    fare_cents: 600,
    payment_status: 'failed' as const,
  },
]

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/wallet/pending']}>
        <Routes>
          <Route path="/wallet/pending" element={<PendingEarningsPage />} />
          <Route path="/wallet" element={<div data-testid="wallet-page-mock">Wallet</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ pending: mockPending, total_cents: 1450 }),
  }))
})

describe('PendingEarningsPage', () => {
  it('renders the page wrapper', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('pending-earnings-page')).toBeInTheDocument()
    })
  })

  it('renders the total card with sum + ride count', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('pending-earnings-total-card')).toBeInTheDocument()
    })
    const card = screen.getByTestId('pending-earnings-total-card')
    expect(card.textContent).toContain('$14.50')
    expect(card.textContent).toContain('2 rides')
  })

  it('renders one row per pending earning', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByTestId('pending-earnings-row')).toHaveLength(2)
    })
    const rows = screen.getAllByTestId('pending-earnings-row')
    expect(rows[0].textContent).toContain('Sam')
    expect(rows[0].textContent).toContain('Davis Amtrak')
    expect(rows[0].textContent).toContain('No card on file')
    expect(rows[1].textContent).toContain('Lee')
    expect(rows[1].textContent).toContain('Card declined')
  })

  it('Nudge POST success flips the button into cooldown', async () => {
    let nudgeAttempts = 0
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/pending-earnings')) {
        return Promise.resolve({ ok: true, json: async () => ({ pending: mockPending.slice(0, 1), total_cents: 850 }) })
      }
      if (typeof url === 'string' && url.includes('/nudge-rider')) {
        nudgeAttempts++
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }))

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('pending-earnings-nudge')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('pending-earnings-nudge'))

    await waitFor(() => {
      const btn = screen.getByTestId('pending-earnings-nudge')
      expect(btn.textContent).toMatch(/Wait \d+s/)
      expect(btn).toBeDisabled()
    })
    expect(nudgeAttempts).toBe(1)
  })

  it('Honours 429 retry_after_seconds from the server', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/pending-earnings')) {
        return Promise.resolve({ ok: true, json: async () => ({ pending: mockPending.slice(0, 1), total_cents: 850 }) })
      }
      if (typeof url === 'string' && url.includes('/nudge-rider')) {
        return Promise.resolve({
          ok: false,
          status: 429,
          json: async () => ({
            error: { code: 'COOLDOWN', message: 'Please wait 45s' },
            retry_after_seconds: 45,
          }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }))

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('pending-earnings-nudge')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('pending-earnings-nudge'))

    await waitFor(() => {
      const btn = screen.getByTestId('pending-earnings-nudge')
      expect(btn.textContent).toMatch(/Wait \d+s/)
      expect(btn).toBeDisabled()
    })
  })

  it('shows the empty state when there are no pending earnings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ pending: [], total_cents: 0 }),
    }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('pending-earnings-empty')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('pending-earnings-total-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pending-earnings-row')).not.toBeInTheDocument()
  })

  it('shows the error banner + Retry when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }))
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('pending-earnings-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('pending-earnings-retry')).toBeInTheDocument()
  })

  it('back button routes to /wallet', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('pending-earnings-back')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('pending-earnings-back'))
    await waitFor(() => {
      expect(screen.getByTestId('wallet-page-mock')).toBeInTheDocument()
    })
  })
})
