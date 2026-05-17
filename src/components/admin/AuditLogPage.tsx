import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAdminAuditLog,
  type AuditLogFilters,
  type AuditLogRow,
} from '@/hooks/useAdminAuditLog'
import InfoTooltip from './InfoTooltip'

/**
 * Slice 1.8 — global admin audit log page.
 *
 * Shows EVERY admin write across EVERY user, paginated, with three
 * filter dropdowns: action / admin email / target user. The per-user
 * audit list on the user-detail Admin Actions tab is the same data
 * filtered server-side by target_user_id; this page is the
 * complement — useful for "who did what across all users today" or
 * "show me every refund" investigations.
 */

const PAGE_SIZE = 25

export default function AuditLogPage() {
  const [filters, setFilters] = useState<AuditLogFilters>({})
  const [page, setPage] = useState(0)

  // Reset page to 0 whenever filters change so the offset doesn't
  // outlast the result set it was meant to page.
  const setFilter = <K extends keyof AuditLogFilters>(key: K, value: string | undefined) => {
    setFilters((prev) => {
      const next = { ...prev }
      if (value === undefined || value === '') {
        delete next[key]
      } else {
        next[key] = value as AuditLogFilters[K]
      }
      return next
    })
    setPage(0)
  }

  const query = useAdminAuditLog({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    filters,
  })

  const rows = query.data?.audit ?? []
  const total = query.data?.total ?? 0
  const actionOptions = query.data?.distinct_actions ?? []

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total],
  )

  const hasActiveFilter = Object.values(filters).some((v) => Boolean(v))

  return (
    <div data-testid="admin-audit-log-page" className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text-primary">Audit log</h1>
          <InfoTooltip
            testid="audit-log-page-info"
            text="Every write the admin panel has performed. Filter by action type, admin who fired it, or target user. The per-user list on the Admin Actions tab is the same data filtered server-side."
            align="left"
          />
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          {query.isLoading
            ? 'Loading…'
            : `${total} action${total === 1 ? '' : 's'} recorded`}
          {hasActiveFilter && ' · matching current filter'}
        </p>
      </div>

      {/* ── Filters ──────────────────────────────────────────────── */}
      <section
        data-testid="audit-log-filters"
        className="rounded-2xl border border-border bg-white p-4 flex flex-wrap items-end gap-3"
      >
        <FilterField label="Search" tooltip="Free-text search across the action token AND the JSON payload. Use this to find a specific push title, refund reason, or any string the server stored.">
          <input
            data-testid="filter-q"
            type="search"
            value={filters.q ?? ''}
            onChange={(e) => setFilter('q', e.target.value || undefined)}
            placeholder="search action or payload…"
            className="w-72 rounded-md border border-border px-2 py-1.5 text-sm"
          />
        </FilterField>

        <FilterField label="Action" tooltip="Token written by the server when the action ran (e.g. send_push, grant_wallet_credit, force_cancel_ride).">
          <select
            data-testid="filter-action"
            value={filters.action ?? ''}
            onChange={(e) => setFilter('action', e.target.value || undefined)}
            className="rounded-md border border-border px-2 py-1.5 text-sm"
          >
            <option value="">Any action</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Admin UUID" tooltip="Paste the UUID of the admin you want to filter by. Use /admin/users to copy a UUID.">
          <input
            data-testid="filter-admin-id"
            type="text"
            value={filters.admin_id ?? ''}
            onChange={(e) => setFilter('admin_id', e.target.value || undefined)}
            placeholder="admin user UUID"
            className="w-72 rounded-md border border-border px-2 py-1.5 text-sm font-mono"
          />
        </FilterField>

        <FilterField label="Target user UUID" tooltip="Filter by the user the action was performed on. Type 'null' to filter for broadcast actions (no specific target).">
          <input
            data-testid="filter-target-id"
            type="text"
            value={filters.target_user_id ?? ''}
            onChange={(e) => setFilter('target_user_id', e.target.value || undefined)}
            placeholder="target UUID or 'null'"
            className="w-72 rounded-md border border-border px-2 py-1.5 text-sm font-mono"
          />
        </FilterField>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setFilters({}); setPage(0) }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface"
          >
            Clear all
          </button>
        )}
      </section>

      {/* ── Table ────────────────────────────────────────────────── */}
      <section
        data-testid="audit-log-table"
        className="rounded-2xl border border-border bg-white overflow-hidden"
      >
        {query.isLoading ? (
          <div className="p-4 text-sm text-text-secondary">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-sm text-text-secondary">
            No audit rows match the current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left">
                <tr className="text-xs uppercase tracking-wide text-text-secondary">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Admin</th>
                  <th className="px-4 py-2 font-medium">Target</th>
                  <th className="px-4 py-2 font-medium">Payload</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => <AuditRow key={row.id} row={row} />)}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <footer className="px-4 py-3 border-t border-border flex items-center justify-between text-sm">
            <span className="text-text-secondary">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="audit-page-prev"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-md border border-border px-3 py-1 hover:bg-surface disabled:opacity-40"
              >
                ← Prev
              </button>
              <button
                type="button"
                data-testid="audit-page-next"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-border px-3 py-1 hover:bg-surface disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </footer>
        )}
      </section>
    </div>
  )
}

