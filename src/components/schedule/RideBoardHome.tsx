/**
 * Search-first Ride Board landing (2026-05-18, web parity W2).
 *
 * Replaces the legacy `RideBoard.tsx` wall-of-posts as the primary
 * `/rides/board` surface. The browse list lives on at
 * `/rides/board/browse` reachable via the "Browse all rides" link
 * below the search button — matches the iOS pattern shipped in
 * `RideBoardHomePage.swift`.
 *
 * Mode chips ("I need a ride" / "I'm driving") drive the `mode`
 * field sent to `POST /api/schedule/board/search`. Default mode
 * derives from the user's `is_driver` profile flag but they can
 * flip freely. Results card shows a match-type badge + an inline
 * transit-handoff suggestion when the server returns one (same
 * `computeTransitDropoffSuggestions` engine the iOS app uses).
 *
 * Compatibility: legacy `RideBoard.tsx` is intentionally untouched
 * in this slice — only the routing changes (main.tsx). Following
 * slices (W3-W5) layer a "Post this search" CTA, last-seats
 * persistence, my-posts shortcut, and driver-side handoff
 * propagation on top.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { getLastSeats } from '@/lib/lastSeats'
import {
  type PlaceSuggestion,
  searchPlaces,
  getPlaceCoordinates,
} from '@/lib/places'
import {
  runBoardSearch,
  type BoardSearchResult,
  type BoardSearchTransitHandoff,
  type BoardSearchMatchType,
} from '@/lib/boardSearch'
import {
  getRecentBoardSearches,
  saveRecentBoardSearch,
  fromRecentToSuggestion,
  type RecentBoardSearch,
} from '@/lib/recentBoardSearches'
import { trackEvent } from '@/lib/analytics'

type SearchMode = 'needRide' | 'offerDrive'

function serverModeFor(mode: SearchMode): 'driver' | 'rider' {
  return mode === 'needRide' ? 'driver' : 'rider'
}

function modeLabels(mode: SearchMode): {
  hero: string
  cta: string
  chipTitle: string
  chipIcon: string
} {
  if (mode === 'needRide') {
    return {
      hero: 'Find your ride.',
      cta: 'Find rides',
      chipTitle: 'I need a ride',
      chipIcon: '🧍',
    }
  }
  return {
    hero: 'Find your riders.',
    cta: 'Find riders',
    chipTitle: "I'm driving",
    chipIcon: '🚗',
  }
}

/** `YYYY-MM-DD` of today in the user's local tz — the value the
 * `<input type="date">` defaults to + the form sends to the server. */
function todayLocalIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Minutes → "47 min" or "1h 35m". */
function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`
  const hours = Math.floor(m / 60)
  const mins = m % 60
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`
}

interface FlashState { flashToast?: string }

