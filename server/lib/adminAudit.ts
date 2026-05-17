import { supabaseAdmin } from './supabaseAdmin.ts'

/**
 * Writes ONE row to `admin_audit_log` so every admin write to user data
 * leaves a forensic trace.
 *
 * Failure mode: we WARN on write error but do NOT throw. The handler
 * that owns the underlying action (push send, wallet credit, etc.)
 * already succeeded; failing the request because the audit row didn't
 * land would leave the admin with a confusing 500 after their action
 * actually happened. Better to surface the audit failure in server
 * logs + Sentry (when wired) and keep the user-facing flow snappy.
 *
 * Inputs:
 *   - adminId       : auth.uid of the admin doing the action
 *                     (set by validateJwt on res.locals.userId)
 *   - targetUserId  : the user the action affected. null for
 *                     non-user-targeted actions (broadcasts).
 *   - action        : short snake_case token. Standard set:
 *                       send_push, grant_wallet_credit,
 *                       override_onboarding, suspend_user (1.3d),
 *                       refund_ride (1.3d), force_reset_password (1.3d)
 *   - payload       : action-specific JSON describing what changed.
 *                     Always include the admin's `reason` field when
 *                     the action was reason-required.
 */
export async function writeAuditLog(args: {
  adminId: string
  targetUserId: string | null
  action: string
  payload: Record<string, unknown>
}): Promise<void> {
  const { adminId, targetUserId, action, payload } = args
  try {
    const { error } = await supabaseAdmin.from('admin_audit_log').insert({
      admin_id: adminId,
      target_user_id: targetUserId,
      action,
      payload,
    })
    if (error) {
      console.warn(
        `[adminAudit] failed to write audit row action=${action} target=${targetUserId ?? 'none'}:`,
        error.message,
      )
    }
  } catch (err) {
    console.warn('[adminAudit] write threw:', err)
  }
}
