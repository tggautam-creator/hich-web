/**
 * v1.3 Sprint 11 Slice 2 — trusted-contacts REST client.
 *
 * Mirrors iOS `TrustedContactsEndpoint.swift` / `AddTrustedContact
 * Endpoint.swift` / `DeleteTrustedContactEndpoint.swift`. Uses the
 * server REST routes at `/api/safety/trusted-contacts*` (NOT direct
 * Supabase access — both platforms talk to the server so the cap
 * check + insert validation runs in one place; see
 * `server/routes/safety.ts:280-398`).
 *
 * Server contract (verified 2026-06-02):
 *   GET     /api/safety/trusted-contacts
 *           → 200 { contacts: TrustedContactRow[] }
 *   POST    /api/safety/trusted-contacts  body { name, phone }
 *           → 201 { contact: TrustedContactRow }
 *           → 400 { error: { code: 'INVALID_NAME' | 'INVALID_PHONE' } }
 *           → 409 { error: { code: 'LIMIT_REACHED' } }
 *   DELETE  /api/safety/trusted-contacts/:id
 *           → 200 { deleted: true }
 *           → 400 { error: { code: 'INVALID_ID' } }
 *
 * `TrustedContactApiError` carries the server's `code` field so call
 * sites can render the friendly copy (mirroring iOS
 * `friendly(serverError:)` at AddTrustedContactSheet.swift:185-195).
 */
import { supabase } from '@/lib/supabase'

export interface TrustedContact {
  id: string
  name: string
  phone: string
  created_at: string
}

export type TrustedContactErrorCode =
  | 'INVALID_NAME'
  | 'INVALID_PHONE'
  | 'LIMIT_REACHED'
  | 'INVALID_ID'
  | 'FETCH_FAILED'
  | 'INSERT_FAILED'
  | 'DELETE_FAILED'
  | 'UNAUTHENTICATED'
  | 'NETWORK'
  | 'UNKNOWN'

export class TrustedContactApiError extends Error {
  readonly code: TrustedContactErrorCode

  constructor(code: TrustedContactErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'TrustedContactApiError'
  }
}

async function authHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) {
    throw new TrustedContactApiError('UNAUTHENTICATED', 'Not signed in')
  }
  return `Bearer ${token}`
}

async function parseErrorResponse(resp: Response): Promise<TrustedContactApiError> {
  try {
    const body = (await resp.json()) as { error?: { code?: string; message?: string } }
    const code = (body.error?.code as TrustedContactErrorCode | undefined) ?? 'UNKNOWN'
    const message = body.error?.message ?? `Request failed (${resp.status})`
    return new TrustedContactApiError(code, message)
  } catch {
    return new TrustedContactApiError('UNKNOWN', `Request failed (${resp.status})`)
  }
}

export async function listTrustedContacts(): Promise<TrustedContact[]> {
  // authHeader() can throw UNAUTHENTICATED — must run OUTSIDE the
  // try/catch so its TrustedContactApiError isn't masked as NETWORK.
  const auth = await authHeader()
  let resp: Response
  try {
    resp = await fetch('/api/safety/trusted-contacts', {
      headers: { Authorization: auth },
    })
  } catch {
    throw new TrustedContactApiError('NETWORK', 'Network error')
  }
  if (!resp.ok) throw await parseErrorResponse(resp)
  const body = (await resp.json()) as { contacts?: TrustedContact[] }
  return body.contacts ?? []
}

export async function addTrustedContact(input: { name: string; phone: string }): Promise<TrustedContact> {
  const auth = await authHeader()
  let resp: Response
  try {
    resp = await fetch('/api/safety/trusted-contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body: JSON.stringify({ name: input.name, phone: input.phone }),
    })
  } catch {
    throw new TrustedContactApiError('NETWORK', 'Network error')
  }
  if (!resp.ok) throw await parseErrorResponse(resp)
  const body = (await resp.json()) as { contact?: TrustedContact }
  if (!body.contact) {
    throw new TrustedContactApiError('UNKNOWN', 'Server returned no contact')
  }
  return body.contact
}

export async function deleteTrustedContact(id: string): Promise<void> {
  const auth = await authHeader()
  let resp: Response
  try {
    resp = await fetch(`/api/safety/trusted-contacts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    })
  } catch {
    throw new TrustedContactApiError('NETWORK', 'Network error')
  }
  if (!resp.ok) throw await parseErrorResponse(resp)
}

/**
 * Mirrors iOS `AddTrustedContactSheet.normalisePhone(_:)` verbatim —
 * trim whitespace, preserve leading `+`, strip everything that isn't
 * a digit. The server accepts any 1-20 char string but
 * `MFMessageComposeViewController` / the SMS deep-link on web need a
 * dial-able number so we clean before sending.
 */
export function normalisePhone(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const leadingPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D+/g, '')
  return leadingPlus ? `+${digits}` : digits
}
