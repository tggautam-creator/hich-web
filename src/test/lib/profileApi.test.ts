/**
 * v1.3 Sprint 12 Slice 5a — `updateMyProfile` contract tests.
 *
 * Pins the wire shape between web and `POST /api/users/me/profile`
 * (`server/routes/users.ts:264`) + iOS endpoint
 * `UserProfileUpsertEndpoint.swift`. The server validates each field
 * individually + drops unknowns; this helper just routes the body
 * through and surfaces typed errors so callers can branch on
 * `INVALID_NAME` / `INVALID_DOB` / `INVALID_GENDER` / etc.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateMyProfile, ProfileApiError } from '@/lib/profileApi'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok-prof' } },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-prof' } } })
})

describe('updateMyProfile', () => {
  it('POSTs /api/users/me/profile with the supplied body + bearer auth + returns the canonical profile row', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        profile: { id: 'u1', full_name: 'Casey Lin', phone: '+15551234567', avatar_url: null },
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const profile = await updateMyProfile({ full_name: 'Casey Lin', phone: '+15551234567' })

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/users/me/profile',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok-prof',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ full_name: 'Casey Lin', phone: '+15551234567' }),
      }),
    )
    expect(profile).toMatchObject({ id: 'u1', full_name: 'Casey Lin' })
  })

  it('passes accessibility fields through unchanged (matches iOS UserProfileUpsertEndpoint shape)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, profile: {} }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await updateMyProfile({
      has_accessibility_needs: true,
      accessibility_profile: { needs_wheelchair: true },
      waive_caregiver_fee: false,
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/users/me/profile',
      expect.objectContaining({
        body: JSON.stringify({
          has_accessibility_needs: true,
          accessibility_profile: { needs_wheelchair: true },
          waive_caregiver_fee: false,
        }),
      }),
    )
  })

  it('throws ProfileApiError with status=401 + code=NO_SESSION when there is no signed-in session', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(updateMyProfile({ full_name: 'X' })).rejects.toMatchObject({
      name: 'ProfileApiError',
      status: 401,
      code: 'NO_SESSION',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws ProfileApiError carrying the server error code on 400 INVALID_NAME', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'INVALID_NAME', message: 'full_name must be 1–200 characters' } }),
    }))
    await expect(updateMyProfile({ full_name: '' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_NAME',
    })
  })

  it('throws ProfileApiError on 500 DB_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'DB_ERROR', message: 'Could not save profile' } }),
    }))
    await expect(updateMyProfile({ full_name: 'OK' })).rejects.toBeInstanceOf(ProfileApiError)
  })

  it('returns empty object when server omits profile (shouldn\'t happen but defensive)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }))
    const result = await updateMyProfile({ full_name: 'X' })
    expect(result).toEqual({})
  })
})
