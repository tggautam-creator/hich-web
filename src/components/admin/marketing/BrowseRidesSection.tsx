/**
 * Per-ride story-idea picker — lets the founder browse upcoming
 * ride_schedules and generate 3 distinct Instagram-story angles for
 * a specific ride. Output is ephemeral (no DB write) — copy the bits
 * you like.
 */
import { useMemo, useState } from 'react'
import {
  useRidesForStories,
  useGenerateStoriesForRide,
  type RideAudience,
  type RideForStory,
  type StoryIdea,
} from '@/hooks/useMarketingRideStories'
import { CostBadge } from './_shared'
import { fallbackBanner } from '@/lib/marketing/costs'

const RANGE_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 3,  label: 'Next 3 days' },
  { days: 7,  label: 'Next 7 days' },
  { days: 14, label: 'Next 14 days' },
  { days: 30, label: 'Next 30 days' },
]

export default function BrowseRidesSection() {
  const [audience, setAudience] = useState<RideAudience>('both')
  const [days, setDays] = useState<number>(7)
  const query = useRidesForStories(days, audience)

  // Merge + sort ascending by date+time when audience is 'both'.
  const allRides = useMemo<RideForStory[]>(() => {
    if (!query.data) return []
    const merged = [...query.data.riders, ...query.data.drivers]
    return merged.sort((a, b) => {
      const k = a.trip_date.localeCompare(b.trip_date)
      if (k !== 0) return k
      return (a.trip_time ?? '').localeCompare(b.trip_time ?? '')
    })
  }, [query.data])

  return (
    <section
      data-testid="browse-rides-section"
      className="rounded-2xl border border-border bg-white p-5 space-y-4"
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-text-primary">
            Browse rides for story ideas
          </h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Pick a specific open ride post and have the AI generate 3
            distinct story angles for it. Output is throwaway — copy
            what you want.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <CostBadge feature="story-batch-single-audience" testid="cost-badge-browse-rides" />
          <span className="text-[10px] text-text-secondary">per ride</span>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <AudiencePill active={audience === 'both'} onClick={() => setAudience('both')}>
          Both
        </AudiencePill>
        <AudiencePill active={audience === 'rider'} onClick={() => setAudience('rider')}>
          Riders
        </AudiencePill>
        <AudiencePill active={audience === 'driver'} onClick={() => setAudience('driver')}>
          Drivers
        </AudiencePill>
        <span className="text-text-secondary mx-2">·</span>
        <select
          data-testid="range-select"
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="rounded-md border border-border bg-white px-2 py-1 text-xs text-text-primary"
        >
          {RANGE_OPTIONS.map((o) => (
            <option key={o.days} value={o.days}>{o.label}</option>
          ))}
        </select>
        {query.data && (
          <span className="text-[11px] text-text-secondary ml-auto">
            {allRides.length} ride{allRides.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {query.isLoading && (
        <p className="text-xs text-text-secondary">Loading rides…</p>
      )}
      {query.error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          Couldn't load rides. {query.error.message}
        </div>
      )}
      {query.data && allRides.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-4 text-center text-xs text-text-secondary">
          No upcoming rides in this window. Widen the range or check back later.
        </div>
      )}

      <ul className="space-y-2">
        {allRides.map((r) => <RideCard key={r.id} ride={r} />)}
      </ul>
    </section>
  )
}

function AudiencePill({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
        active
          ? 'bg-primary text-white'
          : 'border border-border bg-white text-text-secondary hover:bg-surface',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function RideCard({ ride }: { ride: RideForStory }) {
  const gen = useGenerateStoriesForRide()
  const [open, setOpen] = useState(false)

  const audienceTone = ride.audience === 'rider'
    ? 'bg-success/10 text-success'
    : 'bg-primary/10 text-primary'

  function handleGenerate() {
    if (gen.isPending) return
    setOpen(true)
    gen.mutate(ride.id)
  }

  const ideas = gen.data?.ideas ?? []
  const showResults = open && (gen.isPending || gen.isError || ideas.length > 0)

  return (
    <li
      data-testid={`ride-card-${ride.id}`}
      className="rounded-xl border border-border bg-surface p-3 space-y-2"
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${audienceTone}`}>
              {ride.audience}
            </span>
            <p className="text-sm font-semibold text-text-primary">
              {ride.poster_name || `User ${ride.user_id_short}`}
            </p>
            {ride.direction_type === 'roundtrip' && (
              <span className="rounded-full bg-text-secondary/10 text-text-secondary px-2 py-0.5 text-[10px] font-semibold uppercase">
                Roundtrip
              </span>
            )}
            {ride.audience === 'driver' && ride.available_seats != null && (
              <span className="text-[11px] text-text-secondary">
                {ride.available_seats} seat{ride.available_seats === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="text-xs text-text-primary mt-1 truncate">
            {ride.route_name}
          </p>
          <p className="text-[11px] text-text-secondary mt-0.5">
            {dateLabel(ride.trip_date, ride.days_until)} · {timeLabel(ride.trip_time)} {ride.time_type}
          </p>
          {ride.note && (
            <p className="text-[11px] text-text-secondary mt-1 italic line-clamp-2">
              "{ride.note}"
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            data-testid={`generate-stories-for-ride-${ride.id}`}
            type="button"
            onClick={handleGenerate}
            disabled={gen.isPending}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {gen.isPending ? 'Generating…' : ideas.length > 0 ? '↻ Regenerate' : '✨ Generate stories'}
          </button>
          {ideas.length > 0 && !gen.isPending && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-[10px] text-text-secondary hover:text-text-primary"
            >
              {open ? 'Hide ideas' : 'Show ideas'}
            </button>
          )}
        </div>
      </header>

      {showResults && (
        <div data-testid={`ride-ideas-${ride.id}`} className="border-t border-border pt-2 space-y-2">
          {gen.isPending && (
            <p className="text-xs text-text-secondary italic">Thinking up 3 angles…</p>
          )}
          {gen.isError && (
            <p className="text-xs text-danger">
              Couldn't generate ideas: {gen.error.message}
            </p>
          )}
          {gen.data && (() => {
            const banner = fallbackBanner(gen.data.model_used, 'gemini-2.5-flash')
            return banner ? <p className="text-[10px] text-warning">{banner}</p> : null
          })()}
          {ideas.map((idea, i) => (
            <IdeaCard key={i} idea={idea} index={i} />
          ))}
        </div>
      )}
    </li>
  )
}

function IdeaCard({ idea, index }: { idea: StoryIdea; index: number }) {
  return (
    <article
      data-testid={`idea-card-${index}`}
      className="rounded-lg border border-border bg-white p-3 space-y-2"
    >
      <header className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-primary">
          Idea {index + 1} · {idea.angle}
        </p>
      </header>
      <CopyableInline label="Headline" value={idea.headline} testid={`idea-${index}-headline`} />
      <CopyableInline label="Body" value={idea.body} testid={`idea-${index}-body`} multiline />
      <div className="rounded-md border border-dashed border-border bg-surface px-2 py-1.5">
        <p className="text-[9px] uppercase tracking-wide font-semibold text-text-secondary">
          Visual idea
        </p>
        <p className="text-xs text-text-primary mt-0.5">{idea.visual_idea}</p>
      </div>
      {idea.hashtags && (
        <CopyableInline label="Hashtags" value={idea.hashtags} testid={`idea-${index}-hashtags`} />
      )}
    </article>
  )
}

function CopyableInline({
  label, value, testid, multiline = false,
}: { label: string; value: string; testid: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard may not be available — silent fail; value is visible
    }
  }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[9px] uppercase tracking-wide font-semibold text-text-secondary">
          {label}
        </p>
        <button
          type="button"
          onClick={copy}
          data-testid={`${testid}-copy`}
          className="text-[10px] font-semibold text-primary hover:underline"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <p
        data-testid={testid}
        className={multiline
          ? 'text-xs text-text-primary mt-0.5 whitespace-pre-wrap'
          : 'text-xs text-text-primary mt-0.5'}
      >
        {value}
      </p>
    </div>
  )
}

function dateLabel(iso: string, daysUntil: number): string {
  if (daysUntil === 0) return 'TODAY'
  if (daysUntil === 1) return 'TOMORROW'
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function timeLabel(t: string): string {
  // t is HH:MM:SS (PG TIME). Render as h:MM AM/PM.
  const [hStr, mStr] = t.split(':')
  if (!hStr) return t
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  if (Number.isNaN(h)) return t
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${period}`
}
