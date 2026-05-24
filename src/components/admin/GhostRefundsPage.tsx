import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAdminGhostRefunds,
  type AdminGhostRefundRow,
  type GhostRefundStatusFilter,
} from '@/hooks/useAdminGhostRefunds'
import { AdminApiException } from '@/lib/admin/api'

/**
 * 2026-05-23 — admin page for the ghost-driver auto-refund queue
 * at `/admin/ghost-refunds`. Pure read-only.
 *
 * Context: when a rider pays for a ride but the driver never
 * connects a Stripe Connect account, the money sits in TAGO
 * custody. A daily cron reminds the driver to connect; after
 * 90 days the rider is auto-refunded + the driver's wallet is
 * clawed back. This page surfaces that queue so admin can see
 * who's pending, who got reminded, and who's already been
 * refunded — plus the dollar amounts at stake.
 */

const PAGE_SIZE = 25

export default function GhostRefundsPage() {
  const [status, setStatus] = useState<GhostRefundStatusFilter>('pending')
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    setOffset(0)
  }, [status])

  const query = useAdminGhostRefunds({ status, limit: PAGE_SIZE, offset })
  const rows = query.data?.rows ?? []
  const counts = query.data?.counts
  const total = query.data?.total ?? 0

  return (
    <div className="space-y-5" data-testid="admin-ghost-refunds">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Ghost-driver refunds
          </h1>
          <p className="text-sm text-text-secondary">
            Rides where the driver never connected a Stripe account. The
            cron reminds them, then auto-refunds the rider after 90 days.
          </p>
        </div>
        {counts && (
          <div className="flex gap-4 text-xs">
            <Kpi
              label="Pending"
              count={counts.pending}
              amountCents={counts.pending_amount_cents}
              tone="warning"
            />
            <Kpi
              label="Refunded"
              count={counts.refunded}
              amountCents={counts.refunded_amount_cents}
              tone="neutral"
            />
          </div>
        )}
      </header>

      <FilterChips status={status} onStatus={setStatus} />

      {query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading && rows.length === 0 ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState status={status} />
      ) : (
        <Table rows={rows} />
      )}

      <Pager
        offset={offset}
        total={total}
        onPrev={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        onNext={() => setOffset(offset + PAGE_SIZE)}
      />
    </div>
  )
}

function Kpi({
  label,
  count,
  amountCents,
  tone,
}: {
  label: string
  count: number
  amountCents: number
  tone: 'warning' | 'neutral'
}) {
  const labelClass =
    tone === 'warning' ? 'text-warning font-semibold' : 'text-text-secondary'
  return (
    <div className="rounded-xl border border-border bg-white px-3 py-2">
      <div className={['text-[10px] uppercase tracking-wide', labelClass].join(' ')}>
        {label}
      </div>
      <div className="text-sm font-bold text-text-primary">
        {count.toLocaleString()}{' '}
        <span className="text-text-secondary font-normal">·</span>{' '}
        <span className={tone === 'warning' ? 'text-warning' : ''}>
          {fmtCents(amountCents)}
        </span>
      </div>
    </div>
  )
}

