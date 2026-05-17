import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WithdrawSheet from '@/components/ride/WithdrawSheet'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'tok_test' } },
      }),
    },
  },
}))

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderSheet(props: Partial<React.ComponentProps<typeof WithdrawSheet>> = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    balanceCents: 2000,
    hasBank: true,
    onSuccess: vi.fn(),
  }
  const merged = { ...defaults, ...props }
  return {
    ...render(
      <MemoryRouter>
        <WithdrawSheet {...merged} />
      </MemoryRouter>,
    ),
    props: merged,
  }
}

describe('WithdrawSheet (F5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockReset()
  })

  it('renders nothing when closed', () => {
    renderSheet({ open: false })
    expect(screen.queryByTestId('withdraw-sheet')).not.toBeInTheDocument()
  })

  it('shows bank-link CTA when hasBank is false', () => {
    renderSheet({ hasBank: false })
    expect(screen.getByTestId('withdraw-sheet-link-bank')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('withdraw-sheet-link-bank'))
    expect(mockNavigate).toHaveBeenCalledWith('/stripe/payouts')
  })

  it('displays the formatted balance amount', () => {
    renderSheet({ balanceCents: 4250 })
    expect(screen.getByTestId('withdraw-sheet-amount').textContent).toContain('$42.50')
  })

  it('Continue opens the confirm dialog; Withdraw POSTs with the full amount', async () => {
    // W-T1-P4 — confirm step before the irreversible Stripe transfer.
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/connect/status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            payout_method_label: 'Chase',
            payout_method_last4: '4242',
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'transferring' }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const onSuccess = vi.fn()
    renderSheet({ onSuccess })

    // Continue opens the confirm dialog — no POST yet.
    fireEvent.click(screen.getByTestId('withdraw-sheet-confirm'))
    expect(screen.getByTestId('withdraw-confirm-dialog')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([url]) => (url as string) === '/api/wallet/withdraw'),
    ).toBe(false)

    // Withdraw button inside the dialog actually POSTs.
    fireEvent.click(screen.getByTestId('withdraw-confirm-yes'))
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => (url as string) === '/api/wallet/withdraw'),
      ).toBe(true)
    })

    const withdrawCall = fetchMock.mock.calls.find(
      ([url]) => (url as string) === '/api/wallet/withdraw',
    ) as [string, RequestInit] | undefined
    expect(withdrawCall).toBeDefined()
    expect(withdrawCall![1].method).toBe('POST')
    const headers = withdrawCall![1].headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBeTruthy()
    expect(headers['Authorization']).toBe('Bearer tok_test')
    expect(withdrawCall![1].body).toBe(JSON.stringify({ amount_cents: 2000 }))

    await waitFor(() => {
      expect(screen.getByTestId('withdraw-sheet-done')).toBeInTheDocument()
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('Cancel inside the confirm dialog leaves the sheet open without firing /withdraw', () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/connect/status') {
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderSheet()
    fireEvent.click(screen.getByTestId('withdraw-sheet-confirm'))
    expect(screen.getByTestId('withdraw-confirm-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('withdraw-confirm-cancel'))
    expect(screen.queryByTestId('withdraw-confirm-dialog')).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([url]) => (url as string) === '/api/wallet/withdraw'),
    ).toBe(false)
  })

  it('surfaces the error message on failure', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/connect/status') {
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: { code: 'BANK_NOT_LINKED', message: 'Link a bank account' } }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderSheet()
    fireEvent.click(screen.getByTestId('withdraw-sheet-confirm'))
    fireEvent.click(screen.getByTestId('withdraw-confirm-yes'))

    await waitFor(() => {
      expect(screen.getByTestId('withdraw-sheet-error').textContent).toContain('Link a bank account')
    })
  })

  // ── W-T1-P3 — amount picker ────────────────────────────────────────────

  it('Half pill sets the amount to half the balance', () => {
    renderSheet({ balanceCents: 4000 })
    fireEvent.click(screen.getByTestId('withdraw-sheet-pill-half'))
    const input = screen.getByTestId('withdraw-sheet-amount-input') as HTMLInputElement
    expect(input.value).toBe('20.00')
  })

  it('All pill sets the amount to the full balance', () => {
    renderSheet({ balanceCents: 4000 })
    fireEvent.click(screen.getByTestId('withdraw-sheet-pill-all'))
    const input = screen.getByTestId('withdraw-sheet-amount-input') as HTMLInputElement
    expect(input.value).toBe('40.00')
  })

  it('blocks Continue when amount exceeds available balance', () => {
    renderSheet({ balanceCents: 1000 })
    const input = screen.getByTestId('withdraw-sheet-amount-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '50' } })
    expect(screen.getByTestId('withdraw-sheet-validation').textContent).toContain('Max is')
    expect((screen.getByTestId('withdraw-sheet-confirm') as HTMLButtonElement).disabled).toBe(true)
  })

  it('blocks Continue when amount is below the $1 minimum', () => {
    renderSheet({ balanceCents: 5000 })
    const input = screen.getByTestId('withdraw-sheet-amount-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '0.50' } })
    expect(screen.getByTestId('withdraw-sheet-validation').textContent).toContain('Minimum')
    expect((screen.getByTestId('withdraw-sheet-confirm') as HTMLButtonElement).disabled).toBe(true)
  })
})
