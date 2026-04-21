// @vitest-environment node
/**
 * F7 — Ghost-driver refund job tests.
 *
 * Verifies:
 *  - Day-60 reminder sweep upserts ghost_refunds rows with reminder_sent_at
 *  - Day-90 refund sweep: Stripe refund → wallet debit → rides update → refunded_at
 *  - Already-refunded rides are skipped (idempotency)
 *  - Stripe failure bails without changing DB state
 *  - Onboarded drivers are filtered out (only ghost drivers refunded)
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const { mockStripeRefundsCreate, state, mockFrom, mockRpc } = vi.hoisted(() => {
  type R = Record<string, unknown>
  const state: {
    transactions: R[]
    ghost_refunds: R[]
    rides: R[]
    rpcCalls: Array<{ fn: string; params: R }>
    rideUpdates: Array<{ id: string; patch: R }>
  } = {
    transactions: [],
    ghost_refunds: [],
    rides: [],
    rpcCalls: [],
    rideUpdates: [],
  }
  const mockStripeRefundsCreate = vi.fn()
  const mockRpc = vi.fn((fn: string, params: R) => {
    state.rpcCalls.push({ fn, params })
    return Promise.resolve({ data: { applied: true, balance: 0 }, error: null })
  })
  return { mockStripeRefundsCreate, state, mockFrom: vi.fn(), mockRpc }
})

vi.mock('stripe', () => {
  class StripeError extends Error {}
  const StripeCtor = vi.fn().mockImplementation(() => ({
    refunds: { create: mockStripeRefundsCreate },
  }))
  return {
    default: Object.assign(StripeCtor, { errors: { StripeError } }),
  }
})

vi.mock('../../../server/env.ts', () => ({
  getServerEnv: () => ({ STRIPE_SECRET_KEY: 'sk_test_mock' }),
}))

function txQuery() {
  // Chainable builder for `from('transactions').select(...).eq(...).not(...).lte(...)`.
  const filters: Array<(r: Row) => boolean> = []
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return builder },
    not: (col: string, _op: string, val: unknown) => {
      filters.push((r) => (val === null ? r[col] !== null && r[col] !== undefined : r[col] !== val))
      return builder
    },
    lte: (col: string, val: unknown) => {
      filters.push((r) => new Date(r[col] as string).getTime() <= new Date(val as string).getTime())
      return builder
    },
    in: (col: string, vals: unknown[]) => {
      filters.push((r) => vals.includes(r[col]))
      return builder
    },
    is: (col: string, val: unknown) => {
      filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val))
      return builder
    },
    order: () => builder,
    limit: () => builder,
    then: (cb: (v: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve(cb({
        data: state.transactions.filter((r) => filters.every((f) => f(r))),
        error: null,
      })),
  }
  return builder
}

mockFrom.mockImplementation((table: string) => {
  if (table === 'transactions') return txQuery()
  if (table === 'ghost_refunds') {
    const filters: Array<(r: Row) => boolean> = []
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      is: (col: string, v: unknown) => {
        filters.push((r) => (v === null ? r[col] === null || r[col] === undefined : r[col] === v))
        return builder
      },
      not: (col: string, _op: string, v: unknown) => {
        filters.push((r) => (v === null ? r[col] !== null && r[col] !== undefined : r[col] !== v))
        return builder
      },
      in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return builder },
      eq: (col: string, v: unknown) => { filters.push((r) => r[col] === v); return builder },
      upsert: (row: Row) => {
        const idx = state.ghost_refunds.findIndex((r) => r['ride_id'] === row['ride_id'])
        if (idx >= 0) state.ghost_refunds[idx] = { ...state.ghost_refunds[idx], ...row }
        else state.ghost_refunds.push({ ...row })
        return Promise.resolve({ data: null, error: null })
      },
      then: (cb: (v: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve(cb({
          data: state.ghost_refunds.filter((r) => filters.every((f) => f(r))),
          error: null,
        })),
    }
    return builder
  }
  if (table === 'rides') {
    return {
      update: (patch: Row) => ({
        eq: (_col: string, id: string) => {
          state.rideUpdates.push({ id, patch })
          return Promise.resolve({ error: null })
        },
      }),
    }
  }
  return {}
})

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: {
    from: mockFrom,
    rpc: (fn: string, params: Row) => mockRpc(fn, params),
  },
}))

// ── Load job AFTER mocks ─────────────────────────────────────────────────────

import { sendGhostDriverReminders, processGhostDriverRefunds } from '../../../server/jobs/ghostRefund.ts'

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

function seedGhostDriver(rideId: string, driverId: string, riderId: string, amount: number, ageDays: number) {
  state.transactions.push({
    ride_id: rideId,
    user_id: driverId,
    type: 'ride_earning',
    amount_cents: amount,
    payment_intent_id: `pi_${rideId}`,
    created_at: daysAgo(ageDays),
    rides: { rider_id: riderId },
    users: { stripe_onboarding_complete: false },
  })
}

beforeEach(() => {
  state.transactions = []
  state.ghost_refunds = []
  state.rides = []
  state.rpcCalls = []
  state.rideUpdates = []
  mockStripeRefundsCreate.mockReset()
})

describe('sendGhostDriverReminders (day 60)', () => {
  it('upserts a ghost_refunds row with reminder_sent_at for each stale earning', async () => {
    seedGhostDriver('ride-A', 'driver-1', 'rider-1', 1000, 65)
    seedGhostDriver('ride-B', 'driver-2', 'rider-2', 1500, 70)

    const result = await sendGhostDriverReminders()

    expect(result.scanned).toBe(2)
    expect(result.processed).toBe(2)
    expect(state.ghost_refunds).toHaveLength(2)
    expect(state.ghost_refunds[0].reminder_sent_at).toBeTruthy()
  })

  it('skips drivers who already onboarded to Connect', async () => {
    state.transactions.push({
      ride_id: 'ride-X',
      user_id: 'driver-onboarded',
      type: 'ride_earning',
      amount_cents: 1000,
      payment_intent_id: 'pi_X',
      created_at: daysAgo(65),
      rides: { rider_id: 'rider-1' },
      users: { stripe_onboarding_complete: true },
    })

    const result = await sendGhostDriverReminders()
    expect(result.scanned).toBe(0)
    expect(state.ghost_refunds).toHaveLength(0)
  })
})

describe('processGhostDriverRefunds (day 90)', () => {
  it('refunds rider via Stripe, debits driver wallet, marks ride refunded', async () => {
    seedGhostDriver('ride-A', 'driver-1', 'rider-1', 1000, 92)
    mockStripeRefundsCreate.mockResolvedValue({ id: 're_123' })

    const result = await processGhostDriverRefunds()

    expect(result.processed).toBe(1)
    expect(mockStripeRefundsCreate).toHaveBeenCalledTimes(1)
    const [body, opts] = mockStripeRefundsCreate.mock.calls[0]
    expect(body.payment_intent).toBe('pi_ride-A')
    expect(body.amount).toBe(1000)
    expect(opts.idempotencyKey).toBe('ghost-refund-ride-A')

    // Wallet debit via RPC with negative delta + ghost_refund type
    const debit = state.rpcCalls.find((c) => (c.params as { p_type: string }).p_type === 'ghost_refund')
    expect(debit).toBeDefined()
    expect((debit?.params as { p_delta_cents: number }).p_delta_cents).toBe(-1000)

    // Ride marked refunded
    expect(state.rideUpdates).toEqual([{ id: 'ride-A', patch: { payment_status: 'refunded_ghost_driver' } }])

    // ghost_refunds finalized
    expect(state.ghost_refunds[0].refunded_at).toBeTruthy()
    expect(state.ghost_refunds[0].stripe_refund_id).toBe('re_123')
  })

  it('skips rides that are already refunded (idempotency on replay)', async () => {
    seedGhostDriver('ride-A', 'driver-1', 'rider-1', 1000, 92)
    state.ghost_refunds.push({
      ride_id: 'ride-A',
      driver_id: 'driver-1',
      rider_id: 'rider-1',
      amount_cents: 1000,
      payment_intent_id: 'pi_ride-A',
      refunded_at: new Date().toISOString(),
      stripe_refund_id: 're_prev',
    })

    const result = await processGhostDriverRefunds()

    expect(result.skipped).toBe(1)
    expect(result.processed).toBe(0)
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('records an error without touching DB when Stripe refund fails', async () => {
    seedGhostDriver('ride-A', 'driver-1', 'rider-1', 1000, 92)
    mockStripeRefundsCreate.mockRejectedValue(new Error('charge_already_refunded'))

    const result = await processGhostDriverRefunds()

    expect(result.processed).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toBe('charge_already_refunded')
    expect(state.rpcCalls).toHaveLength(0)
    expect(state.rideUpdates).toHaveLength(0)
  })

  it('leaves ghost_refunds row with refunded_at/stripe_refund_id NULL on Stripe failure so replay is safe', async () => {
    // Reminder pass at day 60 wrote a row with reminder_sent_at but no refund yet.
    state.ghost_refunds.push({
      ride_id: 'ride-A',
      driver_id: 'driver-1',
      rider_id: 'rider-1',
      amount_cents: 1000,
      payment_intent_id: 'pi_ride-A',
      reminder_sent_at: daysAgo(30),
      refunded_at: null,
      stripe_refund_id: null,
    })
    seedGhostDriver('ride-A', 'driver-1', 'rider-1', 1000, 92)
    mockStripeRefundsCreate.mockRejectedValueOnce(new Error('network_error'))

    const firstRun = await processGhostDriverRefunds()
    expect(firstRun.processed).toBe(0)
    expect(firstRun.errors).toHaveLength(1)

    // Finalization fields must remain unset — these are what guard replay.
    const row = state.ghost_refunds.find((r) => r.ride_id === 'ride-A')
    expect(row).toBeDefined()
    expect(row?.refunded_at ?? null).toBeNull()
    expect(row?.stripe_refund_id ?? null).toBeNull()

    // Replay: second run succeeds because the skip-set only contains rides
    // where refunded_at IS NOT NULL. Same idempotency key hits Stripe again.
    mockStripeRefundsCreate.mockResolvedValueOnce({ id: 're_retry' })
    const secondRun = await processGhostDriverRefunds()

    expect(secondRun.processed).toBe(1)
    expect(mockStripeRefundsCreate).toHaveBeenCalledTimes(2)
    expect(mockStripeRefundsCreate.mock.calls[1][1].idempotencyKey).toBe('ghost-refund-ride-A')
    expect(state.ghost_refunds[0].refunded_at).toBeTruthy()
    expect(state.ghost_refunds[0].stripe_refund_id).toBe('re_retry')
  })
})