function FilterChips({
  status,
  onStatus,
}: {
  status: GhostRefundStatusFilter
  onStatus: (v: GhostRefundStatusFilter) => void
}) {
  const opts: { id: GhostRefundStatusFilter; label: string }[] = [
    { id: 'pending', label: 'Pending' },
    { id: 'refunded', label: 'Refunded' },
    { id: 'all', label: 'All' },
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map((opt) => {
        const active = status === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onStatus(opt.id)}
            data-testid={`ghost-refunds-status-${opt.id}`}
            className={[
              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
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
  )
}

function Table({ rows }: { rows: AdminGhostRefundRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-surface text-[10px] uppercase tracking-wide text-text-secondary">
          <tr>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-left">Rider</th>
            <th className="px-4 py-2 text-left">Driver</th>
            <th className="px-4 py-2 text-left">Route</th>
            <th className="px-4 py-2 text-right">Amount</th>
            <th className="px-4 py-2 text-left">Timeline</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({ row }: { row: AdminGhostRefundRow }) {
  const isRefunded = row.refunded_at != null
  return (
    <tr
      data-testid={`ghost-refund-row-${row.id}`}
      className="border-t border-border hover:bg-surface/50 transition-colors"
    >
      <td className="px-4 py-3">
        {isRefunded ? (
          <span className="rounded-full bg-surface text-text-secondary text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">
            Refunded
          </span>
        ) : (
          <span className="rounded-full bg-warning/15 text-warning text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">
            Pending
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/admin/users/${row.rider_id}`}
          className="block hover:text-primary text-text-primary"
        >
          <div className="font-medium truncate max-w-[180px]">
            {row.rider_name ?? row.rider_email ?? '—'}
          </div>
          {row.rider_email && row.rider_name && (
            <div className="text-[11px] text-text-secondary truncate max-w-[180px]">
              {row.rider_email}
            </div>
          )}
        </Link>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/admin/users/${row.driver_id}`}
          className="block hover:text-primary text-text-primary"
        >
          <div className="font-medium truncate max-w-[180px]">
            {row.driver_name ?? row.driver_email ?? '—'}
          </div>
          {row.driver_email && row.driver_name && (
            <div className="text-[11px] text-text-secondary truncate max-w-[180px]">
              {row.driver_email}
            </div>
          )}
        </Link>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/admin/rides/${row.ride_id}`}
          className="block hover:text-primary"
        >
          <div className="text-text-primary text-xs truncate max-w-[260px]">
            {row.ride_origin_name ?? '—'} → {row.ride_destination_name ?? '—'}
          </div>
        </Link>
      </td>
      <td className="px-4 py-3 text-right text-text-primary font-semibold">
        {fmtCents(row.amount_cents)}
      </td>
      <td className="px-4 py-3 text-xs">
        <div className="space-y-0.5">
          <div className="text-text-secondary">
            <span className="text-[10px] uppercase tracking-wide">Created</span>{' '}
            <span className="text-text-primary">{fmtDate(row.created_at)}</span>
          </div>
          {row.reminder_sent_at && (
            <div className="text-text-secondary">
              <span className="text-[10px] uppercase tracking-wide">Reminded</span>{' '}
              <span className="text-text-primary">
                {fmtDate(row.reminder_sent_at)}
              </span>
            </div>
          )}
          {row.refunded_at && (
            <div className="text-success">
              <span className="text-[10px] uppercase tracking-wide">Refunded</span>{' '}
              <span className="font-semibold">{fmtDate(row.refunded_at)}</span>
            </div>
          )}
          {row.stripe_refund_id && (
            <div className="text-[10px] font-mono text-text-secondary truncate max-w-[180px]">
              {row.stripe_refund_id}
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

function Pager({
  offset,
  total,
  onPrev,
  onNext,
}: {
  offset: number
  total: number
  onPrev: () => void
  onNext: () => void
}) {
  const start = total === 0 ? 0 : offset + 1
  const end = Math.min(offset + PAGE_SIZE, total)
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total
  return (
    <div className="flex items-center justify-between text-xs text-text-secondary">
      <span>
        {start}–{end} of {total.toLocaleString()}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canPrev}
          onClick={onPrev}
          className="rounded-md border border-border px-2.5 py-1 disabled:opacity-50 hover:bg-surface"
        >
          ← Prev
        </button>
        <button
          type="button"
          disabled={!canNext}
          onClick={onNext}
          className="rounded-md border border-border px-2.5 py-1 disabled:opacity-50 hover:bg-surface"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="rounded-2xl border border-border bg-white p-6 text-center text-sm text-text-secondary">
      Loading…
    </div>
  )
}

function EmptyState({ status }: { status: GhostRefundStatusFilter }) {
  // Honest copy — empty here usually means "the daily cron hasn't
  // had a reason to write a row yet" rather than a strong claim
  // about driver-connect rates.
  const copy =
    status === 'pending'
      ? 'No pending ghost refunds right now. Either every recent rider-paid ride had a Stripe-connected driver, or the cron has already cleared the queue.'
      : status === 'refunded'
        ? 'No auto-refunds have been issued. The 90-day timer hasn’t elapsed for any pending ride yet.'
        : 'No ghost-refund rows on file. The cron only writes a row when a paid ride hits 90 days without the driver connecting Stripe.'
  return (
    <div className="rounded-2xl border border-border bg-white p-8 text-center">
      <p className="text-sm font-semibold text-text-primary">Nothing here.</p>
      <p className="mt-1 text-xs text-text-secondary max-w-md mx-auto">{copy}</p>
    </div>
  )
}

function ErrorPanel({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const msg =
    error instanceof AdminApiException
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : 'Couldn’t load ghost refunds.'
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

function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
