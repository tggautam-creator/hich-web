/**
 * v1.3 Sprint 14 — Suggestions API contract tests.
 *
 * Pins the wire shape between web and the three `/api/suggestions/*`
 * endpoints + iOS SuggestionEndpoints.swift. Decoded shape is
 * snake_case pass-through (no camelCase remap layer) so all that
 * needs verifying is: URL + bearer + body unwrap + error mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  dismissSuggestion,
  fetchSuggestionsBoard,
  fetchSuggestionsTop,
  SuggestionsApiError,
} from '@/lib/suggestionsApi'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok-sugg' } },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-sugg' } } })
})

const SAMPLE_SUGGESTION = {
  id: 's-001',
  trip_date: '2026-06-10',
  match_type: 'same_day_forward',
  relevance_score: 0.87,
  match_signals: {
    classification: 'direct',
    bearing_diff_deg: 5.2,
    time_diff_min: 10,
    origin_distance_m: 320,
    dest_distance_m: 410,
    corridor_origin_m: null,
    corridor_dest_m: null,
    handoff_total_minutes: null,
    handoff_station_name: null,
    handoff_station_address: null,
    handoff_walk_minutes: null,
    handoff_transit_minutes: null,
    handoff_ride_minutes: null,
    handoff_transit_line: null,
    handoff_transit_type: null,
  },
  side: 'rider',
  status: 'new',
  other_user: { id: 'u-2', full_name: 'Casey', avatar_url: null, rating_avg: 4.8 },
  rider_source: null,
  driver_source: null,
  created_at: '2026-06-04T12:00:00.000Z',
}

describe('fetchSuggestionsTop', () => {
  it('GETs /api/suggestions/top + decodes results array verbatim (no side filter)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [SAMPLE_SUGGESTION] }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await fetchSuggestionsTop()
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/suggestions/top',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-sugg' }),
      }),
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 's-001', side: 'rider' })
  })

  it('appends ?side=rider when filtering', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await fetchSuggestionsTop('rider')
    expect(fetchSpy).toHaveBeenCalledWith('/api/suggestions/top?side=rider', expect.anything())
  })

  it('appends ?side=driver when filtering', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await fetchSuggestionsTop('driver')
    expect(fetchSpy).toHaveBeenCalledWith('/api/suggestions/top?side=driver', expect.anything())
  })

  it('throws SuggestionsApiError with status=401 + NO_SESSION when not signed in', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(fetchSuggestionsTop()).rejects.toMatchObject({
      status: 401,
      code: 'NO_SESSION',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns [] when server omits results (defensive)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }))
    expect(await fetchSuggestionsTop()).toEqual([])
  })

  it('throws SuggestionsApiError on 500 INTERNAL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'INTERNAL', message: 'boom' } }),
    }))
    await expect(fetchSuggestionsTop()).rejects.toBeInstanceOf(SuggestionsApiError)
  })
})

describe('fetchSuggestionsBoard', () => {
  it('appends ?limit=20 by default', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await fetchSuggestionsBoard()
    expect(fetchSpy).toHaveBeenCalledWith('/api/suggestions/board?limit=20', expect.anything())
  })

  it('clamps limit to server max 50 + min 1', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await fetchSuggestionsBoard(999)
    expect(fetchSpy).toHaveBeenCalledWith('/api/suggestions/board?limit=50', expect.anything())
    fetchSpy.mockClear()
    await fetchSuggestionsBoard(0)
    expect(fetchSpy).toHaveBeenCalledWith('/api/suggestions/board?limit=1', expect.anything())
  })

  it('decodes results array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [SAMPLE_SUGGESTION, { ...SAMPLE_SUGGESTION, id: 's-002' }] }),
    }))
    const list = await fetchSuggestionsBoard()
    expect(list).toHaveLength(2)
    expect(list.map((s) => s.id)).toEqual(['s-001', 's-002'])
  })
})

describe('dismissSuggestion', () => {
  it('POSTs /api/suggestions/:id/dismiss with bearer + URL-encodes the id', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchSpy)
    await dismissSuggestion('s/with/slashes')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/suggestions/s%2Fwith%2Fslashes/dismiss',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-sugg' }),
      }),
    )
  })

  it('throws SuggestionsApiError on 404 NOT_FOUND', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NOT_FOUND', message: 'gone' } }),
    }))
    await expect(dismissSuggestion('s-1')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('resolves silently on 200 ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }))
    await expect(dismissSuggestion('s-1')).resolves.toBeUndefined()
  })
})
