/**
 * v1.3 Sprint 12 Slice 2b — `fetchDriverPendingOffer` contract tests.
 *
 * Pins the wire shape between web and `GET /api/rides/driver-pending-offer`
 * (`server/routes/rides.ts:5681`) and the iOS endpoint
 * `DriverPendingOfferEndpoint.swift`. The fetch is a silent backstop —
 * it must never throw on the auth / network / 4xx paths because the
 * caller (RideRequestNotification) fires it on every mount.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchDriverPendingOffer } from '@/lib/driverPendingOfferApi'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok-abc' } },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-abc' } } })
})

describe('fetchDriverPendingOffer', () => {
  it('GETs /api/rides/driver-pending-offer with bearer auth + returns decoded offer', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        offer: {
          ride_id: 'ride-001',
          offer_created_at: '2026-06-03T17:00:00.000Z',
          rider_name: 'Casey',
          rider_avatar_url: 'https://cdn/avatar.png',
          rider_rating: 4.8,
          rider_rating_count: 12,
          origin_name: 'Library',
          destination: 'Dorm A',
          origin_lat: 32.71,
          origin_lng: -117.16,
          destination_lat: 32.78,
          destination_lng: -117.13,
          estimated_earnings_cents: 642,
          distance_km: 3.4,
          saved_destination_lat: 32.78,
          saved_destination_lng: -117.13,
          saved_destination_name: 'Dorm A',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const offer = await fetchDriverPendingOffer()

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/rides/driver-pending-offer',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-abc' }),
      }),
    )
    expect(offer).toEqual({
      rideId: 'ride-001',
      offerCreatedAt: '2026-06-03T17:00:00.000Z',
      riderName: 'Casey',
      riderAvatarUrl: 'https://cdn/avatar.png',
      riderRating: 4.8,
      riderRatingCount: 12,
      originName: 'Library',
      destination: 'Dorm A',
      originLat: 32.71,
      originLng: -117.16,
      destinationLat: 32.78,
      destinationLng: -117.13,
      estimatedEarningsCents: 642,
      distanceKm: 3.4,
      savedDestinationLat: 32.78,
      savedDestinationLng: -117.13,
      savedDestinationName: 'Dorm A',
    })
  })

  it('returns null when server responds { offer: null } (no actionable pending offer)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ offer: null }),
    }))
    expect(await fetchDriverPendingOffer()).toBeNull()
  })

  it('returns null when there is no session (silent — caller retries on auth ready)', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await fetchDriverPendingOffer()).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null on non-2xx without throwing (silent backstop — never breaks the mount)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    expect(await fetchDriverPendingOffer()).toBeNull()
  })

  it('returns null on network error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchDriverPendingOffer()).toBeNull()
  })

  it('preserves nullable numeric fields when server returns null for rating / lat / lng / distance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        offer: {
          ride_id: 'ride-002',
          offer_created_at: '2026-06-03T17:00:00.000Z',
          rider_name: 'Drew',
          rider_avatar_url: '',
          rider_rating: null,
          rider_rating_count: 0,
          origin_name: 'Origin',
          destination: 'Dest',
          origin_lat: null,
          origin_lng: null,
          destination_lat: null,
          destination_lng: null,
          estimated_earnings_cents: 500,
          distance_km: null,
          saved_destination_lat: null,
          saved_destination_lng: null,
          saved_destination_name: null,
        },
      }),
    }))
    const offer = await fetchDriverPendingOffer()
    expect(offer).not.toBeNull()
    expect(offer?.riderRating).toBeNull()
    expect(offer?.originLat).toBeNull()
    expect(offer?.distanceKm).toBeNull()
    expect(offer?.savedDestinationName).toBeNull()
  })
})
