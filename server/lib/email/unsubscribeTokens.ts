/**
 * Signed unsubscribe tokens for lifecycle emails.
 *
 * Token format: base64url(payload) + "." + base64url(hmac)
 *   payload = JSON: { uid, tk, scope, exp }
 *     uid:   user_id (UUID)
 *     tk:    template_key (or "*" for global)
 *     scope: "single" | "global"
 *     exp:   epoch seconds — refuse after this; we set 1 year out
 *            so old emails still work for the typical user lifecycle.
 *
 * Same HMAC key as qrToken.ts (QR_HMAC_SECRET) — we don't introduce
 * a second secret for what is effectively the same threat model
 * (anyone with the token can take a specific action on behalf of
 * one user). Token rotation would invalidate outstanding unsub links;
 * that's an acceptable trade-off (the worst case is "user has to
 * unsubscribe twice" which is fine).
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { getServerEnv } from '../../env.ts'

const TOKEN_VERSION = 'v1'
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

interface UnsubPayload {
  v: typeof TOKEN_VERSION
  uid: string
  tk: string
  scope: 'single' | 'global'
  exp: number
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const padded = s + '==='.slice((s.length + 3) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function sign(payload: UnsubPayload): string {
  const { QR_HMAC_SECRET } = getServerEnv()
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload)))
  const sig = createHmac('sha256', QR_HMAC_SECRET).update(body).digest()
  return `${body}.${b64urlEncode(sig)}`
}

export function generateUnsubscribeToken(args: {
  userId: string
  templateKey: string
  scope?: 'single' | 'global'
}): string {
  const payload: UnsubPayload = {
    v: TOKEN_VERSION,
    uid: args.userId,
    tk: args.templateKey,
    scope: args.scope ?? 'single',
    exp: Math.floor(Date.now() / 1000) + ONE_YEAR_SECONDS,
  }
  return sign(payload)
}

export type VerifyResult =
  | { ok: true; userId: string; templateKey: string; scope: 'single' | 'global' }
  | { ok: false; reason: string }

export function verifyUnsubscribeToken(token: string): VerifyResult {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing token' }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed token' }
  const [body, sig] = parts as [string, string]

  // Verify signature first to avoid leaking timing info via payload parse.
  let expected: Buffer
  try {
    const { QR_HMAC_SECRET } = getServerEnv()
    expected = createHmac('sha256', QR_HMAC_SECRET).update(body).digest()
  } catch {
    return { ok: false, reason: 'sign error' }
  }
  let provided: Buffer
  try { provided = b64urlDecode(sig) }
  catch { return { ok: false, reason: 'bad signature encoding' } }
  if (provided.length !== expected.length) return { ok: false, reason: 'bad signature' }
  if (!timingSafeEqual(provided, expected)) return { ok: false, reason: 'bad signature' }

  let payload: UnsubPayload
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8')) as UnsubPayload
  } catch {
    return { ok: false, reason: 'bad payload' }
  }
  if (payload.v !== TOKEN_VERSION) return { ok: false, reason: 'old version' }
  if (typeof payload.uid !== 'string' || payload.uid.length < 8) return { ok: false, reason: 'bad uid' }
  if (typeof payload.tk !== 'string' || payload.tk.length === 0) return { ok: false, reason: 'bad tk' }
  if (payload.scope !== 'single' && payload.scope !== 'global') return { ok: false, reason: 'bad scope' }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true, userId: payload.uid, templateKey: payload.tk, scope: payload.scope }
}
