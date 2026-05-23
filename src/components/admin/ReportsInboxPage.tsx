import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAdminReportInbox,
  type AdminReportInboxRow,
  type AdminReportSeverity,
  type AdminReportStatus,
  type InboxHasRefund,
  type InboxSeverityFilter,
  type InboxSort,
  type InboxStatusFilter,
} from '@/hooks/useAdminReports'
import { AdminApiException } from '@/lib/admin/api'
import { trackEvent } from '@/lib/analytics'
import InfoTooltip from './InfoTooltip'

/**
 * 2026-05-22 — Phase 3a of docs/REPORTS_PLAN.md. Admin inbox for
 * the in-app reporting system at `/admin/reports`. Counter header
 * + filter chips + sort dropdown + paginated table.
 *
 * Severity-first sort by default (the most-useful triage view —
 * emergencies float regardless of recency). Auto-refresh every 30s
 * matches the alerts page cadence.
 */

const CATEGORY_LABEL: Record<string, string> = {
  driver_conduct: 'Driver conduct',
  rider_conduct: 'Rider conduct',
  vehicle_condition: 'Vehicle condition',
  route_issue: 'Route problem',
  fare_dispute: 'Fare dispute',
  payment_issue: 'Payment issue',
  pickup_dropoff: 'Pickup / dropoff',
  lost_item: 'Lost item',
  cancellation_dispute: 'Cancellation dispute',
  safety_during_ride: 'Safety during ride',
  bug_report: 'Bug report',
  account_issue: 'Account issue',
  harassment_messages: 'Harassment via messages',
  feedback_feature: 'Feedback / feature request',
}

const SEVERITY_LABEL: Record<AdminReportSeverity, string> = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  normal: 'Normal',
  low: 'Low',
}
const SEVERITY_TONE: Record<AdminReportSeverity, string> = {
  emergency: 'bg-danger text-white',
  urgent: 'bg-warning/15 text-warning',
  normal: 'bg-surface text-text-secondary',
  low: 'bg-surface text-text-secondary',
}
const STATUS_LABEL: Record<AdminReportStatus, string> = {
  open: 'Open',
  in_progress: 'In review',
  awaiting_user: 'Waiting on user',
  resolved: 'Resolved',
  closed: 'Closed',
}
const STATUS_TONE: Record<AdminReportStatus, string> = {
  open: 'bg-primary-light text-primary',
  in_progress: 'bg-primary-light text-primary',
  awaiting_user: 'bg-warning/15 text-warning',
  resolved: 'bg-success/15 text-success',
  closed: 'bg-surface text-text-secondary',
}

