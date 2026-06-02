/**
 * Public lifecycle-email routes — primarily the unsubscribe handler.
 * No JWT — links arrive from email clients that don't carry our
 * session cookies. Security comes from the HMAC-signed token.
 */
import { Router, type Request, type Response } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { verifyUnsubscribeToken } from '../lib/email/unsubscribeTokens.ts'

export const emailPublicRouter = Router()

// ── HTML helpers ──────────────────────────────────────────────────

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${htmlEscape(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; padding:0; background:#f5f5f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#1f2937; }
  .wrap { max-width:520px; margin:48px auto; background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:32px; }
  h1 { font-size:18px; margin:0 0 12px; }
  p  { font-size:14px; line-height:1.55; margin:8px 0; color:#374151; }
  .muted { color:#6b7280; font-size:12px; margin-top:24px; }
  form { margin-top:16px; }
  button { background:#0066ff; color:#fff; border:0; border-radius:10px; padding:10px 16px; font-weight:600; font-size:14px; cursor:pointer; }
  button:hover { background:#0052cc; }
  .danger { color:#b91c1c; }
  .success { color:#047857; font-weight:600; }
</style></head>
<body><div class="wrap">${bodyHtml}<p class="muted">Tago · tagorides.com</p></div></body></html>`
}

// ── GET — confirmation page ──────────────────────────────────────
//
// Gmail / Outlook etc. prefetch GET links (and the "unsubscribe"
// button next to the sender name uses one-click POST per RFC 8058).
// We render a CONFIRM page on GET — the actual opt-out is a POST —
// so a prefetch doesn't silently unsubscribe a curious user.
emailPublicRouter.get(
  '/unsubscribe',
  async (req: Request, res: Response) => {
    const token = typeof req.query['token'] === 'string' ? req.query['token'] : ''
    const verified = verifyUnsubscribeToken(token)
    if (!verified.ok) {
      res.status(400).type('html').send(shell('Unsubscribe link invalid', `
        <h1>This unsubscribe link is invalid or expired.</h1>
        <p>If you want to stop receiving Tago lifecycle emails, reply to any of them with the word <strong>UNSUBSCRIBE</strong> and we'll handle it manually.</p>
        <p class="danger">Reason: ${htmlEscape(verified.reason)}</p>
      `))
      return
    }
    const tkLabel = verified.templateKey === '*'
      ? 'every Tago lifecycle email'
      : `Tago "${htmlEscape(verified.templateKey)}" emails`

    res.status(200).type('html').send(shell('Unsubscribe from Tago', `
      <h1>Stop receiving ${tkLabel}?</h1>
      <p>This won't affect transactional emails about rides, payments, or safety — those are essential to using Tago.</p>
      <form method="post" action="/api/email/unsubscribe">
        <input type="hidden" name="token" value="${htmlEscape(token)}" />
        <button type="submit">Yes, unsubscribe</button>
      </form>
      <p class="muted">If you change your mind later, just reply to one of our emails and we'll re-enable them.</p>
    `))
  },
)

// ── POST — one-click unsubscribe ─────────────────────────────────
//
// Idempotent INSERT — second click on the same link is a no-op via
// the UNIQUE(user_id, COALESCE(template_key, '*')) index.
emailPublicRouter.post(
  '/unsubscribe',
  async (req: Request, res: Response) => {
    const fromBody = req.body && typeof req.body === 'object'
      ? (req.body as Record<string, unknown>)['token']
      : null
    const fromQuery = typeof req.query['token'] === 'string' ? req.query['token'] : ''
    const token = typeof fromBody === 'string' && fromBody ? fromBody : fromQuery
    const verified = verifyUnsubscribeToken(token)
    if (!verified.ok) {
      res.status(400).type('html').send(shell('Unsubscribe failed', `
        <h1>We couldn't process that unsubscribe link.</h1>
        <p>It may have expired or been edited. Reply <strong>UNSUBSCRIBE</strong> to any Tago email and we'll handle it.</p>
        <p class="danger">Reason: ${htmlEscape(verified.reason)}</p>
      `))
      return
    }
    const tkScope = verified.scope === 'global' ? null : verified.templateKey
    // Plain INSERT + treat 23505 (unique_violation) as success — the
    // upsert path can't match the COALESCE expression index in
    // migration 117 (Postgres can't infer the target from a regular
    // (user_id, template_key) onConflict argument), so we hand-roll
    // idempotency. Any other error is a real failure (logged loudly)
    // — we still show the success page so the user isn't blocked,
    // but ops gets a clear signal.
    const { error } = await supabaseAdmin
      .from('email_opt_outs')
      .insert({
        user_id: verified.userId,
        template_key: tkScope,
        source: 'self',
      } as never)
    if (error) {
      const isDuplicate = error.code === '23505'
        || /duplicate key|already exists/i.test(error.message)
      if (!isDuplicate) {
        console.error(
          `[email/unsubscribe] opt-out INSERT failed for user=${verified.userId} tk=${verified.templateKey}: `
          + `${error.code ?? '<no code>'} ${error.message}`,
        )
      }
    }
    const tkLabel = verified.scope === 'global'
      ? 'all Tago lifecycle emails'
      : `Tago "${htmlEscape(verified.templateKey)}" emails`
    res.status(200).type('html').send(shell('Unsubscribed', `
      <h1 class="success">You're unsubscribed.</h1>
      <p>You won't receive ${tkLabel} from us anymore. You'll still get transactional notifications about rides, payments, and safety.</p>
      <p class="muted">Reply to any Tago email if you want to re-enable lifecycle messages later.</p>
    `))
  },
)
