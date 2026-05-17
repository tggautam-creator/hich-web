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
