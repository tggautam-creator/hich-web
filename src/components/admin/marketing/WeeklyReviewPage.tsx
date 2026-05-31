/**
 * /admin/marketing/weekly-review — Feature 4.
 *
 * Shows last week's auto-generated Slack recap. Founder can preview
 * the rendered message, manually regenerate it (rate-limited 60s),
 * manually post to Slack, and run a one-shot test ping to verify
 * the webhook URL is wired.
 */
import { useEffect } from 'react'
import {
  useWeeklyReview,
  useGenerateWeeklyReview,
  useSendWeeklyReview,
  useTestWebhook,
  type WeeklyHistoryRow,
  type WeeklyReview,
} from '@/hooks/useMarketingWeeklyReview'
import { CostFooterNote, GeminiQuotaBanner } from './_shared'

export default function WeeklyReviewPage() {
  const q = useWeeklyReview()
  const gen = useGenerateWeeklyReview()
  const send = useSendWeeklyReview()
  const test = useTestWebhook()

  // Auto-clear test-webhook result after 4s so the founder can re-run
  // without confusion. React Query's `reset` is the cleanest path.
  useEffect(() => {
    if (test.isSuccess || test.isError) {
      const t = window.setTimeout(() => test.reset(), 4000)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [test.isSuccess, test.isError, test])

  return (
    <div data-testid="admin-marketing-weekly-review" className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-text-primary">Weekly Slack review</h1>
        <p className="text-sm text-text-secondary">
          Every Monday at 9 AM PT, Tago auto-posts a recap of last week
          (Monday → Sunday) to the marketing Slack channel. Preview,
          regenerate, or send manually below.
        </p>
      </header>

      <GeminiQuotaBanner />

      <section className="rounded-2xl border border-border bg-white p-4 space-y-3">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-bold text-text-primary">Webhook</p>
            <p className="text-xs text-text-secondary">
              Configured via <code>SLACK_MARKETING_WEBHOOK_URL</code> in the EC2 server env.
            </p>
          </div>
          <button
            data-testid="test-webhook"
            type="button"
            onClick={() => test.mutate()}
            disabled={test.isPending}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-white disabled:opacity-50"
          >
            {test.isPending ? 'Pinging…' : 'Send test ping'}
          </button>
        </header>
        {test.isSuccess && test.data && (
          <p
            data-testid="test-webhook-success"
            className={test.data.ok ? 'text-xs text-success' : 'text-xs text-danger'}
          >
            {test.data.ok
              ? '✓ Slack accepted the test ping. Check #marketing.'
              : `× Slack returned ${test.data.status}: ${test.data.body}`}
          </p>
        )}
        {test.isError && (
          <p data-testid="test-webhook-error" className="text-xs text-danger">
            Test ping failed: {test.error.message}
          </p>
        )}
      </section>

      {q.isLoading && <p className="text-sm text-text-secondary">Loading review…</p>}
      {q.error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          Couldn't load the weekly review. {q.error.message}
        </div>
      )}

      {q.data && (
        <CurrentReviewCard
          weekStarting={q.data.week_starting}
          current={q.data.current}
          isGenerating={gen.isPending}
          isSending={send.isPending}
          generateError={gen.error?.message}
          sendError={send.error?.message}
          sendOk={send.isSuccess ? send.data?.ok ?? false : null}
          onGenerate={() => gen.mutate()}
          onSend={() => send.mutate()}
        />
      )}

      {q.data && q.data.history.length > 0 && (
        <HistorySection rows={q.data.history} />
      )}

      <CostFooterNote />
    </div>
  )
}

function CurrentReviewCard({
  weekStarting, current,
  isGenerating, isSending, generateError, sendError, sendOk,
  onGenerate, onSend,
}: {
  weekStarting: string
  current: WeeklyReview | null
  isGenerating: boolean
  isSending: boolean
  generateError: string | undefined
  sendError: string | undefined
  sendOk: boolean | null
  onGenerate: () => void
  onSend: () => void
}) {
  return (
    <section
      data-testid="weekly-review-current"
      className="rounded-2xl border border-border bg-white p-5 space-y-3"
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wide font-semibold text-text-secondary">
            Week of {weekStarting}
          </p>
          {current?.summary
            ? <h2 className="text-base font-bold text-text-primary mt-1">{current.summary}</h2>
            : <p className="text-sm text-text-secondary mt-1">No review generated yet for this week.</p>}
        </div>
        <div className="flex gap-2">
          <button
            data-testid="weekly-review-generate"
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            {isGenerating ? 'Generating…' : current?.summary ? '↻ Regenerate' : '✨ Generate now'}
          </button>
          {current?.summary && (
            <button
              data-testid="weekly-review-send"
              type="button"
              onClick={onSend}
              disabled={isSending}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {isSending ? 'Sending…' : current?.slack_sent_at ? 'Re-send to Slack' : 'Send to Slack'}
            </button>
          )}
        </div>
      </header>

      {generateError && (
        <p data-testid="weekly-review-gen-error" className="text-xs text-danger">
          Generate failed: {generateError}
        </p>
      )}
      {sendError && (
        <p data-testid="weekly-review-send-error" className="text-xs text-danger">
          Send failed: {sendError}
        </p>
      )}
      {sendOk === true && (
        <p data-testid="weekly-review-send-ok" className="text-xs text-success">
          ✓ Posted to Slack.
        </p>
      )}

      {current?.error && (
        <p
          data-testid="weekly-review-gen-error-row"
          className="text-xs text-warning"
        >
          Last attempt errored: {current.error}
        </p>
      )}

      {current?.highlights && current.highlights.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide font-semibold text-text-secondary mb-1.5">
            Highlights
          </p>
          <ul className="space-y-1.5">
            {current.highlights.map((h, i) => (
              <li
                key={i}
                data-testid={`weekly-review-highlight-${i}`}
                className="flex gap-2 text-sm text-text-primary"
              >
                <span className="text-text-secondary shrink-0">{h.icon}</span>
                <span>{h.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {current?.next_week_focus && (
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-text-secondary">
            Focus for next week
          </p>
          <p className="text-sm text-text-primary mt-0.5">{current.next_week_focus}</p>
        </div>
      )}

      {current && (
        <div className="border-t border-border pt-2 text-[10px] text-text-secondary flex flex-wrap gap-x-3 gap-y-1">
          <span>
            Generated {new Date(current.generated_at).toLocaleString()}
          </span>
          {current.llm_model && <span>· {current.llm_model}</span>}
          {current.slack_sent_at ? (
            <span data-testid="weekly-review-sent-at" className="text-success">
              · Posted to Slack {new Date(current.slack_sent_at).toLocaleString()}
            </span>
          ) : (
            <span data-testid="weekly-review-unsent" className="text-warning">
              · Not posted to Slack yet
            </span>
          )}
          {current.input_tokens != null && (
            <span>· {current.input_tokens.toLocaleString()} in / {current.output_tokens?.toLocaleString() ?? '?'} out tokens</span>
          )}
        </div>
      )}
    </section>
  )
}

function HistorySection({ rows }: { rows: WeeklyHistoryRow[] }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-5 space-y-2">
      <h2 className="text-sm font-bold text-text-primary">History</h2>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li
            key={r.id}
            data-testid={`weekly-review-history-${r.for_week_starting}`}
            className="py-2 flex items-start justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-text-primary">
                Week of {r.for_week_starting}
              </p>
              <p className="text-xs text-text-secondary truncate">
                {r.summary ?? '(no summary)'}
              </p>
            </div>
            <div className="text-[10px] text-text-secondary shrink-0 text-right">
              {r.slack_sent_at
                ? <span className="text-success">Posted ✓</span>
                : r.error
                  ? <span className="text-danger">Error</span>
                  : <span className="text-warning">Not posted</span>}
              <br />
              {r.slack_response_status != null && `HTTP ${r.slack_response_status}`}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
