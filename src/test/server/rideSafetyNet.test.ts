// @vitest-environment node
/**
 * Unit tests for the v1.2 Phase 3.1 ride divergence state machine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockFrom,
  mockSendFcmPush,
  mockChargeRide,
  mockCreditDriver,
  mockRealtime,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockSendFcmPush: vi.fn(),
  mockChargeRide: vi.fn(),
  mockCreditDriver: vi.fn(),
  mockRealtime: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { from: mockFrom },
}))
vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcmPush,
}))
vi.mock('../../../server/lib/realtimeBroadcast.ts', () => ({
  realtimeBroadcast: mockRealtime,
  realtimeBroadcastMany: vi.fn(),
}))
vi.mock('../../../server/lib/walletPayment.ts', () => ({
  chargeRideViaWallet: mockChargeRide,
  creditDriverEarning: mockCreditDriver,
}))

import {
  advanceDivergenceState,
  fireDivergenceWarning,
  endRideForSafety,
  GPS_WATCH_THRESHOLD_M,
  GPS_DIVERGE_THRESHOLD_M,
  WATCH_TO_WARNING_AGE_MS,
  WARNING_TO_AUTOEND_MS,
  WARNING_REFIRE_COOLDOWN_MS,
  MAX_WARNING_PUSHES,
  type SafetyRideRow,
} from '../../../server/lib/rideSafetyNet.ts'

// ── Helpers ───────────────────────────────────────────────────────────

const RIDE_ID = 'ride-safety-001'
const RIDER_ID = 'rider-001'
const DRIVER_ID = 'driver-001'

function makeRide(overrides: Partial<SafetyRideRow> = {}): SafetyRideRow {
  return {
    id: RIDE_ID,
    rider_id: RIDER_ID,
    driver_id: DRIVER_ID,
    status: 'active',
    started_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    gps_distance_metres: 5000,
    last_driver_gps_lat: 38.54,
    last_driver_gps_lng: -121.77,
    last_rider_gps_lat: 38.54,
    last_rider_gps_lng: -121.77,
    last_driver_ping_at: new Date().toISOString(),
    last_rider_ping_at: new Date().toISOString(),
    divergence_state: null,
    divergence_first_seen_at: null,
    warning_fired_at: null,
    warning_push_count: 0,
    pickup_point: null,
    dropoff_point: null,
    auto_ended: false,
    ...overrides,
  }
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

// ── advanceDivergenceState ────────────────────────────────────────────

describe('advanceDivergenceState', () => {
  const now = Date.now()

  it('null + sep < 250m → noop', () => {
    expect(advanceDivergenceState({
      ride: makeRide({ divergence_state: null }),
      separationM: 100,
      now,
    }).action).toBe('noop')
  })

  it('null + sep ≥ 250m → flag_watching', () => {
    expect(advanceDivergenceState({
      ride: makeRide({ divergence_state: null }),
      separationM: 260,
      now,
    }).action).toBe('flag_watching')
  })

  it('watching + sep back < 250m → reset', () => {
    expect(advanceDivergenceState({
      ride: makeRide({
        divergence_state: 'watching',
        divergence_first_seen_at: new Date(now - 30_000).toISOString(),
      }),
      separationM: 50,
      now,
    }).action).toBe('reset')
  })

  it('watching + sep > 500m but < 60s old → noop', () => {
    expect(advanceDivergenceState({
      ride: makeRide({
        divergence_state: 'watching',
        divergence_first_seen_at: new Date(now - 30_000).toISOString(),
        warning_push_count: 0,
      }),
      separationM: 600,
      now,
    }).action).toBe('noop')
  })

  it('watching + sep > 500m AND aged > 60s → fire_warning', () => {
    const decision = advanceDivergenceState({
      ride: makeRide({
        divergence_state: 'watching',
        divergence_first_seen_at: new Date(now - WATCH_TO_WARNING_AGE_MS - 1).toISOString(),
        warning_push_count: 0,
      }),
      separationM: 600,
      now,
    })
    expect(decision.action).toBe('fire_warning')
    if (decision.action === 'fire_warning') {
      expect(decision.nextPushCount).toBe(1)
    }
  })

  it('warning + age > 90s → auto_end', () => {
    expect(advanceDivergenceState({
      ride: makeRide({
        divergence_state: 'warning',
        warning_fired_at: new Date(now - WARNING_TO_AUTOEND_MS - 1).toISOString(),
        warning_push_count: 1,
      }),
      separationM: 800,
      now,
    }).action).toBe('auto_end')
  })

  it('warning + age < 90s → noop (waiting on user)', () => {
    expect(advanceDivergenceState({
      ride: makeRide({
        divergence_state: 'warning',
        warning_fired_at: new Date(now - 30_000).toISOString(),
        warning_push_count: 1,
      }),
      separationM: 800,
      now,
    }).action).toBe('noop')
  })

  it('responded + sep > 500m + cooldown elapsed + cap not hit → fire_warning (re-fire)', () => {
    const decision = advanceDivergenceState({
      ride: makeRide({
        divergence_state: 'responded',
        warning_fired_at: new Date(now - WARNING_REFIRE_COOLDOWN_MS - 1).toISOString(),
        warning_push_count: 1,
      }),
      separationM: 600,
      now,
    })
    expect(decision.action).toBe('fire_warning')
    if (decision.action === 'fire_warning') {
      expect(decision.nextPushCount).toBe(2)
    }
  })

  it('responded + sep > 500m + cooldown NOT elapsed → noop', () => {
    expect(advanceDivergenceState({
      ride: makeRide({
        divergence_state: 'responded',
        warning_fired_at: new Date(now - 60_000).toISOString(),
        warning_push_count: 1,
      }),
      separationM: 800,
      now,
    }).action).toBe('noop')
  })

  it('push count at MAX → auto_end when warning aged > 90s instead of fire_warning', () => {
    expect(advanceDivergenceState({
      ride: makeRide({
        divergence_state: 'watching',
        divergence_first_seen_at: new Date(now - WATCH_TO_WARNING_AGE_MS - 1).toISOString(),
        warning_fired_at: new Date(now - WARNING_TO_AUTOEND_MS - 1).toISOString(),
        warning_push_count: MAX_WARNING_PUSHES,
      }),
      separationM: 700,
      now,
    }).action).toBe('auto_end')
  })

  it('safety_ended terminal → noop forever', () => {
    expect(advanceDivergenceState({
      ride: makeRide({ divergence_state: 'safety_ended' }),
      separationM: 1000,
      now,
    }).action).toBe('noop')
  })

  it('constants exposed publicly for cross-module reuse', () => {
    expect(GPS_WATCH_THRESHOLD_M).toBe(250)
    expect(GPS_DIVERGE_THRESHOLD_M).toBe(500)
    expect(WATCH_TO_WARNING_AGE_MS).toBe(60_000)
    expect(WARNING_TO_AUTOEND_MS).toBe(90_000)
    expect(WARNING_REFIRE_COOLDOWN_MS).toBe(5 * 60_000)
    expect(MAX_WARNING_PUSHES).toBe(2)
  })
})

// ── fireDivergenceWarning ─────────────────────────────────────────────

describe('fireDivergenceWarning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('atomic write succeeds → push fan-out fires + realtime broadcast', async () => {
    mockFrom.mockReturnValueOnce(chainOk([{ id: RIDE_ID }]))
    mockFrom.mockReturnValueOnce(chainOk([{ token: 'rider-tok' }]))
    mockFrom.mockReturnValueOnce(chainOk([{ token: 'driver-tok' }]))

    mockSendFcmPush.mockResolvedValue(undefined)
    mockRealtime.mockReturnValue(undefined)

    const fired = await fireDivergenceWarning(makeRide({ warning_push_count: 0 }), Date.now(), 1)
    expect(fired).toBe(true)
    expect(mockSendFcmPush).toHaveBeenCalledTimes(2)
    expect(mockRealtime).toHaveBeenCalledWith(
      expect.stringContaining('ride-safety:'),
      'warning_fired',
      expect.objectContaining({ ride_id: RIDE_ID }),
    )
  })

  it('atomic write loses race (zero rows) → no push, returns false', async () => {
    mockFrom.mockReturnValueOnce(chainOk([]))
    const fired = await fireDivergenceWarning(makeRide({ warning_push_count: 0 }), Date.now(), 1)
    expect(fired).toBe(false)
    expect(mockSendFcmPush).not.toHaveBeenCalled()
  })
})

// ── endRideForSafety ──────────────────────────────────────────────────

describe('endRideForSafety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses to act on a non-active ride (idempotent guard)', async () => {
    mockFrom.mockReturnValueOnce(chainOk({
      id: RIDE_ID,
      rider_id: RIDER_ID,
      driver_id: DRIVER_ID,
      status: 'completed',
      started_at: new Date().toISOString(),
      gps_distance_metres: 0,
      last_driver_gps_lat: null,
      last_driver_gps_lng: null,
    }))

    const result = await endRideForSafety({ rideId: RIDE_ID, endReason: 'auto_divergence' })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('not_active')
    expect(mockChargeRide).not.toHaveBeenCalled()
  })

  it('computes GPS-distance fare with $5 floor and charges via wallet', async () => {
    const startedAt = new Date(Date.now() - 20 * 60_000).toISOString()
    mockFrom.mockReturnValueOnce(chainOk({
      id: RIDE_ID,
      rider_id: RIDER_ID,
      driver_id: DRIVER_ID,
      status: 'active',
      started_at: startedAt,
      gps_distance_metres: 0,
      last_driver_gps_lat: 38.54,
      last_driver_gps_lng: -121.77,
    }))
    mockFrom.mockReturnValueOnce(chainOk({
      stripe_customer_id: 'cus_x',
      default_payment_method_id: 'pm_x',
      wallet_balance: 0,
    }))
    mockFrom.mockReturnValueOnce(chainOk())
    mockFrom.mockReturnValueOnce(chainOk([]))

    mockChargeRide.mockResolvedValue({
      success: true,
      cardChargeCents: 500,
      paymentIntentId: 'pi_x',
      stripeFeeCents: 30,
    })
    mockCreditDriver.mockResolvedValue(undefined)

    const result = await endRideForSafety({ rideId: RIDE_ID, endReason: 'rider_safety_button' })
    expect(result.ok).toBe(true)
    expect(result.fareCents).toBe(500)
    expect(mockChargeRide).toHaveBeenCalledWith(
      expect.objectContaining({ rideId: RIDE_ID, riderId: RIDER_ID, fareCents: 500 }),
    )
    expect(mockCreditDriver).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: DRIVER_ID, fareCents: 500 }),
    )
  })

  it('broadcasts safety_ended on the ride-safety channel + ride_ended per-user', async () => {
    mockFrom.mockReturnValueOnce(chainOk({
      id: RIDE_ID,
      rider_id: RIDER_ID,
      driver_id: DRIVER_ID,
      status: 'active',
      started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      gps_distance_metres: 0,
      last_driver_gps_lat: null,
      last_driver_gps_lng: null,
    }))
    mockFrom.mockReturnValueOnce(chainOk({
      stripe_customer_id: null,
      default_payment_method_id: null,
      wallet_balance: 0,
    }))
    mockFrom.mockReturnValueOnce(chainOk())
    mockFrom.mockReturnValueOnce(chainOk([]))
    mockFrom.mockReturnValueOnce(chainOk([]))

    const r = await endRideForSafety({ rideId: RIDE_ID, endReason: 'auto_divergence' })
    expect(r.ok).toBe(true)

    const events = mockRealtime.mock.calls.map((c) => c[1])
    expect(events).toContain('ride_ended')
    expect(events).toContain('safety_ended')
  })
})
