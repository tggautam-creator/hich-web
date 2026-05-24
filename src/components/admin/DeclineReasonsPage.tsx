import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAdminDeclineReasons,
  type AdminDeclineEvent,
  type AdminDeclineReasonRow,
  type DeclineWindow,
} from '@/hooks/useAdminDeclineReasons'
import { AdminApiException } from '@/lib/admin/api'

/**
 * 2026-05-23 — supply-side analytics page at /admin/decline-reasons.
 *
 * Renders a horizontal-bar histogram of the reasons drivers give
 * when they decline a ride request OR snooze the rider banner.
 * Pure read-only. Useful for spotting matching-algorithm gaps:
 * "Too far" dominating → distance gate too loose; "Wrong route" →
 * board fit issue; "Notification: Snooze" dominating → drivers
 * are dodging rather than declining outright.
 *
 * The "bars" are pure-CSS width % — no chart library needed.
 * Sub-bars overlay to show snooze breakdown within each reason
 * (light overlay on the right edge = "of these, N were snoozes").
 */

const WINDOWS: { id: DeclineWindow; label: string }[] = [
  { id: '24h', label: 'Last 24h' },
  { id: '7d', label: 'Last 7d' },
  { id: '30d', label: 'Last 30d' },
  { id: 'all', label: 'All time' },
]

export default function DeclineReasonsPage() {
  const [window, setWindow] = useState<DeclineWindow>('7d')
  const query = useAdminDeclineReasons({ window })
  const data = query.data
  const rows = data?.rows ?? []
  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1

  return (
    <div className="space-y-5" data-testid="admin-decline-reasons">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Driver decline reasons
          </h1>
          <p className="text-sm text-text-secondary max-w-2xl">
            What drivers said when they declined a ride request or snoozed
            the banner. Dominant reasons usually point at a matching-algorithm
            gap.
          </p>
        </div>
        <WindowChips window={window} onWindow={setWindow} />
      </header>

      {data && (
        <div className="flex flex-wrap gap-4 text-xs">
          <Kpi label="Total declines" value={data.total_declines.toLocaleString()} />
          <Kpi
            label="Of which snoozes"
            value={`${data.total_snoozes.toLocaleString()} (${pct(
              data.total_snoozes,
              data.total_declines,
            )})`}
          />
          <Kpi
            label="Distinct reasons"
            value={rows.length.toLocaleString()}
          />
        </div>
      )}

      {query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading && rows.length === 0 ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState window={window} />
      ) : (
        <>
          <Histogram rows={rows} maxCount={maxCount} />
          {data && data.events.length > 0 && (
            <ActivityLog
              events={data.events}
              truncated={data.events_truncated}
            />
          )}
        </>
      )}
    </div>
  )
}

/**
 * 2026-05-23 — per-event detail. The histogram tells you WHAT
 * reasons dominate; this table tells you WHO was involved, WHEN,
 * and (when the decline was on a board ride) where they were
 * supposed to be going. Capped at 200 events server-side; if
 * truncated, narrow the window to see more recent slices.
 */