const STATUS_OPTIONS: { value: InboxStatusFilter; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In review' },
  { value: 'awaiting_user', label: 'Waiting on user' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
]
const SEVERITY_OPTIONS: { value: InboxSeverityFilter; label: string }[] = [
  { value: '', label: 'All severities' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]
const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All categories' },
  ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
]
const HAS_REFUND_OPTIONS: { value: InboxHasRefund; label: string }[] = [
  { value: '', label: 'Any refund state' },
  { value: 'yes', label: 'Has refund request' },
  { value: 'no', label: 'No refund request' },
]
const SORT_OPTIONS: { value: InboxSort; label: string }[] = [
  { value: 'severity_first', label: 'Severity first' },
  { value: 'awaiting', label: 'Waiting on user first' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

const LIMIT = 25

export default function ReportsInboxPage() {
  const [status, setStatus] = useState<InboxStatusFilter>('')
  const [severity, setSeverity] = useState<InboxSeverityFilter>('')
  const [category, setCategory] = useState<string>('')
  const [hasRefund, setHasRefund] = useState<InboxHasRefund>('')
  const [myQueue, setMyQueue] = useState<boolean>(false)
  const [sort, setSort] = useState<InboxSort>('severity_first')
  const [page, setPage] = useState(0)

  useEffect(() => {
    trackEvent('admin_reports_inbox_loaded')
  }, [])

  const { data, isLoading, error } = useAdminReportInbox({
    status,
    severity,
    category,
    hasRefund,
    myQueue,
    sort,
    limit: LIMIT,
    offset: page * LIMIT,
  })

  const counts = data?.counts ?? { open: 0, urgent: 0, emergency: 0 }

  return (
    <div data-testid="reports-inbox" className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Reports</h1>
          <p className="mt-1 text-xs text-text-secondary">
            In-app issue + feedback inbox. Severity-first by default so
            emergencies stay on top.
          </p>
        </div>
        <InboxCounter counts={counts} />
      </div>

      <FilterBar
        status={status}
        setStatus={setStatus}
        severity={severity}
        setSeverity={setSeverity}
        category={category}
        setCategory={setCategory}
        hasRefund={hasRefund}
        setHasRefund={setHasRefund}
        myQueue={myQueue}
        setMyQueue={setMyQueue}
        sort={sort}
        setSort={setSort}
        onReset={() => {
          setStatus('')
          setSeverity('')
          setCategory('')
          setHasRefund('')
          setMyQueue(false)
          setSort('severity_first')
          setPage(0)
        }}
      />

      {isLoading && !data && (
        <p data-testid="reports-inbox-loading" className="text-sm text-text-secondary">
          Loading…
        </p>
      )}
      {error && (
        <div
          data-testid="reports-inbox-error"
          className="rounded-2xl border border-danger bg-white p-5 text-sm text-danger"
        >
          Failed to load reports —{' '}
          {error instanceof AdminApiException
            ? `${error.code}: ${error.message}`
            : (error as Error).message}
        </div>
      )}

      {data && data.reports.length === 0 && (
        <EmptyState
          hasFilters={
            !!(status || severity || category || hasRefund || myQueue)
          }
        />
      )}

      {data && data.reports.length > 0 && (
        <>
          <Table reports={data.reports} />
          <Pagination
            page={page}
            total={data.total}
            limit={LIMIT}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
        </>
      )}
    </div>
  )
}

// ── Counter header ─────────────────────────────────────────────────

function InboxCounter({
  counts,
}: {
  counts: { open: number; urgent: number; emergency: number }
}) {
  return (
    <div
      data-testid="reports-counter"
      className="flex items-center gap-3 rounded-2xl border border-border bg-white px-4 py-2"
    >
      <Stat label="Open" value={counts.open} />
      <span className="text-text-secondary">·</span>
      <Stat label="Urgent" value={counts.urgent} tone="warning" />
      <span className="text-text-secondary">·</span>
      <Stat
        label="Emergency"
        value={counts.emergency}
        tone="danger"
        pulse={counts.emergency > 0}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  pulse,
}: {
  label: string
  value: number
  tone?: 'warning' | 'danger'
  pulse?: boolean
}) {
  const valueTone =
    tone === 'danger' && value > 0
      ? 'text-danger'
      : tone === 'warning' && value > 0
        ? 'text-warning'
        : 'text-text-primary'
  return (
    <div className="flex items-baseline gap-1">
      <span
        className={[
          'text-base font-bold tabular-nums',
          valueTone,
          pulse ? 'animate-pulse' : '',
        ].join(' ')}
      >
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wide font-semibold text-text-secondary">
        {label}
      </span>
    </div>
  )
}

// ── Filter bar ─────────────────────────────────────────────────────

function FilterBar(props: {
  status: InboxStatusFilter
  setStatus: (v: InboxStatusFilter) => void
  severity: InboxSeverityFilter
  setSeverity: (v: InboxSeverityFilter) => void
  category: string
  setCategory: (v: string) => void
  hasRefund: InboxHasRefund
  setHasRefund: (v: InboxHasRefund) => void
  myQueue: boolean
  setMyQueue: (v: boolean) => void
  sort: InboxSort
  setSort: (v: InboxSort) => void
  onReset: () => void
}) {
  return (
    <div
      data-testid="reports-filters"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-white p-4"
    >
      <Select
        testid="filter-status"
        value={props.status}
        onChange={(v) => props.setStatus(v as InboxStatusFilter)}
        options={STATUS_OPTIONS}
      />
      <Select
        testid="filter-severity"
        value={props.severity}
        onChange={(v) => props.setSeverity(v as InboxSeverityFilter)}
        options={SEVERITY_OPTIONS}
      />
      <Select
        testid="filter-category"
        value={props.category}
        onChange={(v) => props.setCategory(v)}
        options={CATEGORY_OPTIONS}
      />
      <Select
        testid="filter-refund"
        value={props.hasRefund}
        onChange={(v) => props.setHasRefund(v as InboxHasRefund)}
        options={HAS_REFUND_OPTIONS}
      />
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          data-testid="filter-my-queue"
          type="checkbox"
          checked={props.myQueue}
          onChange={(e) => props.setMyQueue(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border accent-primary"
        />
        My queue
        <InfoTooltip
          text="Only show reports assigned to you. Assignment lands in Phase 3c — until then this filter will return zero rows."
          align="left"
        />
      </label>
      <div className="ml-auto flex items-center gap-2">
        <label className="text-[11px] uppercase tracking-wide font-semibold text-text-secondary">
          Sort
        </label>
        <Select
          testid="filter-sort"
          value={props.sort}
          onChange={(v) => props.setSort(v as InboxSort)}
          options={SORT_OPTIONS}
        />
        <button
          type="button"
          data-testid="filter-reset"
          onClick={props.onReset}
          className="rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface"
        >
          Reset
        </button>
      </div>
    </div>
  )
}

function Select({
  testid,
  value,
  onChange,
  options,
}: {
  testid: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ── Table ──────────────────────────────────────────────────────────

function Table({ reports }: { reports: AdminReportInboxRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-text-secondary">
            <th className="px-4 py-2.5">Severity</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Reporter</th>
            <th className="px-4 py-2.5">Title / Preview</th>
            <th className="px-4 py-2.5">Category</th>
            <th className="px-4 py-2.5 text-right">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {reports.map((r) => (
            <Row key={r.id} report={r} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({ report }: { report: AdminReportInboxRow }) {
  const reporterDisplay =
    report.reporter_name || report.reporter_email || report.reporter_id.slice(0, 8)
  return (
    <tr
      data-testid={`report-row-${report.id}`}
      className="cursor-pointer hover:bg-surface"
    >
      <td className="px-4 py-3">
        <Link to={`/admin/reports/${report.id}`} className="block">
          <span
            className={[
              'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              SEVERITY_TONE[report.severity],
            ].join(' ')}
          >
            {SEVERITY_LABEL[report.severity]}
          </span>
        </Link>
      </td>
      <td className="px-4 py-3">
        <Link to={`/admin/reports/${report.id}`} className="block">
          <span
            className={[
              'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              STATUS_TONE[report.status],
            ].join(' ')}
          >
            {STATUS_LABEL[report.status]}
          </span>
        </Link>
      </td>
      <td className="px-4 py-3">
        <Link to={`/admin/reports/${report.id}`} className="block">
          <div className="text-text-primary text-sm font-medium truncate">
            {reporterDisplay}
          </div>
          {report.reporter_email && report.reporter_name && (
            <div className="text-[11px] text-text-secondary truncate">
              {report.reporter_email}
            </div>
          )}
        </Link>
      </td>
      <td className="px-4 py-3 max-w-md">
        <Link to={`/admin/reports/${report.id}`} className="block">
          <div className="text-sm font-semibold text-text-primary truncate">
            {report.title}
          </div>
          <div className="text-xs text-text-secondary line-clamp-1">
            {report.body_preview}
          </div>
        </Link>
      </td>
      <td className="px-4 py-3">
        <Link to={`/admin/reports/${report.id}`} className="block">
          <span className="text-xs text-text-secondary">
            {CATEGORY_LABEL[report.category] ?? report.category}
          </span>
          {report.requested_refund_cents != null && (
            <span className="ml-1.5 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-warning">
              refund
            </span>
          )}
        </Link>
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap text-xs text-text-secondary">
        <Link to={`/admin/reports/${report.id}`} className="block">
          {formatTimeAgo(report.updated_at)}
        </Link>
      </td>
    </tr>
  )
}

// ── Empty + Pagination ─────────────────────────────────────────────

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div
      data-testid="reports-inbox-empty"
      className="rounded-2xl border border-border bg-white p-10 text-center"
    >
      <p className="text-sm font-semibold text-text-primary">
        {hasFilters ? 'No reports match those filters.' : 'No reports yet.'}
      </p>
      <p className="mt-1 text-xs text-text-secondary">
        {hasFilters
          ? 'Try the Reset button to see the full list.'
          : 'When a user submits a report from the app, it lands here.'}
      </p>
    </div>
  )
}

function Pagination({
  page,
  total,
  limit,
  onPrev,
  onNext,
}: {
  page: number
  total: number
  limit: number
  onPrev: () => void
  onNext: () => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  if (total <= limit) return null
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        disabled={page === 0}
        onClick={onPrev}
        className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-text-primary disabled:opacity-40 hover:bg-surface"
      >
        ← Previous
      </button>
      <span className="text-xs text-text-secondary">
        Page {page + 1} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page + 1 >= totalPages}
        onClick={onNext}
        className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-text-primary disabled:opacity-40 hover:bg-surface"
      >
        Next →
      </button>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
