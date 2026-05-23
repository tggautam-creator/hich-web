import { supabaseAdmin } from './supabaseAdmin.ts'
import { getResendClient } from './resend.ts'
import { getServerEnv } from '../env.ts'

/**
 * 2026-05-23 — Email fallback for users without registered push
 * tokens. Wired from the `board_offer` + `board_request` server
 * fan-outs in `routes/schedule.ts`: when the recipient has no row
 * in `push_tokens`, we still need to surface "someone responded to
 * your post" — otherwise a user without the app installed (or with
 * notifications denied) silently misses every offer/request and
 * thinks their post got no traction.
 *
 * Suppression rules:
 *   - Skip when RESEND_API_KEY is empty (local dev without email
 *     configured). Logs once per call, never throws.
 *   - Skip when the recipient has no email on file (rare — every
 *     auth signup requires .edu email).
 *   - Skip when the recipient has at least one push token. The
 *     CALLER is expected to gate on `tokens.length === 0` before
 *     invoking — this helper does NOT re-query push_tokens, to
 *     avoid a double round-trip from the hot push-fan-out path.
 *
 * Tradeoffs vs adding throttling:
 *   - One email per event matches one push per event. No
 *     deduplication. A user with 5 offers in a minute gets 5
 *     emails. Acceptable for v1; revisit if anyone complains.
 *   - We could check `notification_preferences.email_*` but the
 *     plan is: if the user has NO push registered, an email is the
 *     only path to inform them. Respecting an "email off" pref
 *     while also having no push tokens = total silence, which
 *     defeats the purpose of this whole helper.
 */

export type NoPushEventKind = 'board_offer' | 'board_request'

export interface NoPushEmailContext {
  recipientUserId: string
  eventKind: NoPushEventKind
  /** "UC Davis → Vacaville Premium Outlets" */
  routeStr: string
  /** ISO date "2026-05-23" — formatted as "Sat, May 23" in the body. */
  tripDate: string | null
  /** "12:02" (24h) — formatted as "12:02 PM" in the body. */
  tripTime: string | null
  /** First name (or full name) of whoever triggered the event,
   *  e.g. the driver who made the offer. */
  actorName: string
}

/**
 * Look up the recipient's email + first name + push token presence.
 * Returns `null` when the recipient has push tokens OR no email on
 * file — both cases mean we don't send.
 */
async function lookupRecipient(userId: string): Promise<
  { email: string; firstName: string } | null
> {
  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('email, full_name')
    .eq('id', userId)
    .maybeSingle()
  if (userErr || !user?.email) return null

  // Re-check push tokens as a defense in case the caller forgot to
  // gate. Empty array → genuine no-push user. Any token → bail.
  const { data: tokens } = await supabaseAdmin
    .from('push_tokens')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
  if ((tokens?.length ?? 0) > 0) return null

  const firstName = ((user.full_name as string | null) ?? '').trim().split(/\s+/)[0] || 'there'
  return { email: user.email as string, firstName }
}

export async function sendNoPushFallbackEmail(
  ctx: NoPushEmailContext,
): Promise<{ sent: boolean; reason: string | null }> {
  const env = getServerEnv()
  if (!env.RESEND_API_KEY) {
    console.warn('[noPushFallback] RESEND_API_KEY not set — skipping email')
    return { sent: false, reason: 'no_resend_key' }
  }
  try {
    const recipient = await lookupRecipient(ctx.recipientUserId)
    if (!recipient) {
      return { sent: false, reason: 'no_email_or_has_push' }
    }

    const subject = subjectFor(ctx.eventKind)
    const html = renderHtml(ctx, recipient.firstName)

    const client = getResendClient()
    const result = await client.emails.send({
      from: 'Tago <hello@tagorides.com>',
      to: recipient.email,
      subject,
      html,
    })
    if (result?.error) {
      console.error('[noPushFallback] send failed:', result.error.message ?? 'unknown')
      return { sent: false, reason: 'resend_error' }
    }
    return { sent: true, reason: null }
  } catch (err) {
    console.error(
      '[noPushFallback] crashed:',
      err instanceof Error ? err.message : String(err),
    )
    return { sent: false, reason: 'exception' }
  }
}

