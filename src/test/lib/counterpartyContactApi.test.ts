/**
 * v1.3 Sprint 12 Slice 3 — `fetchCounterpartyContact` contract tests.
 *
 * Pins the wire shape between web and `GET /api/rides/:rideId/
 * counterparty-contact` (`server/routes/rides.ts:6993`) + the iOS
 * endpoint `CounterpartyContactEndpoint.swift`. Errors are mapped to
 * an `CounterpartyContactApiError` carrying the server's `code` so
 * the UI can branch on `OUTSIDE_WINDOW` vs `FORBIDDEN` vs network
 * failure without re-parsing the body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CounterpartyContactApiError,
  fetchCounterpartyContact,
} from '@/lib/counterpartyContactApi'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok-zzz' } },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-zzz' } } })
})

describe('fetchCounterpartyContact', () => {
  it('GETs /api/rides/:rideId/counterparty-contact with bearer auth and decodes the body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ phone: '+15551234567', full_name: 'Casey Lin' }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await fetchCounterpartyContact('ride-001')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/rides/ride-001/counterparty-contact',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-zzz' }),
      }),
    )
    expect(result).toEqual({ phone: '+15551234567', fullName: 'Casey Lin' })
  })

  it('URL-encodes rideId so a UUID with special chars never breaks the path', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ phone: null, full_name: null }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await fetchCounterpartyContact('ride/with/slashes')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/rides/ride%2Fwith%2Fslashes/counterparty-contact',
      expect.anything(),
    )
  })

  it('returns { phone: null, fullName: null } on 200 when server has no phone for the counterparty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ phone: null, full_name: null }),
    }))
    expect(await fetchCounterpartyContact('ride-001')).toEqual({ phone: null, fullName: null })
  })

  it('throws CounterpartyContactApiError with code=OUTSIDE_WINDOW on 403 outside the active window', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'OUTSIDE_WINDOW', message: 'Contact is only shared during active rides.' } }),
    }))
    await expect(fetchCounterpartyContact('ride-001')).rejects.toMatchObject({
      name: 'CounterpartyContactApiError',
      status: 403,
      code: 'OUTSIDE_WINDOW',
    })
  })

  it('throws CounterpartyContactApiError with code=FORBIDDEN when caller isn\'t a party', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'FORBIDDEN', message: 'Not a party to this ride' } }),
    }))
    await expect(fetchCounterpartyContact('ride-001')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('throws CounterpartyContactApiError with status=401 when no session', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(fetchCounterpartyContact('ride-001')).rejects.toBeInstanceOf(
      CounterpartyContactApiError,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws CounterpartyContactApiError when server returns 404 RIDE_NOT_FOUND', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'RIDE_NOT_FOUND', message: 'Ride not found' } }),
    }))
    await expect(fetchCounterpartyContact('ride-missing')).rejects.toMatchObject({
      status: 404,
      code: 'RIDE_NOT_FOUND',
    })
  })
})
