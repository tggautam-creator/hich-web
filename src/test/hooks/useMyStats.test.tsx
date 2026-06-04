/**
 * v1.3 Sprint 12 Slice 5b — useMyStats hook tests.
 *
 * Pins:
 *   - Fetches when enabled (default true)
 *   - Skips fetch when enabled=false (lets caller gate on profile readiness)
 *   - Decodes the API helper's shape through to consumers verbatim
 *   - retry: false — 404 NOT_FOUND is deterministic, no spam
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMyStats } from '@/hooks/useMyStats'

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

describe('useMyStats', () => {
  it('fetches and surfaces decoded stats when enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rides_completed: 17, rating_avg: 4.71, rating_count: 9 }),
    }))
    const { result } = renderHook(() => useMyStats(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())
    expect(result.current.data).toEqual({
      ridesCompleted: 17,
      ratingAvg: 4.71,
      ratingCount: 9,
    })
  })

  it('does not fetch when enabled=false', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderHook(() => useMyStats({ enabled: false }), { wrapper })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('surfaces error without retry on 404 NOT_FOUND', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NOT_FOUND', message: 'User profile not found' } }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const { result } = renderHook(() => useMyStats(), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
