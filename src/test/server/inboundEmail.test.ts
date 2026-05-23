// @vitest-environment node
/**
 * 2026-05-22 — pure-function tests for Phase 6b inbound webhook
 * helpers in server/lib/inboundEmail.ts. Locks the parsing +
 * signature verification before the route handler that depends on
 * them gets exercised.
 */
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  parseReportIdFromTo,
  stripQuotedReply,
  verifyResendSignature,
  readString,
} from '../../../server/lib/inboundEmail.ts'

const UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

describe('parseReportIdFromTo', () => {
  it('extracts a UUID from the canonical reports.tagorides.com subdomain', () => {
    expect(parseReportIdFromTo(`reports+${UUID}@reports.tagorides.com`)).toBe(UUID)
  })

  it('also accepts the legacy tagorides.com apex (transition compat)', () => {
    // Kept accepted while in-flight emails from the pre-subdomain cutover
    // are still being replied to. Safe — only addresses with our UUID +tag
    // get accepted, so the apex still requires Resend MX on the apex to
    // actually deliver here, which we explicitly chose NOT to set up.
    expect(parseReportIdFromTo(`reports+${UUID}@tagorides.com`)).toBe(UUID)
  })

  it('handles display-name wrappers', () => {
    expect(parseReportIdFromTo(`"Tago Support" <reports+${UUID}@reports.tagorides.com>`)).toBe(UUID)
  })

  it('is case-insensitive on the address', () => {
    expect(parseReportIdFromTo(`Reports+${UUID.toUpperCase()}@Reports.TagoRides.com`)).toBe(UUID)
  })

  it('returns null for non-Tago domains (spoofing defense)', () => {
    expect(parseReportIdFromTo(`reports+${UUID}@evil.com`)).toBeNull()
  })

  it('returns null for missing +tag', () => {
    expect(parseReportIdFromTo('reports@reports.tagorides.com')).toBeNull()
  })

  it('returns null for non-UUID tag', () => {
    expect(parseReportIdFromTo('reports+not-a-uuid@reports.tagorides.com')).toBeNull()
  })

  it('returns null for empty / non-string input', () => {
    expect(parseReportIdFromTo('')).toBeNull()
    expect(parseReportIdFromTo(null as unknown as string)).toBeNull()
  })
})

describe('stripQuotedReply', () => {
  it('keeps only the user\'s new text before "On … wrote:" marker', () => {
    const body = `Thanks for the help, I'll try restarting.

On Wed, May 22, 2026 at 10:30 AM, Tago Support <support@tagorides.com> wrote:
> Hi there, please try restarting the app.`
    expect(stripQuotedReply(body)).toBe("Thanks for the help, I'll try restarting.")
  })

  it('cuts at the first > -prefixed quoted line', () => {
    const body = `Just one more question.

> Previous reply text
> spanning multiple lines`
    expect(stripQuotedReply(body)).toBe('Just one more question.')
  })

  it('cuts at Outlook\'s -----Original Message----- marker', () => {
    const body = `Following up.

-----Original Message-----
From: Tago Support`
    expect(stripQuotedReply(body)).toBe('Following up.')
  })

  it('cuts at mobile signature footers', () => {
    const body = `Got it!\n\nSent from my iPhone`
    expect(stripQuotedReply(body)).toBe('Got it!')
  })

  it('returns the whole body when no marker is found', () => {
    expect(stripQuotedReply('Just a clean reply with no markers.')).toBe(
      'Just a clean reply with no markers.',
    )
  })

  it('returns empty string for empty/non-string input', () => {
    expect(stripQuotedReply('')).toBe('')
    expect(stripQuotedReply(null as unknown as string)).toBe('')
  })
})

describe('verifyResendSignature', () => {
  // 32-byte random key, base64-encoded — matches the shape Resend's
  // dashboard hands you.
  const keyBytes = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
  const secret = 'whsec_' + keyBytes.toString('base64')
  const msgId = 'msg_2026'
  const timestamp = '1747920000'
  const body = JSON.stringify({ type: 'email.inbound', data: { from: 'a@b.com' } })

  function signed(): string {
    const sig = createHmac('sha256', keyBytes).update(`${msgId}.${timestamp}.${body}`).digest('base64')
    return `v1,${sig}`
  }

  it('accepts a valid signature', () => {
    expect(
      verifyResendSignature({ rawBody: body, msgId, timestamp, signature: signed(), secret }),
    ).toBe(true)
  })

  it('accepts when the secret has the whsec_ prefix', () => {
    // Re-derive against the same secret with prefix already on it
    expect(
      verifyResendSignature({ rawBody: body, msgId, timestamp, signature: signed(), secret }),
    ).toBe(true)
  })

  it('rejects on body tamper', () => {
    expect(
      verifyResendSignature({
        rawBody: body + ' tampered',
        msgId,
        timestamp,
        signature: signed(),
        secret,
      }),
    ).toBe(false)
  })

  it('rejects on missing header fields', () => {
    expect(
      verifyResendSignature({ rawBody: body, msgId: null, timestamp, signature: signed(), secret }),
    ).toBe(false)
    expect(
      verifyResendSignature({ rawBody: body, msgId, timestamp: null, signature: signed(), secret }),
    ).toBe(false)
    expect(
      verifyResendSignature({ rawBody: body, msgId, timestamp, signature: null, secret }),
    ).toBe(false)
  })

  it('returns false on empty secret (caller is expected to skip verification entirely in that case)', () => {
    expect(
      verifyResendSignature({ rawBody: body, msgId, timestamp, signature: signed(), secret: '' }),
    ).toBe(false)
  })

  it('accepts multi-key headers when at least one matches', () => {
    const valid = signed()
    const decoy = `v1,${Buffer.from('not-a-valid-sig').toString('base64')}`
    expect(
      verifyResendSignature({
        rawBody: body,
        msgId,
        timestamp,
        signature: `${decoy} ${valid}`,
        secret,
      }),
    ).toBe(true)
  })

  it('rejects when no v1 key parses', () => {
    expect(
      verifyResendSignature({
        rawBody: body,
        msgId,
        timestamp,
        signature: 'v2,abc v2,def',
        secret,
      }),
    ).toBe(false)
  })
})

describe('readString', () => {
  it('returns string fields', () => {
    expect(readString({ a: 'hello' }, 'a')).toBe('hello')
  })
  it('returns null for non-string fields', () => {
    expect(readString({ a: 42 }, 'a')).toBeNull()
    expect(readString({ a: null }, 'a')).toBeNull()
  })
  it('returns null for non-object payloads', () => {
    expect(readString(null, 'a')).toBeNull()
    expect(readString(undefined, 'a')).toBeNull()
    expect(readString('not-an-object', 'a')).toBeNull()
  })
})
