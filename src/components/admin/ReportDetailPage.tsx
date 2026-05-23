import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useAdminReportDetail,
  useAdminPostReportMessage,
  useAdminChangeReportStatus,
  useAdminChangeReportSeverity,
  useAdminReportAudit,
  type AdminReport,
  type AdminReportMessage,
  type AdminReportUser,
  type AdminReportRideSnapshot,
  type AdminReportAuditRow,
  type AdminReportSeverity,
  type AdminReportStatus,
} from '@/hooks/useAdminReports'
import { AdminApiException } from '@/lib/admin/api'
import { trackEvent } from '@/lib/analytics'
import InfoTooltip from './InfoTooltip'

/**
 * 2026-05-22 — Phase 3b of docs/REPORTS_PLAN.md. Admin-side
 * detail view for a single in-app report. Three columns:
 *
 *   Left  — Context (reporter card, subject user card, ride
 *           snapshot, GPS pin link, app version, attachments)
 *   Center — Thread (chronological mix of user messages, admin
 *           replies, and internal admin notes with yellow
 *           background)
 *   Right — Actions panel (Phase 3c will fill this in — status /
 *           severity / refund / suspend / internal note). Today
 *           it's a placeholder + the visible-reply compose box.
 *
 * The Slack alert "Open in admin" deep-link points at this URL,
 * so the moment this page renders the alert button starts
 * working end-to-end.
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

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading, error } = useAdminReportDetail(id)

  useEffect(() => {
    if (id) trackEvent('admin_report_detail_loaded', { report_id: id })
  }, [id])

  if (isLoading && !data) {
    return (
      <div
        data-testid="report-detail-loading"
        className="flex h-64 items-center justify-center text-sm text-text-secondary"
      >
        Loading report…
      </div>
    )
  }

  if (error) {
    const msg =
      error instanceof AdminApiException
        ? `${error.code}: ${error.message}`
        : (error as Error).message
    return (
      <div
        data-testid="report-detail-error"
        className="rounded-2xl border border-danger bg-white p-5 text-sm text-danger"
      >
        Failed to load report — {msg}
      </div>
    )
  }

  if (!data) return null

  return (
    <div data-testid="report-detail" className="space-y-6">
      <Link
        to="/admin"
        className="inline-block text-xs text-text-secondary hover:text-text-primary"
      >
        ← Admin home
      </Link>

      <Header report={data.report} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr_300px]">
        <ContextColumn
          report={data.report}
          reporter={data.reporter}
          subjectUser={data.subject_user}
          ride={data.ride}
          attachments={data.attachments.length}
        />
        <ThreadColumn
          reportId={data.report.id}
          messages={data.messages}
        />
        <ActionsColumn
          report={data.report}
          reporter={data.reporter}
          subjectUser={data.subject_user}
          ride={data.ride}
        />
      </div>
    </div>
  )
}

// ── Header ──────────────────────────────────────────────────────────

function Header({ report }: { report: AdminReport }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityPill severity={report.severity} />
        <StatusPill status={report.status} />
        <span className="text-[11px] uppercase tracking-wide text-text-secondary">
          {CATEGORY_LABEL[report.category] ?? report.category}
        </span>
      </div>
      <h1 className="mt-2 text-xl font-bold text-text-primary">{report.title}</h1>
      <p className="mt-2 whitespace-pre-wrap text-sm text-text-primary">{report.body}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
        <span>Filed {fmtDateTime(report.created_at)}</span>
        {report.updated_at !== report.created_at && (
          <span>· Updated {fmtDateTime(report.updated_at)}</span>
        )}
        {report.requested_refund_cents != null && (
          <span>
            · Refund requested: {fmtCents(report.requested_refund_cents)}
          </span>
        )}
        {report.ride_state_at_report && (
          <span>· Ride was {report.ride_state_at_report} at report time</span>
        )}
      </div>
    </div>
  )
}

// ── Context (left column) ───────────────────────────────────────────

function ContextColumn({
  report,
  reporter,
  subjectUser,
  ride,
  attachments,
}: {
  report: AdminReport
  reporter: AdminReportUser | null
  subjectUser: AdminReportUser | null
  ride: AdminReportRideSnapshot | null
  attachments: number
}) {
  return (
    <div className="space-y-4">
      <Card title="Reporter" testid="report-reporter">
        {reporter ? <UserMiniCard user={reporter} /> : <NeutralRow text="Unknown reporter" />}
      </Card>

      {subjectUser && (
        <Card title="Subject user" testid="report-subject">
          <UserMiniCard user={subjectUser} />
        </Card>
      )}

      {ride && (
        <Card title="Ride snapshot" testid="report-ride">
          <RideMiniCard ride={ride} />
        </Card>
      )}

      <Card title="Client context" testid="report-client">
        <ClientContext metadata={report.metadata} />
      </Card>

      <Card title={`Attachments · ${attachments}`} testid="report-attachments">
        {attachments === 0 ? (
          <NeutralRow text="No attachments." />
        ) : (
          <p className="text-xs text-text-secondary">
            {attachments} file{attachments === 1 ? '' : 's'} on storage. Inline preview lands in a follow-up.
          </p>
        )}
      </Card>
    </div>
  )
}

function UserMiniCard({ user }: { user: AdminReportUser }) {
  return (
    <Link
      to={`/admin/users/${user.id}`}
      className="block rounded-xl border border-border bg-surface p-3 transition-colors hover:border-primary hover:bg-primary/5"
    >
      <div className="flex items-center gap-3">
        <Avatar url={user.avatar_url} fallback={initialsFor(user)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text-primary">
            {user.full_name ?? '(no name)'}
          </p>
          <p className="truncate text-xs text-text-secondary">{user.email}</p>
          <div className="mt-1 flex gap-1 text-[10px] uppercase tracking-wide font-semibold">
            <span className="rounded bg-white px-1.5 py-0.5 text-text-secondary border border-border">
              {user.is_driver ? 'driver' : 'rider'}
            </span>
            {user.suspended_at && (
              <span className="rounded bg-danger/10 px-1.5 py-0.5 text-danger">
                suspended
              </span>
            )}
          </div>
        </div>
        <span className="text-text-secondary">›</span>
      </div>
    </Link>
  )
}

function RideMiniCard({ ride }: { ride: AdminReportRideSnapshot }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-[11px] font-mono text-text-secondary truncate">
        {ride.id}
      </div>
      <div className="mt-1.5 grid grid-cols-[80px_1fr] gap-y-1 text-xs">
        <span className="text-text-secondary">Status</span>
        <span className="text-text-primary">{ride.status}</span>
        {ride.fare_cents != null && (
          <>
            <span className="text-text-secondary">Fare</span>
            <span className="text-text-primary">{fmtCents(ride.fare_cents)}</span>
          </>
        )}
        {ride.payment_status && (
          <>
            <span className="text-text-secondary">Payment</span>
            <span className="text-text-primary">{ride.payment_status}</span>
          </>
        )}
        {ride.origin_name && (
          <>
            <span className="text-text-secondary">From</span>
            <span className="text-text-primary truncate">{ride.origin_name}</span>
          </>
        )}
        {ride.destination_name && (
          <>
            <span className="text-text-secondary">To</span>
            <span className="text-text-primary truncate">{ride.destination_name}</span>
          </>
        )}
      </div>
    </div>
  )
}

function ClientContext({ metadata }: { metadata: Record<string, unknown> }) {
  const lat = typeof metadata['gps_lat'] === 'number' ? (metadata['gps_lat'] as number) : null
  const lng = typeof metadata['gps_lng'] === 'number' ? (metadata['gps_lng'] as number) : null
  const platform = typeof metadata['platform'] === 'string' ? (metadata['platform'] as string) : null
  const appVersion = typeof metadata['app_version'] === 'string' ? (metadata['app_version'] as string) : null
  const plate = typeof metadata['plate'] === 'string' ? (metadata['plate'] as string) : null

  if (!lat && !lng && !platform && !appVersion && !plate) {
    return <NeutralRow text="No client metadata captured." />
  }
  return (
    <div className="grid grid-cols-[80px_1fr] gap-y-1 text-xs">
      {platform && (
        <>
          <span className="text-text-secondary">Platform</span>
          <span className="text-text-primary">{platform}</span>
        </>
      )}
      {appVersion && (
        <>
          <span className="text-text-secondary">App version</span>
          <span className="text-text-primary font-mono text-[11px]">{appVersion}</span>
        </>
      )}
      {plate && (
        <>
          <span className="text-text-secondary">Plate</span>
          <span className="text-text-primary font-mono text-[11px]">{plate}</span>
        </>
      )}
      {lat != null && lng != null && (
        <>
          <span className="text-text-secondary">GPS</span>
          <a
            href={`https://www.google.com/maps?q=${lat},${lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {lat.toFixed(4)}, {lng.toFixed(4)} ↗
          </a>
        </>
      )}
    </div>
  )
}

// ── Thread (center column) ──────────────────────────────────────────

function ThreadColumn({
  reportId,
  messages,
}: {
  reportId: string
  messages: AdminReportMessage[]
}) {
  return (
    <div className="space-y-4">
      <Card title="Thread" testid="report-thread">
        {messages.length === 0 ? (
          <NeutralRow text="No messages yet. Use the compose box to send the first reply." />
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </ul>
        )}
      </Card>

      <ComposeBox reportId={reportId} />
    </div>
  )
}

function MessageBubble({ message }: { message: AdminReportMessage }) {
  if (message.is_internal_note) {
    return <InternalNoteBubble message={message} />
  }
  const isAdmin = message.author_role === 'admin'
  return (
    <li
      data-testid={`thread-msg-${message.id}`}
      className={['flex', isAdmin ? 'justify-end' : 'justify-start'].join(' ')}
    >
      <div
        className={[
          'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
          isAdmin
            ? 'rounded-br-md bg-primary text-white'
            : 'rounded-bl-md bg-surface text-text-primary',
        ].join(' ')}
      >
        <p
          className={[
            'mb-0.5 text-[10px] uppercase tracking-wide font-semibold',
            isAdmin ? 'text-white/70' : 'text-text-secondary',
          ].join(' ')}
        >
          {isAdmin ? `Admin · ${message.channel}` : 'User'}
        </p>
        <p className="whitespace-pre-wrap">{message.body}</p>
        <p
          className={[
            'mt-1 text-[10px]',
            isAdmin ? 'text-white/60' : 'text-text-secondary',
          ].join(' ')}
        >
          {fmtDateTime(message.created_at)}
        </p>
      </div>
    </li>
  )
}

function InternalNoteBubble({ message }: { message: AdminReportMessage }) {
  return (
    <li
      data-testid={`thread-note-${message.id}`}
      className="rounded-2xl border border-warning/40 bg-warning/10 p-3"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
        <span>🔒 Internal note</span>
        <span className="text-warning/70">· not visible to reporter</span>
      </div>
      <p className="whitespace-pre-wrap text-xs text-text-primary">{message.body}</p>
      <p className="mt-1 text-[10px] text-text-secondary">{fmtDateTime(message.created_at)}</p>
    </li>
  )
}

function ComposeBox({ reportId }: { reportId: string }) {
  const [draft, setDraft] = useState('')
  const [internalNote, setInternalNote] = useState(false)
  const m = useAdminPostReportMessage(reportId)

  const canSend = draft.trim().length > 0 && !m.isPending

  function handleSubmit() {
    if (!canSend) return
    m.mutate(
      { body: draft.trim(), is_internal_note: internalNote },
      {
        onSuccess: () => {
          setDraft('')
          setInternalNote(false)
        },
      },
    )
  }

  return (
    <div
      className="rounded-2xl border border-border bg-white p-4"
      data-testid="report-compose"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-text-primary">
          {internalNote ? 'Internal note' : 'Reply to user'}
        </h3>
        <InfoTooltip
          text="Replies are visible to the reporter in their My Reports view. Internal notes are admin-only — the user never sees them. Use notes for triage context like 'linked to refund tx_xyz' or 'flagged duplicate of report #...'"
          align="left"
        />
      </div>
      <textarea
        data-testid="report-compose-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        maxLength={5000}
        placeholder={
          internalNote
            ? 'Add an internal note (admins only)…'
            : 'Reply to the reporter…'
        }
        className="mt-3 w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
      />
      {m.isError && (
        <p
          data-testid="report-compose-error"
          className="mt-1 text-xs text-danger"
          role="alert"
        >
          {m.error instanceof AdminApiException
            ? `${m.error.code}: ${m.error.message}`
            : m.error.message}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            data-testid="report-compose-internal-toggle"
            type="checkbox"
            checked={internalNote}
            onChange={(e) => setInternalNote(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          Mark as internal note (hidden from user)
        </label>
        <button
          type="button"
          data-testid="report-compose-submit"
          onClick={handleSubmit}
          disabled={!canSend}
          className={[
            'rounded-full px-4 py-1.5 text-xs font-semibold transition-colors',
            canSend
              ? internalNote
                ? 'bg-warning text-white hover:opacity-90'
                : 'bg-primary text-white hover:bg-primary-dark'
              : 'bg-border text-text-secondary cursor-not-allowed',
          ].join(' ')}
        >
          {m.isPending ? 'Sending…' : internalNote ? 'Save note' : 'Send reply'}
        </button>
      </div>
    </div>
  )
}

// ── Actions panel (right column, Phase 3c) ─────────────────────────

function ActionsColumn({
  report,
  reporter,
  subjectUser,
  ride,
}: {
  report: AdminReport
  reporter: AdminReportUser | null
  subjectUser: AdminReportUser | null
  ride: AdminReportRideSnapshot | null
}) {
  return (
    <div className="space-y-4">
      <StatusCard report={report} />
      <SeverityCard report={report} />
      <CrossLinksCard
        reporter={reporter}
        subjectUser={subjectUser}
        ride={ride}
      />
      <AuditCard reportId={report.id} />
    </div>
  )
}

function StatusCard({ report }: { report: AdminReport }) {
  const [showConfirm, setShowConfirm] = useState<AdminReportStatus | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')
  const m = useAdminChangeReportStatus(report.id)

  function handlePick(next: AdminReportStatus) {
    if (next === report.status) return
    // Resolution states get a confirm modal + optional note. Other
    // flips are immediate (admin can hit them in one tap during
    // triage).
    if (next === 'resolved' || next === 'closed') {
      setShowConfirm(next)
      return
    }
    m.mutate({ status: next })
  }

  function handleConfirm() {
    if (!showConfirm) return
    m.mutate(
      {
        status: showConfirm,
        resolution_note: resolutionNote.trim() || undefined,
      },
      {
        onSuccess: () => {
          setShowConfirm(null)
          setResolutionNote('')
        },
      },
    )
  }

  return (
    <>
      <Card title="Status" testid="report-actions-status">
        <div className="grid grid-cols-2 gap-2">
          {(
            ['open', 'in_progress', 'awaiting_user', 'resolved', 'closed'] as AdminReportStatus[]
          ).map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`action-status-${s}`}
              disabled={m.isPending || s === report.status}
              onClick={() => handlePick(s)}
              className={[
                'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                s === report.status
                  ? 'border-primary bg-primary-light text-primary cursor-default'
                  : 'border-border bg-white text-text-primary hover:border-primary hover:bg-primary/5',
                m.isPending && s !== report.status ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        {m.isError && (
          <p className="mt-2 text-xs text-danger">
            {m.error instanceof AdminApiException
              ? `${m.error.code}: ${m.error.message}`
              : m.error.message}
          </p>
        )}
      </Card>
      {showConfirm && (
        <ResolutionConfirmDialog
          targetStatus={showConfirm}
          resolutionNote={resolutionNote}
          setResolutionNote={setResolutionNote}
          submitting={m.isPending}
          onCancel={() => {
            setShowConfirm(null)
            setResolutionNote('')
          }}
          onConfirm={handleConfirm}
        />
      )}
    </>
  )
}

function ResolutionConfirmDialog({
  targetStatus,
  resolutionNote,
  setResolutionNote,
  submitting,
  onCancel,
  onConfirm,
}: {
  targetStatus: AdminReportStatus
  resolutionNote: string
  setResolutionNote: (v: string) => void
  submitting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      data-testid="resolution-confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        role="dialog"
        aria-label={`Confirm ${STATUS_LABEL[targetStatus]}`}
        className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl"
      >
        <div className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Confirm {STATUS_LABEL[targetStatus].toLowerCase()}
        </div>
        <p className="mt-2 text-sm text-text-primary">
          Marking this report as <strong>{STATUS_LABEL[targetStatus]}</strong> will hide it
          from the open queue and stamp <code className="text-xs">resolved_at</code> +{' '}
          <code className="text-xs">resolved_by</code> on the row.
        </p>
        <label className="mt-4 block">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            Resolution note (optional)
          </div>
          <textarea
            data-testid="resolution-note-input"
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={
              targetStatus === 'resolved'
                ? "e.g. refunded $5.00 via UserDetail; emailed reporter"
                : 'e.g. duplicate of report #abc — closed in favour of that one'
            }
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
          />
        </label>
        <p className="mt-2 text-xs text-text-secondary">
          The note is saved on the report and copied into the audit log.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            data-testid="resolution-cancel"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-text-primary disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="resolution-confirm"
            onClick={onConfirm}
            disabled={submitting}
            className={[
              'rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors',
              submitting
                ? 'bg-border cursor-not-allowed text-text-secondary'
                : 'bg-success hover:opacity-90',
            ].join(' ')}
          >
            {submitting ? 'Saving…' : `Mark ${STATUS_LABEL[targetStatus].toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function SeverityCard({ report }: { report: AdminReport }) {
  const m = useAdminChangeReportSeverity(report.id)
  return (
    <Card title="Severity" testid="report-actions-severity">
      <div className="grid grid-cols-2 gap-2">
        {(['emergency', 'urgent', 'normal', 'low'] as AdminReportSeverity[]).map((s) => (
          <button
            key={s}
            type="button"
            data-testid={`action-severity-${s}`}
            disabled={m.isPending || s === report.severity}
            onClick={() => m.mutate({ severity: s })}
            className={[
              'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
              s === report.severity
                ? severityActiveClass(s)
                : 'border-border bg-white text-text-primary hover:border-primary hover:bg-primary/5',
              m.isPending && s !== report.severity ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
          >
            {SEVERITY_LABEL[s]}
          </button>
        ))}
      </div>
      {m.isError && (
        <p className="mt-2 text-xs text-danger">
          {m.error instanceof AdminApiException
            ? `${m.error.code}: ${m.error.message}`
            : m.error.message}
        </p>
      )}
      <p className="mt-2 text-[11px] text-text-secondary">
        Server auto-assigns severity at insert time. Use this to override
        — e.g. downgrade a misclassified emergency. The change writes
        an audit row.
      </p>
    </Card>
  )
}

function severityActiveClass(severity: AdminReportSeverity): string {
  switch (severity) {
    case 'emergency':
      return 'border-danger bg-danger text-white cursor-default'
    case 'urgent':
      return 'border-warning bg-warning/15 text-warning cursor-default'
    default:
      return 'border-primary bg-primary-light text-primary cursor-default'
  }
}

function CrossLinksCard({
  reporter,
  subjectUser,
  ride,
}: {
  reporter: AdminReportUser | null
  subjectUser: AdminReportUser | null
  ride: AdminReportRideSnapshot | null
}) {
  const canRefund =
    ride &&
    typeof ride.fare_cents === 'number' &&
    ride.fare_cents > 0 &&
    ride.payment_status === 'paid' &&
    ride.status === 'completed'

  return (
    <Card title="Cross-links" testid="report-actions-links">
      <p className="text-[11px] text-text-secondary mb-2">
        Refund + suspend live on the existing user detail page — these
        links jump straight there with the right context.
      </p>
      <div className="space-y-2">
        {ride && reporter && (
          <Link
            to={`/admin/users/${reporter.id}`}
            data-testid="action-refund-link"
            className={[
              'block rounded-md border px-3 py-2 text-xs font-medium transition-colors',
              canRefund
                ? 'border-warning bg-warning/10 text-warning hover:bg-warning/15'
                : 'border-border bg-surface text-text-secondary',
            ].join(' ')}
          >
            Issue refund on reporter's wallet →
            {!canRefund && (
              <div className="mt-1 text-[10px] text-text-secondary">
                Ride must be completed + paid to refund.
              </div>
            )}
          </Link>
        )}
        {subjectUser && (
          <Link
            to={`/admin/users/${subjectUser.id}`}
            data-testid="action-suspend-link"
            className="block rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/10"
          >
            Open subject user detail →
            <div className="mt-1 text-[10px] text-danger/80">
              Suspend / grant credit / send push from there.
            </div>
          </Link>
        )}
        {reporter && (
          <Link
            to={`/admin/users/${reporter.id}`}
            data-testid="action-reporter-link"
            className="block rounded-md border border-border bg-white px-3 py-2 text-xs font-medium text-text-primary hover:border-primary hover:bg-primary/5"
          >
            Open reporter detail →
          </Link>
        )}
      </div>
    </Card>
  )
}

function AuditCard({ reportId }: { reportId: string }) {
  const { data, isLoading } = useAdminReportAudit(reportId)
  return (
    <Card title="Audit log" testid="report-actions-audit">
      {isLoading && !data ? (
        <p className="text-xs text-text-secondary">Loading…</p>
      ) : !data || data.audit.length === 0 ? (
        <p className="text-xs text-text-secondary">
          No admin actions logged on this report yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.audit.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function AuditRow({ row }: { row: AdminReportAuditRow }) {
  const fromTo = (() => {
    const p = row.payload
    if (typeof p['from'] === 'string' && typeof p['to'] === 'string') {
      return `${p['from']} → ${p['to']}`
    }
    return null
  })()
  return (
    <li className="text-[11px] text-text-secondary">
      <span className="font-semibold text-text-primary">
        {row.action.replace(/_/g, ' ')}
      </span>
      {fromTo && <span className="ml-1">· {fromTo}</span>}
      <div className="text-[10px] text-text-secondary">
        by {row.admin_email ?? row.admin_id.slice(0, 8) + '…'} · {fmtDateTime(row.created_at)}
      </div>
    </li>
  )
}

// ── Atoms ──────────────────────────────────────────────────────────

function Card({
  title,
  testid,
  children,
}: {
  title: string
  testid: string
  children: React.ReactNode
}) {
  return (
    <div
      data-testid={testid}
      className="rounded-2xl border border-border bg-white p-4"
    >
      <h3 className="mb-3 text-sm font-semibold text-text-primary">{title}</h3>
      {children}
    </div>
  )
}

function NeutralRow({ text }: { text: string }) {
  return <p className="text-xs text-text-secondary">{text}</p>
}

function SeverityPill({ severity }: { severity: AdminReportSeverity }) {
  return (
    <span
      data-testid={`severity-${severity}`}
      className={[
        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        SEVERITY_TONE[severity],
      ].join(' ')}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  )
}

function StatusPill({ status }: { status: AdminReportStatus }) {
  return (
    <span
      data-testid={`status-${status}`}
      className={[
        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        STATUS_TONE[status],
      ].join(' ')}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

function Avatar({ url, fallback }: { url: string | null; fallback: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-10 w-10 rounded-full object-cover border border-border"
      />
    )
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-light text-sm font-bold text-primary">
      {fallback || '?'}
    </div>
  )
}

function initialsFor(user: AdminReportUser): string {
  return (user.full_name ?? user.email)
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')
}

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function fmtDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso))
}

function fmtCents(cents: number): string {
  return moneyFmt.format(cents / 100)
}
