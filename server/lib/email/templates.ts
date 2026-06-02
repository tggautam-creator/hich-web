/**
 * Lifecycle email template engine.
 *
 * Loads admin-editable templates from the email_templates table,
 * substitutes whitelisted {{var}} placeholders, renders Markdown to
 * HTML, ships via Resend, and records the outcome in email_sends.
 *
 * Idempotency lives at TWO levels:
 *   1. SQL: a partial UNIQUE index on (user_id, template_key) WHERE
 *      status='sent' AND is_test=false. A successful send blocks
 *      any concurrent duplicate.
 *   2. Application: we SELECT email_sends to filter candidates before
 *      attempting a send, so concurrent sweeps don't all hit Resend
 *      and then have N-1 INSERTs fail.
 */
import { supabaseAdmin } from '../supabaseAdmin.ts'
import { getResendClient, isAllowedFromAddress } from '../resend.ts'
import { recordApiCall } from '../apiUsage.ts'
import { markdownToHtml, wrapInEmailShell } from './markdownToHtml.ts'

// ── Types ─────────────────────────────────────────────────────────

export interface EmailTemplateRow {
  id: string
  key: string
  name: string
  subject: string
  body_markdown: string
  from_email: string
  from_name: string
  reply_to: string | null
  variables: string[]
  is_active: boolean
  created_at: string
  updated_at: string
  updated_by: string | null
}

export interface EmailSendRow {
  id: string
  user_id: string
  template_key: string
  recipient_email: string
  subject_at_send: string | null
  body_html_at_send: string | null
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'
  provider_message_id: string | null
  error: string | null
  attempt_count: number
  is_test: boolean
  sent_at: string | null
  failed_at: string | null
  created_at: string
}

export type TemplateVars = Record<string, string | number | null | undefined>

// ── Template loading ──────────────────────────────────────────────

export async function loadTemplate(key: string): Promise<EmailTemplateRow | null> {
  const { data, error } = await supabaseAdmin
    .from('email_templates').select('*').eq('key', key).maybeSingle()
  if (error || !data) return null
  return data as EmailTemplateRow
}

export async function listTemplates(): Promise<EmailTemplateRow[]> {
  const { data, error } = await supabaseAdmin
    .from('email_templates').select('*').order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EmailTemplateRow[]
}

export async function updateTemplate(
  key: string,
  patch: Partial<Pick<EmailTemplateRow, 'name' | 'subject' | 'body_markdown' | 'from_email' | 'from_name' | 'reply_to' | 'is_active' | 'variables'>>,
  updatedBy: string | null,
): Promise<{ ok: boolean; template?: EmailTemplateRow; reason?: string }> {
  // Server-side allowlist enforcement on the From-address so a
  // future admin (or compromised admin token) can't fabricate
  // arbitrary From values.
  if (patch.from_email != null && !isAllowedFromAddress(patch.from_email)) {
    return {
      ok: false,
      reason: `from_email "${patch.from_email}" is not on the allowlist (see FROM_ADDRESS_ALLOWLIST in server/lib/resend.ts).`,
    }
  }
  const updates: Record<string, unknown> = {
    ...patch,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  }
  const { data, error } = await supabaseAdmin
    .from('email_templates').update(updates as never).eq('key', key)
    .select('*').single()
  if (error || !data) return { ok: false, reason: error?.message ?? 'update failed' }
  return { ok: true, template: data as EmailTemplateRow }
}

// ── Substitution + rendering ──────────────────────────────────────

/**
 * Replaces every {{var}} occurrence with the value from `vars`,
 * scoped to the template's declared `variables` allowlist. Unknown
 * placeholders are stripped (rendered as empty string) so a future
 * admin can't fish for sensitive fields by writing
 * `{{stripe_account_id}}` etc.
 */
export function substitute(
  source: string,
  vars: TemplateVars,
  allowlist: ReadonlyArray<string>,
): string {
  return source.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
    if (!allowlist.includes(key)) return ''
    const v = vars[key]
    if (v == null) return ''
    return String(v)
  })
}

export function renderTemplate(
  template: EmailTemplateRow,
  vars: TemplateVars,
): { subject: string; html: string; markdown: string } {
  const subject = substitute(template.subject, vars, template.variables)
  const markdown = substitute(template.body_markdown, vars, template.variables)
  const innerHtml = markdownToHtml(markdown)
  const html = wrapInEmailShell(innerHtml, subject)
  return { subject, html, markdown }
}

