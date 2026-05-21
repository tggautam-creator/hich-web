import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { trackEvent } from '@/lib/analytics'
import { ReportsApiException } from '@/lib/reportsApi'
import {
  useReportDetail,
  usePostReportMessage,
  type ReportMessage,
} from '@/hooks/useReports'
import {
  SEVERITY_LABEL,
  SEVERITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  findCategory,
} from './categoryConfig'

/**
 * 2026-05-20 — `/reports/:id`. The user-facing thread view for a
 * single report: header (category / severity / status / when),
 * read-only details panel, then a chronological thread of admin
 * replies + user replies, with a compose box at the bottom. Internal
 * admin notes never reach this page — the server filters them out.
 *
 * The compose box is disabled when the report is `closed`; the
 * banner above it explains why.
 */
export default function MyReportDetailPage({
  'data-testid': testId = 'my-report-detail-page',
}: {
  'data-testid'?: string
}) {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { data, isLoading, error, refetch } = useReportDetail(id)
  const send = usePostReportMessage(id ?? '')
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const threadEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Scroll the thread to the bottom whenever new messages arrive
    // — matches every chat UI expectation.
    if (data?.messages?.length) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [data?.messages?.length])

  if (isLoading && !data) {
    return (
      <div
        data-testid="my-report-detail-loading"
        className="flex h-64 items-center justify-center text-sm text-text-secondary"
      >
        Loading…
      </div>
    )
  }

  if (error || !data) {
    const msg = error instanceof ReportsApiException
      ? `${error.code}: ${error.message}`
      : (error as Error | null)?.message ?? 'Report not found'
    return (
      <div
        data-testid="my-report-detail-error"
        className="flex flex-col items-center gap-3 px-6 py-12 text-center"
      >
        <p className="text-sm text-danger">{msg}</p>
        <button
          type="button"
          onClick={() => navigate('/reports')}
          className="text-sm font-medium text-primary"
        >
          ← Back to My reports
        </button>
      </div>
    )
  }

  const r = data.report
  const cat = findCategory(r.category)
  const isClosed = r.status === 'closed'

  async function handleSend() {
    if (!id) return
    const trimmed = draft.trim()
    if (trimmed.length === 0) return
    setSendError(null)
    try {
      await send.mutateAsync({ body: trimmed })
      setDraft('')
      trackEvent('report_message_sent', { report_id: id })
      void refetch()
    } catch (err) {
      const msg = err instanceof ReportsApiException
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Could not send — try again'
      setSendError(msg)
    }
  }

  return (
    <div
      data-testid={testId}
      className="min-h-dvh w-full bg-surface font-sans"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 1.25rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)',
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

        <header className="mt-3 flex flex-col gap-3 rounded-2xl border border-border bg-white p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityPill severity={r.severity} />
            <span
              className={[
                'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                STATUS_TONE[r.status],
              ].join(' ')}
            >
              {STATUS_LABEL[r.status]}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-text-secondary">
              {cat?.label ?? r.category}
            </span>
          </div>
          <h1 className="text-lg font-bold text-text-primary">{r.title}</h1>
          <p className="whitespace-pre-wrap text-sm text-text-primary">{r.body}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
            <span>Submitted {formatDateTime(r.created_at)}</span>
            {r.updated_at !== r.created_at && (
              <span>· Updated {formatDateTime(r.updated_at)}</span>
            )}
            {r.requested_refund_cents != null && (
              <span>
                · Refund requested: ${(r.requested_refund_cents / 100).toFixed(2)}
              </span>
            )}
            {r.ride_id && (
              <span>· Ride {r.ride_id.slice(0, 8)}…</span>
            )}
          </div>
        </header>

        <section className="mt-4 rounded-2xl border border-border bg-white">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Thread</h2>
          </div>
          {data.messages.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-text-secondary">
              No messages yet. We'll reply here when we have an update.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 px-5 py-4" data-testid="report-thread">
              {data.messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              <div ref={threadEndRef} />
            </ul>
          )}
        </section>

        <section className="mt-4">
          {isClosed ? (
            <div className="rounded-2xl border border-border bg-white p-4 text-xs text-text-secondary">
              This report is closed. <span className="text-text-primary">Need to add more?</span>{' '}
              <button
                type="button"
                onClick={() => navigate('/reports')}
                className="font-medium text-primary"
              >
                Start a new report
              </button>
              .
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-white p-4">
              <label htmlFor="report-reply" className="text-xs font-medium text-text-secondary">
                Reply
              </label>
              <textarea
                id="report-reply"
                data-testid="report-reply-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                maxLength={5000}
                placeholder="Add more detail or answer a question from us…"
                className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-primary focus:outline-none"
              />
              {sendError && (
                <p role="alert" data-testid="report-reply-error" className="text-xs text-danger">
                  {sendError}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  data-testid="report-reply-submit"
                  onClick={() => { void handleSend() }}
                  disabled={send.isPending || draft.trim().length === 0}
                  className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {send.isPending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ReportMessage }) {
  const isMine = message.author_role === 'user'
  return (
    <li
      data-testid={`report-message-${message.id}`}
      className={['flex', isMine ? 'justify-end' : 'justify-start'].join(' ')}
    >
      <div
        className={[
          'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
          isMine
            ? 'rounded-br-md bg-primary text-white'
            : 'rounded-bl-md bg-surface text-text-primary',
        ].join(' ')}
      >
        <p className={['mb-0.5 text-[10px] uppercase tracking-wide', isMine ? 'text-white/70' : 'text-text-secondary'].join(' ')}>
          {isMine ? 'You' : 'Tago support'}
        </p>
        <p className="whitespace-pre-wrap">{message.body}</p>
        <p className={['mt-1 text-[10px]', isMine ? 'text-white/60' : 'text-text-secondary'].join(' ')}>
          {formatDateTime(message.created_at)}
        </p>
      </div>
    </li>
  )
}

function SeverityPill({ severity }: { severity: 'emergency' | 'urgent' | 'normal' | 'low' }) {
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

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}
