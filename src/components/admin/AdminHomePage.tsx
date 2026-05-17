import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Placeholder admin dashboard. Renders a minimal "you're in" surface
 * + a /api/admin/ping health-probe so the admin can confirm:
 *
 *   1. The client-side AdminGuard accepted them (this page rendered)
 *   2. The server-side adminAuth middleware accepts them (ping returns 200)
 *
 * Slice 1.1 replaces this with the 12 KPI cards + 3 charts dashboard.
 * Keeping the file in place now so the `/admin` route resolves to
 * something usable.
 */

interface PingResult {
  ok: boolean
  user_id: string
  is_admin: boolean
  server_env: string
  server_time: string
}

export default function AdminHomePage() {
  const [ping, setPing] = useState<PingResult | null>(null)
  const [pingError, setPingError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function probe() {
      try {
        const { data: sessionRes } = await supabase.auth.getSession()
        const token = sessionRes.session?.access_token
        if (!token) {
          setPingError('No active session — sign in again.')
          return
        }
        // Relative path — Vercel rewrites `/api/*` to the EC2 server
        // (`vercel.json`), so the web app + admin server share an origin
        // from the browser's perspective.
        const res = await fetch(`/api/admin/ping`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          if (cancelled) return
          setPingError(
            (body as { error?: { message?: string } }).error?.message ??
              `Server returned ${res.status}`,
          )
          return
        }
        const body = (await res.json()) as PingResult
        if (cancelled) return
        setPing(body)
      } catch (err) {
        if (cancelled) return
        setPingError(err instanceof Error ? err.message : 'Network error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void probe()
    return () => { cancelled = true }
  }, [])

  return (
    <div data-testid="admin-home" className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          Welcome to the admin panel
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Phase 0 shell — KPIs and tools land in subsequent slices.
        </p>
      </div>

      {/* ── Server-permission probe ─────────────────────────────── */}
      <div
        data-testid="admin-ping-card"
        className="rounded-2xl border border-border bg-white p-5"
      >
        <div className="text-sm font-semibold text-text-primary">
          Server admin permission probe
        </div>
        <p className="mt-1 text-xs text-text-secondary">
          Calls <code className="font-mono text-[11px] bg-surface px-1 py-0.5 rounded">GET /api/admin/ping</code>
          {' '}to confirm the server accepts your admin JWT. If this fails, the
          {' '}sidebar will still render but every other admin call will 403.
        </p>
        <div className="mt-4">
          {loading && (
            <span data-testid="admin-ping-loading" className="text-sm text-text-secondary">
              Checking…
            </span>
          )}
          {!loading && ping && (
            <div data-testid="admin-ping-success" className="space-y-1 text-sm">
              <div className="text-success font-semibold">✓ Admin access confirmed</div>
              <div className="text-text-secondary">
                User id: <span className="font-mono text-xs">{ping.user_id}</span>
              </div>
              <div className="text-text-secondary">
                Server env: <span className="font-mono text-xs">{ping.server_env}</span>
              </div>
              <div className="text-text-secondary">
                Server time: <span className="font-mono text-xs">{ping.server_time}</span>
              </div>
            </div>
          )}
          {!loading && pingError && (
            <div data-testid="admin-ping-error" className="text-sm text-danger">
              ✗ {pingError}
            </div>
          )}
        </div>
      </div>

      {/* ── Phase 1 preview ──────────────────────────────────────── */}
      <div className="rounded-2xl border border-dashed border-border bg-white p-5">
        <div className="text-sm font-semibold text-text-primary">
          Coming next (Phase 1)
        </div>
        <ul className="mt-2 space-y-1 text-sm text-text-secondary list-disc list-inside">
          <li>Slice 1.1 — overview dashboard with 12 KPI cards + charts</li>
          <li>Slice 1.2 — user funnel breakdown</li>
          <li>Slice 1.3 — user search + profile detail (Users tab)</li>
          <li>Slice 1.4 / 1.5 / 1.6 — campaign composer (push + email + in-app)</li>
          <li>Slice 1.7 — live ops view (map + event feed)</li>
          <li>Slice 1.8 — campaign history + audit log</li>
        </ul>
      </div>
    </div>
  )
}