// ── Send orchestration ────────────────────────────────────────────

export interface SendOptions {
  userId: string
  templateKey: string
  recipientEmail: string
  vars: TemplateVars
  /** When true, bypasses the idempotency guard so test sends from
   *  the admin UI can fire repeatedly. Marked is_test=true on the
   *  ledger row. */
  isTest?: boolean
}

export interface SendResult {
  ok: boolean
  send?: EmailSendRow
  reason?: 'no_template' | 'inactive' | 'already_sent' | 'send_failed' | 'no_recipient'
  error?: string
}

/**
 * Sends a templated email + records the ledger row. Idempotent —
 * returns reason='already_sent' if a successful send already exists
 * for (userId, templateKey) (unless isTest=true).
 *
 * Caller is expected to fire-and-forget (`void sendTemplated(...)`)
 * unless they specifically need the result. Errors are logged + the
 * row is updated with status='failed'.
 */
export async function sendTemplated(opts: SendOptions): Promise<SendResult> {
  if (!opts.recipientEmail) {
    return { ok: false, reason: 'no_recipient' }
  }
  const tpl = await loadTemplate(opts.templateKey)
  if (!tpl) return { ok: false, reason: 'no_template' }
  if (!tpl.is_active) return { ok: false, reason: 'inactive' }

  // Idempotency check — only for real (non-test) sends. Avoids the
  // unique-index conflict on retry by short-circuiting before the
  // Resend call.
  if (!opts.isTest) {
    const { data: existing } = await supabaseAdmin
      .from('email_sends').select('id, status')
      .eq('user_id', opts.userId)
      .eq('template_key', opts.templateKey)
      .eq('is_test', false)
      .eq('status', 'sent')
      .maybeSingle()
    if (existing) return { ok: false, reason: 'already_sent' }
  }

  const { subject, html } = renderTemplate(tpl, opts.vars)

  // Insert queued row first so the ledger has a trace of the attempt
  // even if Resend fails outright.
  const { data: queued, error: queueErr } = await supabaseAdmin
    .from('email_sends')
    .insert({
      user_id: opts.userId,
      template_key: opts.templateKey,
      recipient_email: opts.recipientEmail,
      subject_at_send: subject,
      body_html_at_send: html,
      status: 'sending',
      attempt_count: 1,
      is_test: opts.isTest ?? false,
    } as never)
    .select('*').single()
  if (queueErr || !queued) {
    return { ok: false, reason: 'send_failed', error: queueErr?.message ?? 'queue insert failed' }
  }
  const send = queued as EmailSendRow

  try {
    const client = getResendClient()
    const from = `${tpl.from_name} <${tpl.from_email}>`
    const replyTo = tpl.reply_to ?? tpl.from_email
    void recordApiCall('resend', 1)
    const result = await client.emails.send({
      from,
      to: opts.recipientEmail,
      subject,
      html,
      replyTo,
    })
    if (result?.error) {
      await supabaseAdmin
        .from('email_sends')
        .update({
          status: 'failed',
          error: result.error.message ?? 'resend returned error',
          failed_at: new Date().toISOString(),
        } as never)
        .eq('id', send.id)
      return { ok: false, send, reason: 'send_failed', error: result.error.message ?? 'unknown' }
    }
    await supabaseAdmin
      .from('email_sends')
      .update({
        status: 'sent',
        provider_message_id: result?.data?.id ?? null,
        sent_at: new Date().toISOString(),
      } as never)
      .eq('id', send.id)
    return { ok: true, send }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await supabaseAdmin
      .from('email_sends')
      .update({
        status: 'failed',
        error: msg,
        failed_at: new Date().toISOString(),
      } as never)
      .eq('id', send.id)
    return { ok: false, send, reason: 'send_failed', error: msg }
  }
}

// ── Ledger lookups (for the admin UI) ─────────────────────────────

export async function listRecentSends(args: {
  templateKey?: string
  limit?: number
}): Promise<EmailSendRow[]> {
  const limit = Math.min(200, args.limit ?? 50)
  let q = supabaseAdmin
    .from('email_sends').select('*')
    .order('created_at', { ascending: false }).limit(limit)
  if (args.templateKey) q = q.eq('template_key', args.templateKey)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as EmailSendRow[]
}