function FilterField({
  label,
  tooltip,
  children,
}: {
  label: string
  tooltip: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-xs font-medium text-text-secondary">
        {label}
        <InfoTooltip testid={`filter-info-${label.toLowerCase().replace(/\s+/g, '-')}`} text={tooltip} />
      </span>
      {children}
    </div>
  )
}

function AuditRow({ row }: { row: AuditLogRow }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="px-4 py-2 text-text-secondary whitespace-nowrap">
        <div>{new Date(row.created_at).toLocaleString()}</div>
        <div className="text-xs text-text-tertiary">{timeAgo(row.created_at)} ago</div>
      </td>
      <td className="px-4 py-2">
        <span className="inline-block rounded-full bg-primary-light px-2 py-0.5 text-xs font-medium text-primary">
          {row.action}
        </span>
      </td>
      <td className="px-4 py-2 text-text-primary">
        <div className="truncate max-w-xs">{row.admin_email ?? row.admin_id.slice(0, 8) + '…'}</div>
        <div className="text-xs text-text-tertiary font-mono">{row.admin_id.slice(0, 8)}…</div>
      </td>
      <td className="px-4 py-2">
        {row.target_user_id ? (
          <Link
            to={`/admin/users/${row.target_user_id}`}
            className="text-primary hover:underline"
          >
            {row.target_email ?? row.target_user_id.slice(0, 8) + '…'}
          </Link>
        ) : (
          <span className="text-text-tertiary italic">broadcast</span>
        )}
      </td>
      <td className="px-4 py-2 max-w-md">
        <PayloadCell payload={row.payload} />
      </td>
    </tr>
  )
}

function PayloadCell({ payload }: { payload: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const summary = useMemo(() => summarizePayload(payload), [payload])
  return (
    <div>
      <div className="text-xs text-text-secondary truncate">{summary}</div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 text-xs text-primary hover:underline"
      >
        {open ? 'Hide' : 'Show'} full JSON
      </button>
      {open && (
        <pre className="mt-1 overflow-x-auto rounded-md bg-surface p-2 text-xs text-text-secondary">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

function summarizePayload(payload: Record<string, unknown>): string {
  // Tiny single-line summary for the common action shapes. Keeps the
  // table scannable without forcing the admin to expand every row.
  if (typeof payload['amount_cents'] === 'number') {
    const amount = (payload['amount_cents'] as number) / 100
    const reason = typeof payload['reason'] === 'string' ? payload['reason'] : ''
    return `$${amount.toFixed(2)}${reason ? ` · ${reason}` : ''}`
  }
  if (typeof payload['title'] === 'string') {
    const title = String(payload['title'])
    return title.length > 80 ? title.slice(0, 80) + '…' : title
  }
  if (typeof payload['reason'] === 'string') {
    return String(payload['reason']).slice(0, 80)
  }
  const keys = Object.keys(payload)
  return keys.length === 0 ? '(empty)' : keys.slice(0, 4).join(', ')
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}