export default function RideBoardHome() {
  const navigate = useNavigate()
  const location = useLocation()
  const isDriver = useAuthStore((s) => s.isDriver)

  // 2026-05-18 — when SchedulePage navigates back here after a
  // successful "Post this search" submit, it passes a flash message
  // via location.state. Show it as a transient toast then clear it
  // so a back/forward doesn't re-fire.
  const [flashToast, setFlashToast] = useState<string | null>(null)
  useEffect(() => {
    const incoming = (location.state as FlashState | null)?.flashToast
    if (!incoming) return
    setFlashToast(incoming)
    navigate(location.pathname, { replace: true, state: null })
    const t = setTimeout(() => { setFlashToast(null) }, 3000)
    return () => { clearTimeout(t) }
    // We deliberately depend on the route only — re-runs on actual
    // navigation, not on every internal state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  // Default to whichever side of the marketplace the user is most
  // likely searching from. Driver-flagged users get "I'm driving"
  // preselected; everyone else lands on "I need a ride."
  const [mode, setMode] = useState<SearchMode>(isDriver ? 'offerDrive' : 'needRide')

  // ── From + To autocomplete state ───────────────────────────────
  const fromSessionTokenRef = useRef<string>(crypto.randomUUID())
  const toSessionTokenRef = useRef<string>(crypto.randomUUID())
  const [fromQuery, setFromQuery] = useState('')
  const [fromSelected, setFromSelected] = useState<PlaceSuggestion | null>(null)
  const [fromSuggestions, setFromSuggestions] = useState<PlaceSuggestion[]>([])
  const [toQuery, setToQuery] = useState('')
  const [toSelected, setToSelected] = useState<PlaceSuggestion | null>(null)
  const [toSuggestions, setToSuggestions] = useState<PlaceSuggestion[]>([])

  // ── Date + time ────────────────────────────────────────────────
  const [tripDate, setTripDate] = useState<string>(todayLocalIso())
  const [includeTime, setIncludeTime] = useState(false)
  const [tripTime, setTripTime] = useState<string>('12:00')

  // ── Search + results ───────────────────────────────────────────
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [results, setResults] = useState<BoardSearchResult[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // ── Recents ────────────────────────────────────────────────────
  const [recents, setRecents] = useState<RecentBoardSearch[]>([])
  useEffect(() => {
    setRecents(getRecentBoardSearches())
  }, [])

  // ── Debounced autocomplete ────────────────────────────────────
  useEffect(() => {
    if (fromSelected) return // already a pinned selection
    const q = fromQuery.trim()
    if (q.length < 2) {
      setFromSuggestions([])
      return
    }
    const handle = setTimeout(async () => {
      try {
        const results = await searchPlaces(q, fromSessionTokenRef.current)
        setFromSuggestions(results)
      } catch {
        setFromSuggestions([])
      }
    }, 280)
    return () => { clearTimeout(handle) }
  }, [fromQuery, fromSelected])

  useEffect(() => {
    if (toSelected) return
    const q = toQuery.trim()
    if (q.length < 2) {
      setToSuggestions([])
      return
    }
    const handle = setTimeout(async () => {
      try {
        const results = await searchPlaces(q, toSessionTokenRef.current)
        setToSuggestions(results)
      } catch {
        setToSuggestions([])
      }
    }, 280)
    return () => { clearTimeout(handle) }
  }, [toQuery, toSelected])

  const canSearch = useMemo(
    () => !!fromSelected && !!toSelected && !searching,
    [fromSelected, toSelected, searching],
  )

  async function selectSuggestion(side: 'from' | 'to', suggestion: PlaceSuggestion) {
    const token = side === 'from' ? fromSessionTokenRef.current : toSessionTokenRef.current
    // Resolve coords up-front so the search request has lat/lng
    // ready without a second round-trip on submit.
    let coords = suggestion.lat != null && suggestion.lng != null
      ? { lat: suggestion.lat, lng: suggestion.lng }
      : null
    if (!coords) {
      coords = await getPlaceCoordinates(suggestion.placeId, token)
    }
    if (!coords) {
      setErrorMessage("Couldn't pin that location. Try another.")
      return
    }
    const resolved: PlaceSuggestion = {
      ...suggestion,
      lat: coords.lat,
      lng: coords.lng,
    }
    if (side === 'from') {
      setFromSelected(resolved)
      setFromQuery(resolved.fullAddress)
      setFromSuggestions([])
      fromSessionTokenRef.current = crypto.randomUUID()
    } else {
      setToSelected(resolved)
      setToQuery(resolved.fullAddress)
      setToSuggestions([])
      toSessionTokenRef.current = crypto.randomUUID()
    }
  }

  function clearFrom() {
    setFromSelected(null)
    setFromQuery('')
    setFromSuggestions([])
  }
  function clearTo() {
    setToSelected(null)
    setToQuery('')
    setToSuggestions([])
  }

  async function runSearch() {
    if (!fromSelected?.lat || !fromSelected?.lng) return
    if (!toSelected?.lat || !toSelected?.lng) return
    setSearching(true)
    setErrorMessage(null)
    try {
      const payload = {
        originLat: fromSelected.lat,
        originLng: fromSelected.lng,
        destinationLat: toSelected.lat,
        destinationLng: toSelected.lng,
        tripDate,
        tripTime: includeTime ? `${tripTime}:00` : null,
        mode: serverModeFor(mode),
      }
      const response = await runBoardSearch(payload)
      setResults(response.results ?? [])
      setHasSearched(true)
      saveRecentBoardSearch({
        fromPlaceId: fromSelected.placeId,
        fromMainText: fromSelected.mainText,
        fromFullAddress: fromSelected.fullAddress,
        fromLat: fromSelected.lat,
        fromLng: fromSelected.lng,
        toPlaceId: toSelected.placeId,
        toMainText: toSelected.mainText,
        toFullAddress: toSelected.fullAddress,
        toLat: toSelected.lat,
        toLng: toSelected.lng,
        tripDate,
        tripTime: includeTime ? `${tripTime}:00` : null,
        mode: serverModeFor(mode),
      })
      setRecents(getRecentBoardSearches())
      trackEvent('board_search_run', {
        mode: serverModeFor(mode),
        trip_date: tripDate,
        trip_time: includeTime ? `${tripTime}:00` : null,
        result_count: response.results?.length ?? 0,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error — try again.'
      setErrorMessage(msg)
      setResults([])
      setHasSearched(true)
    } finally {
      setSearching(false)
    }
  }

  function replayRecent(entry: RecentBoardSearch) {
    setMode(entry.mode === 'driver' ? 'needRide' : 'offerDrive')
    const from = fromRecentToSuggestion(entry, 'from')
    const to = fromRecentToSuggestion(entry, 'to')
    setFromSelected(from)
    setFromQuery(from.fullAddress)
    setToSelected(to)
    setToQuery(to.fullAddress)
    setTripDate(entry.tripDate)
    if (entry.tripTime) {
      setIncludeTime(true)
      setTripTime(entry.tripTime.slice(0, 5))
    } else {
      setIncludeTime(false)
    }
    // Defer until state writes settle.
    setTimeout(() => { void runSearch() }, 0)
  }

  function onClearResults() {
    setResults([])
    setHasSearched(false)
    setErrorMessage(null)
  }

  /**
   * 2026-05-18 W3 — Post-this-search empty-state CTA. Pre-fills
   * `SchedulePage` with the exact search inputs so publishing a
   * post takes one extra tap (Submit on the post page). Driver
   * seats default to the user's last-used value via `getLastSeats`.
   * After a successful post the SchedulePage navigates back to
   * `/rides/board` with a `flashToast` so the user sees a
   * confirmation banner here.
   */
  function postThisSearch() {
    if (!fromSelected || !toSelected) return
    const serverMode = serverModeFor(mode)
    const targetRoute = serverMode === 'driver' ? '/schedule/driver' : '/schedule/rider'
    navigate(targetRoute, {
      state: {
        prefillFrom: fromSelected,
        prefillTo: toSelected,
        prefillTripDate: tripDate,
        prefillTripTime: includeTime ? tripTime : undefined,
        prefillAnytime: !includeTime,
        prefillAvailableSeats: serverMode === 'driver' ? getLastSeats() : undefined,
        prefillMode: serverMode,
        returnTo: '/rides/board',
        returnFlashMessage: serverMode === 'driver'
          ? 'Posted! Riders along your route will see it shortly.'
          : 'Posted! Drivers along your route will see it shortly.',
      },
    })
    trackEvent('board_post_this_search_cta', { mode: serverMode })
  }

  function flipMode(next: SearchMode) {
    if (next === mode) return
    setMode(next)
    // Clear stale results so the user doesn't think they're seeing
    // matches for the new mode.
    onClearResults()
  }

  const labels = modeLabels(mode)

  return (
    <div className="min-h-screen bg-surface pb-32">
      <header className="flex items-center gap-3 px-4 pt-4">
        <button
          type="button"
          onClick={() => { navigate(-1) }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm border border-border"
          aria-label="Back"
          data-testid="board-home-back"
        >
          <span className="text-lg text-textPrimary">‹</span>
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => { navigate('/rides') }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm border border-border"
          aria-label="My posts"
          data-testid="board-home-my-posts"
          title="My posts"
        >
          <span className="text-base">📥</span>
        </button>
        {/* iOS RideBoardHomePage header carries three buttons: back +
            my-posts + my-routines. Web was missing the third — drivers
            with recurring routes had no in-flow shortcut to manage
            them from the search-first home. Routes to the browse list
            with state.openRoutines so the existing routines sheet
            auto-opens (same hint plumbing used by the Rides tab). */}
        <button
          type="button"
          onClick={() => { navigate('/rides/board/browse', { state: { openRoutines: true } }) }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm border border-border"
          aria-label="My routines"
          data-testid="board-home-my-routines"
          title="My routines"
        >
          <span className="text-base">🔁</span>
        </button>
      </header>

      <h1 className="px-4 pt-6 text-3xl font-extrabold text-textPrimary">
        {labels.hero}
      </h1>

      {/* Search card */}
      <section className="mx-4 mt-4 rounded-3xl bg-white p-4 shadow-sm border border-border">
        <div className="flex gap-2">
          {(['needRide', 'offerDrive'] as const).map((opt) => {
            const active = opt === mode
            return (
              <button
                key={opt}
                type="button"
                onClick={() => { flipMode(opt) }}
                className={[
                  'flex-1 rounded-full px-3 py-2 text-xs font-bold transition-colors',
                  active
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-surface text-textPrimary border border-border',
                ].join(' ')}
                data-testid={`board-home-mode-${opt}`}
              >
                {modeLabels(opt).chipIcon} {modeLabels(opt).chipTitle}
              </button>
            )
          })}
        </div>

        <PlaceField
          label="FROM"
          accent="success"
          placeholder="Pickup or starting point"
          query={fromQuery}
          onQueryChange={setFromQuery}
          selected={fromSelected}
          suggestions={fromSuggestions}
          onPick={(s) => { void selectSuggestion('from', s) }}
          onClear={clearFrom}
          testIdPrefix="board-home-from"
        />
        <PlaceField
          label="TO"
          accent="primary"
          placeholder="Destination"
          query={toQuery}
          onQueryChange={setToQuery}
          selected={toSelected}
          suggestions={toSuggestions}
          onPick={(s) => { void selectSuggestion('to', s) }}
          onClear={clearTo}
          testIdPrefix="board-home-to"
        />

        <div className="mt-4">
          <div className="flex items-center gap-3">
            <label className="flex-1">
              <span className="block text-xs font-bold tracking-wider text-textSecondary">
                WHEN
              </span>
              <input
                type="date"
                value={tripDate}
                min={todayLocalIso()}
                onChange={(e) => { setTripDate(e.target.value) }}
                className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-textPrimary"
                data-testid="board-home-date"
              />
            </label>
            <label className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                checked={includeTime}
                onChange={(e) => { setIncludeTime(e.target.checked) }}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-textSecondary">
                Specific time
              </span>
            </label>
          </div>
          {includeTime && (
            <input
              type="time"
              value={tripTime}
              onChange={(e) => { setTripTime(e.target.value) }}
              className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-textPrimary"
              data-testid="board-home-time"
            />
          )}
        </div>

        <button
          type="button"
          disabled={!canSearch}
          onClick={() => { void runSearch() }}
          className={[
            'mt-4 w-full rounded-full py-3 text-sm font-bold text-white transition-colors',
            canSearch ? 'bg-primary hover:bg-primaryDark' : 'bg-textSecondary/50 cursor-not-allowed',
          ].join(' ')}
          data-testid="board-home-search"
        >
          {searching ? 'Searching…' : labels.cta}
        </button>
      </section>

      {/* Browse all rides link */}
      <button
        type="button"
        onClick={() => { navigate('/rides/board/browse') }}
        className="mx-4 mt-4 flex w-[calc(100%-2rem)] items-center justify-between rounded-xl bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"
        data-testid="board-home-browse-all"
      >
        <span className="flex items-center gap-2">
          <span>📋</span>
          <span>Browse all rides on the board</span>
        </span>
        <span>›</span>
      </button>

      {errorMessage && (
        <div className="mx-4 mt-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </div>
      )}

      {/* Results OR recents */}
      <div className="mt-4 px-4">
        {hasSearched ? (
          <ResultsList
            results={results}
            mode={mode}
            onBrowseAll={() => { navigate('/rides/board/browse') }}
            onPostThisSearch={postThisSearch}
            onSelectResult={(r) => {
              // W5/W6 (2026-05-18) — tapping a result navigates to the
              // legacy browse page with a state hint so it auto-opens
              // the detail / confirm sheet for that specific ride. When
              // the match was a transit handoff the browse page reads
              // `state.proposedHandoff` and pre-fills the offer with
              // `proposed_dropoff_*` (forward) or `proposed_pickup_*`
              // (reverse, v1.2.1 S2.1 — rider takes transit to meet
              // driver at the station). Full parity with iOS — see
              // `RideBoardConfirmViewModel.proposedHandoff`.
              navigate('/rides/board/browse', {
                state: {
                  openRideId: r.id,
                  proposedHandoff: r.transit_handoff
                    ? {
                        station_name: r.transit_handoff.station_name,
                        station_lat: r.transit_handoff.station_lat,
                        station_lng: r.transit_handoff.station_lng,
                        direction: r.transit_handoff.direction ?? 'forward',
                      }
                    : null,
                },
              })
            }}
          />
        ) : (
          recents.length > 0 && (
            <RecentsList recents={recents} onReplay={replayRecent} />
          )
        )}
      </div>

      {/* Cross-page flash toast surfaced after a Post-this-search CTA
          submits successfully. Self-clears after 3s. */}
      {flashToast && (
        <div
          className="fixed left-1/2 bottom-24 z-50 -translate-x-1/2 rounded-full bg-success px-4 py-2 text-sm font-semibold text-white shadow-lg"
          data-testid="board-home-flash-toast"
        >
          {flashToast}
        </div>
      )}

      {/* Post-ride FAB */}
      <button
        type="button"
        onClick={() => {
          navigate(mode === 'needRide' ? '/schedule/rider' : '/schedule/driver')
        }}
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primaryDark"
        aria-label="Post a ride"
        data-testid="board-home-post-fab"
      >
        <span className="text-2xl font-bold">+</span>
      </button>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

interface PlaceFieldProps {
  label: string
  accent: 'success' | 'primary'
  placeholder: string
  query: string
  onQueryChange: (q: string) => void
  selected: PlaceSuggestion | null
  suggestions: PlaceSuggestion[]
  onPick: (s: PlaceSuggestion) => void
  onClear: () => void
  testIdPrefix: string
}

function PlaceField(props: PlaceFieldProps) {
  const dot = props.accent === 'success' ? 'bg-success' : 'bg-primary'
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <span className={['h-2 w-2 rounded-full', dot].join(' ')} />
        <span className="text-xs font-bold tracking-wider text-textSecondary">
          {props.label}
        </span>
      </div>
      {props.selected ? (
        <div className="mt-1 flex items-center justify-between rounded-xl bg-success/10 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-textPrimary">
              {props.selected.mainText}
            </div>
            <div className="truncate text-xs text-textSecondary">
              {props.selected.secondaryText}
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClear}
            className="ml-2 flex h-6 w-6 items-center justify-center rounded-full bg-textSecondary/10 text-textSecondary"
            aria-label="Clear"
            data-testid={`${props.testIdPrefix}-clear`}
          >
            ×
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={props.query}
          onChange={(e) => { props.onQueryChange(e.target.value) }}
          placeholder={props.placeholder}
          className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-textPrimary placeholder:text-textSecondary"
          data-testid={`${props.testIdPrefix}-input`}
        />
      )}
      {!props.selected && props.suggestions.length > 0 && (
        <ul className="mt-1 overflow-hidden rounded-xl border border-border bg-white shadow-sm">
          {props.suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onClick={() => { props.onPick(s) }}
                className="w-full px-3 py-2 text-left hover:bg-surface"
                data-testid={`${props.testIdPrefix}-suggestion`}
              >
                <div className="text-sm font-semibold text-textPrimary">{s.mainText}</div>
                <div className="text-xs text-textSecondary">{s.secondaryText}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface ResultsListProps {
  results: BoardSearchResult[]
  mode: SearchMode
  onBrowseAll: () => void
  onPostThisSearch: () => void
  onSelectResult: (r: BoardSearchResult) => void
}

function ResultsList(props: ResultsListProps) {
  if (props.results.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-white p-6 text-center">
        <div className="text-2xl">📭</div>
        <h3 className="mt-2 text-sm font-bold text-textPrimary">
          No rides match this date and route.
        </h3>
        <p className="mt-1 text-xs text-textSecondary">
          {props.mode === 'needRide'
            ? 'Post your trip and let a driver come to you.'
            : 'Post your trip and let riders along the way reach out.'}
        </p>
        {/* Primary CTA: one-tap publish — pre-fills SchedulePage with
            the exact inputs the user already typed for the search. */}
        <button
          type="button"
          onClick={props.onPostThisSearch}
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-primaryDark"
          data-testid="board-home-post-this-search"
        >
          {props.mode === 'needRide'
            ? '🧍 Post this as a ride request'
            : '🚗 Offer this as a drive'}
        </button>
        <div className="mt-2">
          <button
            type="button"
            onClick={props.onBrowseAll}
            className="text-xs text-textSecondary underline"
            data-testid="board-home-empty-browse"
          >
            Browse all rides
          </button>
        </div>
      </div>
    )
  }
  return (
    <ul className="flex flex-col gap-3">
      {props.results.map((r) => (
        <li key={r.id}>
          <BoardResultCard result={r} onSelect={props.onSelectResult} />
        </li>
      ))}
    </ul>
  )
}

function BoardResultCard({
  result,
  onSelect,
}: {
  result: BoardSearchResult
  onSelect: (r: BoardSearchResult) => void
}) {
  return (
    <button
      type="button"
      onClick={() => { onSelect(result) }}
      className="w-full text-left rounded-2xl border border-border bg-white p-3 shadow-sm transition-colors hover:bg-surface/50"
      data-testid="board-home-result"
    >
      <MatchBadge matchType={result.match_type ?? 'endpoint'} handoff={result.transit_handoff ?? null} />
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex items-start gap-2">
          <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-success" />
          <span className="text-textPrimary">{result.origin_address}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
          <span className="text-textPrimary">{result.dest_address}</span>
        </div>
        <div className="text-xs text-textSecondary">
          {result.trip_date} · {result.trip_time.slice(0, 5)} · {result.mode === 'driver' ? 'Offering' : 'Requesting'}
        </div>
        {result.poster?.full_name && (
          <div className="text-xs text-textSecondary">
            From {result.poster.full_name}
            {result.poster.rating_avg && ` · ★ ${result.poster.rating_avg.toFixed(1)}`}
          </div>
        )}
      </div>
      {result.transit_handoff && (
        <TransitHandoffCard handoff={result.transit_handoff} />
      )}
    </button>
  )
}

// Exported for unit testing the v1.2.1 S2.1 reverse-handoff variant
// without standing up the full RideBoardHome search + autocomplete UI.
export function MatchBadge({
  matchType,
  handoff,
}: {
  matchType: BoardSearchMatchType
  handoff: BoardSearchTransitHandoff | null
}) {
  if (matchType === 'direct') {
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-1 text-xs font-bold text-success">
        ✓ On your route
      </div>
    )
  }
  if (matchType === 'transit_handoff') {
    const total = handoff?.total_rider_minutes
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-1 text-xs font-bold text-warning">
        🚊 Drop + transit{total ? ` · ~${formatMinutes(total)} total` : ''}
      </div>
    )
  }
  // v1.2.1 S2.1 (2026-05-21) — reverse hand-off: rider takes transit
  // TO a station on the route, then meets the driver. Different tint
  // from the forward (warning) variant so users can scan the list and
  // know at a glance which direction the hand-off goes. Mirrors iOS
  // RideBoardHomePage.swift:842-849 — primary tint, "Meet via transit"
  // copy verbatim, optional total minutes appended.
  if (matchType === 'reverse_transit_handoff') {
    const total = handoff?.total_rider_minutes
    return (
      <div
        data-testid="board-match-badge-reverse"
        className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-xs font-bold text-primary"
      >
        🚶 Meet via transit{total ? ` · ~${formatMinutes(total)} total` : ''}
      </div>
    )
  }
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-xs font-bold text-primary">
      ⌖ Nearby
    </div>
  )
}

// Exported for unit testing the v1.2.1 S2.1 direction-aware copy
// (forward warning tint vs reverse primary tint + leg framing flip)
// without standing up the full RideBoardHome search + autocomplete UI.
export function TransitHandoffCard({ handoff }: { handoff: BoardSearchTransitHandoff }) {
  // v1.2.1 S2.1 — direction-aware copy + tint. Forward = warning tint
  // + "Drop at X". Reverse = primary tint + "Take transit to X to meet
  // driver." Same chrome (rounded card + tinted border + tinted bg) so
  // both render visually consistent in the result list. Mirrors iOS
  // RideBoardHomePage.swift::transitHandoffCard (889-947).
  const isReverse = handoff.direction === 'reverse'
  const containerClass = isReverse
    ? 'mt-2 rounded-xl border border-primary/30 bg-primary/5 p-3'
    : 'mt-2 rounded-xl border border-warning/30 bg-warning/5 p-3'
  const headline = isReverse
    ? `Take transit to ${handoff.station_name}`
    : `Drop at ${handoff.station_name}`
  // Forward: transit goes FROM station TO dest. Reverse: transit goes
  // FROM rider's pickup TO station. Same field (transit_to_dest_minutes)
  // but the framing flips per direction.
  const legDescription = handoff.transit_option
    ? isReverse
      ? `${handoff.transit_option.line_name} · ${formatMinutes(handoff.transit_to_dest_minutes)} from your pickup`
      : `${handoff.transit_option.line_name} · ${formatMinutes(handoff.transit_to_dest_minutes)} to your destination`
    : null
  const breakdown = isReverse
    ? `Walk ${handoff.walk_to_station_minutes} min · transit ${formatMinutes(handoff.transit_to_dest_minutes)} · ~${formatMinutes(handoff.total_rider_minutes)} total + ride with driver`
    : `Walk ${handoff.walk_to_station_minutes} min · ride ${formatMinutes(handoff.transit_to_dest_minutes)} · ~${formatMinutes(handoff.total_rider_minutes)} total`
  return (
    <div className={containerClass} data-testid="board-transit-handoff-card">
      <div className="text-sm font-bold text-textPrimary">{headline}</div>
      {handoff.transit_option ? (
        <>
          <div className="text-xs text-textSecondary">{legDescription}</div>
          <div className="mt-0.5 text-[11px] text-textSecondary/85">{breakdown}</div>
        </>
      ) : (
        <div className="text-xs text-textSecondary">
          Transit info unavailable — verify before booking
        </div>
      )}
    </div>
  )
}

interface RecentsListProps {
  recents: RecentBoardSearch[]
  onReplay: (r: RecentBoardSearch) => void
}

function RecentsList({ recents, onReplay }: RecentsListProps) {
  return (
    <div>
      <div className="px-1 pb-2 text-xs font-bold tracking-wider text-textSecondary">
        RECENT SEARCHES
      </div>
      <ul className="overflow-hidden rounded-2xl border border-border bg-white">
        {recents.map((r, idx) => (
          <li key={r.id} className={idx > 0 ? 'border-t border-border' : ''}>
            <button
              type="button"
              onClick={() => { onReplay(r) }}
              className="flex w-full items-center justify-between px-3 py-3 text-left hover:bg-surface"
              data-testid="board-home-recent"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-textPrimary">
                  {r.fromMainText} → {r.toMainText}
                </div>
                <div className="text-xs text-textSecondary">
                  {r.tripDate}{r.tripTime ? ` · ${r.tripTime.slice(0, 5)}` : ' · Anytime'}
                </div>
              </div>
              <span className="ml-2 text-textSecondary">›</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
