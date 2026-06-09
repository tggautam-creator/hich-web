// @vitest-environment node
/**
 * V4 F6 — getOrCreatePlanLegTrip: the shared multi-rider event-trip grouping.
 *
 * Every rider accepted onto the same driver plan + leg must converge on ONE
 * trips row so the segment cost-split fires. This covers the three branches:
 *   1. plan already grouped → return existing trip, never insert
 *   2. fresh leg → mint a trip + win the claim → created:true
 *   3. concurrent accept won the claim → reuse winner's trip + drop our orphan
 *
 * The helper takes an injectable client, so we feed a tiny chain-emulating
 * fake whose terminals shift from a per-scenario result queue (call order is
 * deterministic inside the helper).
 */
import { describe, it, expect, vi } from 'vitest'

// trips.ts imports supabaseAdmin at module load, which validates server env.
// We inject our own client into the helper, so a bare stub is enough to let
// the import resolve under the test env.
vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { from: () => { throw new Error('unexpected default-client use') } },
}))

import { getOrCreatePlanLegTrip } from '../../../server/lib/trips.ts'

type Result = { data: unknown; error: unknown }

interface Op {
  table: string
  action: 'select' | 'insert' | 'update' | 'delete'
  payload?: Record<string, unknown>
}

/** Records every terminal op the helper issues, in order. */
function makeClient(queue: Result[], log: Op[]) {
  function from(table: string) {
    const op: Op = { table, action: 'select' }
    const next = (): Promise<Result> => {
      log.push({ ...op })
      const r = queue.shift()
      if (!r) throw new Error(`unexpected extra query: ${op.action} ${table}`)
      return Promise.resolve(r)
    }
    const builder: Record<string, unknown> = {}
    builder['select'] = () => builder
    builder['insert'] = (payload: Record<string, unknown>) => { op.action = 'insert'; op.payload = payload; return builder }
    builder['update'] = (payload: Record<string, unknown>) => { op.action = 'update'; op.payload = payload; return builder }
    builder['delete'] = () => { op.action = 'delete'; return builder }
    builder['eq'] = () => builder
    builder['is'] = () => builder
    builder['maybeSingle'] = () => next()
    builder['single'] = () => next()
    // Thenable so `await update(...).select(col)` (array result) and the bare
    // `await delete(...).eq(...)` both resolve through the same queue.
    builder['then'] = (onF: (r: Result) => unknown, onR?: (e: unknown) => unknown) => next().then(onF, onR)
    return builder
  }
  return { from } as never
}

const PLAN = '11111111-1111-4111-8111-111111111111'
const DRIVER = '22222222-2222-4222-8222-222222222222'

describe('getOrCreatePlanLegTrip', () => {
  it('returns the existing trip when the plan leg is already grouped', async () => {
    const log: Op[] = []
    const client = makeClient([
      { data: { outbound_trip_id: 'trip-existing' }, error: null },
    ], log)

    const res = await getOrCreatePlanLegTrip(PLAN, 'outbound', DRIVER, client)

    expect(res).toEqual({ tripId: 'trip-existing', created: false })
    // No insert / update / delete — purely a read.
    expect(log.map((o) => o.action)).toEqual(['select'])
  })

  it('mints a trip and links the plan leg on first accept (claim won)', async () => {
    const log: Op[] = []
    const client = makeClient([
      { data: { return_trip_id: null }, error: null },     // 1. not grouped yet
      { data: { id: 'trip-new' }, error: null },            // 2. trips insert
      { data: [{ return_trip_id: 'trip-new' }], error: null }, // 3. claim won (non-empty)
    ], log)

    const res = await getOrCreatePlanLegTrip(PLAN, 'return', DRIVER, client)

    expect(res).toEqual({ tripId: 'trip-new', created: true })
    expect(log.map((o) => o.action)).toEqual(['select', 'insert', 'update'])
    // The minted trip carries the driver + is parked pending.
    const insert = log.find((o) => o.action === 'insert')
    expect(insert?.payload).toMatchObject({ driver_id: DRIVER, status: 'pending', kind: 'instant' })
  })

  it('reuses the winner trip and drops the orphan when a concurrent accept wins the claim', async () => {
    const log: Op[] = []
    const client = makeClient([
      { data: { outbound_trip_id: null }, error: null },        // 1. not grouped yet
      { data: { id: 'trip-orphan' }, error: null },             // 2. our insert
      { data: [], error: null },                                // 3. claim lost (empty)
      { data: { outbound_trip_id: 'trip-winner' }, error: null }, // 4. re-read winner
      { data: null, error: null },                              // 5. delete orphan
    ], log)

    const res = await getOrCreatePlanLegTrip(PLAN, 'outbound', DRIVER, client)

    expect(res).toEqual({ tripId: 'trip-winner', created: false })
    expect(log.map((o) => o.action)).toEqual(['select', 'insert', 'update', 'select', 'delete'])
  })

  it('surfaces a read error without inserting', async () => {
    const log: Op[] = []
    const client = makeClient([
      { data: null, error: { message: 'boom' } },
    ], log)

    const res = await getOrCreatePlanLegTrip(PLAN, 'outbound', DRIVER, client)

    expect(res.tripId).toBe('')
    expect(res.error).toBe('boom')
    expect(log.map((o) => o.action)).toEqual(['select'])
  })
})
