/**
 * 2026-05-21 — Phase 4 of docs/REPORTS_PLAN.md. Severity-driven
 * fan-out for admin alerts.
 *
 * When a report lands in `POST /api/report`, the route calls
 * `notifyReportSubmitted` (fire-and-forget) and we route the
 * notification to the right channels based on the new report's
 * severity:
 *
 *   emergency  → Slack ping + email page-out + email forensic record
 *   urgent     → Slack ping + email forensic record
 *   normal/low → no-op (sits in the admin reports inbox)
 *
 * Both channels are independent — one failing doesn't block the
 * other. The handler also catches and logs all errors so a bad
 * Slack URL or a Resend outage NEVER affects the user's report
 * submission.
 */
import { getServerEnv } from '../env.ts'
import { postToSlack, type SlackMessage } from './slackWebhook.ts'
import { getResendClient, sendEmailToMany } from './resend.ts'

/**
 * Snapshot of the just-inserted report row + the reporter's
 * surface-level identity. Keeps `adminAlerts` independent of the
 * full DB Row type so it doesn't drag in 20 extra fields it doesn't
 * use.
 */
export interface ReportAlertContext {
  reportID: string
  category: string
  severity: 'emergency' | 'urgent' | 'normal' | 'low'
  title: string
  body: string
  rideID: string | null
  requestedRefundCents: number | null
  /** Server-frozen `metadata` jsonb. Pulled into the alert body. */
  metadata: Record<string, unknown>
  /** Reporter's email + display name from the JWT lookup. Falls back to id. */
  reporterEmail: string | null
  reporterName: string | null
  reporterID: string
  /** When the report row was created (`reports.created_at`). */
  createdAt: string
}

const FROM_ADDRESS = 'alerts@tagorides.com'

/**
 * Fire-and-forget. Returns immediately; both channels are
 * intentionally not awaited from the caller's perspective. Errors
 * are caught + logged inside; nothing thrown.
 */
export function notifyReportSubmitted(ctx: ReportAlertContext): void {
  // Route by severity. Slack pings on emergency + urgent (per
  // Tarun 2026-05-21). Email pages on emergency only (urgent
  // doesn't need a sound-on alert — Slack handles it).
  const slackChannels = ctx.severity === 'emergency' || ctx.severity === 'urgent'
  const emailChannels = ctx.severity === 'emergency' || ctx.severity === 'urgent'
  if (!slackChannels && !emailChannels) return

  if (slackChannels) {
    void fireSlack(ctx).catch((err) => {
      console.error(
        '[adminAlerts] slack channel error:',
        err instanceof Error ? err.message : String(err),
      )
    })
  }

  if (emailChannels) {
    void fireEmail(ctx).catch((err) => {
      console.error(
        '[adminAlerts] email channel error:',
        err instanceof Error ? err.message : String(err),
      )
    })
  }
}

// ── Slack channel ───────────────────────────────────────────────────

async function fireSlack(ctx: ReportAlertContext): Promise<void> {
  await postToSlack(buildSlackMessage(ctx))
}

