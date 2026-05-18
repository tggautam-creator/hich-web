/**
 * 2026-05-18 — mail-merge token substitution for campaign emails.
 *
 * Tokens use Mustache-style `{{name}}` syntax (industry standard;
 * unambiguous, never appears in normal email copy). Two tokens shipped
 * in v1: `{{name}}` (full name) and `{{first_name}}` (first word of
 * full name). Both fall back gracefully when the user has no
 * `full_name` — we try the email username next, then a literal
 * "there" / first initial as last resort.
 *
 * Adding a new token is two lines: add it to TOKENS + add a resolver.
 * Keep the resolver pure (no async, no DB) so this can run for every
 * recipient in a 10k-user campaign without choking.
 */

export interface PersonalizationRecipient {
  email: string | null
  full_name: string | null
}

export const RECIPIENT_TOKENS = ['{{name}}', '{{first_name}}'] as const

/**
 * Replaces every supported `{{token}}` in `template` with the per-
 * recipient value. Unknown tokens are left alone so an admin typing
 * raw double-braces in copy doesn't get an empty string substituted
 * (failure should be visible, not silent).
 */
export function substitute(
  template: string,
  recipient: PersonalizationRecipient,
): string {
  if (!template) return template
  let out = template
  for (const token of RECIPIENT_TOKENS) {
    const value = resolveToken(token, recipient)
    if (value === null) continue
    // Replace all occurrences. Global regex; tokens are literal,
    // no regex metacharacters to escape beyond braces.
    const pattern = new RegExp(escapeRegex(token), 'g')
    out = out.replace(pattern, value)
  }
  return out
}

function resolveToken(
  token: (typeof RECIPIENT_TOKENS)[number],
  recipient: PersonalizationRecipient,
): string | null {
  switch (token) {
    case '{{name}}': {
      const fullName = (recipient.full_name ?? '').trim()
      if (fullName) return fullName
      const emailUsername = extractEmailUsername(recipient.email)
      if (emailUsername) return emailUsername
      return 'there'
    }
    case '{{first_name}}': {
      const fullName = (recipient.full_name ?? '').trim()
      if (fullName) {
        const first = fullName.split(/\s+/)[0]
        if (first) return first
      }
      const emailUsername = extractEmailUsername(recipient.email)
      if (emailUsername) return emailUsername
      return 'there'
    }
    default:
      return null
  }
}

function extractEmailUsername(email: string | null): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at <= 0) return null
  const raw = email.slice(0, at).trim()
  return raw || null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
