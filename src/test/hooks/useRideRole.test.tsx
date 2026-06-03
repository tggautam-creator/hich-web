/**
 * v1.3 Sprint 11 Slice 3 — useRideRole hook tests.
 *
 * Pins the role-per-ride memory rule: role MUST come from comparing
 * `auth.profile.id` against `rides.rider_id` / `rides.driver_id`,
 * never from any session-level capability flag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRideRole } from '@/hooks/useRideRole'

// ── Mocks ────────────────────────────────────────────────────────────

const RIDER_ID = 'user-rider-001'
const DRIVER_ID = 'user-driver-001'
const STRANGER_ID = 'user-stranger-001'

const { mockProfile, mockSupabaseFrom } = vi.hoisted(() => ({
  mockProfile: { current: { id: 'user-rider-001' } as { id: string } | null },
  mockSupabaseFrom: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockSupabaseFrom(...args) },
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string } | null }) => unknown) =>
    selector({ profile: mockProfile.current }),
}))

function mockRideRow(row: { rider_id: string | null; driver_id: string | null } | null, error: Error | null = null) {
  mockSupabaseFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: row, error }),
      }),
    }),
  })
}

function wrapper({ children }: { children: React.ReactNode }) {
  // Disable retries so test isn't slow when we want an error state.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mockProfile.current = { id: RIDER_ID }
  mockSupabaseFrom.mockReset()
})

// ── Tests ────────────────────────────────────────────────────────────

describe('useRideRole', () => {
  it('returns role="rider" when the user is rides.rider_id', async () => {
    mockRideRow({ rider_id: RIDER_ID, driver_id: DRIVER_ID })
    const { result } = renderHook(() => useRideRole('ride-1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.role).toBe('rider')
  })

  it('returns role="driver" when the user is rides.driver_id', async () => {
    mockProfile.current = { id: DRIVER_ID }
    mockRideRow({ rider_id: RIDER_ID, driver_id: DRIVER_ID })
    const { result } = renderHook(() => useRideRole('ride-1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.role).toBe('driver')
  })

  it('returns role=null when the user is neither rider nor driver on the ride', async () => {
    mockProfile.current = { id: STRANGER_ID }
    mockRideRow({ rider_id: RIDER_ID, driver_id: DRIVER_ID })
    const { result } = renderHook(() => useRideRole('ride-1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.role).toBeNull()
  })

  it('returns role=null while the ride row fetch is in flight (loading state)', () => {
    mockSupabaseFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => new Promise(() => {}), // never resolves
        }),
      }),
    })
    const { result } = renderHook(() => useRideRole('ride-1'), { wrapper })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.role).toBeNull()
  })

  it('does NOT fetch when rideId is null', () => {
    const { result } = renderHook(() => useRideRole(null), { wrapper })
    expect(mockSupabaseFrom).not.toHaveBeenCalled()
    expect(result.current.role).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('returns role=null on fetch error', async () => {
    mockRideRow(null, new Error('rls denied'))
    const { result } = renderHook(() => useRideRole('ride-1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.role).toBeNull()
    expect(result.current.error?.message).toBe('rls denied')
  })
})
