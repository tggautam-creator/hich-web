/**
 * Slice 1.3e — admin ride refund endpoint.
 *
 *   POST /api/admin/rides/:rideId/refund
 *
 * Refund a completed, paid ride:
 *   - rider's wallet:  +fare_cents  (admin_refund)
 *   - driver's wallet: -fare_cents  (admin_refund)
 *   - rides.payment_status: → 'refunded'
 *   - 2 audit_log rows (one per party) so both users' Admin
 *     Actions audit lists pick it up.
 *
 * Driver overdraft policy (locked 2026-05-17 with Tarun):
 *   - Soft warn + admin override. By default the endpoint refuses
 *     with 409 DRIVER_WOULD_OVERDRAFT when the driver's wallet
 *     balance < fare_cents. The admin can re-submit with
 *     `allow_driver_overdraft: true` to push through, leaving the
 *     driver's wallet temporarily negative until they top up or
 *     earn back via a future ride.
 *   - Rationale: hard-block would force admins to grant the driver
 *     wallet credit first (extra step); silent-overdraft would put
 *     drivers in the red without anyone noticing. The middle path
 *     surfaces the gap, lets ops decide.
 *
 * Atomicity note: wallet_apply_delta runs per-user. If the rider
 * credit succeeds but the driver debit fails, the rider gets the
 * money and the driver's wallet stays whole — overall, Tago is
 * out by `fare_cents`. We log the failure loud and rely on manual
 * reconciliation; this matches how the existing ride-completion
 * flow handles split wallet writes.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'
import { writeAuditLog } from '../../lib/adminAudit.ts'

export const adminRefundsRouter = Router()

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

interface RefundBody {
  reason?: unknown
  allow_driver_overdraft?: unknown
}

adminRefundsRouter.post(
  '/:rideId/refund',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rideIdRaw = req.params['rideId']
      const rideId = typeof rideIdRaw === 'string' ? rideIdRaw : ''
      if (!rideId || !UUID_RE.test(rideId)) {
        res.status(400).json({
          error: { code: 'INVALID_RIDE_ID', message: 'ride id must be a UUID' },
        })
        return
      }

      const adminId = res.locals['userId'] as string
      const b = req.body as RefundBody
      const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
      const allowOverdraft = b.allow_driver_overdraft === true

      if (!reason) {
        res.status(400).json({
          error: { code: 'REASON_REQUIRED', message: 'A reason is required to refund a ride.' },
        })
        return
      }

      // 1. Fetch ride + verify it's refundable.
      const { data: ride, error: rideErr } = await supabaseAdmin
        .from('rides')
        .select('id, rider_id, driver_id, fare_cents, status, payment_status')
        .eq('id', rideId)
        .maybeSingle()
      if (rideErr) throw rideErr
      if (!ride) {
        res.status(404).json({
          error: { code: 'RIDE_NOT_FOUND', message: 'ride does not exist' },
        })
        return
      }
      if (ride.status !== 'completed') {
        res.status(400).json({
          error: {
            code: 'RIDE_NOT_COMPLETED',
            message: `Only completed rides can be refunded (this ride is ${ride.status}).`,
          },
        })
        return
      }
      if (ride.payment_status !== 'paid') {
        res.status(400).json({
          error: {
            code: 'RIDE_NOT_PAID',
            message: `Only paid rides can be refunded (this ride's payment_status is ${ride.payment_status ?? 'null'}).`,
          },
        })
        return
      }
      if (typeof ride.fare_cents !== 'number' || ride.fare_cents <= 0) {
        res.status(400).json({
          error: {
            code: 'INVALID_FARE',
            message: 'Ride has no fare to refund.',
          },
        })
        return
      }
      if (!ride.driver_id) {
        res.status(400).json({
          error: {
            code: 'NO_DRIVER',
            message: 'Ride has no driver — refund would have nothing to debit.',
          },
        })
        return
      }

      const fareCents = ride.fare_cents
      const riderId = ride.rider_id
      const driverId = ride.driver_id

      // 2. Driver-overdraft guard.
      if (!allowOverdraft) {
        const { data: driverRow, error: driverErr } = await supabaseAdmin
          .from('users')
          .select('wallet_balance')
          .eq('id', driverId)
          .maybeSingle()
        if (driverErr) throw driverErr
        if (!driverRow) {
          res.status(404).json({
            error: { code: 'DRIVER_NOT_FOUND', message: 'driver user row missing' },
          })
          return
        }
        if (driverRow.wallet_balance < fareCents) {
          res.status(409).json({
            error: {
              code: 'DRIVER_WOULD_OVERDRAFT',
              message: 'Refund would push the driver wallet below zero. Re-submit with allow_driver_overdraft=true to override.',
            },
            driver_balance_cents: driverRow.wallet_balance,
            fare_cents: fareCents,
            gap_cents: fareCents - driverRow.wallet_balance,
          })
          return
        }
      }

      // 3. Credit rider.
      const { data: riderResult, error: riderApplyErr } = await supabaseAdmin.rpc(
        'wallet_apply_delta',
        {
          p_user_id: riderId,
          p_delta_cents: fareCents,
          p_type: 'admin_refund',
          p_description: `Refund: ${reason}`,
          p_ride_id: rideId,
          p_payment_intent_id: null,
          p_stripe_event_id: null,
        },
      )
      if (riderApplyErr) throw riderApplyErr
      const riderApplied = riderResult as { applied?: boolean; balance?: number; error?: string }
      if (!riderApplied?.applied) {
        res.status(500).json({
          error: {
            code: 'RIDER_CREDIT_REJECTED',
            message: riderApplied?.error ?? 'wallet_apply_delta did not apply for rider.',
          },
        })
        return
      }

      // 4. Debit driver.
      const { data: driverResult, error: driverApplyErr } = await supabaseAdmin.rpc(
        'wallet_apply_delta',
        {
          p_user_id: driverId,
          p_delta_cents: -fareCents,
          p_type: 'admin_refund',
          p_description: `Refund issued by admin: ${reason}`,
          p_ride_id: rideId,
          p_payment_intent_id: null,
          p_stripe_event_id: null,
        },
      )
      if (driverApplyErr) {
        // Rider already credited; log loudly + return 207-ish.
        console.error(
          `[adminRefund] CRITICAL: rider credited but driver debit failed for ride=${rideId}. ` +
          `Tago is now out by ${fareCents}¢. Manual reconciliation needed.`,
          driverApplyErr,
        )
        res.status(500).json({
          error: {
            code: 'DRIVER_DEBIT_FAILED',
            message: 'Rider was credited but driver debit failed. Manual reconciliation needed.',
          },
          rider_balance_after_cents: riderApplied.balance ?? null,
        })
        return
      }
      const driverApplied = driverResult as { applied?: boolean; balance?: number; error?: string }
      if (!driverApplied?.applied) {
        console.error(
          `[adminRefund] CRITICAL: rider credited but driver debit returned not-applied for ride=${rideId}. ` +
          `Tago is now out by ${fareCents}¢. Manual reconciliation needed. Result:`,
          driverApplied,
        )
        res.status(500).json({
          error: {
            code: 'DRIVER_DEBIT_REJECTED',
            message: driverApplied?.error ?? 'wallet_apply_delta did not apply for driver.',
          },
          rider_balance_after_cents: riderApplied.balance ?? null,
        })
        return
      }

      // 5. Flip the ride's payment_status.
      const { error: rideUpdateErr } = await supabaseAdmin
        .from('rides')
        .update({ payment_status: 'refunded' })
        .eq('id', rideId)
      if (rideUpdateErr) {
        console.error(
          `[adminRefund] wallet moves applied but failed to flip rides.payment_status for ride=${rideId}.`,
          rideUpdateErr,
        )
        // Don't 500 — wallets are already correct. Just log; admin can
        // re-run UPDATE manually if needed.
      }

      // 6. Two audit rows — one per party — so both users' audit lists pick it up.
      await writeAuditLog({
        adminId,
        targetUserId: riderId,
        action: 'refund_ride',
        payload: {
          ride_id: rideId,
          role: 'rider',
          amount_cents: fareCents,
          balance_after_cents: riderApplied.balance ?? null,
          reason,
          driver_id: driverId,
        },
      })
      await writeAuditLog({
        adminId,
        targetUserId: driverId,
        action: 'refund_ride',
        payload: {
          ride_id: rideId,
          role: 'driver',
          amount_cents: -fareCents,
          balance_after_cents: driverApplied.balance ?? null,
          allow_driver_overdraft: allowOverdraft,
          reason,
          rider_id: riderId,
        },
      })

      res.status(200).json({
        ok: true,
        ride_id: rideId,
        fare_cents: fareCents,
        rider_balance_after_cents: riderApplied.balance ?? null,
        driver_balance_after_cents: driverApplied.balance ?? null,
      })
    } catch (err) {
      next(err)
    }
  },
)
