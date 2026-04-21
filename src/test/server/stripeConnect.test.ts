// @vitest-environment node
/**
 * F1 — chargeRideFare unit tests
 *
 * Verifies the platform-custody charge model: rider is charged to TAGO's
 * Stripe balance (NO transfer_data.destination), so a driver with no
 * Connect account can still have their ride paid for.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockPaymentIntentCreate = vi.fn()

vi.mock('stripe', () => {
  class StripeError extends Error {}
  const StripeCtor = vi.fn().mockImplementation(() => ({
    paymentIntents: { create: mockPaymentIntentCreate },
  }))
  return {
    default: Object.assign(StripeCtor, {
      errors: { StripeError },
    }),
  }
})

vi.mock('../../../server/env.ts', () => ({
  getServerEnv: () => ({
    STRIPE_SECRET_KEY: 'sk_test_mock',
  }),
}))

import { chargeRideFare, estimateStripeFee } from '../../../server/lib/stripeConnect.ts'

describe('chargeRideFare (F1 — platform custody)', () => {
  beforeEach(() => {
    mockPaymentIntentCreate.mockReset()
  })

  it('charges to TAGO platform balance with NO transfer_data', async () => {
    mockPaymentIntentCreate.mockResolvedValue({ id: 'pi_123' })

    const result = await chargeRideFare({
      rideId: 'ride-abc',
      fareCents: 1000,
      riderCustomerId: 'cus_rider',
      riderPaymentMethodId: 'pm_rider',
    })

    expect(result.success).toBe(true)
    expect(result.paymentIntentId).toBe('pi_123')
    expect(mockPaymentIntentCreate).toHaveBeenCalledTimes(1)

    const [body, options] = mockPaymentIntentCreate.mock.calls[0]
    expect(body).not.toHaveProperty('transfer_data')
    expect(body).not.toHaveProperty('application_fee_amount')
    expect(body.customer).toBe('cus_rider')
    expect(body.payment_method).toBe('pm_rider')
    expect(body.amount).toBe(1000 + estimateStripeFee(1000))
    expect(body.metadata).toEqual({ ride_id: 'ride-abc' })
    expect(options.idempotencyKey).toBe('ride-payment-ride-abc')
  })

  it('does not require a driver account id in the call signature', async () => {
    mockPaymentIntentCreate.mockResolvedValue({ id: 'pi_456' })

    // Compile-time check: chargeRideFare accepts no driverAccountId. If a
    // future change re-introduces the Connect dependency, this test's
    // typing would break the build.
    const result = await chargeRideFare({
      rideId: 'ride-no-driver-onboarded',
      fareCents: 500,
      riderCustomerId: 'cus_rider',
      riderPaymentMethodId: 'pm_rider',
    })

    expect(result.success).toBe(true)
  })

  it('returns { success: false, error } on Stripe failure', async () => {
    mockPaymentIntentCreate.mockRejectedValue(new Error('card_declined'))

    const result = await chargeRideFare({
      rideId: 'ride-fail',
      fareCents: 1500,
      riderCustomerId: 'cus_rider',
      riderPaymentMethodId: 'pm_rider',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('card_declined')
  })
})
