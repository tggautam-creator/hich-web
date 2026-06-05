/**
 * v1.3 Sprint 14 Slice B — single Suggested Ride card.
 *
 * Mirrors iOS SuggestedRideCard.swift (density: compact). Used in the
 * home-page hero stack. The transit per-leg breakdown is intentionally
 * deferred to Slice C's SuggestionDetailSheet — keeping the home
 * card light keeps the map-first UX (cards stack above the search
 * pill; vertical real estate matters).
 *
 * CTA is role-aware (matches the role-by-IDs rule):
 *   - viewer.side === 'rider' → "Request this ride" (primary tint)
 *   - viewer.side === 'driver' → "Offer this ride" (success/green)
 */
import type { Suggestion } from '@/lib/suggestionsApi'

interface SuggestedRideCardProps {
  suggestion: Suggestion
  onAct: () => void
  onDismiss: () => void
  /** Open the detail sheet (Slice C). No-op until that lands. */
  onTap?: () => void
  'data-testid'?: string
}

export default function SuggestedRideCard({
  suggestion,
  onAct,
  onDismiss,
  onTap,
  'data-testid': testId,
}: SuggestedRideCardProps) {
  const isRider = suggestion.side === 'rider'
  const ctaLabel = isRider ? 'Request this ride' : 'Offer this ride'
  const ctaClass = isRider
    ? 'bg-primary text-white active:bg-primary/90'
    : 'bg-success text-white active:bg-success/90'

  const badge = badgeDescriptor(suggestion)
  const name = displayName(suggestion)
  const destination = destinationLine(suggestion)
  const dateTime = dateTimeLine(suggestion)
  const totalLabel = totalTimeLabel(suggestion)
  const rating = suggestion.other_user?.rating_avg ?? null

  return (
    <div
      data-testid={testId ?? `suggested-ride-card-${suggestion.id}`}
      className="w-full rounded-2xl bg-white/95 backdrop-blur-md shadow-md ring-1 ring-black/5 px-3.5 pt-3 pb-3"
    >
      {/* Header — classification badge + dismiss X */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${badge.bgClass} ${badge.textClass}`}>
          {badge.icon}
          {badge.label}
        </span>
        <button
          type="button"
          data-testid={`suggested-ride-card-dismiss-${suggestion.id}`}
          onClick={onDismiss}
          aria-label="Dismiss suggestion"
          className="h-6 w-6 rounded-full bg-surface/80 flex items-center justify-center text-text-secondary active:opacity-60"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body — tappable region opens the detail sheet (Slice C). */}
      <button
        type="button"
        onClick={onTap}
        className="w-full text-left active:opacity-90 transition-opacity"
        aria-label={`View suggestion: ${name} ${destination ?? ''}`.trim()}
        disabled={!onTap}
      >
        <div className="flex items-start gap-3">
          {/* Avatar (initials fallback) */}
          {suggestion.other_user?.avatar_url ? (
            <img
              src={suggestion.other_user.avatar_url}
              alt=""
              className="h-9 w-9 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="h-9 w-9 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center shrink-0">
              {name[0]?.toUpperCase() ?? '?'}
            </div>
          )}

          {/* Name + dest + date/time stack */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{name}</p>
            {destination && (
              <p className="text-xs text-text-primary truncate mt-0.5">{destination}</p>
            )}
            {dateTime && (
              <p className="flex items-center gap-1 text-[11px] text-text-secondary mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-2.5 w-2.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {dateTime}
              </p>
            )}
          </div>

          {/* Total time + rating on the right */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            {totalLabel && (
              <span className="text-sm font-bold text-text-primary tabular-nums">{totalLabel}</span>
            )}
            {rating != null && (
              <span className="flex items-center gap-0.5 text-[11px] text-text-secondary">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FACC15" className="h-2.5 w-2.5" aria-hidden="true">
                  <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9" />
                </svg>
                {rating.toFixed(1)}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* CTA */}
      <button
        type="button"
        data-testid={`suggested-ride-card-cta-${suggestion.id}`}
        onClick={onAct}
        className={`mt-3 w-full rounded-xl py-2.5 text-sm font-semibold ${ctaClass}`}
      >
        {ctaLabel}
      </button>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────

interface Badge {
  label: string
  icon: React.ReactNode
  bgClass: string
  textClass: string
}

function badgeDescriptor(s: Suggestion): Badge {
  const c = s.match_signals.classification
  if (c === 'direct') {
    return {
      label: 'Same route',
      icon: <span aria-hidden="true">&#x2192;</span>,
      bgClass: 'bg-success/15',
      textClass: 'text-success',
    }
  }
  return {
    label: c === 'transit_dropoff' ? 'Transit dropoff' : 'Transit pickup',
    icon: <span aria-hidden="true">&#x21D2;</span>,
    bgClass: 'bg-primary/15',
    textClass: 'text-primary',
  }
}

function displayName(s: Suggestion): string {
  const raw = s.other_user?.full_name?.trim() ?? ''
  if (!raw) return s.side === 'rider' ? 'Driver' : 'Rider'
  return raw.split(/\s+/)[0] ?? raw
}

function otherSideSource(s: Suggestion) {
  return s.side === 'rider' ? s.driver_source : s.rider_source
}

function destinationLine(s: Suggestion): string | null {
  const other = otherSideSource(s)
  const viewer = s.side === 'rider' ? s.rider_source : s.driver_source
  const dest =
    other?.schedule?.dest_address
    ?? other?.routine?.dest_address
    ?? viewer?.schedule?.dest_address
    ?? viewer?.routine?.dest_address
  if (!dest) return null
  return dest.split(',')[0] ?? dest
}

function dateTimeLine(s: Suggestion): string | null {
  const other = otherSideSource(s)
  const dateStr = friendlyDate(s.trip_date)
  const flexible = other?.schedule?.time_flexible === true
  const isFullyAnytime = isAnytimeBothSides(s)

  let timeStr: string | null = null
  if (flexible) {
    timeStr = 'Anytime'
  } else {
    const raw = other?.schedule?.trip_time
      ?? other?.routine?.departure_time
      ?? other?.routine?.arrival_time
    if (raw) {
      timeStr = friendlyTime(raw)
    } else if (isFullyAnytime) {
      timeStr = 'Anytime'
    }
  }

  const parts = [dateStr, timeStr].filter((p): p is string => Boolean(p))
  return parts.length > 0 ? parts.join(' · ') : null
}

function totalTimeLabel(s: Suggestion): string | null {
  const total = s.match_signals.handoff_total_minutes
  if (total == null) return null
  return `${Math.round(total)} min`
}

function isAnytimeBothSides(s: Suggestion): boolean {
  function sourceHasTime(src: typeof s.rider_source) {
    if (src?.schedule) {
      if (src.schedule.time_flexible === true) return false
      return Boolean(src.schedule.trip_time && src.schedule.trip_time.length > 0)
    }
    if (src?.routine) {
      const dep = src.routine.departure_time?.length ?? 0
      const arr = src.routine.arrival_time?.length ?? 0
      return dep > 0 || arr > 0
    }
    return false
  }
  return !sourceHasTime(s.rider_source) && !sourceHasTime(s.driver_source)
}

function friendlyDate(iso: string): string | null {
  // iso is YYYY-MM-DD in local TZ. Parse without UTC drift.
  const [yyyy, mm, dd] = iso.split('-').map((n) => Number(n))
  if (!yyyy || !mm || !dd) return iso
  const d = new Date(yyyy, mm - 1, dd)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const dCopy = new Date(d)
  dCopy.setHours(0, 0, 0, 0)
  if (dCopy.getTime() === today.getTime()) return 'Today'
  if (dCopy.getTime() === tomorrow.getTime()) return 'Tomorrow'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function friendlyTime(hhmm: string): string {
  // "HH:MM" or "HH:MM:SS" → "h:mm a"
  const [hStr, mStr] = hhmm.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