export function buildSlackMessage(ctx: ReportAlertContext): SlackMessage {
  const reporter = ctx.reporterName || ctx.reporterEmail || ctx.reporterID.slice(0, 8)
  const headerEmoji = ctx.severity === 'emergency' ? '🚨' : '⚠️'
  const headerText = `${headerEmoji} ${labelForSeverity(ctx.severity)} · ${labelForCategory(ctx.category)}`

  // Truncate the body so we don't blow Slack's block-size limits —
  // anyone investigating clicks through to the admin panel for the
  // full text anyway.
  const bodyPreview = ctx.body.length > 400 ? ctx.body.slice(0, 397) + '…' : ctx.body

  const fields: { type: 'mrkdwn'; text: string }[] = [
    { type: 'mrkdwn', text: `*Reporter*\n${reporter}` },
    { type: 'mrkdwn', text: `*Reported at*\n${ctx.createdAt}` },
  ]
  if (ctx.rideID) {
    fields.push({ type: 'mrkdwn', text: `*Ride*\n\`${ctx.rideID.slice(0, 8)}…\`` })
  }
  if (ctx.requestedRefundCents !== null) {
    const dollars = (ctx.requestedRefundCents / 100).toFixed(2)
    fields.push({ type: 'mrkdwn', text: `*Refund request*\n$${dollars}` })
  }
  const gpsField = gpsFieldFor(ctx)
  if (gpsField) fields.push(gpsField)
  const platformField = platformFieldFor(ctx)
  if (platformField) fields.push(platformField)

  // Plain-text fallback for the notification banner (when Slack
  // can't render blocks — desktop/mobile push body).
  const fallback = `${headerText} — ${reporter}: ${ctx.title}`

  return {
    text: fallback,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: headerText } },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${ctx.title}*\n${bodyPreview}` },
      },
      { type: 'section', text: { type: 'mrkdwn', text: ' ' }, fields },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open in admin' },
            url: `https://www.tagorides.com/admin/reports/${ctx.reportID}`,
            style: ctx.severity === 'emergency' ? 'danger' : 'primary',
          },
        ],
      },
    ],
  }
}

function gpsFieldFor(ctx: ReportAlertContext): { type: 'mrkdwn'; text: string } | null {
  const lat = ctx.metadata['gps_lat']
  const lng = ctx.metadata['gps_lng']
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  const url = `https://www.google.com/maps?q=${lat},${lng}`
  return {
    type: 'mrkdwn',
    text: `*GPS*\n<${url}|${lat.toFixed(4)}, ${lng.toFixed(4)}>`,
  }
}

function platformFieldFor(ctx: ReportAlertContext): { type: 'mrkdwn'; text: string } | null {
  const platform = ctx.metadata['platform']
  const appVersion = ctx.metadata['app_version']
  if (typeof platform !== 'string' && typeof appVersion !== 'string') return null
  const parts: string[] = []
  if (typeof platform === 'string') parts.push(platform)
  if (typeof appVersion === 'string') parts.push(`v${appVersion}`)
  return {
    type: 'mrkdwn',
    text: `*Client*\n${parts.join(' · ')}`,
  }
}

// ── Email channel ───────────────────────────────────────────────────

async function fireEmail(ctx: ReportAlertContext): Promise<void> {
  const { ADMIN_ALERT_EMAILS, RESEND_API_KEY } = getServerEnv()
  if (!ADMIN_ALERT_EMAILS || !RESEND_API_KEY) {
    // Don't warn-spam — email-to-admin is optional and silently
    // skipping is fine when ops hasn't wired the env vars.
    return
  }
  const recipients = ADMIN_ALERT_EMAILS.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (recipients.length === 0) return

  // Lazy-touch the Resend client up front so a bad config fails
  // here instead of inside sendEmailToMany.
  getResendClient()

  await sendEmailToMany({
    from: FROM_ADDRESS,
    subject: emailSubjectFor(ctx),
    html: emailHtmlFor(ctx),
    recipients,
  })
}

export function emailSubjectFor(ctx: ReportAlertContext): string {
  const prefix = ctx.severity === 'emergency' ? '🚨 EMERGENCY' : '⚠️ Urgent'
  return `${prefix}: ${labelForCategory(ctx.category)} · ${ctx.title}`
}

