import { Router } from 'express'
import type { Request, Response } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'
import { getServerEnv } from '../../env.ts'
import {
  parseReportIdFromTo,
  stripQuotedReply,
  verifyResendSignature,
  readString,
} from '../../lib/inboundEmail.ts'
import { notifyAdminOfUserReply } from '../../lib/adminAlerts.ts'

export const resendInboundRouter = Router()

/**
 * 2026-05-22 — Phase 6b of docs/REPORTS_PLAN.md. Resend inbound
 * webhook handler. Resend POSTs us the raw email payload when a
 * user replies to an admin-sent support email (or sends anything
 * to `reports+<reportId>@tagorides.com`). We:
 *
 *   1. Verify the Svix-style HMAC signature (when configured).
 *   2. Extract `report_id` from the To: header's `+`-tag.
 *   3. Verify the From: matches the report's reporter email — a
 *      stranger who guesses a report id from the email subject
 *      can't inject a message into someone else's thread.
 *   4. Strip quoted reply text + signatures so the thread only
 *      stores the user's new content.
 *   5. Insert a `report_messages` row with channel='email_inbound'
 *      and the Resend message id stashed for forensic dedup.
 *   6. Flip status `awaiting_user` → `in_progress` (mirroring the
 *      in-app reply path in `server/routes/report.ts`).
 *   7. Re-ping admin via Slack for emergency/urgent severities so
 *      the same human triage loop fires whether the user replied
 *      in-app or via email.
 *
 * The handler is mounted at `/api/webhooks/resend-inbound` BEFORE
 * the global JSON parser in `app.ts` so we can compute HMAC over
 * the raw request body. The body is parsed via `JSON.parse(...)`
 * after signature verification.
 *
 * Resend's inbound payload shape (cribbed from their docs +
 * defensive against schema drift):
 *
 *   {
 *     "type": "email.inbound" | "email.received",
 *     "data": {
 *       "from": "user@school.edu",
 *       "to": ["reports+<reportId>@tagorides.com"],
 *       "subject": "Re: Tago report — Bug",
 *       "text": "...plaintext body with quoted history...",
 *       "html": "...html version...",
 *       "message_id": "<provider-supplied id>",
 *       ...
 *     }
 *   }
 *
 * We read defensively — `to` may arrive as `string` or `string[]`
 * depending on the recipient list — and tolerate fields being
 * absent. Everything that can fail logs + returns 200 (Resend
 * retries on non-2xx, and a retry of a bad payload won't fix it).
 */

