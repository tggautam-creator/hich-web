import { Resend } from 'resend'
import { getServerEnv } from '../env.ts'

/**
 * Thin Resend wrapper — built for Slice 1.5 admin email broadcasts.
 *
 * Reads `RESEND_API_KEY` from env. Hard-fails the email-send path if
 * the key is missing (rather than booting failed) so a server
 * running without email support can still serve every other route.
 *
 * From-address allowlist is enforced here, not on the client, so an
 * admin can't fabricate a `from` field via API to send as
 * `support@some-other-domain.com`.
 */
let _client: Resend | null = null

export function getResendClient(): Resend {
  if (_client) return _client
  const { RESEND_API_KEY } = getServerEnv()
  if (!RESEND_API_KEY) {
    throw new Error(
      'Missing RESEND_API_KEY. Set it in EC2 .env (and dev .env for local testing). ' +
      'Without it, the admin email broadcast endpoint cannot send.',
    )
  }
  _client = new Resend(RESEND_API_KEY)
  return _client
}

/**
 * Server-side allowlist of From addresses an admin can pick. Mirrors
 * the verified `tagorides.com` domain in Resend (per Slice 0.1).
 * Anything outside this list is rejected at the send endpoint.
 *
 * To add a new one: also create the mailbox in GoDaddy + verify in
 * Resend (DKIM auto-applies because the domain is verified, but the
 * From address itself just has to exist as a routable mailbox if
 * replies are expected — Resend will send from any address @
 * tagorides.com regardless).
 */
export const FROM_ADDRESS_ALLOWLIST: ReadonlyArray<{
  value: string
  label: string
}> = [
  { value: 'marketing@tagorides.com', label: 'Marketing <marketing@tagorides.com>' },
  { value: 'hello@tagorides.com',     label: 'Hello <hello@tagorides.com>' },
  { value: 'support@tagorides.com',   label: 'Support <support@tagorides.com>' },
  { value: 'admin@tagorides.com',     label: 'Admin <admin@tagorides.com>' },
]

export function isAllowedFromAddress(addr: string): boolean {
  return FROM_ADDRESS_ALLOWLIST.some((a) => a.value === addr.toLowerCase().trim())
}

/**
 * Batch-send the same email to N recipients via Resend's
 * `emails.send` per recipient. Resend has a true batch endpoint
 * (`batch.send`) but it has a 100-recipient cap per call; for the
 * first cut we loop with a small concurrency to stay simple. Larger
 * audiences will need the batch endpoint with chunking.
 *
 * Returns success / failure counts so the campaign row can record
 * how many actually went out vs. how many were attempted.
 */
/**
 * 2026-05-18 — personalized variant of `sendEmailToMany`. Same per-
 * recipient loop, but each send first runs `substitute()` over the
 * subject + html using that recipient's `full_name` / `email`. Lets
 * the admin write copy like `Hi {{name}},` and have every recipient
 * see their own name. Returns the same shape as `sendEmailToMany`.
 *
 * Substitution is applied to BOTH subject and html so an admin can
 * write `{{name}}, your ride is confirmed` in either field.
 *
 * Implementation note: a true Resend batch endpoint can't be used
 * here (it requires identical content per call). We're already 1-per-
 * recipient anyway because Resend's `batch.send` caps at 100 and
 * doesn't accept per-recipient bodies.
 */
import { substitute, type PersonalizationRecipient } from './personalize.ts'
import { recordApiCall } from './apiUsage.ts'

export interface FailedRecipient {
  email: string
  error: string
}

/**
 * Sends per-recipient personalized email and tracks which addresses
 * failed (rather than only counting failures). Caller can persist
 * the failed list to enable retry.
 *
 * **2026-05-19 rate-limit retune.** Concurrency dropped 10 → 2 and a
 * `RATE_LIMIT_BATCH_DELAY_MS` (1100ms) gap added between batches so
 * we stay strictly under Resend's free-tier 2 req/s limit. Empirical:
 * a 28-recipient send was completing in ~3s with 23 of 28 hitting 429
 * (`Too Many Requests`). The throttled version completes in ~16s with
 * 28 of 28 delivered. Trade-off accepted: marketing emails don't need
 * sub-second send; transactional flows don't use this function.
 *
 * If we ever upgrade to Resend's paid tier (10 req/s), bump concurrency
 * back to 10 and drop the inter-batch delay.
 */
