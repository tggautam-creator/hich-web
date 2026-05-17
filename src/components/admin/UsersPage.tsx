import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminUserSearch } from '@/hooks/useAdminUsers'
import { AdminApiException } from '@/lib/admin/api'
import { trackEvent } from '@/lib/analytics'
import InfoTooltip from './InfoTooltip'

/**
 * Slice 1.3a — /admin/users.
 *
 * Big search box → debounced 250ms → server-side ILIKE across
 * email / full_name / phone (or exact id match on a full UUID).
 * Empty query shows newest signups so the page isn't blank on
 * first visit. Each row links to /admin/users/:id for the
 * profile detail.
 */
export default function UsersPage() {
  const [raw, setRaw] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const limit = 25

  useEffect(() => {
    trackEvent('admin_users_loaded')
  }, [])

  // Debounce keystrokes → only fire the query 250ms after the user
  // stops typing. Reset page back to 0 whenever the query changes
  // (a new query should land on the first page, not deep mid-list).
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQ(raw.trim())
      setPage(0)
    }, 250)
    return () => window.clearTimeout(handle)
  }, [raw])

  const { data, isLoading, isFetching, error } = useAdminUserSearch({
    q,
    limit,
    offset: page * limit,
  })

  const totalPages = useMemo(() => {
    if (!data) return 1
    return Math.max(1, Math.ceil(data.total / limit))
  }, [data])

  return (
    <div data-testid="admin-users" className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text-primary">Users</h1>
          <InfoTooltip
            testid="users-page-info"
            text="Search every user in the public.users table. Type an email, name, phone, or a full UUID. Empty search shows the newest signups so you can browse. Results are paginated 25 at a time. Click any row to open the full profile."
            align="left"
          />
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          Find any user by email, name, phone, or UUID. Type to search.
        </p>
      </div>

      {/* ── Search box ──────────────────────────────────────────────── */}
      <div className="relative">
        <input
          data-testid="users-search-input"
          type="text"
          autoFocus
          placeholder="Search by email, name, phone, or UUID…"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className={[
            'w-full rounded-2xl border border-border bg-white px-5 py-3',
            'text-sm text-text-primary placeholder:text-text-secondary',
            'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
          ].join(' ')}
        />
        {raw && (
          <button
            type="button"
            data-testid="users-search-clear"
            onClick={() => setRaw('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Status row ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <div data-testid="users-search-meta">
          {isLoading && !data && 'Searching…'}
          {data && (
            <>
              {data.total.toLocaleString('en-US')} result{data.total === 1 ? '' : 's'}
              {q === '' && ' (newest signups)'}
            </>
          )}
        </div>
        <div>{isFetching && data && <span className="text-primary">Refreshing…</span>}</div>
      </div>

      {/* ── Results ─────────────────────────────────────────────────── */}
      {error && (
        <div
          data-testid="users-error"
          className="rounded-2xl border border-danger bg-white p-5 text-sm text-danger"
        >
          {error instanceof AdminApiException
            ? `${error.code}: ${error.message}`
            : (error as Error).message}
        </div>
      )}

      {data && data.users.length === 0 && (
        <div
          data-testid="users-empty"
          className="rounded-2xl border border-border bg-white p-8 text-center text-sm text-text-secondary"
        >
          No users match this search.
        </div>
      )}

      {data && data.users.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-text-secondary">
                <th className="px-4 py-2.5">Name / Email</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Signed up</th>
                <th className="px-4 py-2.5">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.users.map((u) => (
                <tr
                  key={u.id}
                  data-testid={`users-row-${u.id}`}
                  className="hover:bg-surface"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/users/${u.id}`}
                      className="block"
                    >
                      <div className="font-semibold text-text-primary">
                        {u.full_name ?? '(no name)'}
                      </div>
                      <div className="text-xs text-text-secondary">
                        {u.email}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {u.is_driver ? 'driver' : 'rider'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {fmtDate(u.created_at)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {u.last_active_at ? fmtRelative(u.last_active_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ──────────────────────────────────────────────── */}
      {data && data.total > limit && (
        <div
          data-testid="users-pagination"
          className="flex items-center justify-between"
        >
          <button
            type="button"
            data-testid="users-prev-page"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-text-primary disabled:opacity-40 hover:bg-surface"
          >
            ← Previous
          </button>
          <span className="text-xs text-text-secondary">
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            data-testid="users-next-page"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-text-primary disabled:opacity-40 hover:bg-surface"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

// ── formatters ───────────────────────────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function fmtDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

function fmtRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (days === 0) {
    const hours = Math.floor(diffMs / (60 * 60 * 1000))
    if (hours === 0) return 'just now'
    return `${hours}h ago`
  }
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return fmtDate(iso)
}
