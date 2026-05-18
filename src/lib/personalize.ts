/**
 * 2026-05-18 — client-side mirror of `server/lib/personalize.ts`.
 *
 * Used by the campaign composer's live preview pane so the admin can
 * see what `{{name}}` will resolve to per recipient without hitting
 * the server. Keep the resolver logic identical to the server so the
 * preview matches what actually goes out.
 */

export interface PersonalizationRecipient {
  email: string | null
  full_name: string | null
}

export const RECIPIENT_TOKENS = ['{{name}}', '{{first_name}}'] as const

export function substitute(
  template: string,
  recipient: PersonalizationRecipient,
): string {
  if (!template) return template
  let out = template
  for (const token of RECIPIENT_TOKENS) {
    const value = resolveToken(token, recipient)
    if (value === null) continue
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
