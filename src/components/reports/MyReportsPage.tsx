import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMyReports, type ReportListItem } from '@/hooks/useReports'
import ReportFlowSheet from './ReportFlowSheet'
import {
  SEVERITY_LABEL,
  SEVERITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  findCategory,
} from './categoryConfig'

/**
 * 2026-05-20 — `/reports`. Surfaces every report the signed-in user
 * has filed (any context, any state) with a status pill so they can
 * see at a glance which threads are awaiting their reply vs. just
 * sitting in the admin queue. New report → opens the shared
 * ReportFlowSheet with `context='general'`.
 */
export default function MyReportsPage({
  'data-testid': testId = 'my-reports-page',
}: {
  'data-testid'?: string
}) {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const limit = 25
  const { data, isLoading, error } = useMyReports({ limit, offset: page * limit })
  const [sheetOpen, setSheetOpen] = useState(false)

  const reports = data?.reports ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div
      data-testid={testId}
      className="min-h-dvh w-full bg-surface font-sans"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 1.25rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)',
      }}
    >
      <div className="mx-auto flex max-w-3xl flex-col px-5 py-2">
        <button
          data-testid="back-button"
          onClick={() => navigate(-1)}
          className="self-start text-sm font-medium text-primary"
        >
          ← Back
        </button>

        <header className="mt-3 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">My reports</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Issues and feedback you've sent us.
            </p>
          </div>
          <button
            type="button"
            data-testid="new-report-button"
            onClick={() => setSheetOpen(true)}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark"
          >
            + New
          </button>
        </header>

        <div className="mt-6">
          {isLoading && !data && (
            <p data-testid="my-reports-loading" className="text-sm text-text-secondary">
              Loading…
            </p>
          )}
          {error && (
            <p data-testid="my-reports-error" className="text-sm text-danger">
              Couldn't load your reports — {(error as Error).message}
            </p>
          )}
          {data && reports.length === 0 && <EmptyState onNew={() => setSheetOpen(true)} />}
          {data && reports.length > 0 && (
            <ul className="flex flex-col gap-2" data-testid="my-reports-list">
              {reports.map((r) => (
                <ReportCard key={r.id} report={r} />
              ))}
            </ul>
          )}
        </div>

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between text-xs text-text-secondary">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-lg border border-border bg-white px-3 py-1.5 font-medium text-text-primary disabled:opacity-40"
            >
              ← Prev
            </button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 font-medium text-text-primary disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      <ReportFlowSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        context="general"
        data-testid="my-reports-new-sheet"
      />
    </div>
  )
}

function ReportCard({ report }: { report: ReportListItem }) {
  const cat = findCategory(report.category)
  return (
    <li>
      <Link
        to={`/reports/${report.id}`}
        data-testid={`report-row-${report.id}`}
        className="block rounded-2xl border border-border bg-white p-4 transition-colors hover:border-primary"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <SeverityPill severity={report.severity} />
              <StatusPill status={report.status} />
              <span className="text-[11px] uppercase tracking-wide text-text-secondary">
                {cat?.label ?? report.category}
              </span>
            </div>
            <p className="truncate text-sm font-semibold text-text-primary">
              {report.title}
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
              {report.body}
            </p>
          </div>
          <div className="shrink-0 text-right text-[11px] text-text-secondary">
            {formatTime(report.updated_at)}
          </div>
        </div>
      </Link>
    </li>
  )
}

function SeverityPill({ severity }: { severity: ReportListItem['severity'] }) {
  if (severity === 'low' || severity === 'normal') return null
  return (
    <span
      className={[
        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        SEVERITY_TONE[severity],
      ].join(' ')}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  )
}

function StatusPill({ status }: { status: ReportListItem['status'] }) {
  return (
    <span
      className={[
        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        STATUS_TONE[status],
      ].join(' ')}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div
      data-testid="my-reports-empty"
      className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-white px-6 py-10 text-center"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl text-primary">
        💬
      </div>
      <p className="text-sm font-semibold text-text-primary">No reports yet</p>
      <p className="mt-1 max-w-xs text-xs text-text-secondary">
        Hit a bug, have feedback, or had trouble with a ride? Let us know — we read everything.
      </p>
      <button
        type="button"
        onClick={onNew}
        className="mt-4 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white"
      >
        Report something
      </button>
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
