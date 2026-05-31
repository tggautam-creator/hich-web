/**
 * /admin/marketing/calendar — Phase 5 smart marketing calendar.
 *
 * Three sections:
 *  1. Reminders pill at the top — events within target_lead_time_days
 *     that haven't been dismissed
 *  2. Upcoming events list — chronological, with countdown badges
 *  3. Add manual + Seed + Refresh-AI controls in the header
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useMarketingEvents,
  useSeedEvents,
  useRefreshAiEvents,
  useAddManualEvent,
  useDismissEventReminder,
  useDeleteEvent,
  type EventAudience,
  type EventCategory,
  type MarketingEvent,
} from '@/hooks/useMarketingEvents'
import { CostBadge, CostFooterNote, NoAiCostBadge, GeminiQuotaBanner, useQuotaGate } from './_shared'

const CATEGORY_LABELS: Record<EventCategory, { label: string; tone: string }> = {
  holiday:          { label: 'HOLIDAY',         tone: 'bg-warning/10 text-warning' },
  academic:         { label: 'ACADEMIC',        tone: 'bg-primary/10 text-primary' },
  campus:           { label: 'CAMPUS',          tone: 'bg-success/10 text-success' },
  'travel-trigger': { label: 'TRAVEL TRIGGER',  tone: 'bg-text-secondary/10 text-text-secondary' },
  custom:           { label: 'CUSTOM',          tone: 'bg-text-secondary/10 text-text-secondary' },
}

const SOURCE_LABELS = {
  seeded:        'SEEDED',
  ai_suggested:  'AI SUGGESTED',
  manual:        'MANUAL',
} as const

export default function CalendarPage() {
  const query = useMarketingEvents()
  const seed = useSeedEvents()
  const refreshAi = useRefreshAiEvents()
  const [showAdd, setShowAdd] = useState(false)
  const refreshGate = useQuotaGate('calendar-refresh-ai')

  const reminders = query.data?.reminders ?? []
  const events = query.data?.events ?? []
  const hasAnyEvent = events.length > 0

  return (
    <div data-testid="admin-marketing-calendar" className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Smart calendar</h1>
          <p className="text-sm text-text-secondary">
            Events that drive ride demand. Reminders fire 1+ week ahead;
            click an event to generate a poster targeting it.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex flex-col items-start gap-1">
            <button
              data-testid="seed-events"
              type="button"
              onClick={() => seed.mutate()}
              disabled={seed.isPending}
              className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface disabled:opacity-50"
            >
              {seed.isPending ? 'Seeding…' : hasAnyEvent ? 'Re-seed defaults' : 'Seed default events'}
            </button>
            <NoAiCostBadge />
          </div>
          <div className="flex flex-col items-start gap-1">
            <button
              data-testid="refresh-ai-events"
              type="button"
              onClick={() => refreshGate.run(() => refreshAi.mutate())}
              disabled={refreshAi.isPending || refreshGate.fullyDisabled}
              title={refreshGate.fullyDisabled ? 'Gemini Pro quota exhausted today' : undefined}
              className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              {refreshAi.isPending ? 'Asking Gemini…' : refreshGate.fullyDisabled ? 'Pro quota exhausted' : '✨ Refresh AI suggestions'}
            </button>
            <CostBadge feature="calendar-refresh-ai" />
          </div>
          <div className="flex flex-col items-start gap-1">
            <button
              data-testid="add-event-toggle"
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90"
            >
              {showAdd ? 'Cancel' : '+ Add event'}
            </button>
            <NoAiCostBadge />
          </div>
        </div>
      </header>
      <GeminiQuotaBanner />
      <CostFooterNote />

      {seed.isSuccess && seed.data && (
        <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-2 text-sm text-text-primary">
          Seed: {seed.data.inserted} inserted, {seed.data.skipped} skipped (already present).
        </div>
      )}
      {seed.isError && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          {seed.error.message}
        </div>
      )}
      {refreshAi.isSuccess && refreshAi.data && (
        <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-2 text-sm text-text-primary space-y-1">
          <p>
            AI suggestions: <span className="font-semibold">{refreshAi.data.inserted} added</span>
            {refreshAi.data.skipped > 0 && (
              <>
                {', '}
                {(refreshAi.data.skipped_duplicate ?? 0) > 0 && `${refreshAi.data.skipped_duplicate} duplicate`}
                {(refreshAi.data.skipped_duplicate ?? 0) > 0 && (refreshAi.data.skipped_invalid ?? 0) > 0 && ', '}
                {(refreshAi.data.skipped_invalid ?? 0) > 0 && `${refreshAi.data.skipped_invalid} invalid (bad date / out-of-range)`}
              </>
            )}
            {refreshAi.data.sources_count != null && refreshAi.data.sources_count > 0 && (
              <span className="ml-2 text-xs text-text-secondary">
                · verified via {refreshAi.data.sources_count} Google Search source{refreshAi.data.sources_count === 1 ? '' : 's'}
              </span>
            )}
            .
          </p>
          {refreshAi.data.insert_errors && refreshAi.data.insert_errors.length > 0 && (
            <ul className="mt-1 text-xs text-danger">
              {refreshAi.data.insert_errors.map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
          )}
        </div>
      )}
      {refreshAi.isError && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          {refreshAi.error.message}
        </div>
      )}

      {showAdd && <AddEventForm onClose={() => setShowAdd(false)} />}

      {reminders.length > 0 && <RemindersSection reminders={reminders} />}

      <section>
        <h2 className="text-sm font-bold text-text-primary mb-2">
          Events ({events.length})
          {(() => {
            // Server returns events from -14d to +400d. Split the
            // header counts so "Upcoming (N)" doesn't lie when the
            // list also contains a recently-finished holiday.
            const todayIso = new Date().toLocaleDateString('sv-SE', {
              timeZone: 'America/Los_Angeles',
            })
            const upcoming = events.filter((e) => e.event_date >= todayIso).length
            const recent = events.length - upcoming
            if (events.length === 0) return null
            return (
              <span className="ml-2 text-[11px] font-normal text-text-secondary">
                — {upcoming} upcoming
                {recent > 0 && <> · {recent} recently past</>}
              </span>
            )
          })()}
        </h2>
        {query.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
        {query.error && (
          <p className="text-sm text-danger">Couldn't load events. {query.error.message}</p>
        )}
        {query.data && events.length === 0 && (
          <div className="rounded-2xl border border-border bg-white p-8 text-center text-sm text-text-secondary">
            <p className="font-semibold text-text-primary mb-1">No events yet</p>
            <p className="mb-3">
              Click "Seed default events" to load federal holidays + UC Davis
              academic calendar + Picnic Day etc., or "Refresh AI suggestions"
              to have Gemini propose events to target.
            </p>
          </div>
        )}
        <ul className="space-y-2">
          {events.map((e) => <EventRow key={e.id} event={e} />)}
        </ul>
      </section>
    </div>
  )
}

// ── Reminders banner ────────────────────────────────────────────────

function RemindersSection({ reminders }: { reminders: MarketingEvent[] }) {
  return (
    <section
      data-testid="event-reminders"
      className="rounded-2xl border border-warning/40 bg-warning/5 p-4"
    >
      <h2 className="text-sm font-bold text-warning mb-2">
        ⚠ {reminders.length} event{reminders.length === 1 ? '' : 's'} needing attention
      </h2>
      <ul className="space-y-2">
        {reminders.map((e) => (
          <li key={e.id} className="rounded-lg border border-border bg-white p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary">
                {e.title}
              </p>
              <p className="text-xs text-text-secondary">
                <Countdown date={e.event_date} /> · {e.event_date}
                {e.location_hint && ` · ${e.location_hint}`}
              </p>
              {e.description && (
                <p className="mt-1 text-xs text-text-secondary">{e.description}</p>
              )}
            </div>
            <ReminderActions event={e} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ReminderActions({ event }: { event: MarketingEvent }) {
  const dismiss = useDismissEventReminder()
  const posterUrl = `/admin/marketing/posters?event_tag=${encodeURIComponent(event.title)}&event_date=${event.event_date}`
  return (
    <div className="flex flex-col gap-1 shrink-0">
      <Link
        to={posterUrl}
        className="rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-white text-center hover:bg-primary/90"
      >
        Make poster
      </Link>
      <button
        type="button"
        onClick={() => dismiss.mutate(event.id)}
        disabled={dismiss.isPending}
        aria-label={`Dismiss reminder for ${event.title}`}
        className="rounded-md border border-border bg-white px-2 py-1 text-[10px] font-semibold text-text-secondary hover:bg-surface disabled:opacity-50"
      >
        Dismiss
      </button>
    </div>
  )
}

// ── Event row ──────────────────────────────────────────────────────

function EventRow({ event }: { event: MarketingEvent }) {
  const deleteMut = useDeleteEvent()
  const cat = CATEGORY_LABELS[event.category]
  async function handleDelete() {
    if (!window.confirm(`Delete "${event.title}"? This can't be undone.`)) return
    await deleteMut.mutateAsync(event.id)
  }
  return (
    <li
      data-testid={`event-${event.id}`}
      className="group rounded-xl border border-border bg-white p-3 flex items-start gap-3"
    >
      <div className="shrink-0 text-center w-16">
        <p className="text-xs font-bold text-text-secondary uppercase">
          {monthShort(event.event_date)}
        </p>
        <p className="text-xl font-bold text-text-primary leading-none">
          {dayOf(event.event_date)}
        </p>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-text-primary truncate">
            {event.title}
          </p>
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${cat.tone}`}>
            {cat.label}
          </span>
          {event.source !== 'manual' && (
            <span className="rounded-full bg-text-secondary/10 text-text-secondary px-1.5 py-0.5 text-[9px] font-semibold">
              {SOURCE_LABELS[event.source]}
            </span>
          )}
        </div>
        <p className="text-xs text-text-secondary">
          <Countdown date={event.event_date} />
          {event.end_date && ` · through ${event.end_date}`}
          {event.location_hint && ` · ${event.location_hint}`}
          {' · target: '}
          <span className="text-text-primary">{event.target_audience}</span>
        </p>
        {event.description && (
          <p className="text-xs text-text-secondary line-clamp-2">{event.description}</p>
        )}
        {event.source_urls && event.source_urls.length > 0 && (
          <p className="text-[10px] text-text-secondary">
            Sources:{' '}
            {event.source_urls.slice(0, 3).map((u, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                <a
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  [{hostnameOf(u) || 'link'}]
                </a>
              </span>
            ))}
            {event.source_urls.length > 3 && (
              <span className="text-text-secondary"> +{event.source_urls.length - 3}</span>
            )}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
        <Link
          to={`/admin/marketing/posters?event_tag=${encodeURIComponent(event.title)}&event_date=${event.event_date}`}
          className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/10 text-center"
        >
          Make poster
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          aria-label={`Delete ${event.title}`}
          className="rounded-md border border-border bg-white px-2 py-1 text-[10px] font-semibold text-text-secondary hover:text-danger hover:border-danger/30"
        >
          Delete
        </button>
      </div>
    </li>
  )
}

// ── Add manual event form ──────────────────────────────────────────

function AddEventForm({ onClose }: { onClose: () => void }) {
  const add = useAddManualEvent()
  const [title, setTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [category, setCategory] = useState<EventCategory>('custom')
  const [locationHint, setLocationHint] = useState('')
  const [description, setDescription] = useState('')
  const [audience, setAudience] = useState<EventAudience>('both')
  const [leadDays, setLeadDays] = useState(7)
  const [notes, setNotes] = useState('')

  async function handleSubmit() {
    if (!title.trim() || !eventDate) return
    await add.mutateAsync({
      title: title.trim(),
      event_date: eventDate,
      end_date: endDate || undefined,
      category,
      location_hint: locationHint.trim() || undefined,
      description: description.trim() || undefined,
      target_audience: audience,
      target_lead_time_days: leadDays,
      notes: notes.trim() || undefined,
    })
    onClose()
  }

  return (
    <section className="rounded-2xl border border-border bg-white p-5 space-y-3">
      <h2 className="text-sm font-bold text-text-primary">Add event</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Input label="Title*" value={title} onChange={setTitle} placeholder="e.g. Outside Lands" />
        <Input label="Date*" type="date" value={eventDate} onChange={setEventDate} />
        <Input label="End date" type="date" value={endDate} onChange={setEndDate} />
        <Select
          label="Category"
          value={category}
          onChange={(v) => setCategory(v as EventCategory)}
          options={[
            { value: 'holiday', label: 'Holiday' },
            { value: 'academic', label: 'Academic' },
            { value: 'campus', label: 'Campus' },
            { value: 'travel-trigger', label: 'Travel trigger' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        <Input label="Location hint" value={locationHint} onChange={setLocationHint} placeholder="e.g. SoCal, Tahoe" />
        <Select
          label="Target audience"
          value={audience}
          onChange={(v) => setAudience(v as EventAudience)}
          options={[
            { value: 'rider', label: 'Riders' },
            { value: 'driver', label: 'Drivers' },
            { value: 'both', label: 'Both' },
          ]}
        />
        <Input label="Lead-time days" type="number" value={String(leadDays)} onChange={(v) => setLeadDays(Math.max(1, Math.min(60, Number(v) || 7)))} />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Why this event drives ride demand"
          rows={2}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
          Notes (private)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Marketing strategy notes for this event"
          rows={2}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
      </div>
      {add.isError && (
        <p className="text-xs text-danger">{add.error.message}</p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={add.isPending || !title.trim() || !eventDate}
          className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Add event'}
        </button>
      </div>
    </section>
  )
}

function Input({
  label, value, onChange, type, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
        {label}
      </label>
      <input
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50"
      />
    </div>
  )
}

function Select({
  label, value, onChange, options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ── Date helpers ──────────────────────────────────────────────────

function Countdown({ date }: { date: string }) {
  const days = daysUntil(date)
  if (days < 0) return <span className="text-text-secondary">{Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} ago</span>
  if (days === 0) return <span className="font-bold text-warning">TODAY</span>
  if (days === 1) return <span className="font-bold text-warning">Tomorrow</span>
  if (days <= 7) return <span className="font-semibold text-warning">In {days} days</span>
  if (days <= 30) return <span className="text-text-primary">In {days} days</span>
  return <span className="text-text-secondary">In {days} days</span>
}

function daysUntil(dateStr: string): number {
  const today = new Date()
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const target = new Date(dateStr + 'T00:00:00').getTime()
  return Math.round((target - todayMid) / (24 * 60 * 60 * 1000))
}

function monthShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleString('en-US', { month: 'short' })
}

function dayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return String(d.getDate())
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