const RATE_LIMIT_CONCURRENCY = 2
const RATE_LIMIT_BATCH_DELAY_MS = 1100

export async function sendPersonalizedEmailToMany(args: {
  from: string
  subjectTemplate: string
  htmlTemplate: string
  recipients: (PersonalizationRecipient & { email: string })[]
}): Promise<{
  sent: number
  failed: number
  failures: string[]
  failedRecipients: FailedRecipient[]
}> {
  const { from, subjectTemplate, htmlTemplate, recipients } = args
  if (recipients.length === 0) {
    return { sent: 0, failed: 0, failures: [], failedRecipients: [] }
  }

  const client = getResendClient()
  let sent = 0
  let failed = 0
  const failures: string[] = []
  const failedRecipients: FailedRecipient[] = []

  for (let i = 0; i < recipients.length; i += RATE_LIMIT_CONCURRENCY) {
    const slice = recipients.slice(i, i + RATE_LIMIT_CONCURRENCY)
    // Tracked even when the call fails — Resend still counts a
    // request against our daily quota regardless of outcome.
    void recordApiCall('resend', slice.length)
    const results = await Promise.allSettled(
      slice.map((r) =>
        client.emails.send({
          from,
          to: r.email,
          subject: substitute(subjectTemplate, r),
          html: substitute(htmlTemplate, r),
        }),
      ),
    )
    // Walk results index-aligned with slice so we know which
    // recipient each failure belongs to — needed for the
    // failed_emails column on campaigns + Retry-failed path.
    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      const recipient = slice[j]
      if (!recipient) continue
      if (result?.status === 'fulfilled' && result.value?.data?.id) {
        sent += 1
        continue
      }
      failed += 1
      let errMsg = 'unknown'
      if (result?.status === 'rejected') {
        errMsg = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      } else if (result?.status === 'fulfilled' && result.value?.error) {
        errMsg = result.value.error.message ?? 'unknown'
      }
      failures.push(errMsg)
      failedRecipients.push({ email: recipient.email, error: errMsg })
    }

    // Inter-batch pause. Skip the final iteration to avoid a
    // dangling 1.1s wait after the last batch resolves.
    if (i + RATE_LIMIT_CONCURRENCY < recipients.length) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, RATE_LIMIT_BATCH_DELAY_MS),
      )
    }
  }

  return { sent, failed, failures, failedRecipients }
}

export async function sendEmailToMany(args: {
  from: string
  subject: string
  html: string
  recipients: string[]
}): Promise<{ sent: number; failed: number; failures: string[] }> {
  const { from, subject, html, recipients } = args
  if (recipients.length === 0) return { sent: 0, failed: 0, failures: [] }

  const client = getResendClient()

  let sent = 0
  let failed = 0
  const failures: string[] = []

  // Tiny concurrency control — fan out 10 at a time so a 500-user
  // campaign doesn't open 500 sockets to Resend at once.
  const concurrency = 10
  for (let i = 0; i < recipients.length; i += concurrency) {
    const slice = recipients.slice(i, i + concurrency)
    void recordApiCall('resend', slice.length)
    const results = await Promise.allSettled(
      slice.map((to) =>
        client.emails.send({ from, to, subject, html }),
      ),
    )
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.data?.id) {
        sent += 1
      } else {
        failed += 1
        if (r.status === 'rejected') {
          failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
        } else if (r.status === 'fulfilled' && r.value?.error) {
          failures.push(r.value.error.message ?? 'unknown')
        }
      }
    }
  }

  return { sent, failed, failures }
}
