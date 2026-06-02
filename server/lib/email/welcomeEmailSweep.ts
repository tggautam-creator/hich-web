/**
 * Cron sweep: send the 'welcome-new-user' template to every user
 * who has finished onboarding but hasn't received the welcome email
 * yet.
 *
 * Why a sweep instead of a synchronous trigger at signup time:
 *   - The signup endpoint (and the onboarding_completed flip) is
 *     client-driven via supabase-js; there's no server hook to
 *     piggyback on without a new endpoint.
 *   - A 5-min cron sweep is idempotent by design and survives
 *     transient Resend failures + client disconnects.
 *   - Zero latency added to the signup hot path.
 *
 * Caps: at most WELCOME_BATCH_LIMIT users per sweep tick. Resend
 * burst limits apply, and we don't want one big migration / data
 * import to drain the daily quota in one sweep.
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'
import { sendTemplated } from './templates.ts'

const WELCOME_BATCH_LIMIT = 25
const TEMPLATE_KEY = 'welcome-new-user'

interface CandidateRow {
  id: string
  email: string | null
  full_name: string | null
}

/**
 * Sweep entrypoint. Picks up users where:
 *   - onboarding_completed = true
 *   - email IS NOT NULL (filter test / placeholder rows)
 *   - email ends with '.edu' (the trust spine of Tago — never email
 *     a non-.edu account even if one slips into the table)
 *   - no successful send row for (user_id, welcome-new-user) exists
 *
 * Returns the count attempted + a per-user error list for the cron
 * log line.
 */
export async function trySweepWelcomeEmails(): Promise<{
  attempted: number
  sent: number
  failed: number
  reason: string
}> {
  // Fetch a window of candidates. We over-fetch slightly to give
  // the in-app idempotency filter room (the SQL guard does the rest).
  const { data: candidates, error: candErr } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name')
    .eq('onboarding_completed', true)
    .not('email', 'is', null)
    .ilike('email', '%.edu')
    .order('created_at', { ascending: false })
    .limit(WELCOME_BATCH_LIMIT * 4)
  if (candErr) {
    return { attempted: 0, sent: 0, failed: 0, reason: `candidate query failed: ${candErr.message}` }
  }
  const rows = (candidates ?? []) as CandidateRow[]
  if (rows.length === 0) return { attempted: 0, sent: 0, failed: 0, reason: 'no_candidates' }

  // Filter out already-sent users in one batch query. Pulling all
  // distinct user_ids that already have a successful welcome send.
  const userIds = rows.map((r) => r.id)
  const { data: existingRaw } = await supabaseAdmin
    .from('email_sends')
    .select('user_id')
    .eq('template_key', TEMPLATE_KEY)
    .eq('status', 'sent')
    .eq('is_test', false)
    .in('user_id', userIds)
  const sentSet = new Set(
    ((existingRaw ?? []) as { user_id: string }[]).map((r) => r.user_id),
  )
  const eligible = rows.filter((r) => !sentSet.has(r.id)).slice(0, WELCOME_BATCH_LIMIT)
  if (eligible.length === 0) return { attempted: 0, sent: 0, failed: 0, reason: 'all_sent' }

  let sent = 0
  let failed = 0
  for (const user of eligible) {
    if (!user.email) continue
    const firstName = deriveFirstName(user.full_name, user.email)
    const result = await sendTemplated({
      userId: user.id,
      templateKey: TEMPLATE_KEY,
      recipientEmail: user.email,
      vars: { first_name: firstName, email: user.email },
    })
    if (result.ok) sent += 1
    else if (result.reason === 'already_sent') {
      // Raced with another sweep — count as sent for telemetry.
      sent += 1
    } else {
      failed += 1
      console.warn(
        `[email/welcome-sweep] send failed for ${user.id} (${user.email}): ` +
        `${result.reason ?? 'unknown'} ${result.error ?? ''}`,
      )
    }
  }
  return {
    attempted: eligible.length,
    sent,
    failed,
    reason: `sent=${sent} failed=${failed} attempted=${eligible.length}`,
  }
}

/**
 * Best-effort first-name extraction.
 *  1. If full_name is set, take the first whitespace-separated token.
 *     Capitalize for safety since names may arrive lowercase.
 *  2. Else derive from the email local-part — split on . / _ / -,
 *     take the first chunk.
 *  3. Fallback: "there" (lets the copy "Hi there," work even with
 *     no signal).
 */
export function deriveFirstName(
  fullName: string | null | undefined,
  email: string | null | undefined,
): string {
  if (fullName) {
    const first = fullName.trim().split(/\s+/)[0]
    if (first) return capitalize(first)
  }
  if (email) {
    const local = email.split('@')[0] ?? ''
    const chunk = (local.split(/[._-]/)[0] ?? '').trim()
    if (chunk) return capitalize(chunk)
  }
  return 'there'
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}