export function emailHtmlFor(ctx: ReportAlertContext): string {
  const reporter = ctx.reporterName || ctx.reporterEmail || ctx.reporterID
  const adminURL = `https://www.tagorides.com/admin/reports/${ctx.reportID}`
  const gpsRow = (() => {
    const lat = ctx.metadata['gps_lat']
    const lng = ctx.metadata['gps_lng']
    if (typeof lat !== 'number' || typeof lng !== 'number') return ''
    return `<tr><td><strong>GPS</strong></td><td><a href="https://www.google.com/maps?q=${lat},${lng}">${lat.toFixed(4)}, ${lng.toFixed(4)}</a></td></tr>`
  })()
  const rideRow = ctx.rideID
    ? `<tr><td><strong>Ride</strong></td><td><code>${ctx.rideID}</code></td></tr>`
    : ''
  const refundRow = ctx.requestedRefundCents !== null
    ? `<tr><td><strong>Refund request</strong></td><td>$${(ctx.requestedRefundCents / 100).toFixed(2)}</td></tr>`
    : ''

  return `
    <p style="font-family: system-ui; font-size: 14px;">
      <strong>${labelForSeverity(ctx.severity)}</strong> · ${labelForCategory(ctx.category)}
    </p>
    <h2 style="font-family: system-ui; margin: 0 0 8px;">${escapeHtml(ctx.title)}</h2>
    <p style="font-family: system-ui; white-space: pre-wrap;">${escapeHtml(ctx.body)}</p>
    <table style="font-family: system-ui; font-size: 13px; border-collapse: collapse; margin-top: 16px;">
      <tr><td style="padding: 4px 8px;"><strong>Reporter</strong></td><td>${escapeHtml(reporter)}</td></tr>
      ${rideRow}
      ${refundRow}
      ${gpsRow}
      <tr><td style="padding: 4px 8px;"><strong>Reported at</strong></td><td>${ctx.createdAt}</td></tr>
    </table>
    <p style="margin-top: 24px;">
      <a href="${adminURL}" style="background:#00A8F3; color: white; padding: 8px 14px; border-radius: 6px; text-decoration: none; font-family: system-ui; font-size: 13px; font-weight: 600;">Open in admin →</a>
    </p>
  `
}

// ── User-reply Slack ping ───────────────────────────────────────────

export interface UserReplyAlertContext {
  reportID: string
  reportTitle: string
  /** Severity stays from the original report; tells the admin how
   *  important the conversation is at a glance. */
  reportSeverity: 'emergency' | 'urgent' | 'normal' | 'low'
  /** Trimmed/previewed body of the user's reply. */
  replyPreview: string
  reporterEmail: string | null
  reporterName: string | null
  reporterID: string
  createdAt: string
}

/**
 * Fire-and-forget Slack ping when a reporter sends a reply on their
 * own report. Lower-key than the initial-submission alert — uses
 * `:speech_balloon:` instead of the full severity emoji, and only
 * fires when there's something to surface (skipped when severity
 * is normal/low since those don't need real-time triage).
 */
export function notifyAdminOfUserReply(ctx: UserReplyAlertContext): void {
  if (ctx.reportSeverity !== 'emergency' && ctx.reportSeverity !== 'urgent') {
    return
  }
  void postToSlack(buildUserReplySlackMessage(ctx)).catch((err) => {
    console.error(
      '[adminAlerts] user-reply slack error:',
      err instanceof Error ? err.message : String(err),
    )
  })
}

export function buildUserReplySlackMessage(ctx: UserReplyAlertContext): SlackMessage {
  const reporter = ctx.reporterName || ctx.reporterEmail || ctx.reporterID.slice(0, 8)
  const headerText = `💬 New reply on ${labelForSeverity(ctx.reportSeverity)} report`
  return {
    text: `${headerText} — ${reporter}: ${ctx.replyPreview}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${headerText}*\n*${ctx.reportTitle}*\n> ${ctx.replyPreview}`,
        },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: ' ' },
        fields: [
          { type: 'mrkdwn', text: `*Reporter*\n${reporter}` },
          { type: 'mrkdwn', text: `*Replied at*\n${ctx.createdAt}` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open in admin' },
            url: `https://www.tagorides.com/admin/reports/${ctx.reportID}`,
            style: ctx.reportSeverity === 'emergency' ? 'danger' : 'primary',
          },
        ],
      },
    ],
  }
}

// ── Display helpers ─────────────────────────────────────────────────

function labelForSeverity(severity: ReportAlertContext['severity']): string {
  switch (severity) {
    case 'emergency': return 'Emergency'
    case 'urgent': return 'Urgent'
    case 'normal': return 'Normal'
    case 'low': return 'Low'
  }
}

