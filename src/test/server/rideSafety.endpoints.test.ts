// @vitest-environment node
/**
 * Integration tests for v1.2 Phase 3.2 safety endpoints:
 *  - POST /api/rides/:id/safety-warning-response
 *  - POST /api/rides/:id/safety-end
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockAuth, mockFrom, mockRpc, mockSendFcmPush,
  mockEndRideForSafety, mockRealtime, mockStripeListPm,
} = vi.hoisted(() => ({
  mockAuth: { getUser: vi.fn() },
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockSendFcmPush: vi.fn(),
  mockEndRideForSafety: vi.fn(),
  mockRealtime: vi.fn(),
  mockStripeListPm: vi.fn().mockResolvedValue({ data: [] }),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom, rpc: mockRpc },
}))

vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcmPush,
  sendSilentFcmPush: vi.fn(),
}))

vi.mock('../../../server/lib/realtimeBroadcast.ts', () => ({
  realtimeBroadcast: mockRealtime,
  realtimeBroadcastMany: vi.fn(),
}))

// Stub endRideForSafety so endpoint tests don't run the full
// payment + ride-update flow. We assert the call shape instead.
vi.mock('../../../server/lib/rideSafetyNet.ts', () => ({
  endRideForSafety: mockEndRideForSafety,
}))

vi.mock('../../../server/env.ts', () => ({
  getServerEnv: () => ({
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    FIREBASE_SERVICE_ACCOUNT_PATH: './mock-path.json',
    QR_HMAC_SECRET: 'test-secret',
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_WEBHOOK_SECRET: 'whsec_mock',
    PORT: 3001,
  }),
  validateStripeEnv: () => undefined,
}))

vi.mock('stripe', () => {
  const StripeCtor = vi.fn().mockImplementation(() => ({
    paymentMethods: { list: mockStripeListPm },
  }))
  return { default: StripeCtor }
})

import { app } from '../../../server/app.ts'

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_JWT = 'Bearer valid.jwt.token'
const RIDER_ID = 'rider-safety-001'
const DRIVER_ID = 'driver-safety-001'
const STRANGER_ID = 'stranger-001'
const RIDE_ID = 'ride-safety-001'

// ── Helpers ──────────────────────────────────────────────────────────────────

function authAs(userId: string) {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function chainOk(data: unknown = null, error: unknown = null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = new Proxy({} as Record<string, unknown>, {
    get(_t, key: string) {
      if (key === 'then') return (resolve: (v: unknown) => void) => resolve({ data, error })
      if (key === 'catch' || key === 'finally') return undefined
      return (..._args: unknown[]) => chain
    },
  })
  return chain
}

/** Routing mockFrom: validateJwt's `bumpLastActive` calls
 *  `from('users').update(...)` once per fresh userId, which would
 *  drain a flat mockReturnValueOnce queue. Routing by table name keeps
 *  endpoint tests ordering-independent. */
function routedMockFrom(seqs: {
  rides?: unknown[]
  users?: unknown[]
  trusted_contacts?: unknown[]
  location_shares?: unknown[]
}) {
  const queues: Record<string, unknown[]> = {
    rides: [...(seqs.rides ?? [])],
    users: [...(seqs.users ?? [])],
    trusted_contacts: [...(seqs.trusted_contacts ?? [])],
    location_shares: [...(seqs.location_shares ?? [])],
  }
  return (table: string) => {
    const queue = queues[table]
    if (queue && queue.length > 0) {
      return queue.shift()
    }
    return chainOk()
  }
}

function buildRideRowForResponse(opts: {
  status?: string
  riderId?: string | null
  driverId?: string | null
  divergenceState?: string | null
  warningFiredAt?: string | null
  warningPushCount?: number
  helpSmsSentAt?: string | null
} = {}): Record<string, unknown> {
  const ds = 'divergenceState' in opts ? opts.divergenceState : 'warning'
  return {
    id: RIDE_ID,
    rider_id: opts.riderId === undefined ? RIDER_ID : opts.riderId,
    driver_id: opts.driverId === undefined ? DRIVER_ID : opts.driverId,
    status: opts.status ?? 'active',
    divergence_state: ds,
    warning_fired_at: opts.warningFiredAt ?? new Date(Date.now() - 30_000).toISOString(),
    warning_push_count: opts.warningPushCount ?? 1,
    help_sms_sent_at: opts.helpSmsSentAt ?? null,
  }
}

