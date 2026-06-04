/**
 * v1.3 Sprint 12 Slice 3 — useCounterpartyContact tests.
 *
 * Pins:
 *   - Calls fetchCounterpartyContact when enabled + rideId present
 *   - enabled=false → no fetch fires
 *   - rideId=null   → no fetch fires
 *   - 403 OUTSIDE_WINDOW surfaces as error without retry spam
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCounterpartyContact } from '@/hooks/useCounterpartyContact'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok' } },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
})

describe('useCounterpartyContact', () => {
  it('fetches and returns decoded contact when enabled and rideId present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ phone: '+15551234567', full_name: 'Casey Lin' }),
    }))
    const { result } = renderHook(() => useCounterpartyContact('ride-001'), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data).toEqual({ phone: '+15551234567', fullName: 'Casey Lin' })
  })

  it('does not fetch when enabled=false', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderHook(() => useCounterpartyContact('ride-001', { enabled: false }), { wrapper })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not fetch when rideId is null', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderHook(() => useCounterpartyContact(null), { wrapper })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('surfaces error without retry on 403 OUTSIDE_WINDOW', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'OUTSIDE_WINDOW', message: 'gated' } }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const { result } = renderHook(() => useCounterpartyContact('ride-001'), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
