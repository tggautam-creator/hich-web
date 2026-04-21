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

  it('posts to /api/wallet/withdraw with Idempotency-Key header on confirm', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'transferring', transfer_id: 'tr_1', amount_cents: 2000, eta_days: 2 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const onSuccess = vi.fn()
    renderSheet({ onSuccess })

    fireEvent.click(screen.getByTestId('withdraw-sheet-confirm'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/wallet/withdraw')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBeTruthy()
    expect(headers['Authorization']).toBe('Bearer tok_test')
    expect(init.body).toBe(JSON.stringify({ amount_cents: 2000 }))

    await waitFor(() => {
      expect(screen.getByTestId('withdraw-sheet-done')).toBeInTheDocument()
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('surfaces the error message on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { code: 'BANK_NOT_LINKED', message: 'Link a bank account' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderSheet()
    fireEvent.click(screen.getByTestId('withdraw-sheet-confirm'))

    await waitFor(() => {
      expect(screen.getByTestId('withdraw-sheet-error').textContent).toContain('Link a bank account')
    })
  })

  it('disables the confirm button while submitting', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((r) => { resolveFetch = r }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderSheet()
    const btn = screen.getByTestId('withdraw-sheet-confirm') as HTMLButtonElement
    fireEvent.click(btn)

    await waitFor(() => expect(btn.textContent).toContain('Transferring'))
    expect(btn.disabled).toBe(true)

    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ status: 'transferring', transfer_id: 'tr_1', amount_cents: 2000, eta_days: 2 }),
    })
  })
})
