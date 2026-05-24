/**
 * `/api/admin/rides/:id/force-safety-check` — admin force-trigger
 * for the v1.2 Phase 3 safety overlay.
 *
 * 2026-05-24 — closes one of the CTO-review gaps: today the
 * divergence-warning push only fires when the safety-net cron (or
 * the inline /gps-ping path) detects separation. If ops is watching
 * a live ride that looks worrying (rider's GPS frozen, driver
 * jittering, passenger off-route) but the algorithmic detector
 * hasn't yet flipped state, there's no way to escalate. This
 * endpoint exposes the same `fireDivergenceWarning` helper the
 * cron uses, so admin can force the in-app overlay + FCM push on
 * demand.
 *
 * Auth gate inherited from the parent adminRouter (JWT +
 * adminAuth). Mounted alongside `adminRidesRouter` +
 * `adminRefundsRouter` at `/api/admin/rides` via method routing —
 * those two own GETs + POST /:id/refund; this one owns
 * POST /:id/force-safety-check.
 *
 * Write action: every fire writes an audit log row so misuse is
 * traceable. Today the action label is `force_safety_check` and
 * the entity_type is `ride`.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'
import { writeAuditLog } from '../../lib/adminAudit.ts'
import {
  fireDivergenceWarning,
  MAX_WARNING_PUSHES,
  type SafetyRideRow,
} from '../../lib/rideSafetyNet.ts'

export const adminRideSafetyActionsRouter = Router()

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function parseIdParam(req: Request, res: Response): string | null {
  const raw = req.params['id']
  const id = typeof raw === 'string' ? raw : ''
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'ride id must be a UUID' },
    })
    return null
  }
  return id
}

adminRideSafetyActionsRouter.post(
  '/:id/force-safety-check',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminUserId = res.locals['userId'] as string
      const rideId = parseIdParam(req, res)
      if (!rideId) return

      const { data: rideRaw, error } = await supabaseAdmin
        .from('rides')
        .select(
          ('id, rider_id, driver_id, status, started_at, gps_distance_metres, '
            + 'last_driver_gps_lat, last_driver_gps_lng, last_rider_gps_lat, last_rider_gps_lng, '
            + 'last_driver_ping_at, last_rider_ping_at, '
            + 'divergence_state, divergence_first_seen_at, warning_fired_at, warning_push_count, '
            + 'pickup_point, dropoff_point, auto_ended') as never,
        )
        .eq('id', rideId)
        .single()
      if (error || !rideRaw) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Ride not found' },
        })
        return
      }
      const ride = rideRaw as unknown as SafetyRideRow

      // Refuse on terminal statuses — the safety overlay only makes
      // sense for in-flight rides.
      if (ride.status !== 'active') {
        res.status(409).json({
          error: {
            code: 'NOT_ACTIVE',
            message: `Ride status is '${ride.status}', cannot force safety check`,
          },
        })
        return
      }

      // Cap-honour: refuse if the ride already used its 2 pushes.
      // Same hard limit `fireDivergenceWarning` enforces internally,
      // but checking here gives a clearer error than a generic
      // "atomic write lost the race" silent no-op.
      const currentCount = ride.warning_push_count ?? 0
      if (currentCount >= MAX_WARNING_PUSHES) {
        res.status(409).json({
          error: {
            code: 'PUSH_CAP_HIT',
            message: `Ride already used ${MAX_WARNING_PUSHES} of ${MAX_WARNING_PUSHES} warning pushes`,
          },
        })
        return
      }

      const nextPushCount = currentCount + 1
      const fired = await fireDivergenceWarning(ride, Date.now(), nextPushCount)
      if (!fired) {
        // Atomic write lost the race — another path (cron, /gps-ping,
        // or a parallel admin click) flipped push_count first.
        res.status(409).json({
          error: {
            code: 'RACE_LOST',
            message: 'Warning push raced with another path; check the ride row state',
          },
        })
        return
      }

      // Audit row — admin-initiated escalations on a ride are
      // exactly the kind of action ops needs to be able to trace.
      // Target both rider + driver simultaneously isn't expressible
      // in the audit schema (one target_user_id per row), so we
      // pass null for target and put the ride context in the
      // payload. Future: extend audit log to support entity_type.
      void writeAuditLog({
        adminId: adminUserId,
        targetUserId: null,
        action: 'force_safety_check',
        payload: {
          ride_id: rideId,
          push_count: { before: currentCount, after: nextPushCount },
          rider_id: ride.rider_id,
          driver_id: ride.driver_id,
        },
      })

      res.status(200).json({
        ok: true,
        ride_id: rideId,
        push_count: nextPushCount,
        max_pushes: MAX_WARNING_PUSHES,
      })
    } catch (err) {
      next(err)
    }
  },
)
