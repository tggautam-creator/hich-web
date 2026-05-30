/**
 * Thin client for the `/api/admin/*` surface.
 *
 * Two responsibilities:
 *   1. Attach the current Supabase JWT to every request.
 *   2. Normalize errors into the `{ error: { code, message } }` envelope
 *      the server uses, so React Query / callers can rely on a single
 *      shape for failures.
 *
 * Keep this file dependency-light — it's imported from the admin
 * route bundle which is lazy-loaded for non-admins.
 */
import { supabase } from '@/lib/supabase'

export interface AdminApiError {
  status: number
  code: string
  message: string
}

export class AdminApiException extends Error {
  status: number
  code: string

  constructor({ status, code, message }: AdminApiError) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'AdminApiException'
  }
}

/**
 * GET an `/api/admin/*` JSON endpoint. Throws AdminApiException on any
 * non-2xx response so React Query routes it to `error` instead of
 * `data`.
 */
export async function adminGet<T>(path: string): Promise<T> {
  const { data: sessionRes } = await supabase.auth.getSession()
  const token = sessionRes.session?.access_token
  if (!token) {
    throw new AdminApiException({
      status: 0,
      code: 'NO_SESSION',
      message: 'No active session — sign in again.',
    })
  }

  const res = await fetch(`/api/admin${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as
      | { error?: { code?: string; message?: string } }
      | undefined
    throw new AdminApiException({
      status: res.status,
      code: body?.error?.code ?? 'UNKNOWN',
      message: body?.error?.message ?? `Server returned ${res.status}`,
    })
  }

  return (await res.json()) as T
}

/**
 * POST a JSON body to an `/api/admin/*` endpoint. Same auth + error
 * envelope as adminGet. Used by every mutation in the Admin Actions
 * tab.
 */
export async function adminPost<T>(path: string, body: unknown): Promise<T> {
  return adminMutate<T>('POST', path, body)
}

/**
 * PATCH a JSON body to an `/api/admin/*` endpoint. Same auth + error
 * envelope as adminPost. Used by status-update mutations (marketing
 * story items, etc.).
 */
export async function adminPatch<T>(path: string, body: unknown): Promise<T> {
  return adminMutate<T>('PATCH', path, body)
}

async function adminMutate<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
  const { data: sessionRes } = await supabase.auth.getSession()
  const token = sessionRes.session?.access_token
  if (!token) {
    throw new AdminApiException({
      status: 0,
      code: 'NO_SESSION',
      message: 'No active session — sign in again.',
    })
  }

  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as
      | { error?: { code?: string; message?: string } }
      | undefined
    throw new AdminApiException({
      status: res.status,
      code: errBody?.error?.code ?? 'UNKNOWN',
      message: errBody?.error?.message ?? `Server returned ${res.status}`,
    })
  }

  return (await res.json()) as T
}
