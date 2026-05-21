/**
 * 2026-05-20 — thin client for `/api/report/*` (Phase 2 of the
 * reporting & issue-tracking system). Mirrors the auth + error
 * envelope pattern from `lib/admin/api.ts` so React Query / callers
 * can rely on a single shape for failures.
 */
import { supabase } from '@/lib/supabase'

export interface ReportsApiError {
  status: number
  code: string
  message: string
}

export class ReportsApiException extends Error {
  status: number
  code: string

  constructor({ status, code, message }: ReportsApiError) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'ReportsApiException'
  }
}

async function getToken(): Promise<string> {
  const { data: sessionRes } = await supabase.auth.getSession()
  const token = sessionRes.session?.access_token
  if (!token) {
    throw new ReportsApiException({
      status: 0,
      code: 'NO_SESSION',
      message: 'No active session — sign in again.',
    })
  }
  return token
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as
      | { error?: { code?: string; message?: string } }
      | undefined
    throw new ReportsApiException({
      status: res.status,
      code: body?.error?.code ?? 'UNKNOWN',
      message: body?.error?.message ?? `Server returned ${res.status}`,
    })
  }
  return (await res.json()) as T
}

export async function reportsGet<T>(path: string): Promise<T> {
  const token = await getToken()
  const res = await fetch(`/api/report${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return unwrap<T>(res)
}

export async function reportsPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getToken()
  const res = await fetch(`/api/report${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return unwrap<T>(res)
}
