/**
 * v1.3 Sprint 12 Slice 6 — `createBoardOffer` contract tests.
 *
 * Pins the wire shape between web and
 * `POST /api/schedule/board/offers` (server/routes/schedule.ts:4532)
 * + iOS `CreateBoardOfferEndpoint.swift`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBoardOffer, BoardOfferApiError } from '@/lib/boardOfferApi'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok-offer' } },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-offer' } } })
})

describe('createBoardOffer', () => {
  it('POSTs /api/schedule/board/offers with bearer auth + body + returns the decoded result', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ offer_id: 'off-1', status: 'pending', created_at: '2026-06-04T18:00:00Z' }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await createBoardOffer({
      schedule_id: 'sched-1',
      proposed_pickup_lat: 38.54,
      proposed_pickup_lng: -121.75,
      proposed_pickup_name: 'Main Library',
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/schedule/board/offers',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok-offer',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          schedule_id: 'sched-1',
          proposed_pickup_lat: 38.54,
          proposed_pickup_lng: -121.75,
          proposed_pickup_name: 'Main Library',
        }),
      }),
    )
    expect(result).toEqual({
      offer_id: 'off-1',
      status: 'pending',
      created_at: '2026-06-04T18:00:00Z',
    })
  })

  it('serialises the full proposed_* contract iOS uses (pickup + dropoff + transit + fare + eta)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ offer_id: 'off-2', status: 'pending', created_at: '2026-06-04T19:00:00Z' }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await createBoardOffer({
      schedule_id: 's2',
      vehicle_id: 'veh-1',
      proposed_pickup_lat: 1, proposed_pickup_lng: 2, proposed_pickup_name: 'A',
      proposed_dropoff_lat: 3, proposed_dropoff_lng: 4, proposed_dropoff_name: 'B',
      proposed_fare_cents: 750,
      proposed_eta_minutes: 8,
      proposed_transit_line_name: 'BART Yellow',
      proposed_transit_walk_minutes: 5,
      proposed_transit_to_dest_minutes: 22,
      proposed_transit_total_minutes: 32,
    })
    const arg = (fetchSpy.mock.calls[0][1] as { body: string }).body
    const sent = JSON.parse(arg) as Record<string, unknown>
    expect(sent).toMatchObject({
      schedule_id: 's2',
      vehicle_id: 'veh-1',
      proposed_pickup_lat: 1,
      proposed_pickup_lng: 2,
      proposed_pickup_name: 'A',
      proposed_dropoff_lat: 3,
      proposed_dropoff_lng: 4,
      proposed_dropoff_name: 'B',
      proposed_fare_cents: 750,
      proposed_eta_minutes: 8,
      proposed_transit_line_name: 'BART Yellow',
      proposed_transit_walk_minutes: 5,
      proposed_transit_to_dest_minutes: 22,
      proposed_transit_total_minutes: 32,
    })
  })

  it('throws BoardOfferApiError with status=401 + code=NO_SESSION when not signed in', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(createBoardOffer({ schedule_id: 'x' })).rejects.toMatchObject({
      name: 'BoardOfferApiError',
      status: 401,
      code: 'NO_SESSION',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws BoardOfferApiError carrying the server code on 403 NOT_A_DRIVER', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'NOT_A_DRIVER', message: 'Become a driver first.' } }),
    }))
    await expect(createBoardOffer({ schedule_id: 'x' })).rejects.toMatchObject({
      status: 403,
      code: 'NOT_A_DRIVER',
    })
  })

  it('throws BoardOfferApiError on 409 WRONG_MODE (rider tried via this endpoint)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'WRONG_MODE', message: 'Schedule is driver-posted.' } }),
    }))
    await expect(createBoardOffer({ schedule_id: 'x' })).rejects.toMatchObject({
      status: 409,
      code: 'WRONG_MODE',
    })
  })

  it('throws BoardOfferApiError on 404 SCHEDULE_NOT_FOUND', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'SCHEDULE_NOT_FOUND', message: 'Schedule withdrawn.' } }),
    }))
    await expect(createBoardOffer({ schedule_id: 'x' })).rejects.toBeInstanceOf(BoardOfferApiError)
  })

  it('throws INVALID_RESPONSE when the server returns a 200 but the body is incomplete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'pending' }),
    }))
    await expect(createBoardOffer({ schedule_id: 'x' })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })
})
