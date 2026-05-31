/**
 * Feature 3 — Daily focus brief banner on /admin/marketing.
 *
 * Shows today's LLM-generated focus + recommendations + KPI deltas.
 * "Talk through this" spawns a seeded advisor thread + navigates;
 * "Dismiss" hides for the day; "Regenerate" forces a re-run.
 *
 * Hides itself when no brief exists (cron hasn't run yet pre-7 AM PT,
 * or the founder dismissed). Errors render as a small inline chip
 * instead of the full banner.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useDailyFocus,
  useDismissDailyFocus,
  useRegenerateDailyFocus,
  useStartDailyFocusThread,
  type FocusPriority,
  type FocusTag,
} from '@/hooks/useMarketingDailyFocus'

export default function DailyFocusBanner() {
  const q = useDailyFocus()
  const dismiss = useDismissDailyFocus()
  const regen = useRegenerateDailyFocus()
  const spawn = useStartDailyFocusThread()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)

  if (q.isLoading) return null
  if (q.error) {
    return (
      <div
        data-testid="daily-focus-fetch-error"
        className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger"
      >
        Couldn't load today's focus. {q.error.message}
      </div>
    )
  }
  const brief = q.data
  if (!brief) return null
  if (brief.dismissed_at) return null

  // Generation error — show small inline chip instead of full banner
  if (brief.error || !brief.focus) {
    return (
      <div
        data-testid="daily-focus-gen-error"
        className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary flex items-center gap-2"
      >
        <span>Daily focus generation hit a snag: {brief.error ?? 'no focus produced'}.</span>
        <button
          data-testid="daily-focus-regenerate-error"
          type="button"
          onClick={() => regen.mutate()}
          disabled={regen.isPending}
          className="text-primary hover:underline"
        >
          {regen.isPending ? 'Regenerating…' : 'Retry'}
        </button>
      </div>
    )
  }

  const recs = brief.recommendations ?? []
  const delta = brief.kpi_snapshot?.kpis.delta

  return (
    <section
      data-testid="daily-focus-banner"
      className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-3"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-primary">
            Today's focus · {dayOfWeekLabel(brief.for_date)} · {brief.for_date}
          </p>
          <h2
            data-testid="daily-focus-focus"
            className="text-base font-bold text-text-primary mt-1"
          >
            {brief.focus}
          </h2>
        </div>
        <button
          data-testid="daily-focus-dismiss"
          type="button"
          onClick={() => dismiss.mutate()}
          disabled={dismiss.isPending}
          className="text-text-secondary hover:text-text-primary text-lg leading-none"
          aria-label="Dismiss today's focus"
          title="Dismiss for today"
        >
          ×
        </button>
      </header>

      {recs.length > 0 && (
        <ul className="space-y-1.5">
          {recs.slice(0, 3).map((r, i) => (
            <li
              key={i}
              data-testid={`daily-focus-rec-${i}`}
              className="flex items-start gap-2 text-sm"
            >
              <PriorityDot priority={r.priority} />
              <span className="text-text-primary flex-1">{r.text}</span>
              <TagChip tag={r.tag} />
            </li>
          ))}
        </ul>
      )}

      {delta && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs border-t border-primary/20 pt-3">
          <DeltaPill label="DAU vs yesterday" value={delta.dau_vs_yesterday_pct} />
          <DeltaPill label="Revenue vs 7d avg" value={delta.revenue_vs_7d_avg_pct} />
          <DeltaPill label="Rides vs 7d avg" value={delta.rides_vs_7d_avg_pct} />
        </div>
      )}

      <div className="flex gap-3 pt-1 items-center">
        <button
          data-testid="daily-focus-spawn-thread"
          type="button"
          onClick={() =>
            spawn.mutate(undefined, {
              onSuccess: (r) => navigate(`/admin/marketing/advisor?thread=${r.thread_id}`),
            })
          }
          disabled={spawn.isPending}
          className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
        >
          {spawn.isPending ? 'Opening…' : 'Talk through this →'}
        </button>
        <button
          data-testid="daily-focus-expand"
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-text-secondary hover:text-text-primary"
        >
          {expanded ? 'Hide full brief' : 'Show full brief'}
        </button>
        <button
          data-testid="daily-focus-regenerate"
          type="button"
          onClick={() => regen.mutate()}
          disabled={regen.isPending}
          className="text-xs text-text-secondary hover:text-text-primary ml-auto disabled:opacity-50"
        >
          {regen.isPending ? 'Regenerating…' : '↻ Regenerate'}
        </button>
      </div>

      {expanded && (
        <div data-testid="daily-focus-expanded" className="border-t border-primary/20 pt-3 space-y-3">
          {recs.length > 3 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-text-secondary mb-1.5">
                More recommendations
              </p>
              <ul className="space-y-1.5">
                {recs.slice(3).map((r, i) => (
                  <li
                    key={i}
                    data-testid={`daily-focus-rec-extra-${i}`}
                    className="flex items-start gap-2 text-sm"
                  >
                    <PriorityDot priority={r.priority} />
                    <span className="text-text-primary flex-1">{r.text}</span>
                    <TagChip tag={r.tag} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {brief.detail && (
            <article className="text-sm text-text-primary whitespace-pre-wrap">
              {brief.detail}
            </article>
          )}
        </div>
      )}

      {spawn.error && (
        <p data-testid="daily-focus-spawn-error" className="text-xs text-danger">
          Couldn't open thread: {spawn.error.message}
        </p>
      )}
      {regen.error && (
        <p data-testid="daily-focus-regen-error" className="text-xs text-danger">
          Couldn't regenerate: {regen.error.message}
        </p>
      )}
    </section>
  )
}

function dayOfWeekLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
  })
}

function PriorityDot({ priority }: { priority: FocusPriority }) {
  const tone = priority === 'high'
    ? 'bg-danger'
    : priority === 'medium'
      ? 'bg-warning'
      : 'bg-text-secondary/50'
  return (
    <span
      aria-hidden="true"
      title={`${priority} priority`}
      className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${tone}`}
    />
  )
}

function TagChip({ tag }: { tag: FocusTag }) {
  return (
    <span
      data-testid={`tag-chip-${tag}`}
      className="rounded-full bg-text-secondary/10 text-text-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shrink-0"
    >
      {tag}
    </span>
  )
}

function DeltaPill({ label, value }: { label: string; value: number | null }) {
  // null = prior value was 0 (math undefined). Render as "new"
  // rather than fabricating a 0% flat reading.
  if (value === null) {
    return (
      <span className="text-text-secondary">
        {label}: <span className="font-semibold text-text-primary">new</span>
      </span>
    )
  }
  const tone = value > 5
    ? 'text-success'
    : value < -5
      ? 'text-danger'
      : 'text-text-secondary'
  const sign = value >= 0 ? '+' : ''
  return (
    <span className="text-text-secondary">
      {label}: <span className={`font-semibold ${tone}`}>{sign}{value}%</span>
    </span>
  )
}
