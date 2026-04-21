// @vitest-environment node
/**
 * 24/48/72 h payment-dunning cron tests.
 *
 * Verifies:
 *  - A ride ended 25 h ago with pending/failed payment gets a 24h nudge
 *  - A ride already nudged for its current bucket is skipped (idempotency)
 *  - Three separate rides in three buckets each get one push
 *  - A ride ended <24 h ago is NOT nudged (too early)
 *  - A ride ended >96 h ago is NOT nudged (ghost-refund territory)
 *  - Insert UNIQUE race (23505) is counted as skip, not an error
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

type R = Record<string, unknown>

const { mockFcm, state, mockFrom } = vi.hoisted(() => {
  const state: {
    rides: R[]
    payment_nudges: R[]
    push_tokens: R[]
    insertErrors: Map<string, { code: string; message: string }>
  } = {
    rides: [],
    payment_nudges: [],
    push_tokens: [],
    insertErrors: new Map(),
  }
  return {
    mockFcm: vi.fn(async (_tokens: string[], _payload: unknown) => 1),
    state,
    mockFrom: vi.fn(),
  }
})

vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: (tokens: string[], payload: unknown) => mockFcm(tokens, payload),
}))

mockFrom.mockImplementation((table: string) => {
  if (table === 'rides') {
    let rangeStart: number | null = null
    let rangeEnd: number | null = null
    const filters: Array<(r: R) => boolean> = []
    const builder = {
      select: () => builder,
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
        return builder
      },
      gte: (col: string, v: unknown) => {
        rangeStart = new Date(v as string).getTime()
        filters.push((r) => new Date(r[col] as string).getTime() >= (rangeStart as number))
        return builder
      },
      lte: (col: string, v: unknown) => {
        rangeEnd = new Date(v as string).getTime()
        filters.push((r) => new Date(r[col] as string).getTime() <= (rangeEnd as number))
        return builder
      },
      then: (cb: (v: { data: R[]; error: null }) => unknown) =>
        Promise.resolve(cb({
          data: state.rides.filter((r) => filters.every((f) => f(r))),
          error: null,
        })),
    }
    return builder
  }
  if (table === 'payment_nudges') {
    return {
      insert: (row: R) => {
        const key = `${row['ride_id']}|${row['bucket']}`
        const injected = state.insertErrors.get(key)
        if (injected) return Promise.resolve({ data: null, error: injected })
        const already = state.payment_nudges.find(
          (n) => n['ride_id'] === row['ride_id'] && n['bucket'] === row['bucket'],
        )
        if (already) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } })
        }
        state.payment_nudges.push({ ...row, sent_at: new Date().toISOString() })
        return Promise.resolve({ data: null, error: null })
      },
    }
  }
  if (table === 'push_tokens') {
    const filters: Array<(r: R) => boolean> = []
    const builder = {
      select: () => builder,
      eq: (col: string, v: unknown) => { filters.push((r) => r[col] === v); return builder },
      then: (cb: (v: { data: R[]; error: null }) => unknown) =>
        Promise.resolve(cb({
          data: state.push_tokens.filter((r) => filters.every((f) => f(r))),
          error: null,
        })),
    }
    return builder
  }
  return {}
})

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: {
    from: mockFrom,
  },
}))

// ── Load job AFTER mocks ─────────────────────────────────────────────────────

import { sendPendingPaymentNudges } from '../../../server/jobs/paymentDunning.ts'

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString()
}

function seedRide(id: string, riderId: string, endedHoursAgo: number, status: 'pending' | 'failed' = 'pending') {
  state.rides.push({
    id, rider_id: riderId, ended_at: hoursAgo(endedHoursAgo), payment_status: status,
  })
}

function seedRiderToken(riderId: string, token: string) {
  state.push_tokens.push({ user_id: riderId, token })
}

beforeEach(() => {
  state.rides = []
  state.payment_nudges = []
  state.push_tokens = []
  state.insertErrors.clear()
  mockFcm.mockClear()
  mockFcm.mockResolvedValue(1)
})

describe('sendPendingPaymentNudges', () => {
  it('nudges a ride at 25h with its 24h bucket and records the row', async () => {
    seedRide('ride-A', 'rider-1', 25)
    seedRiderToken('rider-1', 'tok-1')

    const result = await sendPendingPaymentNudges()

    expect(result.scanned).toBe(1)
    expect(result.nudged).toBe(1)
    expect(result.skipped).toBe(0)
    expect(mockFcm).toHaveBeenCalledTimes(1)
    const call = mockFcm.mock.calls[0] as unknown as [string[], { data: { bucket: string; type: string; ride_id: string } }]
    const [tokens, payload] = call
    expect(tokens).toEqual(['tok-1'])
    expect(payload.data.type).toBe('payment_needed')
    expect(payload.data.bucket).toBe('24h')
    expect(payload.data.ride_id).toBe('ride-A')
    expect(state.payment_nudges).toHaveLength(1)
    expect(state.payment_nudges[0]).toMatchObject({ ride_id: 'ride-A', bucket: '24h' })
  })

  it('skips a ride whose current bucket already has a payment_nudges row', async () => {
    seedRide('ride-A', 'rider-1', 25)
    seedRiderToken('rider-1', 'tok-1')
    state.payment_nudges.push({ ride_id: 'ride-A', bucket: '24h' })

    const result = await sendPendingPaymentNudges()

    expect(result.scanned).toBe(1)
    expect(result.nudged).toBe(0)
    expect(result.skipped).toBe(1)
    expect(mockFcm).not.toHaveBeenCalled()
  })

  it('assigns rides to the correct bucket at 25h / 49h / 73h', async () => {
    seedRide('ride-1', 'rider-1', 25) // 24h bucket
    seedRide('ride-2', 'rider-2', 49) // 48h bucket
    seedRide('ride-3', 'rider-3', 73, 'failed') // 72h bucket
    seedRiderToken('rider-1', 'tok-1')
    seedRiderToken('rider-2', 'tok-2')
    seedRiderToken('rider-3', 'tok-3')

    const result = await sendPendingPaymentNudges()

    expect(result.scanned).toBe(3)
    expect(result.nudged).toBe(3)
    expect(mockFcm).toHaveBeenCalledTimes(3)
    const buckets = state.payment_nudges
      .map((n) => [n['ride_id'], n['bucket']])
      .sort()
    expect(buckets).toEqual([
      ['ride-1', '24h'],
      ['ride-2', '48h'],
      ['ride-3', '72h'],
    ])
  })

  it('does not nudge a ride ended <24h ago', async () => {
    seedRide('ride-too-fresh', 'rider-1', 5)
    seedRiderToken('rider-1', 'tok-1')

    const result = await sendPendingPaymentNudges()

    // 5h ride doesn't even fall inside the query window (24-96h); scanned=0.
    expect(result.scanned).toBe(0)
    expect(result.nudged).toBe(0)
    expect(mockFcm).not.toHaveBeenCalled()
  })

  it('does not nudge a ride ended >96h ago (ghost-refund takes over)', async () => {
    seedRide('ride-too-stale', 'rider-1', 120)
    seedRiderToken('rider-1', 'tok-1')

    const result = await sendPendingPaymentNudges()

    expect(result.scanned).toBe(0)
    expect(result.nudged).toBe(0)
    expect(mockFcm).not.toHaveBeenCalled()
  })

  it('counts a 23505 UNIQUE race from a concurrent cron node as skip, not error', async () => {
    seedRide('ride-A', 'rider-1', 25)
    seedRiderToken('rider-1', 'tok-1')
    state.insertErrors.set('ride-A|24h', { code: '23505', message: 'duplicate key value' })

    const result = await sendPendingPaymentNudges()

    expect(result.skipped).toBe(1)
    expect(result.nudged).toBe(0)
    expect(result.errors).toHaveLength(0)
    // Push must NOT fire — another node already claimed this bucket.
    expect(mockFcm).not.toHaveBeenCalled()
  })

  it('silently skips rides whose rider has no push tokens', async () => {
    seedRide('ride-A', 'rider-1', 25)
    // no tokens seeded

    const result = await sendPendingPaymentNudges()

    // Row was still inserted to prevent future retries hammering a rider
    // whose device registration is broken, but no push was attempted.
    expect(result.nudged).toBe(1)
    expect(state.payment_nudges).toHaveLength(1)
    expect(mockFcm).not.toHaveBeenCalled()
  })
})
