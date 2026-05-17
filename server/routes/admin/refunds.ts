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
import { sendFcmPush } from '../../lib/fcm.ts'

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

// ── POST /:rideId/cancel (Slice 1.7b) ─────────────────────────────────────
//
// Force-cancel a ride from the Live ops drawer. Use case: a ride is
// genuinely stuck (driver vanished mid-ride, rider unreachable,
// requested ride sitting unmatched for 30+ min) and ops decides to
// kill it rather than wait.
//
// Behaviour:
//   - Refuses if ride is already terminal (completed / cancelled / expired)
//   - Sets status='cancelled' + ended_at=now(). Does NOT touch payment_status
//     — that's refund's job. An active ride that's been cancelled mid-trip
//     with payment already taken is a follow-up refund decision; the cancel
//     just stops the clock.
//   - Writes one notifications row per party + best-effort push so both
//     sides see "Tago ended your ride" in the inbox.
//   - Audit logs once per party (rider + driver), same pattern as refund.
interface ForceCancelBody { reason?: unknown }

adminRefundsRouter.post(
  '/:rideId/cancel',
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
      const b = req.body as ForceCancelBody
      const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
      if (!reason) {
        res.status(400).json({
          error: { code: 'INVALID_BODY', message: 'reason is required' },
        })
        return
      }
      if (reason.length > 500) {
        res.status(400).json({
          error: { code: 'REASON_TOO_LONG', message: 'reason must be ≤ 500 chars' },
        })
        return
      }

      // Load ride
      const { data: ride, error: rideErr } = await supabaseAdmin
        .from('rides')
        .select('id, status, rider_id, driver_id')
        .eq('id', rideId)
        .maybeSingle()
      if (rideErr) throw rideErr
      if (!ride) {
        res.status(404).json({
          error: { code: 'RIDE_NOT_FOUND', message: 'no ride with that id' },
        })
        return
      }
      const TERMINAL = new Set(['completed', 'cancelled', 'expired'])
      if (TERMINAL.has(ride.status)) {
        res.status(409).json({
          error: {
            code: 'RIDE_NOT_CANCELLABLE',
            message: `ride is already ${ride.status}`,
          },
        })
        return
      }

      const nowIso = new Date().toISOString()
      const { error: updErr } = await supabaseAdmin
        .from('rides')
        .update({ status: 'cancelled', ended_at: nowIso })
        .eq('id', rideId)
      if (updErr) throw updErr

      // Notify both parties via inbox + best-effort push.
      const riderId = ride.rider_id as string
      const driverId = ride.driver_id as string | null
      const notifTitle = 'Your ride was ended by Tago'
      const notifBody =
        'Tago ops cancelled this ride. Reach out to support if you need help.'

      const recipients: string[] = [riderId]
      if (driverId) recipients.push(driverId)

      const notifInserts = recipients.map((uid) => ({
        user_id: uid,
        type: 'admin_cancel',
        title: notifTitle,
        body: notifBody,
        data: {
          source: 'admin_panel',
          type: 'admin_cancel',
          ride_id: rideId,
          reason,
        },
      }))
      const { error: notifErr } = await supabaseAdmin
        .from('notifications')
        .insert(notifInserts)
      if (notifErr) {
        console.warn('[adminForceCancel] notifications insert failed:', notifErr.message)
      }

      // Best-effort push fan-out per recipient.
      let pushSent = 0
      for (const uid of recipients) {
        try {
          const { data: tokenRows } = await supabaseAdmin
            .from('push_tokens')
            .select('token')
            .eq('user_id', uid)
          const tokens = (tokenRows ?? []).map((r) => r.token as string)
          if (tokens.length > 0) {
            pushSent += await sendFcmPush(tokens, {
              title: notifTitle,
              body: notifBody,
              data: {
                source: 'admin_panel',
                type: 'admin_cancel',
                ride_id: rideId,
              },
            })
          }
        } catch (pushErr) {
          console.warn('[adminForceCancel] push failed for', uid, pushErr)
        }
      }

      // Audit — one row per party so it shows on both Admin Actions
      // history surfaces. Mirrors the refund pattern.
      const auditPayload = {
        ride_id: rideId,
        previous_status: ride.status,
        reason,
        recipients,
      }
      await writeAuditLog({
        adminId,
        targetUserId: riderId,
        action: 'force_cancel_ride',
        payload: { ...auditPayload, role: 'rider' },
      })
      if (driverId) {
        await writeAuditLog({
          adminId,
          targetUserId: driverId,
          action: 'force_cancel_ride',
          payload: { ...auditPayload, role: 'driver' },
        })
      }

      res.status(200).json({
        ok: true,
        ride_id: rideId,
        previous_status: ride.status,
        notifications_written: notifInserts.length,
        push_sent: pushSent,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── POST /:rideId/reassign (Slice 1.7f) ───────────────────────────────────
//
// Manually assign a ride to a specific driver — ops escape hatch when the
// matcher hasn't found a driver fast enough OR when ops knows a specific
// driver should take this ride.
//
// Important boundary: this does NOT touch the matcher RPC or any of the
// staged matching logic in CLAUDE.md. It only:
//   - writes ride.driver_id (+ flips status='requested' → 'accepted')
//   - sends a notification to the new driver and the rider
//   - sends an "unassigned" notification to the previous driver if there was one
//   - audit-logs once per affected party (1–3 rows total)
//
// Constraints enforced before the write:
//   - Ride must be in 'requested' or 'accepted' (mid-flight reassign would
//     require re-routing logic; out of scope for v1)
//   - New driver must exist, be is_driver=true, and not suspended
//   - New driver must NOT already be on another in-flight ride (would
//     create a double-booking — they can't be in two pickups at once)
interface ReassignBody {
  new_driver_id?: unknown
  reason?: unknown
}

const REASSIGNABLE_STATUSES = new Set(['requested', 'accepted'])
const BUSY_STATUSES = ['accepted', 'coordinating', 'active'] as const

adminRefundsRouter.post(
  '/:rideId/reassign',
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
      const b = req.body as ReassignBody
      const newDriverId = typeof b.new_driver_id === 'string' ? b.new_driver_id.trim() : ''
      const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
      if (!newDriverId || !UUID_RE.test(newDriverId)) {
        res.status(400).json({
          error: { code: 'INVALID_NEW_DRIVER_ID', message: 'new_driver_id must be a UUID' },
        })
        return
      }
      if (!reason) {
        res.status(400).json({
          error: { code: 'INVALID_BODY', message: 'reason is required' },
        })
        return
      }
      if (reason.length > 500) {
        res.status(400).json({
          error: { code: 'REASON_TOO_LONG', message: 'reason must be ≤ 500 chars' },
        })
        return
      }

      // 1. Load ride
      const { data: ride, error: rideErr } = await supabaseAdmin
        .from('rides')
        .select('id, status, rider_id, driver_id')
        .eq('id', rideId)
        .maybeSingle()
      if (rideErr) throw rideErr
      if (!ride) {
        res.status(404).json({
          error: { code: 'RIDE_NOT_FOUND', message: 'no ride with that id' },
        })
        return
      }
      if (!REASSIGNABLE_STATUSES.has(ride.status)) {
        res.status(409).json({
          error: {
            code: 'RIDE_NOT_REASSIGNABLE',
            message: `ride is ${ride.status}; reassign only works on requested or accepted rides`,
          },
        })
        return
      }
      if (ride.driver_id === newDriverId) {
        res.status(409).json({
          error: {
            code: 'ALREADY_ASSIGNED',
            message: 'ride is already assigned to this driver',
          },
        })
        return
      }

      // 2. Load new driver + sanity-check
      const { data: driver, error: driverErr } = await supabaseAdmin
        .from('users')
        .select('id, is_driver, suspended_at, full_name, email')
        .eq('id', newDriverId)
        .maybeSingle()
      if (driverErr) throw driverErr
      if (!driver) {
        res.status(404).json({
          error: { code: 'DRIVER_NOT_FOUND', message: 'new_driver_id does not exist' },
        })
        return
      }
      if (!driver.is_driver) {
        res.status(409).json({
          error: { code: 'NOT_A_DRIVER', message: 'target user is not a driver' },
        })
        return
      }
      if (driver.suspended_at) {
        res.status(409).json({
          error: { code: 'DRIVER_SUSPENDED', message: 'target driver is suspended' },
        })
        return
      }

      // 3. Don't double-book. New driver must have no other in-flight ride.
      const { data: busyRides, error: busyErr } = await supabaseAdmin
        .from('rides')
        .select('id, status')
        .eq('driver_id', newDriverId)
        .in('status', BUSY_STATUSES as unknown as readonly never[])
        .limit(1)
      if (busyErr) throw busyErr
      if ((busyRides ?? []).length > 0) {
        res.status(409).json({
          error: {
            code: 'DRIVER_BUSY',
            message: 'driver is already on another in-flight ride',
          },
        })
        return
      }

      // 4. Flip the row.
      const previousDriverId = ride.driver_id as string | null
      const nextStatus = ride.status === 'requested' ? 'accepted' : ride.status
      const { error: updErr } = await supabaseAdmin
        .from('rides')
        .update({ driver_id: newDriverId, status: nextStatus })
        .eq('id', rideId)
      if (updErr) throw updErr

      // 5. Notify all affected parties via inbox + best-effort FCM.
      const newDriverTitle = 'Tago assigned you a ride'
      const newDriverBody = `Ops assigned you a ride. Open the app to see pickup details.`
      const riderTitle = 'Your driver has changed'
      const riderBody = `Tago assigned a new driver to your ride.`
      const oldDriverTitle = 'Ride reassigned'
      const oldDriverBody = `Tago reassigned this ride to another driver.`

      const notifInserts = [
        {
          user_id: newDriverId,
          type: 'admin_assigned',
          title: newDriverTitle,
          body: newDriverBody,
          data: { source: 'admin_panel', type: 'admin_assigned', ride_id: rideId, reason },
        },
        {
          user_id: ride.rider_id as string,
          type: 'admin_assigned',
          title: riderTitle,
          body: riderBody,
          data: { source: 'admin_panel', type: 'admin_assigned', ride_id: rideId },
        },
      ]
      if (previousDriverId) {
        notifInserts.push({
          user_id: previousDriverId,
          type: 'admin_unassigned',
          title: oldDriverTitle,
          body: oldDriverBody,
          data: { source: 'admin_panel', type: 'admin_unassigned', ride_id: rideId, reason },
        })
      }
      const { error: notifErr } = await supabaseAdmin
        .from('notifications')
        .insert(notifInserts)
      if (notifErr) {
        console.warn('[adminReassign] notifications insert failed:', notifErr.message)
      }

      // 6. Best-effort push fan-out.
      let pushSent = 0
      const pushRecipients = [
        { uid: newDriverId, title: newDriverTitle, body: newDriverBody },
        { uid: ride.rider_id as string, title: riderTitle, body: riderBody },
        ...(previousDriverId
          ? [{ uid: previousDriverId, title: oldDriverTitle, body: oldDriverBody }]
          : []),
      ]
      for (const r of pushRecipients) {
        try {
          const { data: tokenRows } = await supabaseAdmin
            .from('push_tokens')
            .select('token')
            .eq('user_id', r.uid)
          const tokens = (tokenRows ?? []).map((row) => row.token as string)
          if (tokens.length > 0) {
            pushSent += await sendFcmPush(tokens, {
              title: r.title,
              body: r.body,
              data: { source: 'admin_panel', type: 'admin_reassigned', ride_id: rideId },
            })
          }
        } catch (pushErr) {
          console.warn('[adminReassign] push failed for', r.uid, pushErr)
        }
      }

      // 7. Audit — one row per affected party (mirrors refund/force-cancel).
      const auditBase = {
        ride_id: rideId,
        previous_status: ride.status,
        next_status: nextStatus,
        previous_driver_id: previousDriverId,
        new_driver_id: newDriverId,
        reason,
      }
      await writeAuditLog({
        adminId,
        targetUserId: ride.rider_id as string,
        action: 'reassign_ride',
        payload: { ...auditBase, role: 'rider' },
      })
      await writeAuditLog({
        adminId,
        targetUserId: newDriverId,
        action: 'reassign_ride',
        payload: { ...auditBase, role: 'new_driver' },
      })
      if (previousDriverId) {
        await writeAuditLog({
          adminId,
          targetUserId: previousDriverId,
          action: 'reassign_ride',
          payload: { ...auditBase, role: 'previous_driver' },
        })
      }

      res.status(200).json({
        ok: true,
        ride_id: rideId,
        previous_status: ride.status,
        next_status: nextStatus,
        previous_driver_id: previousDriverId,
        new_driver_id: newDriverId,
        notifications_written: notifInserts.length,
        push_sent: pushSent,
      })
    } catch (err) {
      next(err)
    }
  },
)
