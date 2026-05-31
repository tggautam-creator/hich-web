// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchShareDetails,
  ShareDetailsApiException,
  type ShareDetails,
} from '@/lib/shareDetails'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}))

import { supabase } from '@/lib/supabase'
const mockedGetSession = vi.mocked(supabase.auth.getSession)

const VALID_TOKEN = 'mock.jwt.token'
const RIDE_ID = '11111111-1111-4111-8111-111111111111'
const TRIP_ID = '22222222-2222-4222-8222-222222222222'

function payload(overrides: Partial<ShareDetails> = {}): ShareDetails {
  return {
    trip: {
      id: TRIP_ID,
      kind: 'board',
      started_at: '2026-05-31T18:00:00Z',
      ended_at: '2026-05-31T18:45:00Z',
      gps_distance_metres: 12_000,
      gas_cost_cents: 350,
      time_cost_cents: 225,
    },
    segments: [
      {
        segment_index: 0,
        started_at: '2026-05-31T18:00:00Z',
        ended_at: '2026-05-31T18:45:00Z',
        distance_meters: 12_000,
        active_rider_ids: ['rider-a'],
        gas_cost_cents: 350,
        time_cost_cents: 225,
      },
    ],
    co_riders: [],
    shares: [
      {
        rider_id: 'rider-a',
        base_share_cents: 575,
        caregiver_share_cents: 0,
        companion_share_cents: 0,
        total_cents: 575,
        segments_in_count: 1,
        payment_status: 'paid',
      },
    ],
    ...overrides,
  }
}

describe('fetchShareDetails', () => {
  beforeEach(() => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: VALID_TOKEN } as never },
      error: null as never,
    } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the parsed payload on 200', async () => {
    const body = payload()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    )
    const result = await fetchShareDetails(RIDE_ID)
    expect(result).toEqual(body)
  })

  it('attaches the bearer token to the request', async () => {
    const fetchSpy = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(JSON.stringify(payload()), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchSpy)
    await fetchShareDetails(RIDE_ID)
    const call = fetchSpy.mock.calls[0]
    expect(call).toBeDefined()
    const init = call?.[1]
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBe(`Bearer ${VALID_TOKEN}`)
  })

  it('URI-encodes the rideId in the path', async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify(payload()), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchSpy)
    // Defensive — production ride IDs are UUIDs, but encodeURIComponent
    // guards against any pathological input reaching the URL parser.
    await fetchShareDetails('weird id/with slash')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/rides/weird%20id%2Fwith%20slash/share-details',
      expect.any(Object),
    )
  })

  it('returns null on 404 (pre-097 backfill miss) — graceful, NOT a throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'TRIP_NOT_FOUND', message: 'No trip' } }),
            { status: 404 },
          ),
      ),
    )
    const result = await fetchShareDetails(RIDE_ID)
    expect(result).toBeNull()
  })

  it('throws ShareDetailsApiException with envelope code on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not a participant' } }),
            { status: 403 },
          ),
      ),
    )
    await expect(fetchShareDetails(RIDE_ID)).rejects.toMatchObject({
      name: 'ShareDetailsApiException',
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('throws ShareDetailsApiException with UNKNOWN code when envelope is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 500 })),
    )
    await expect(fetchShareDetails(RIDE_ID)).rejects.toMatchObject({
      name: 'ShareDetailsApiException',
      status: 500,
      code: 'UNKNOWN',
    })
  })

  it('returns null on a 200 response with a malformed body (defensive shape check)', async () => {
    // Guards against rogue test fixtures or partial server responses
    // that return ok=true but with a body missing the documented keys.
    // Production responses from server/routes/rides.ts always include
    // trip + segments + co_riders + shares.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ revealed: false, other_rating: null }),
            { status: 200 },
          ),
      ),
    )
    const result = await fetchShareDetails(RIDE_ID)
    expect(result).toBeNull()
  })

  it('throws NO_SESSION when no auth token is available', async () => {
    mockedGetSession.mockResolvedValueOnce({
      data: { session: null },
      error: null as never,
    } as never)
    await expect(fetchShareDetails(RIDE_ID)).rejects.toMatchObject({
      name: 'ShareDetailsApiException',
      status: 0,
      code: 'NO_SESSION',
    })
  })
})

describe('ShareDetailsApiException', () => {
  it('captures status + code + message', () => {
    const err = new ShareDetailsApiException({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Not a participant',
    })
    expect(err.status).toBe(403)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.message).toBe('Not a participant')
    expect(err.name).toBe('ShareDetailsApiException')
    expect(err).toBeInstanceOf(Error)
  })
})
