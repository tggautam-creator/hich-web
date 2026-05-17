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