function subjectFor(kind: NoPushEventKind): string {
  if (kind === 'board_offer') return '🚗 You have a new ride offer on TAGO!'
  return '🙋 Someone wants to ride with you on TAGO!'
}

/**
 * Compose the body. Phrasing depends on `eventKind` (offer vs
 * request) so the email reads naturally for whoever the recipient
 * is. App download CTA points at the public landing page since
 * the iOS app isn't on the App Store yet; the landing redirects
 * to whatever the current distribution path is.
 */
function renderHtml(ctx: NoPushEmailContext, firstName: string): string {
  // Per-kind sentence stems — kept as full clauses (not glued
  // verbs) so the grammar lands correctly in both directions.
  // board_offer: someone offered to drive you on a ride you posted.
  // board_request: someone wants to ride along on a route you're driving.
  const intro =
    ctx.eventKind === 'board_offer'
      ? `${escapeHtml(ctx.actorName)} has responded to your upcoming ride post`
      : `${escapeHtml(ctx.actorName)} wants to ride with you on your upcoming post`
  const whatWaiting =
    ctx.eventKind === 'board_offer'
      ? '1 new ride offer waiting for your review'
      : '1 new ride request waiting for your review'
  const headline =
    ctx.eventKind === 'board_offer'
      ? 'You have a new ride offer on TAGO! 🚗'
      : 'Someone wants to ride with you on TAGO! 🙋'

  const [origin, destination] = ctx.routeStr.split(' → ')
  const tripWhen = formatTripWhen(ctx.tripDate, ctx.tripTime)
  const downloadUrl = 'https://www.tagorides.com'

  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; padding: 24px;">
  <h2 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #111827;">
    ${escapeHtml(headline)}
  </h2>

  <p style="font-size: 16px; line-height: 1.55; margin: 0 0 16px;">Hi ${escapeHtml(firstName)},</p>

  <p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
    Great news! ${intro}
    from <strong>${escapeHtml(origin ?? 'your pickup')}</strong> to
    <strong>${escapeHtml(destination ?? 'your destination')}</strong>
    scheduled for <strong>${escapeHtml(tripWhen)}</strong>. You have
    <strong>${escapeHtml(whatWaiting)}</strong>.
  </p>

  <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
    To view the details, coordinate, and make sure you don't miss any
    critical updates about your route, please download the TAGO app.
    Enabling push notifications is the fastest way to stay in the loop
    for all your posted rides.
  </p>

  <div style="margin: 24px 0;">
    <a href="${downloadUrl}" style="display: inline-block; background: #3b82f6; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px;">
      👉 Download the TAGO App for iOS
    </a>
  </div>

  <p style="font-size: 14px; line-height: 1.55; margin: 24px 0 4px; color: #4b5563;">Safe travels,</p>
  <p style="font-size: 14px; line-height: 1.55; margin: 0 0 24px; color: #4b5563;">The TAGO Team</p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
  <p style="font-size: 11px; color: #9ca3af; line-height: 1.5;">
    You're getting this email because you posted a ride on TAGO and your account
    doesn't have push notifications enabled. Install the app or sign in on the
    web to manage your posts directly.
  </p>
</div>`.trim()
}

function formatTripWhen(date: string | null, time: string | null): string {
  if (!date) return 'an upcoming time'
  // Server reads tripDate as ISO `YYYY-MM-DD`. Parse as local; if
  // invalid, fall back to the raw string.
  const parts = date.split('-').map((s) => parseInt(s, 10))
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return date
  const d = new Date(parts[0]!, parts[1]! - 1, parts[2]!)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' })
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const timeStr = formatTimeForBody(time)
  return timeStr ? `${weekday}, ${monthDay} at ${timeStr}` : `${weekday}, ${monthDay}`
}

function formatTimeForBody(time: string | null): string | null {
  if (!time) return null
  // Server stores time as `HH:MM` or `HH:MM:SS`. Trim seconds + 24→12h.
  const match = time.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return time
  const hh = parseInt(match[1]!, 10)
  const mm = match[2]!
  if (Number.isNaN(hh)) return time
  const period = hh >= 12 ? 'PM' : 'AM'
  const hr12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return `${hr12}:${mm} ${period}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
