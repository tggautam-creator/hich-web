import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAdminSafetyEnded,
  type AdminSafetyEndedRow,
  type SafetyEndedReasonFilter,
} from '@/hooks/useAdminSafetyEnded'
import { AdminApiException } from '@/lib/admin/api'

/**
 * 2026-05-24 — admin review queue for rides ended via the v1.2 Phase
 * 3 safety net at `/admin/safety-ended`.
 *
 * Closes the Phase 3 ops loop: the safety-net cron auto-ends rides
 * when rider/driver GPS diverges past the threshold or the ride runs
 * past 8h. Riders/drivers can also end via the in-app safety overlay
 * or the manual escape-hatch button. Every one of those paths stamps
 * `divergence_state='safety_ended'`; this page surfaces the queue so
 * ops can review what happened, who tapped what, and whether the
 * fare landed correctly.
 *
 * Pure read-only — no actions on this page yet. Detail view + manual
 * refund would be Phase 3.5+.
 */

const PAGE_SIZE = 25

export default function SafetyEndedPage() {
  const [reason, setReason] = useState<SafetyEndedReasonFilter>('all')
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    setOffset(0)
  }, [reason])

  const query = useAdminSafetyEnded({ reason, limit: PAGE_SIZE, offset })
  const rows = query.data?.rows ?? []
  const counts = query.data?.counts
  const total = query.data?.total ?? 0

  return (
    <div className="space-y-5" data-testid="admin-safety-ended">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Safety-ended rides
          </h1>
          <p className="text-sm text-text-secondary max-w-2xl">
            Rides that ended via the Phase 3 safety net — GPS-divergence
            auto-end, 8h max-duration auto-end, the in-app safety
            overlay "I got out" button, or the manual end-without-QR
            escape hatch. Sorted by most recently ended.
          </p>
        </div>
        {counts && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Kpi label="Auto · divergence" count={counts.auto_divergence} tone="danger" />
            <Kpi label="Auto · 8h idle" count={counts.auto_idle} tone="warning" />
            <Kpi label="Safety button" count={counts.user_button} tone="primary" />
            <Kpi label="Manual end" count={counts.manual} tone="neutral" />
          </div>
        )}
      </header>

      <FilterChips reason={reason} onReason={setReason} />

      {query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading && rows.length === 0 ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState reason={reason} />
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

// ── KPI tile ──────────────────────────────────────────────────────────

function Kpi({
  label,
  count,
  tone,
}: {
  label: string
  count: number
  tone: 'danger' | 'warning' | 'primary' | 'neutral'
}) {
  const labelClass = {
    danger: 'text-danger font-semibold',
    warning: 'text-warning font-semibold',
    primary: 'text-primary font-semibold',
    neutral: 'text-text-secondary',
  }[tone]
  return (
    <div className="rounded-xl border border-border bg-white px-3 py-2 min-w-[120px]">
      <div className={['text-[10px] uppercase tracking-wide', labelClass].join(' ')}>
        {label}
      </div>
      <div className="text-sm font-bold text-text-primary">
        {count.toLocaleString()}
      </div>
    </div>
  )
}

// ── Filter chips ──────────────────────────────────────────────────────

function FilterChips({
  reason,
  onReason,
}: {
  reason: SafetyEndedReasonFilter
  onReason: (v: SafetyEndedReasonFilter) => void
}) {
  const opts: { id: SafetyEndedReasonFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'auto_divergence', label: 'Auto · divergence' },
    { id: 'auto_idle', label: 'Auto · 8h idle' },
    { id: 'user_button', label: 'Safety button' },
    { id: 'manual', label: 'Manual end' },
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map((opt) => {
        const active = reason === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onReason(opt.id)}
            data-testid={`safety-ended-reason-${opt.id}`}
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

// ── Table ─────────────────────────────────────────────────────────────

function Table({ rows }: { rows: AdminSafetyEndedRow[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-surface text-[10px] uppercase tracking-wide text-text-secondary">
          <tr>
            <th className="px-4 py-2 text-left">Reason</th>
            <th className="px-4 py-2 text-left">Rider</th>
            <th className="px-4 py-2 text-left">Driver</th>
            <th className="px-4 py-2 text-left">Route</th>
            <th className="px-4 py-2 text-right">Fare</th>
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

function Row({ row }: { row: AdminSafetyEndedRow }) {
  return (
    <tr
      data-testid={`safety-ended-row-${row.id}`}
      className="border-t border-border hover:bg-surface/50 transition-colors align-top"
    >
      <td className="px-4 py-3">
        <ReasonBadge endReason={row.end_reason} />
        {row.warning_push_count != null && row.warning_push_count > 0 && (
          <div className="mt-1 text-[10px] text-text-secondary">
            {row.warning_push_count} warning push
            {row.warning_push_count === 1 ? '' : 'es'}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        {row.rider_id ? (
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
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {row.driver_id ? (
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
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/admin/rides/${row.id}`}
          className="block hover:text-primary"
        >
          <div className="text-text-primary text-xs truncate max-w-[260px]">
            {row.origin_name ?? '—'} → {row.destination_name ?? '—'}
          </div>
          {row.gps_distance_metres != null && (
            <div className="text-[10px] text-text-secondary mt-0.5">
              {(row.gps_distance_metres / 1000).toFixed(2)} km tracked
            </div>
          )}
        </Link>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="text-text-primary font-semibold">
          {fmtCents(row.fare_cents)}
        </div>
        <div className="text-[10px] text-text-secondary mt-0.5">
          {paymentStatusLabel(row.payment_status)}
        </div>
      </td>
      <td className="px-4 py-3 text-xs">
        <TimelineCell row={row} />
      </td>
    </tr>
  )
}

function TimelineCell({ row }: { row: AdminSafetyEndedRow }) {
  return (
    <div className="space-y-0.5">
      {row.ended_at && (
        <div className="text-text-secondary">
          <span className="text-[10px] uppercase tracking-wide">Ended</span>{' '}
          <span className="text-text-primary font-semibold">
            {fmtDateTime(row.ended_at)}
          </span>
        </div>
      )}
      {row.warning_fired_at && (
        <div className="text-text-secondary">
          <span className="text-[10px] uppercase tracking-wide">Warning fired</span>{' '}
          <span className="text-text-primary">{fmtTime(row.warning_fired_at)}</span>
        </div>
      )}
      {row.warning_responded_at && row.warning_responded_by && (
        <div className="text-text-secondary">
          <span className="text-[10px] uppercase tracking-wide">Responded</span>{' '}
          <span className="text-text-primary">
            {fmtTime(row.warning_responded_at)}
          </span>
          {' · '}
          <span className="text-primary font-semibold">
            {responseLabel(row.warning_responded_by, row.warning_responded_role)}
          </span>
        </div>
      )}
      {row.help_sms_sent_at && (
        <div className="text-warning">
          <span className="text-[10px] uppercase tracking-wide">SMS-help</span>{' '}
          <span className="font-semibold">{fmtTime(row.help_sms_sent_at)}</span>
        </div>
      )}
    </div>
  )
}

// ── Reason badge ──────────────────────────────────────────────────────

function ReasonBadge({ endReason }: { endReason: string | null }) {
  const cfg = reasonConfig(endReason)
  return (
    <span
      className={[
        'rounded-full text-[10px] font-bold uppercase tracking-wide px-2 py-0.5',
        cfg.bg,
        cfg.fg,
      ].join(' ')}
    >
      {cfg.label}
    </span>
  )
}

function reasonConfig(endReason: string | null): {
  label: string
  bg: string
  fg: string
} {
  switch (endReason) {
    case 'auto_divergence':
      return { label: 'Divergence', bg: 'bg-danger/15', fg: 'text-danger' }
    case 'auto_idle':
      return { label: '8h Idle', bg: 'bg-warning/15', fg: 'text-warning' }
    case 'rider_safety_button':
      return { label: 'Rider · got out', bg: 'bg-primary/15', fg: 'text-primary' }
    case 'driver_safety_button':
      return { label: 'Driver · got out', bg: 'bg-primary/15', fg: 'text-primary' }
    case 'manual_end':
      return { label: 'Manual', bg: 'bg-surface', fg: 'text-text-secondary' }
    default:
      return { label: endReason ?? 'Unknown', bg: 'bg-surface', fg: 'text-text-secondary' }
  }
}

// ── Pager + Loading + Empty + Error ──────────────────────────────────

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

function EmptyState({ reason }: { reason: SafetyEndedReasonFilter }) {
  // Honest copy — empty here usually means "the safety net hasn't
  // had to fire for this category yet" which is the good outcome.
  const copy =
    reason === 'all'
      ? 'No safety-ended rides on file. The Phase 3 safety net only writes a row when GPS diverges, 8h elapses, or a user taps a safety button. An empty queue means nothing has needed intervention.'
      : reason === 'auto_divergence'
        ? 'No rides have been auto-ended for GPS divergence. The cron only fires when rider and driver GPS separate >500m for 60s+ AND no one responds to the 90s overlay.'
        : reason === 'auto_idle'
          ? 'No rides have been auto-ended for hitting the 8-hour max-duration limit.'
          : reason === 'user_button'
            ? 'No rides have been ended via the in-app safety overlay buttons ("I got out" / "Rider got out").'
            : 'No rides have been ended via the manual escape-hatch button (Phase 3.4 — the radio-loss path).'
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
        : 'Couldn’t load safety-ended rides.'
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

// ── Formatters ────────────────────────────────────────────────────────

function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function paymentStatusLabel(status: string | null): string {
  switch (status) {
    case 'paid':       return 'Paid'
    case 'processing': return 'Charge processing'
    case 'pending':    return 'Payment pending'
    case 'failed':     return 'Payment failed'
    default:           return status ?? '—'
  }
}

/**
 * Friendly label for the `warning_responded_by` enum.
 * Adds the role suffix so admin can tell at a glance who tapped what.
 */
function responseLabel(action: string, role: string | null): string {
  switch (action) {
    case 'rider_in_car':   return 'Rider · still in car'
    case 'driver_in_car':  return 'Driver · still together'
    case 'rider_left':     return 'Rider · got out'
    case 'driver_left':    return 'Driver · rider got out'
    case 'help_requested':
      return role ? `Help requested (${role})` : 'Help requested'
    default: return action
  }
}