resendInboundRouter.post('/', async (req: Request, res: Response) => {
  const { RESEND_WEBHOOK_SECRET } = getServerEnv()

  // 1. Signature verification — gated on the env var being set so
  // local dev can hit the endpoint with a fake payload without
  // wiring HMAC. NEVER deploy prod without the secret set.
  if (RESEND_WEBHOOK_SECRET) {
    const ok = verifyResendSignature({
      rawBody: req.body as Buffer,
      msgId: pickHeader(req, 'svix-id') ?? pickHeader(req, 'resend-id'),
      timestamp: pickHeader(req, 'svix-timestamp') ?? pickHeader(req, 'resend-timestamp'),
      signature: pickHeader(req, 'svix-signature') ?? pickHeader(req, 'resend-signature'),
      secret: RESEND_WEBHOOK_SECRET,
    })
    if (!ok) {
      console.warn('[resendInbound] signature verification failed')
      res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'bad signature' } })
      return
    }
  } else {
    console.warn('[resendInbound] RESEND_WEBHOOK_SECRET not set — signature check SKIPPED (dev only)')
  }

  // 2. Parse JSON now that we've verified the raw body.
  let envelope: unknown
  try {
    const bodyStr = (req.body as Buffer).toString('utf8')
    envelope = JSON.parse(bodyStr)
  } catch (err) {
    console.error('[resendInbound] body parse failed:', err instanceof Error ? err.message : err)
    res.status(400).json({ error: { code: 'BAD_BODY', message: 'invalid JSON' } })
    return
  }

  // Resend wraps the email payload under `data`. Some webhook
  // shapes nest deeper (`data.email`); accept both.
  const data = pickData(envelope)
  if (!data) {
    console.warn('[resendInbound] no data field on envelope')
    res.status(200).json({ ok: true, skipped: 'no_data' })
    return
  }

  // 3. Extract To: and pull the report id from the +tag.
  const toRaw = (data as Record<string, unknown>)['to']
  const toCandidates: string[] = Array.isArray(toRaw)
    ? toRaw.filter((x): x is string => typeof x === 'string')
    : typeof toRaw === 'string'
      ? [toRaw]
      : []
  let reportId: string | null = null
  for (const candidate of toCandidates) {
    const parsed = parseReportIdFromTo(candidate)
    if (parsed) {
      reportId = parsed
      break
    }
  }
  if (!reportId) {
    console.warn('[resendInbound] no report id in any To:', toCandidates)
    res.status(200).json({ ok: true, skipped: 'no_report_id' })
    return
  }

  // 4. Look up the report + verify sender matches the reporter.
  const { data: report, error: reportErr } = await supabaseAdmin
    .from('reports')
    .select('id, status, reporter_id, title, severity')
    .eq('id', reportId)
    .maybeSingle()
  if (reportErr || !report) {
    console.warn('[resendInbound] report not found:', reportId)
    res.status(200).json({ ok: true, skipped: 'report_not_found' })
    return
  }

  const { data: reporter } = await supabaseAdmin
    .from('users')
    .select('email, full_name')
    .eq('id', report.reporter_id)
    .maybeSingle()
  const fromAddr = parseEmailAddress(readString(data, 'from') ?? '')
  if (!reporter?.email || !fromAddr || fromAddr.toLowerCase() !== reporter.email.toLowerCase()) {
    console.warn('[resendInbound] sender mismatch:', { reportId, fromAddr, reporterEmail: reporter?.email })
    res.status(200).json({ ok: true, skipped: 'sender_mismatch' })
    return
  }

  // 5. Prefer plain text; fall back to a crude html → text strip
  // when only HTML is provided (rare for real mail clients).
  const rawText = readString(data, 'text') ?? htmlToPlain(readString(data, 'html') ?? '')
  const cleaned = stripQuotedReply(rawText)
  if (!cleaned) {
    console.warn('[resendInbound] empty body after strip:', { reportId })
    res.status(200).json({ ok: true, skipped: 'empty_body' })
    return
  }

  // 6. Insert the thread row. Resend's `message_id` is stored as
  // forensic / dedup hook — re-deliveries from Resend (Svix retries
  // on a flaky 5xx) won't double-insert because we check below.
  const emailMessageId = readString(data, 'message_id') ?? readString(data, 'id')
  if (emailMessageId) {
    const { data: existing } = await supabaseAdmin
      .from('report_messages')
      .select('id')
      .eq('email_message_id', emailMessageId)
      .maybeSingle()
    if (existing) {
      console.info('[resendInbound] duplicate delivery (already ingested):', emailMessageId)
      res.status(200).json({ ok: true, skipped: 'duplicate' })
      return
    }
  }

  const { error: insertErr } = await supabaseAdmin
    .from('report_messages')
    .insert({
      report_id: reportId,
      author_id: report.reporter_id,
      author_role: 'user',
      channel: 'email_inbound',
      body: cleaned.slice(0, 5000),
      is_internal_note: false,
      email_message_id: emailMessageId,
    })
  if (insertErr) {
    console.error('[resendInbound] insert failed:', insertErr.message)
    // 500 so Resend retries — the failure is on our side
    res.status(500).json({ error: { code: 'INSERT_FAILED', message: 'try again' } })
    return
  }

  // 7. Flip status awaiting_user → in_progress, mirroring the
  // user-reply path in /api/report/:id/messages.
  if (report.status === 'awaiting_user') {
    await supabaseAdmin
      .from('reports')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', reportId)
  }

  // 8. Slack ping admin on emergency/urgent — same dispatcher the
  // in-app reply path uses, so triage feels identical regardless of
  // which channel the user replied through.
  setImmediate(() => {
    void notifyAdminOfUserReply({
      reportID: reportId,
      reportTitle: report.title,
      reportSeverity: report.severity as 'emergency' | 'urgent' | 'normal' | 'low',
      replyPreview: cleaned.slice(0, 240),
      reporterEmail: reporter.email ?? null,
      reporterName: reporter.full_name ?? null,
      reporterID: report.reporter_id,
      createdAt: new Date().toISOString(),
    })
  })

  res.status(200).json({ ok: true })
})

function pickHeader(req: Request, name: string): string | null {
  const v = req.headers[name]
  if (typeof v === 'string') return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return null
}

function pickData(envelope: unknown): Record<string, unknown> | null {
  if (!envelope || typeof envelope !== 'object') return null
  const root = envelope as Record<string, unknown>
  const data = root['data']
  if (data && typeof data === 'object') {
    // Some Resend payloads nest as `data.email`
    const inner = (data as Record<string, unknown>)['email']
    if (inner && typeof inner === 'object') return inner as Record<string, unknown>
    return data as Record<string, unknown>
  }
  // Fallback: a few inbound providers POST the payload at root level
  if ('to' in root && ('text' in root || 'html' in root)) return root
  return null
}

/**
 * Extract a bare email out of a header value. Handles both bare
 * `user@x.com` and `"Display" <user@x.com>` formats.
 */
function parseEmailAddress(raw: string): string | null {
  if (!raw) return null
  const angle = raw.match(/<([^>]+)>/)
  if (angle?.[1]) return angle[1].trim()
  // Bare address — keep the first token that looks email-shaped
  const bare = raw.trim().split(/\s/).find((t) => t.includes('@'))
  return bare?.trim() ?? null
}

/** Cheap HTML → text — strips tags only. Only used when Resend
 * didn't include a `text` field (rare). Quote-stripping still
 * runs afterward. */
function htmlToPlain(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
