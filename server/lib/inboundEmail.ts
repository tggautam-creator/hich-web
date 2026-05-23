import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * 2026-05-22 — Phase 6b of docs/REPORTS_PLAN.md. Small parsing +
 * verification helpers for the Resend inbound webhook that ingests
 * user email replies into the report thread.
 *
 * Split out from the route handler so it's trivially unit-testable
 * without spinning up Express or hitting the network.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Domains we accept inbound from. Primary is the dedicated
 * `reports.tagorides.com` subdomain — its MX points at Resend.
 * The apex (`tagorides.com`) is also listed for backwards-
 * compat with any in-flight emails that were sent before the
 * subdomain cutover; once those age out, the apex entry can be
 * removed.
 */
const ACCEPTED_DOMAINS = ['reports.tagorides.com', 'tagorides.com']

/**
 * Extract a report id from a `reports+<uuid>@reports.tagorides.com`
 * address (or the legacy `@tagorides.com` apex during transition).
 *
 * The +-tag is the load-bearing piece. Outbound emails the admin
 * sends set `Reply-To: reports+<reportId>@reports.tagorides.com`
 * (see `sendSupportReplyEmail` in `adminAlerts.ts`), so when the
 * user hits Reply, their mail client populates the To: with that
 * address. Resend's inbound webhook hands us the To: as-is and we
 * pluck the id back out.
 *
 * Returns `null` for any address that:
 *   - doesn't have a `reports+...` local part
 *   - doesn't have a UUID in the +tag
 *   - is on the wrong domain (defense against spoofed To: headers
 *     that route to our inbox via a forwarding rule we don't own)
 *
 * Defensive against display-name wrapping (`"Tago Support" <reports+...>`)
 * and uppercase locals (mail.com is case-insensitive).
 */
export function parseReportIdFromTo(to: string): string | null {
  if (typeof to !== 'string' || to.length === 0) return null
  // Strip a display name wrapper if present: `"Display" <addr@x>`
  const angleMatch = to.match(/<([^>]+)>/)
  const address = (angleMatch?.[1] ?? to).trim().toLowerCase()
  // Must be on a domain we own — anything else is spoofing
  // surface (a forwarding rule we don't control routing through
  // Resend).
  const onOurDomain = ACCEPTED_DOMAINS.some((d) => address.endsWith(`@${d}`))
  if (!onOurDomain) return null
  const local = address.slice(0, address.indexOf('@'))
  if (!local.startsWith('reports+')) return null
  const tag = local.slice('reports+'.length)
  if (!UUID_RE.test(tag)) return null
  return tag
}

/**
 * Strip quoted reply text + email signatures from a user's email
 * body so the thread only stores the new content.
 *
 * Mail clients append the quoted predecessor with formats like:
 *   - `On Wed, May 22, 2026 at 10:30 AM, Tago Support <...> wrote:`
 *   - `> ...` (Gmail's quoted-line prefix)
 *   - `-----Original Message-----` (Outlook)
 *   - `Sent from my iPhone` (mobile signatures)
 *
 * Heuristic: keep everything up to (but not including) the first
 * line that matches one of those markers. If no marker is found,
 * return the whole body (trimmed).
 *
 * Not perfect — some clients use non-standard markers (`Le 22 mai
 * 2026...`, etc.) but the failure mode is "thread row contains some
 * extra quoted text" which an admin can read past, not data loss.
 */
const REPLY_MARKERS: RegExp[] = [
  /^on\s.+\swrote:$/i,
  /^>\s/m,
  /^-{2,}\s*original message\s*-{2,}/i,
  /^from:\s.+$/im,
  /^sent from my (iphone|ipad|android|samsung)/i,
]

export function stripQuotedReply(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  const lines = text.split(/\r?\n/)
  let cutAt = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (REPLY_MARKERS.some((re) => re.test(line))) {
      cutAt = i
      break
    }
  }
  return lines.slice(0, cutAt).join('\n').trim()
}

/**
 * Verify the Resend webhook HMAC signature.
 *
 * Resend (via Svix under the hood) sends `Svix-Signature` headers
 * formatted as `v1,<base64hmac>` joined by spaces when multiple keys
 * are active. The body is signed as
 * `<msgId>.<timestamp>.<rawBody>`. We accept the first matching key.
 *
 * Returns false on any malformed input — the route handler converts
 * that into a 401, so a malicious sender can't bypass verification
 * by sending an empty or weirdly-shaped header.
 *
 * `secret` may be `"whsec_..."` prefixed (Svix convention); we
 * strip the prefix before decoding the key.
 */
export function verifyResendSignature(args: {
  rawBody: string | Buffer
  msgId: string | null
  timestamp: string | null
  signature: string | null
  secret: string
}): boolean {
  const { rawBody, msgId, timestamp, signature, secret } = args
  if (!secret || !msgId || !timestamp || !signature) return false

  const cleanSecret = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  let keyBytes: Buffer
  try {
    keyBytes = Buffer.from(cleanSecret, 'base64')
  } catch {
    return false
  }

  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
  const signed = `${msgId}.${timestamp}.${bodyStr}`
  const expected = createHmac('sha256', keyBytes).update(signed).digest('base64')

  // Header format: `v1,<sig> v1,<sig2>` — accept any.
  const candidates = signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice('v1,'.length))

  for (const cand of candidates) {
    if (cand.length !== expected.length) continue
    try {
      if (timingSafeEqual(Buffer.from(cand), Buffer.from(expected))) {
        return true
      }
    } catch {
      // length mismatch is caught above; any other error skip
    }
  }
  return false
}

/**
 * Pull a plain string out of an unknown payload field. Resend
 * gives us a typed envelope but the inbound JSON crosses an
 * untrusted boundary — narrow defensively.
 */
export function readString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null
  const v = (payload as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : null
}
