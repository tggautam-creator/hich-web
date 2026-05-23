import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAdminRideInbox,
  type AdminRideInboxRow,
  type AdminRideStatus,
  type InboxStatusFilter,
} from '@/hooks/useAdminRides'
import { AdminApiException } from '@/lib/admin/api'
import { trackEvent } from '@/lib/analytics'

/**
 * 2026-05-23 — admin-side ride inbox at `/admin/rides`. Lets ops
 * search the entire ride history by status, date, or party name.
 * Each row links to `/admin/rides/:id` for the full chat + payment
 * + status timeline. Auto-refreshes every 30s.
 */

const STATUS_LABEL: Record<AdminRideStatus, string> = {
  requested: 'Requested',
  accepted: 'Accepted',
  coordinating: 'Coordinating',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const STATUS_TONE: Record<AdminRideStatus, string> = {
  requested: 'bg-surface text-text-secondary',
  accepted: 'bg-primary/15 text-primary',
  coordinating: 'bg-primary/15 text-primary',
  active: 'bg-success/15 text-success',
  completed: 'bg-surface text-text-secondary',
  cancelled: 'bg-danger/10 text-danger',
}

const PAGE_SIZE = 25

export default function RidesInboxPage() {
  const [status, setStatus] = useState<InboxStatusFilter>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [hasReport, setHasReport] = useState(false)
  const [offset, setOffset] = useState(0)

  // 300ms debounce so typing in the search box doesn't fire a
  // query on every keystroke. Matches the cadence the rest of the
  // admin UI uses.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  // Reset pagination when filters change so the user doesn't end up
  // on an empty page after narrowing the result set.
  useEffect(() => {
    setOffset(0)
  }, [status, dateFrom, dateTo, debouncedQ, hasReport])

  const query = useAdminRideInbox({
    status,
    dateFrom,
    dateTo,
    q: debouncedQ,
    hasReport: hasReport ? 'yes' : '',
    limit: PAGE_SIZE,
    offset,
  })

  useEffect(() => {
    trackEvent('admin_rides_inbox_view', {
      status: status || 'all',
      has_report_filter: hasReport,
    })
  }, [status, hasReport])

  const rides = query.data?.rides ?? []
  const total = query.data?.total ?? 0

  return (
    <div className="space-y-5" data-testid="admin-rides-inbox">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Rides</h1>
          <p className="text-sm text-text-secondary">
            Every ride end-to-end — chat, status flips, payment.
          </p>
        </div>
        <div className="text-xs text-text-secondary">
          {query.isLoading ? 'Loading…' : `${total.toLocaleString()} total`}
        </div>
      </header>

      <Filters
        status={status}
        onStatus={setStatus}
        dateFrom={dateFrom}
        onDateFrom={setDateFrom}
        dateTo={dateTo}
        onDateTo={setDateTo}
        q={q}
        onQ={setQ}
        hasReport={hasReport}
        onHasReport={setHasReport}
      />

      {query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading && rides.length === 0 ? (
        <SkeletonRows />
      ) : rides.length === 0 ? (
        <EmptyState />
      ) : (
        <Table rides={rides} />
      )}

      <Pager
        offset={offset}
        pageSize={PAGE_SIZE}
        total={total}
        onPrev={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        onNext={() => setOffset(offset + PAGE_SIZE)}
      />
    </div>
  )
}

function Filters({
  status,
  onStatus,
  dateFrom,
  onDateFrom,
  dateTo,
  onDateTo,
  q,
  onQ,
  hasReport,
  onHasReport,
}: {
  status: InboxStatusFilter
  onStatus: (v: InboxStatusFilter) => void
  dateFrom: string
  onDateFrom: (v: string) => void
  dateTo: string
  onDateTo: (v: string) => void
  q: string
  onQ: (v: string) => void
  hasReport: boolean
  onHasReport: (v: boolean) => void
}) {
  const statusOptions: { id: InboxStatusFilter; label: string }[] = [
    { id: '', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'coordinating', label: 'Coordinating' },
    { id: 'accepted', label: 'Accepted' },
    { id: 'requested', label: 'Requested' },
    { id: 'completed', label: 'Completed' },
    { id: 'cancelled', label: 'Cancelled' },
  ]

  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-1">
            Search rider or driver
          </label>
          <input
            data-testid="rides-inbox-search"
            type="text"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="name or email…"
            className="w-full rounded-xl border border-border bg-white px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-1">
            From
          </label>
          <input
            data-testid="rides-inbox-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFrom(e.target.value)}
            className="rounded-xl border border-border bg-white px-3 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-1">
            To
          </label>
          <input
            data-testid="rides-inbox-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => onDateTo(e.target.value)}
            className="rounded-xl border border-border bg-white px-3 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer pb-1.5">
          <input
            data-testid="rides-inbox-has-report"
            type="checkbox"
            checked={hasReport}
            onChange={(e) => onHasReport(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          Has open report
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {statusOptions.map((opt) => {
          const active = status === opt.id
          return (
            <button
              key={opt.id || 'all'}
              type="button"
              onClick={() => onStatus(opt.id)}
              data-testid={`rides-inbox-status-${opt.id || 'all'}`}
              className={[
                'rounded-full px-2.5 py-1 text-xs font-semibold transition-colors',
                active
                  ? 'bg-primary text-white'
                  : 'bg-surface text-text-secondary hover:bg-border',
              ].join(' ')}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Table({ rides }: { rides: AdminRideInboxRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-surface text-[10px] uppercase tracking-wide text-text-secondary">
          <tr>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-left">Rider</th>
            <th className="px-4 py-2 text-left">Driver</th>
            <th className="px-4 py-2 text-left">Route</th>
            <th className="px-4 py-2 text-right">Fare</th>
            <th className="px-4 py-2 text-left">Created</th>
            <th className="px-4 py-2 text-left">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rides.map((ride) => (
            <Row key={ride.id} ride={ride} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({ ride }: { ride: AdminRideInboxRow }) {
  return (
    <tr
      data-testid={`rides-inbox-row-${ride.id}`}
      className="border-t border-border hover:bg-surface/50 transition-colors"
    >
      <td className="px-4 py-3">
        <span
          className={[
            'inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            STATUS_TONE[ride.status],
          ].join(' ')}
        >
          {STATUS_LABEL[ride.status]}
        </span>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/admin/rides/${ride.id}`}
          className="block text-text-primary hover:text-primary"
        >
          <div className="font-medium truncate max-w-[180px]">
            {ride.rider_name ?? ride.rider_email ?? '—'}
          </div>
          {ride.rider_email && ride.rider_name && (
            <div className="text-[11px] text-text-secondary truncate max-w-[180px]">
              {ride.rider_email}
            </div>
          )}
        </Link>
      </td>
      <td className="px-4 py-3 text-text-primary">
        {ride.driver_name ? (
          <>
            <div className="font-medium truncate max-w-[180px]">{ride.driver_name}</div>
            {ride.driver_email && (
              <div className="text-[11px] text-text-secondary truncate max-w-[180px]">
                {ride.driver_email}
              </div>
            )}
          </>
        ) : (
          <span className="text-text-secondary text-xs">unassigned</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Link to={`/admin/rides/${ride.id}`} className="block hover:text-primary">
          <div className="text-text-primary text-xs truncate max-w-[260px]">
            {ride.origin_name ?? '—'} → {ride.destination_name ?? '—'}
          </div>
        </Link>
      </td>
      <td className="px-4 py-3 text-right text-text-primary">
        {ride.fare_cents != null ? `$${(ride.fare_cents / 100).toFixed(2)}` : '—'}
        {ride.payment_status && ride.payment_status !== 'paid' && (
          <div className="text-[10px] text-warning uppercase tracking-wide">
            {ride.payment_status}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-text-secondary text-xs">
        {fmtDate(ride.created_at)}
      </td>
      <td className="px-4 py-3">
        {ride.has_report ? (
          <span className="rounded-full bg-danger/10 text-danger px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
            Report
          </span>
        ) : (
          <span className="text-text-secondary text-xs">—</span>
        )}
      </td>
    </tr>
  )
}

function Pager({
  offset,
  pageSize,
  total,
  onPrev,
  onNext,
}: {
  offset: number
  pageSize: number
  total: number
  onPrev: () => void
  onNext: () => void
}) {
  const start = total === 0 ? 0 : offset + 1
  const end = Math.min(offset + pageSize, total)
  const canPrev = offset > 0
  const canNext = offset + pageSize < total
  return (
    <div className="flex items-center justify-between text-xs text-text-secondary">
      <span data-testid="rides-inbox-pager-range">
        {start}–{end} of {total.toLocaleString()}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canPrev}
          onClick={onPrev}
          data-testid="rides-inbox-pager-prev"
          className="rounded-md border border-border px-2.5 py-1 disabled:opacity-50 hover:bg-surface"
        >
          ← Prev
        </button>
        <button
          type="button"
          disabled={!canNext}
          onClick={onNext}
          data-testid="rides-inbox-pager-next"
          className="rounded-md border border-border px-2.5 py-1 disabled:opacity-50 hover:bg-surface"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="rounded-2xl border border-border bg-white p-6 text-center text-sm text-text-secondary">
      Loading…
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-border bg-white p-8 text-center">
      <p className="text-sm font-semibold text-text-primary">No rides match.</p>
      <p className="mt-1 text-xs text-text-secondary">
        Loosen the filters or widen the date range.
      </p>
    </div>
  )
}

function ErrorPanel({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const msg =
    error instanceof AdminApiException
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : 'Couldn’t load the rides inbox.'
  return (
    <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm">
      <p className="font-semibold text-danger">{msg}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-md border border-danger/40 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
      >
        Retry
      </button>
    </div>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