function labelForCategory(rawValue: string): string {
  // Friendlier display for the 14 server categories — keep aligned
  // with the web's `categoryConfig.ts` labels.
  switch (rawValue) {
    case 'driver_conduct': return 'Driver conduct'
    case 'rider_conduct': return 'Rider conduct'
    case 'vehicle_condition': return 'Vehicle condition'
    case 'route_issue': return 'Route problem'
    case 'fare_dispute': return 'Fare dispute'
    case 'payment_issue': return 'Payment issue'
    case 'pickup_dropoff': return 'Pickup / dropoff'
    case 'lost_item': return 'Lost item'
    case 'cancellation_dispute': return 'Cancellation dispute'
    case 'safety_during_ride': return 'Safety during ride'
    case 'bug_report': return 'Bug report'
    case 'account_issue': return 'Account issue'
    case 'harassment_messages': return 'Harassment via messages'
    case 'feedback_feature': return 'Feedback / feature request'
    default: return rawValue
  }
}

// ── Phase 6a — Outbound admin reply email ──────────────────────────────────
//
// Sends a single email from the support address to the reporter when an
// admin picks `Reply via: email` (or `both`) on a report. The Reply-To is
// `reports+<reportId>@tagorides.com` — the `+`-addressing means the
// Phase 6b inbound webhook can match the user's reply back to the right
// report ID by just splitting the local part, no header threading
// required. Returns the Resend message id so the caller can stash it
// on the `report_messages` row for forensics + future dedup.

export interface SupportReplyEmailContext {
  reportID: string
  reportTitle: string
  reporterEmail: string
  reporterName: string | null
  body: string
  adminName: string | null
}

export async function sendSupportReplyEmail(
  ctx: SupportReplyEmailContext,
): Promise<{ ok: boolean; emailId: string | null; error: string | null }> {
  const env = getServerEnv()
  if (!env.RESEND_API_KEY) {
    return { ok: false, emailId: null, error: 'RESEND_API_KEY not configured' }
  }
  try {
    const client = getResendClient()
    const subject = `Re: Tago report — ${ctx.reportTitle}`
    const greeting = ctx.reporterName ? `Hi ${ctx.reporterName.split(' ')[0]},` : 'Hi there,'
    const adminLabel = ctx.adminName ?? 'Tago support'
    const detailUrl = `https://www.tagorides.com/reports/${ctx.reportID}`
    const html = `
<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; color: #1f2937;">
  <p>${escapeHtml(greeting)}</p>
  <div style="white-space: pre-wrap; line-height: 1.5;">${escapeHtml(ctx.body)}</div>
  <p style="margin-top: 24px;">— ${escapeHtml(adminLabel)}</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
  <p style="font-size: 12px; color: #6b7280;">
    You can reply to this email to keep the thread going — your reply will land
    back in your Tago report. Or
    <a href="${detailUrl}" style="color: #3b82f6;">open it in the app</a>.
  </p>
  <p style="font-size: 11px; color: #9ca3af;">Report ID: ${escapeHtml(ctx.reportID)}</p>
</div>`.trim()

    // `reports+<id>@` — the +tag makes Phase 6b inbound matching a
    // single split on `+` then `@`. Cleaner than parsing References /
    // In-Reply-To headers across mail clients that mangle them.
    const replyTo = `reports+${ctx.reportID}@tagorides.com`
    const result = await client.emails.send({
      from: 'Tago Support <support@tagorides.com>',
      to: ctx.reporterEmail,
      subject,
      html,
      replyTo,
    })

    if (result?.error) {
      return { ok: false, emailId: null, error: result.error.message ?? 'unknown' }
    }
    return { ok: true, emailId: result?.data?.id ?? null, error: null }
  } catch (err) {
    return {
      ok: false,
      emailId: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function escapeHtml(s: string): string {
  // String.replaceAll is ES2021. Some tsconfig lib targets in this
  // repo are ES2020-ish, so fall back to regex /g for compatibility.
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
