/**
 * v1.3 Sprint 12 Slice 5b — `fetchMyStats` contract tests.
 *
 * Pins the wire shape between web and `GET /api/users/me/stats`
 * (`server/routes/users.ts:36`) + iOS `UserStatsEndpoint.swift`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchMyStats, UserStatsApiError } from '@/lib/userStatsApi'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok-stats' } },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-stats' } } })
})

describe('fetchMyStats', () => {
  it('GETs /api/users/me/stats with bearer auth + decodes snake_case to camelCase', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rides_completed: 42, rating_avg: 4.83, rating_count: 18 }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const stats = await fetchMyStats()
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/users/me/stats',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-stats' }),
      }),
    )
    expect(stats).toEqual({ ridesCompleted: 42, ratingAvg: 4.83, ratingCount: 18 })
  })

  it('preserves null rating_avg for users who have no ratings yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rides_completed: 0, rating_avg: null, rating_count: 0 }),
    }))
    expect(await fetchMyStats()).toEqual({
      ridesCompleted: 0,
      ratingAvg: null,
      ratingCount: 0,
    })
  })

  it('throws UserStatsApiError with status=401 + code=NO_SESSION when there is no session', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(fetchMyStats()).rejects.toMatchObject({
      name: 'UserStatsApiError',
      status: 401,
      code: 'NO_SESSION',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws UserStatsApiError carrying the server code on 404 NOT_FOUND', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NOT_FOUND', message: 'User profile not found' } }),
    }))
    await expect(fetchMyStats()).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('throws UserStatsApiError on 500 INTERNAL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'INTERNAL', message: 'Stats fetch failed' } }),
    }))
    await expect(fetchMyStats()).rejects.toBeInstanceOf(UserStatsApiError)
  })

  it('defensively defaults missing numeric fields (server contract drift safety)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }))
    expect(await fetchMyStats()).toEqual({
      ridesCompleted: 0,
      ratingAvg: null,
      ratingCount: 0,
    })
  })
})
