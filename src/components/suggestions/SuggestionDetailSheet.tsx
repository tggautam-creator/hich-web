/**
 * v1.3 Sprint 14 Slice C — full detail view for a Suggested Ride.
 *
 * Mirrors iOS SuggestionDetailSheet.swift section-for-section:
 *   - Trip date banner (calendar pill at top)
 *   - Classification banner (Same route / Transit dropoff / Transit pickup)
 *   - Other-user card → opens UserProfilePreviewSheet on tap
 *   - Two trip cards (your side + their side) with route + date/time
 *   - Transit breakdown card (non-direct classifications only)
 *   - "Why this match" debug card (relevance + signals)
 *   - Sticky CTA at bottom: "Request this ride" / "Offer this ride"
 *
 * Rendered inside the shared BottomSheet primitive so the chrome
 * (drag handle + close + animation + scroll-lock) is consistent
 * with other sheets in the app.
 */
import { useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import UserProfilePreviewSheet from '@/components/profile/UserProfilePreviewSheet'
import type { Suggestion, SuggestionSource } from '@/lib/suggestionsApi'

interface SuggestionDetailSheetProps {
  isOpen: boolean
  onClose: () => void
  suggestion: Suggestion
  onAct: () => void
}

export default function SuggestionDetailSheet({
  isOpen,
  onClose,
  suggestion,
  onAct,
}: SuggestionDetailSheetProps) {
  const [profileOpen, setProfileOpen] = useState(false)

  const isRider = suggestion.side === 'rider'
  const ctaLabel = isRider ? 'Request this ride' : 'Offer this ride'
  const ctaClass = isRider
    ? 'bg-primary active:bg-primary/90'
    : 'bg-success active:bg-success/90'
  const isTransit = suggestion.match_signals.classification !== 'direct'

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title="Suggested ride"
        data-testid="suggestion-detail-sheet"
      >
        {/* Trip date banner */}
        <div className="flex items-center gap-2.5 rounded-xl bg-primary/10 px-3 py-2.5 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-primary" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-text-secondary">Suggested for</p>
            <p className="text-sm font-bold text-text-primary">{formatDateBanner(suggestion.trip_date)}</p>
          </div>
        </div>

        {/* Classification banner */}
        <ClassificationBanner suggestion={suggestion} />

        {/* Other-user card → tap to open profile */}
        {suggestion.other_user?.id && (
          <button
            type="button"
            data-testid="suggestion-detail-open-profile"
            onClick={() => setProfileOpen(true)}
            className="w-full mb-4 flex items-center gap-3 rounded-2xl bg-surface px-3 py-3 active:opacity-80"
          >
            {suggestion.other_user.avatar_url ? (
              <img
                src={suggestion.other_user.avatar_url}
                alt=""
                className="h-12 w-12 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary text-lg font-bold flex items-center justify-center shrink-0">
                {(suggestion.other_user.full_name?.[0] ?? '?').toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-text-primary truncate">
                {suggestion.other_user.full_name ?? (isRider ? 'Driver' : 'Rider')}
              </p>
              {suggestion.other_user.rating_avg != null && (
                <p className="flex items-center gap-1 text-xs text-text-secondary mt-0.5">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FACC15" className="h-3 w-3" aria-hidden="true">
                    <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9" />
                  </svg>
                  {suggestion.other_user.rating_avg.toFixed(1)}
                </p>
              )}
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 text-text-secondary shrink-0" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}

        {/* Two trip cards: their side first (more relevant), then yours */}
        <TripCard suggestion={suggestion} which="their" />
        <TripCard suggestion={suggestion} which="yours" />

        {/* Transit breakdown — only for transit_dropoff / transit_pickup */}
        {isTransit && <TransitBreakdownCard suggestion={suggestion} />}

        {/* Why this match — relevance + signals */}
        <WhyThisMatchCard suggestion={suggestion} />

        {/* Sticky CTA */}
        <button
          type="button"
          data-testid="suggestion-detail-cta"
          onClick={() => {
            onAct()
            onClose()
          }}
          className={`w-full mt-2 rounded-2xl py-3.5 text-sm font-bold text-white ${ctaClass}`}
        >
          {ctaLabel}
        </button>
      </BottomSheet>

      {/* Partner profile preview — same component MessagingWindow uses. */}
      {suggestion.other_user?.id && (
        <UserProfilePreviewSheet
          isOpen={profileOpen}
          onClose={() => setProfileOpen(false)}
          userId={suggestion.other_user.id}
          fallbackName={suggestion.other_user.full_name ?? null}
          fallbackAvatarUrl={suggestion.other_user.avatar_url ?? null}
          data-testid="suggestion-detail-profile-sheet"
        />
      )}
    </>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────

function ClassificationBanner({ suggestion }: { suggestion: Suggestion }) {
  const c = suggestion.match_signals.classification
  const station = suggestion.match_signals.handoff_station_name ?? 'a transit station'
  let title = 'Same route'
  let tint = 'success'
  let explainer = "You're both going to roughly the same place around the same time. Easy direct ride."
  if (c === 'transit_dropoff') {
    title = 'Transit dropoff'
    tint = 'primary'
    explainer = `Driver drops the rider at ${station}; rider takes transit the rest of the way.`
  } else if (c === 'transit_pickup') {
    title = 'Transit pickup'
    tint = 'primary'
    explainer = `Rider takes transit to ${station}; driver picks them up there.`
  }
  const bgClass = tint === 'success' ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary'
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 ${bgClass}`}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden="true">
          {c === 'direct'
            ? <path d="M5 12h14M13 5l7 7-7 7" />
            : <path d="M4 11h16M4 11l4-4M4 11l4 4M20 13H4M20 13l-4 4M20 13l-4-4" />
          }
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base font-bold text-text-primary">{title}</p>
        <p className="text-xs text-text-secondary mt-0.5">{explainer}</p>
      </div>
    </div>
  )
}

function TripCard({
  suggestion,
  which,
}: {
  suggestion: Suggestion
  which: 'yours' | 'their'
}) {
  const source = which === 'yours'
    ? (suggestion.side === 'rider' ? suggestion.rider_source : suggestion.driver_source)
    : (suggestion.side === 'rider' ? suggestion.driver_source : suggestion.rider_source)
  const header = tripHeader(which, suggestion.side)
  return (
    <div
      data-testid={`suggestion-detail-trip-${which}`}
      className="rounded-2xl border border-border bg-white p-3.5 mb-3"
    >
      <div className="flex items-center justify-between mb-2">
        <p className={`text-[10px] font-bold tracking-wider ${which === 'yours' ? 'text-primary' : 'text-text-secondary'}`}>
          {header}
        </p>
        {which === 'yours' && (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-primary text-white rounded-full px-2 py-0.5">
            You
          </span>
        )}
      </div>
      <SourceSubtitle source={source} which={which} />
      <SourceBody source={source} tripDate={suggestion.trip_date} />
    </div>
  )
}

function SourceSubtitle({
  source,
  which,
}: {
  source: SuggestionSource | null
  which: 'yours' | 'their'
}) {
  if (source?.schedule) {
    return (
      <p className="text-[11px] text-text-secondary mb-2">
        {which === 'yours' ? 'From your posted ride' : 'From their posted ride'}
      </p>
    )
  }
  if (source?.routine) {
    const trimmed = source.routine.route_name?.trim() ?? ''
    const label = which === 'yours' ? 'From your saved routine' : 'From their saved routine'
    const text = trimmed ? `${label}: ${trimmed}` : label
    return <p className="text-[11px] text-text-secondary mb-2">{text}</p>
  }
  return null
}

function SourceBody({
  source,
  tripDate,
}: {
  source: SuggestionSource | null
  tripDate: string
}) {
  if (source?.schedule) {
    const sched = source.schedule
    const isFlexible = sched.time_flexible === true
    const timeText = !isFlexible && sched.trip_time ? friendlyTime(sched.trip_time) : 'Anytime'
    return (
      <div className="space-y-2">
        <RouteRow dotClass="bg-primary" label="From" text={cleanAddress(sched.origin_address) ?? '—'} />
        <RouteRow dotClass="bg-success" label="To" text={cleanAddress(sched.dest_address) ?? '—'} />
        <div className="flex items-center gap-3 pt-1 border-t border-border/50 mt-2 text-[11px] text-text-secondary">
          <span>{formatDateBanner(tripDate)}</span>
          <span aria-hidden="true">·</span>
          <span>{timeText}</span>
        </div>
      </div>
    )
  }
  if (source?.routine) {
    const r = source.routine
    const timeRaw = r.departure_time ?? r.arrival_time
    const timeText = timeRaw ? friendlyTime(timeRaw) : 'Anytime'
    return (
      <div className="space-y-2">
        <RouteRow dotClass="bg-primary" label="From" text={cleanAddress(r.origin_address) ?? '—'} />
        <RouteRow dotClass="bg-success" label="To" text={cleanAddress(r.dest_address) ?? '—'} />
        <div className="flex items-center gap-3 pt-1 border-t border-border/50 mt-2 text-[11px] text-text-secondary">
          <span>{formatDateBanner(tripDate)}</span>
          <span aria-hidden="true">·</span>
          <span>{timeText}</span>
        </div>
      </div>
    )
  }
  return <p className="text-sm text-text-secondary">—</p>
}

function RouteRow({
  dotClass,
  label,
  text,
}: {
  dotClass: string
  label: string
  text: string
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-text-secondary uppercase tracking-wider">{label}</p>
        <p className="text-sm text-text-primary">{text}</p>
      </div>
    </div>
  )
}

function TransitBreakdownCard({ suggestion }: { suggestion: Suggestion }) {
  const s = suggestion.match_signals
  const station = s.handoff_station_name ?? 'transit station'
  const isDropoff = s.classification === 'transit_dropoff'
  const line = s.handoff_transit_line ?? 'transit'

  const rows: Array<{ icon: string; title: string; subtitle: string }> = []
  if (isDropoff) {
    if (s.handoff_ride_minutes != null) {
      rows.push({ icon: '🚗', title: 'Driver', subtitle: `${Math.round(s.handoff_ride_minutes)} min in the car` })
    }
    if (s.handoff_walk_minutes != null) {
      rows.push({ icon: '🚶', title: `Walk to ${station}`, subtitle: `${Math.round(s.handoff_walk_minutes)} min on foot` })
    }
    if (s.handoff_transit_minutes != null) {
      rows.push({ icon: '🚆', title: line, subtitle: `${Math.round(s.handoff_transit_minutes)} min to destination` })
    }
  } else {
    if (s.handoff_transit_minutes != null) {
      rows.push({ icon: '🚆', title: `${line} to ${station}`, subtitle: `${Math.round(s.handoff_transit_minutes)} min` })
    }
    if (s.handoff_walk_minutes != null) {
      rows.push({ icon: '🚶', title: 'Walk to driver', subtitle: `${Math.round(s.handoff_walk_minutes)} min on foot` })
    }
    if (s.handoff_ride_minutes != null) {
      rows.push({ icon: '🚗', title: 'Driver', subtitle: `${Math.round(s.handoff_ride_minutes)} min in the car` })
    }
  }

  return (
    <div
      data-testid="suggestion-detail-transit-breakdown"
      className="rounded-2xl border border-border bg-white p-3.5 mb-3"
    >
      <p className="text-sm font-bold text-text-primary mb-2.5">How the handoff works</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="text-base shrink-0" aria-hidden="true">{r.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-text-primary">{r.title}</p>
              <p className="text-[11px] text-text-secondary">{r.subtitle}</p>
            </div>
          </div>
        ))}
      </div>
      {s.handoff_total_minutes != null && (
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
          <span className="text-[10px] font-bold tracking-wider text-text-secondary uppercase">Total</span>
          <span className="text-sm font-bold text-text-primary tabular-nums">{Math.round(s.handoff_total_minutes)} min</span>
        </div>
      )}
    </div>
  )
}

function WhyThisMatchCard({ suggestion }: { suggestion: Suggestion }) {
  const s = suggestion.match_signals
  const isFullyAnytime = isAnytimeBothSides(suggestion)
  let timesValue = 'One side anytime'
  if (s.time_diff_min != null) timesValue = `${Math.round(s.time_diff_min)} min apart`
  else if (isFullyAnytime) timesValue = 'Both anytime'
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Routes start', value: `${Math.round(s.origin_distance_m)} m apart` },
    { label: 'Routes end', value: `${Math.round(s.dest_distance_m)} m apart` },
    { label: 'Direction', value: `${Math.round(s.bearing_diff_deg)}° difference` },
    { label: 'Times', value: timesValue },
    { label: 'Relevance', value: `${Math.round(suggestion.relevance_score * 100)} / 100` },
  ]
  return (
    <div
      data-testid="suggestion-detail-why-card"
      className="rounded-2xl border border-border bg-white p-3.5 mb-3"
    >
      <p className="text-sm font-bold text-text-primary mb-2.5">Why this match</p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">{r.label}</span>
            <span className="font-semibold text-text-primary tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────

function tripHeader(which: 'yours' | 'their', side: Suggestion['side']): string {
  if (which === 'yours') return side === 'rider' ? 'YOUR RIDE REQUEST' : 'YOUR OFFER'
  return side === 'rider' ? "DRIVER'S ROUTE" : "RIDER'S REQUEST"
}

function cleanAddress(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isAnytimeBothSides(s: Suggestion): boolean {
  function sourceHasTime(src: SuggestionSource | null): boolean {
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

function formatDateBanner(iso: string): string {
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
  const [hStr, mStr] = hhmm.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