function ActivityLog({
  events,
  truncated,
}: {
  events: AdminDeclineEvent[]
  truncated: boolean
}) {
  return (
    <div className="space-y-2" data-testid="decline-activity-log">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-text-primary">
          Activity log · {events.length}
          {truncated && (
            <span className="ml-2 text-xs font-normal text-warning">
              (capped at 200 — narrow the window to see more)
            </span>
          )}
        </h2>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[10px] uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Driver</th>
              <th className="px-3 py-2 text-left">Rider / ride</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="px-3 py-2 text-right">Snooze</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EventRow({ event: e }: { event: AdminDeclineEvent }) {
  return (
    <tr
      data-testid={`decline-event-${e.id}`}
      className="border-t border-border hover:bg-surface/50"
    >
      <td className="px-3 py-2 text-xs text-text-secondary whitespace-nowrap">
        {fmtRelative(e.created_at)}
        <div className="text-[10px] text-text-secondary/70">
          {fmtAbsolute(e.created_at)}
        </div>
      </td>
      <td className="px-3 py-2 text-xs">
        <Link
          to={`/admin/users/${e.driver_id}`}
          className="text-text-primary hover:text-primary"
        >
          <div className="font-medium truncate max-w-[160px]">
            {e.driver_name ?? e.driver_email ?? '—'}
          </div>
          {e.driver_email && e.driver_name && (
            <div className="text-[10px] text-text-secondary truncate max-w-[160px]">
              {e.driver_email}
            </div>
          )}
        </Link>
      </td>
      <td className="px-3 py-2 text-xs">
        {e.ride_id ? (
          <Link
            to={`/admin/rides/${e.ride_id}`}
            className="block hover:text-primary"
          >
            <div className="font-medium text-text-primary truncate max-w-[180px]">
              {e.rider_name ?? e.rider_email ?? '(unknown rider)'}
            </div>
            <div className="text-[10px] text-text-secondary truncate max-w-[180px]">
              {e.ride_origin_name ?? '—'} → {e.ride_destination_name ?? '—'}
            </div>
            {e.ride_fare_cents != null && e.ride_fare_cents > 0 && (
              <div className="text-[10px] text-text-secondary">
                ${(e.ride_fare_cents / 100).toFixed(2)}
                {e.ride_status && (
                  <span className="text-text-secondary/70"> · {e.ride_status}</span>
                )}
              </div>
            )}
          </Link>
        ) : (
          <span className="text-text-secondary italic">
            Instant request (no ride row)
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-text-primary">
        <span className="rounded bg-surface border border-border px-1.5 py-0.5 font-medium">
          {e.reason}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-right">
        {e.snooze_minutes != null && e.snooze_minutes > 0 ? (
          <span
            className={[
              'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
              e.snooze_minutes >= 60
                ? 'bg-warning/15 text-warning'
                : 'bg-surface text-text-secondary',
            ].join(' ')}
          >
            {fmtSnoozeMinutes(e.snooze_minutes)}
          </span>
        ) : (
          <span className="text-text-secondary text-[10px]">—</span>
        )}
      </td>
    </tr>
  )
}

function fmtSnoozeMinutes(n: number): string {
  if (n >= 60) {
    const hours = Math.round((n / 60) * 10) / 10
    return `${hours}h`
  }
  return `${n}m`
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return iso
  if (ms < 60_000) return 'just now'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.round(hr / 24)
  return `${d}d ago`
}

function fmtAbsolute(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function WindowChips({
  window,
  onWindow,
}: {
  window: DeclineWindow
  onWindow: (v: DeclineWindow) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {WINDOWS.map((w) => {
        const active = window === w.id
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => onWindow(w.id)}
            data-testid={`decline-window-${w.id}`}
            className={[
              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              active
                ? 'bg-primary text-white'
                : 'bg-surface text-text-secondary hover:bg-border',
            ].join(' ')}
          >
            {w.label}
          </button>
        )
      })}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-text-secondary">
        {label}
      </div>
      <div className="text-sm font-bold text-text-primary">{value}</div>
    </div>
  )
}

function Histogram({
  rows,
  maxCount,
}: {
  rows: AdminDeclineReasonRow[]
  maxCount: number
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-white"
      data-testid="decline-histogram"
    >
      <ul>
        {rows.map((row) => (
          <Bar key={row.reason} row={row} maxCount={maxCount} />
        ))}
      </ul>
    </div>
  )
}

function Bar({
  row,
  maxCount,
}: {
  row: AdminDeclineReasonRow
  maxCount: number
}) {
  const widthPct = Math.max(1, Math.round((row.count / maxCount) * 100))
  // Snooze-as-share-of-this-reason — overlay narrower bar inside.
  const snoozeWithinPct = row.count > 0
    ? Math.round((row.snooze_count / row.count) * widthPct)
    : 0
  return (
    <li
      data-testid={`decline-bar-${slugify(row.reason)}`}
      className="border-b border-border last:border-b-0 px-4 py-3"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-text-primary truncate" title={row.reason}>
          {row.reason}
        </span>
        <span className="font-mono text-text-secondary shrink-0">
          {row.count.toLocaleString()}
          {row.snooze_count > 0 && (
            <span className="text-[10px] text-warning ml-2">
              · {row.snooze_count} snooze
              {row.snooze_count === 1 ? '' : 's'}
              {row.snooze_long_count > 0 && (
                <span className="text-text-secondary/70">
                  {' '}({row.snooze_long_count} ≥ 1h)
                </span>
              )}
            </span>
          )}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-surface overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-primary/70"
          style={{ width: `${widthPct}%` }}
          aria-hidden="true"
        />
        {snoozeWithinPct > 0 && (
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-warning/80"
            style={{ width: `${snoozeWithinPct}%` }}
            aria-hidden="true"
          />
        )}
      </div>
    </li>
  )
}

function Loading() {
  return (
    <div className="rounded-2xl border border-border bg-white p-6 text-center text-sm text-text-secondary">
      Loading…
    </div>
  )
}

function EmptyState({ window }: { window: DeclineWindow }) {
  const copy =
    window === '24h'
      ? 'No declines in the last 24 hours. Either supply has been keeping up, or no rides were declined.'
      : window === 'all'
        ? 'driver_decline_reasons is empty. No driver has declined a ride yet (rare — usually means the table predates declines being logged).'
        : `No declines in this window. Try a wider window above.`
  return (
    <div className="rounded-2xl border border-border bg-white p-8 text-center">
      <p className="text-sm font-semibold text-text-primary">Nothing to chart.</p>
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
        : 'Couldn’t load decline reasons.'
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

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

/**
 * URL-safe slug from an arbitrary reason string. Used for the
 * data-testid attribute on each bar so e2e tests can target a
 * specific reason without escaping unicode.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
