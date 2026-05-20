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
 * `batch.send` endpoint. Each call carries up to 100 per-recipient
 * payloads with their own substituted `to` / `subject` / `html`, so
 * `{{first_name}}` / `{{name}}` personalization is preserved while
 * 100 emails collapse into a single Resend API call.
 *
 * Returns success / failure counts so the campaign row can record
 * how many actually went out vs. how many were attempted.
 */
import { substitute, type PersonalizationRecipient } from './personalize.ts'
import { recordApiCall } from './apiUsage.ts'

export interface FailedRecipient {
  email: string
  error: string
}

/**
 * 2026-05-19 — switched from per-recipient `emails.send` (28 calls for
 * a 28-person campaign, throttled to ~16s to dodge the 2 req/s limit)
 * to `batch.send` (1 call for ≤100 recipients). Each batch entry still
 * carries its own substituted subject + html, so `{{first_name}}`-style
 * personalization is preserved. `batchValidation: 'permissive'` lets
 * the batch partially succeed and returns per-index errors we map back
 * to recipient emails for the Retry-failed path.
 *
 * Inter-batch 1.1s pause kept so the per-call rate limit (still 2 req/s
 * on free tier) is respected when an audience exceeds 100.
 */
const RESEND_BATCH_MAX = 100
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

  for (let i = 0; i < recipients.length; i += RESEND_BATCH_MAX) {
    const chunk = recipients.slice(i, i + RESEND_BATCH_MAX)
    const payload = chunk.map((r) => ({
      from,
      to: r.email,
      subject: substitute(subjectTemplate, r),
      html: substitute(htmlTemplate, r),
    }))
    // Tracked once per batch.send call — Resend bills the request
    // against quota regardless of how many entries it carries.
    void recordApiCall('resend', 1)

    try {
      const response = await client.batch.send(payload, {
        batchValidation: 'permissive',
      })
      if (response.error || !response.data) {
        const errMsg = response.error?.message ?? 'batch send failed'
        for (const r of chunk) {
          failed += 1
          failures.push(errMsg)
          failedRecipients.push({ email: r.email, error: errMsg })
        }
      } else {
        const responseData = response.data as {
          data?: { id: string }[]
          errors?: { index: number; message?: string }[]
        }
        const errorByIndex = new Map<number, string>()
        for (const e of responseData.errors ?? []) {
          errorByIndex.set(e.index, e.message ?? 'unknown')
        }
        for (let j = 0; j < chunk.length; j++) {
          const recipient = chunk[j]
          if (!recipient) continue
          const err = errorByIndex.get(j)
          if (err) {
            failed += 1
            failures.push(err)
            failedRecipients.push({ email: recipient.email, error: err })
          } else {
            sent += 1
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      for (const r of chunk) {
        failed += 1
        failures.push(errMsg)
        failedRecipients.push({ email: r.email, error: errMsg })
      }
    }

    // Inter-batch pause when another chunk follows — stays under
    // Resend's 2 req/s rate limit on batch.send.
    if (i + RESEND_BATCH_MAX < recipients.length) {
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
