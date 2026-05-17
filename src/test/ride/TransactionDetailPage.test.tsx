/**
 * TransactionDetailPage tests
 *
 * Sprint 3 W-T1-P6 (2026-05-16) — detail / audit view for a single
 * wallet transaction. Mirrors iOS TransactionDetailPage.swift.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TransactionDetailPage from '@/components/ride/TransactionDetailPage'

vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  },
}))

// Supabase mock — each table lookup is routed through `mockSingleFns`.
const mockSingleFns: Record<string, ReturnType<typeof vi.fn>> = {}

const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: 'rider-001' } },
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => {
            const fn = mockSingleFns[table]
            return fn ? fn() : Promise.resolve({ data: null, error: null })
          },
        }),
      }),
    }),
    auth: {
      getUser: () => mockGetUser(),
    },
  },
}))

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderDetail(txId = 'tx-001') {
  return render(
    <MemoryRouter initialEntries={[`/wallet/transaction/${txId}`]}>
      <Routes>
        <Route path="/wallet/transaction/:id" element={<TransactionDetailPage />} />
        <Route path="/wallet" element={<div data-testid="wallet-page">Wallet</div>} />
        <Route path="/ride/summary/:rideId" element={<div data-testid="ride-summary">Ride Summary</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const baseTx = {
  id: 'tx-001',
  user_id: 'rider-001',
  ride_id: null as string | null,
  type: 'topup',
  amount_cents: 2500,
  balance_after_cents: 5000,
  description: null as string | null,
  created_at: '2026-03-09T10:15:00Z',
  payment_intent_id: null as string | null,
  stripe_event_id: null,
  transfer_id: null as string | null,
  transfer_paid_at: null as string | null,
  pm_brand: null as string | null,
  pm_last4: null as string | null,
  pm_wallet: null as string | null,
}

describe('TransactionDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'rider-001' } } })
    Object.keys(mockSingleFns).forEach((k) => delete mockSingleFns[k])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows "Transaction not found" when the row is missing', async () => {
    mockSingleFns['transactions'] = vi.fn(() => Promise.resolve({ data: null, error: { message: 'no row' } }))
    renderDetail()
    await waitFor(() => {
      expect(screen.getByTestId('transaction-not-found')).toBeInTheDocument()
    })
  })

  it('renders the signed-amount hero with + sign for credits', async () => {
    mockSingleFns['transactions'] = vi.fn(() =>
      Promise.resolve({ data: { ...baseTx, type: 'topup', amount_cents: 2500 }, error: null }),
    )
    renderDetail()
    await waitFor(() => {
      expect(screen.getByTestId('amount-hero')).toBeInTheDocument()
    })
    expect(screen.getByTestId('amount-label').textContent).toBe('+$25.00')
    expect(screen.getByTestId('amount-label').className).toContain('text-success')
  })

  it('renders the signed-amount hero with − sign for debits', async () => {
    mockSingleFns['transactions'] = vi.fn(() =>
      Promise.resolve({
        data: { ...baseTx, type: 'fare_debit', amount_cents: -850 },
        error: null,
      }),
    )
    renderDetail()
    await waitFor(() => {
      expect(screen.getByTestId('amount-hero')).toBeInTheDocument()
    })
    expect(screen.getByTestId('amount-label').textContent).toBe('−$8.50')
    expect(screen.getByTestId('amount-label').className).toContain('text-danger')
  })

  it('shows the Refunded status pill + failure banner for withdrawal_failed_refund', async () => {
    mockSingleFns['transactions'] = vi.fn(() =>
      Promise.resolve({
        data: {
          ...baseTx,
          type: 'withdrawal_failed_refund',
          amount_cents: 5000,
          description: 'Refund — withdrawal declined: bank account closed',
        },
        error: null,
      }),
    )
    renderDetail()
    await waitFor(() => screen.getByTestId('status-pill'))
    expect(screen.getByTestId('status-pill').textContent).toContain('Refunded')
    expect(screen.getByTestId('withdrawal-failure-banner').textContent).toContain('bank account closed')
  })

  it('renders references for transaction id + Stripe PaymentIntent + ride id', async () => {
    mockSingleFns['transactions'] = vi.fn(() =>
      Promise.resolve({
        data: {
          ...baseTx,
          ride_id: 'ride-xyz',
          payment_intent_id: 'pi_test_123',
        },
        error: null,
      }),
    )
    mockSingleFns['rides'] = vi.fn(() =>
      Promise.resolve({
        data: { rider_id: 'rider-001', driver_id: 'driver-007' },
        error: null,
      }),
    )
    mockSingleFns['users'] = vi.fn(() =>
      Promise.resolve({ data: { full_name: 'Jane Driver' }, error: null }),
    )

    renderDetail()
    await waitFor(() => screen.getByTestId('references-card'))
    expect(screen.getByTestId('reference-transaction-id').textContent).toContain('tx-001')
    expect(screen.getByTestId('reference-stripe-paymentintent').textContent).toContain('pi_test_123')
    expect(screen.getByTestId('reference-linked-ride').textContent).toContain('ride-xyz')
    // View-ride deep-link surfaces
    expect(screen.getByTestId('view-ride-button')).toBeInTheDocument()
    // Counterparty fetched + labelled as Driver (viewer is the rider)
    await waitFor(() => {
      expect(screen.getByTestId('counterparty-card').textContent).toContain('Jane Driver')
    })
    expect(screen.getByTestId('counterparty-card').textContent).toContain('Driver')
  })

  it('view-ride-button navigates to /ride/summary/:rideId', async () => {
    mockSingleFns['transactions'] = vi.fn(() =>
      Promise.resolve({ data: { ...baseTx, ride_id: 'ride-xyz' }, error: null }),
    )
    mockSingleFns['rides'] = vi.fn(() =>
      Promise.resolve({ data: { rider_id: 'rider-001', driver_id: null }, error: null }),
    )
    renderDetail()
    await waitFor(() => screen.getByTestId('view-ride-button'))
    fireEvent.click(screen.getByTestId('view-ride-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/ride/summary/ride-xyz')
  })

  it('copies a reference value via navigator.clipboard.writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    mockSingleFns['transactions'] = vi.fn(() =>
      Promise.resolve({ data: baseTx, error: null }),
    )
    renderDetail()
    await waitFor(() => screen.getByTestId('reference-transaction-id'))
    fireEvent.click(screen.getByTestId('reference-transaction-id'))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('tx-001')
    })
    expect(screen.getByTestId('copied-toast').textContent).toContain('Copied Transaction ID')
  })

  it('renders the funding-source card for top-ups with pm_brand + pm_last4', async () => {
    mockSingleFns['transactions'] = vi.fn(() =>
      Promise.resolve({
        data: { ...baseTx, type: 'topup', pm_brand: 'visa', pm_last4: '4242' },
        error: null,
      }),
    )
    renderDetail()
    await waitFor(() => {
      expect(screen.getByTestId('funding-source').textContent).toContain('Visa •••• 4242')
    })
  })
})