// ── POST /api/rides/:id/safety-warning-response ──────────────────────────────

describe('POST /api/rides/:id/safety-warning-response', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFcmPush.mockResolvedValue(0)
    mockRealtime.mockReturnValue(undefined)
    mockEndRideForSafety.mockResolvedValue({ ok: true, fareCents: 500, reason: 'rider_safety_button' })
  })

  it('401 without auth header', async () => {
    const res = await request(app).post(`/api/rides/${RIDE_ID}/safety-warning-response`).send({ action: 'rider_in_car' })
    expect(res.status).toBe(401)
  })

  it('400 on missing action', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({}))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_ACTION')
  })

  it('400 on unknown action value', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({}))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'do_something_weird' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_ACTION')
  })

  it('403 when caller is neither rider nor driver', async () => {
    authAs(STRANGER_ID)
    mockFrom.mockImplementation(routedMockFrom({
      rides: [chainOk(buildRideRowForResponse({}))],
    }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'rider_in_car' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_PARTICIPANT')
  })

  it('403 WRONG_ROLE when rider tries driver_in_car', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({
      rides: [chainOk(buildRideRowForResponse({}))],
    }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'driver_in_car' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('WRONG_ROLE')
  })

  it('403 WRONG_ROLE when driver tries rider_left', async () => {
    authAs(DRIVER_ID)
    mockFrom.mockImplementation(routedMockFrom({
      rides: [chainOk(buildRideRowForResponse({}))],
    }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'rider_left' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('WRONG_ROLE')
  })

  it('409 NO_ACTIVE_WARNING when divergence_state is null', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({
      rides: [chainOk(buildRideRowForResponse({ divergenceState: null }))],
    }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'rider_in_car' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NO_ACTIVE_WARNING')
  })

  it('rider_in_car → 200 ok + transitions to responded + broadcasts warning_responded', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({
      rides: [chainOk(buildRideRowForResponse({})), chainOk()],
    }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'rider_in_car' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'rider_in_car', ride_ended: false })
    expect(mockRealtime).toHaveBeenCalledWith(
      expect.stringContaining('ride-safety:'),
      'warning_responded',
      expect.objectContaining({ action: 'rider_in_car', role: 'rider' }),
    )
    expect(mockEndRideForSafety).not.toHaveBeenCalled()
  })

  it('rider_left → delegates to endRideForSafety with rider_safety_button reason', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({
      rides: [chainOk(buildRideRowForResponse({})), chainOk()],
    }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'rider_left' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, action: 'rider_left', ride_ended: true, fare_cents: 500 })
    expect(mockEndRideForSafety).toHaveBeenCalledWith({
      rideId: RIDE_ID,
      endReason: 'rider_safety_button',
    })
  })

  it('driver_left → delegates to endRideForSafety with driver_safety_button reason', async () => {
    authAs(DRIVER_ID)
    mockFrom.mockImplementation(routedMockFrom({
      rides: [chainOk(buildRideRowForResponse({})), chainOk()],
    }))
    mockEndRideForSafety.mockResolvedValueOnce({ ok: true, fareCents: 750, reason: 'driver_safety_button' })
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'driver_left' })
    expect(res.status).toBe(200)
    expect(res.body.fare_cents).toBe(750)
    expect(mockEndRideForSafety).toHaveBeenCalledWith({
      rideId: RIDE_ID,
      endReason: 'driver_safety_button',
    })
  })

  it('help_requested → mints share token + returns trusted_contacts', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({
      rides: [chainOk(buildRideRowForResponse({})), chainOk()],
      location_shares: [chainOk()],
      trusted_contacts: [chainOk([
        { id: 'tc-1', name: 'Mom', phone: '+15551234567' },
        { id: 'tc-2', name: 'Roommate', phone: '+15557654321' },
      ])],
    }))

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'help_requested' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.ride_ended).toBe(false)
    expect(res.body.share_token).toMatch(/^[0-9a-f]{64}$/)
    expect(res.body.share_expires_at).toBeTruthy()
    expect(res.body.trusted_contacts).toHaveLength(2)
    expect(mockRealtime).toHaveBeenCalledWith(
      expect.stringContaining('ride-safety:'),
      'warning_responded',
      expect.objectContaining({ action: 'help_requested' }),
    )
  })

  it('help_requested second tap does NOT re-stamp help_sms_sent_at (throttle)', async () => {
    authAs(RIDER_ID)
    const updateFn = vi.fn().mockReturnThis()
    const eqFn = vi.fn().mockReturnThis()
    const updateChain = { update: updateFn, eq: eqFn } as unknown
    mockFrom.mockImplementation(routedMockFrom({
      rides: [
        chainOk(buildRideRowForResponse({
          helpSmsSentAt: new Date(Date.now() - 60_000).toISOString(),
        })),
        updateChain,
      ],
      location_shares: [chainOk()],
      trusted_contacts: [chainOk([])],
    }))

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'help_requested' })
    expect(res.status).toBe(200)
    const payload = updateFn.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(payload).toBeDefined()
    expect(payload && 'help_sms_sent_at' in payload).toBe(false)
  })

  it('help_requested works even when no warning is active', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({
      rides: [chainOk(buildRideRowForResponse({ divergenceState: null })), chainOk()],
      location_shares: [chainOk()],
      trusted_contacts: [chainOk([])],
    }))

    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'help_requested' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('404 NOT_FOUND when ride row lookup fails', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({
      rides: [chainOk(null, { message: 'not found' })],
    }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-warning-response`)
      .set('Authorization', VALID_JWT)
      .send({ action: 'rider_in_car' })
    expect(res.status).toBe(404)
  })
})

// ── POST /api/rides/:id/safety-end ───────────────────────────────────────────

describe('POST /api/rides/:id/safety-end', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEndRideForSafety.mockResolvedValue({ ok: true, fareCents: 500, reason: 'manual_end' })
  })

  function activeRideRow() {
    return chainOk({
      id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'active',
    })
  }

  it('401 without auth header', async () => {
    const res = await request(app).post(`/api/rides/${RIDE_ID}/safety-end`).send({})
    expect(res.status).toBe(401)
  })

  it('403 when stranger calls it', async () => {
    authAs(STRANGER_ID)
    mockFrom.mockImplementation(routedMockFrom({ rides: [activeRideRow()] }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-end`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_PARTICIPANT')
  })

  it('409 NOT_ACTIVE when ride is already completed', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({
      rides: [chainOk({
        id: RIDE_ID, rider_id: RIDER_ID, driver_id: DRIVER_ID, status: 'completed',
      })],
    }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-end`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NOT_ACTIVE')
  })

  it('no reason → defaults to manual_end', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({ rides: [activeRideRow()] }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-end`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.end_reason).toBe('manual_end')
    expect(mockEndRideForSafety).toHaveBeenCalledWith({
      rideId: RIDE_ID,
      endReason: 'manual_end',
    })
  })

  it('reason="rider_left" maps to rider_safety_button', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({ rides: [activeRideRow()] }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-end`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'rider_left' })
    expect(res.status).toBe(200)
    expect(res.body.end_reason).toBe('rider_safety_button')
  })

  it('reason="driver_left" maps to driver_safety_button', async () => {
    authAs(DRIVER_ID)
    mockFrom.mockImplementation(routedMockFrom({ rides: [activeRideRow()] }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-end`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'driver_left' })
    expect(res.status).toBe(200)
    expect(res.body.end_reason).toBe('driver_safety_button')
  })

  it('unknown reason falls back to manual_end', async () => {
    authAs(RIDER_ID)
    mockFrom.mockImplementation(routedMockFrom({ rides: [activeRideRow()] }))
    const res = await request(app)
      .post(`/api/rides/${RIDE_ID}/safety-end`)
      .set('Authorization', VALID_JWT)
      .send({ reason: 'something_else' })
    expect(res.status).toBe(200)
    expect(res.body.end_reason).toBe('manual_end')
  })
})
