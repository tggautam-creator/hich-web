import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  searchPlaces,
  getRecentDestinations,
  saveRecentDestination,
  type PlaceSuggestion,
} from '@/lib/places'
import { getDirections } from '@/lib/directions'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DestinationSearchProps {
  'data-testid'?: string
}

interface LocationState {
  locationName?: string
  originLat?: number
  originLng?: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DestinationSearch({ 'data-testid': testId }: DestinationSearchProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const locState = location.state as LocationState | null
  const fromName = locState?.locationName ?? 'Current Location'
  const originLat = locState?.originLat
  const originLng = locState?.originLng

  const inputRef = useRef<HTMLInputElement>(null)
  const sessionTokenRef = useRef(crypto.randomUUID())

  const [query,        setQuery]        = useState('')
  const [suggestions,  setSuggestions]  = useState<PlaceSuggestion[]>([])
  const [isLoading,    setIsLoading]    = useState(false)
  const [recent,       setRecent]       = useState<PlaceSuggestion[]>([])
  const [selectedDest, setSelectedDest] = useState<PlaceSuggestion | null>(null)
  const [isResolving,   setIsResolving]  = useState(false)

  // Load recent destinations once on mount
  useEffect(() => {
    setRecent(getRecentDestinations())
  }, [])

  // Auto-focus the input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search — fires 300 ms after the user stops typing
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([])
      setIsLoading(false)
      return
    }

    const timer = setTimeout(() => {
      setIsLoading(true)
      void searchPlaces(query, sessionTokenRef.current).then((results) => {
        setSuggestions(results)
        setIsLoading(false)
      })
    }, 300)

    return () => { clearTimeout(timer) }
  }, [query])

  function handleSelect(place: PlaceSuggestion) {
    setSelectedDest(place)
    setQuery(place.mainText)
    setSuggestions([])
    inputRef.current?.blur()
  }

  async function handleDone() {
    if (!selectedDest) return
    saveRecentDestination(selectedDest)

    // Fetch real driving directions via the Maps JS API DirectionsService
    setIsResolving(true)
    try {
      if (originLat != null && originLng != null) {
        const directions = await getDirections(originLat, originLng, selectedDest.placeId)
        if (directions) {
          navigate('/ride/confirm', {
            state: {
              destination: selectedDest,
              estimatedDistanceKm: directions.distance_km,
              estimatedDurationMin: directions.duration_min,
              polyline: directions.polyline,
              originLat,
              originLng,
              destinationLat: directions.destLat,
              destinationLng: directions.destLng,
            },
          })
          return
        }
      }
    } catch {
      // Fall through to default navigation
    } finally {
      setIsResolving(false)
    }

    // Fallback: navigate without real estimates (uses defaults)
    navigate('/ride/confirm', { state: { destination: selectedDest, originLat, originLng } })
  }

  function handleInputChange(value: string) {
    setQuery(value)
    if (selectedDest && value !== selectedDest.mainText) {
      setSelectedDest(null)
    }
  }

  // Allow user to use their typed text as a manual destination when no API results
  function handleUseTypedText() {
    const text = query.trim()
    if (!text) return
    const manualPlace: PlaceSuggestion = {
      placeId: `manual-${Date.now()}`,
      mainText: text,
      secondaryText: '',
      fullAddress: text,
    }
    handleSelect(manualPlace)
  }

  const showRecent  = !query.trim() && recent.length > 0
  const showResults = Boolean(query.trim()) && !isLoading && !selectedDest
  const showManualOption = showResults && suggestions.length === 0

  return (
    <div
      data-testid={testId ?? 'destination-search-page'}
      className="min-h-dvh w-full bg-surface flex flex-col font-sans"
    >

      {/* ── Back arrow ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center px-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)', paddingBottom: '0.5rem' }}
      >
        <button
          data-testid="back-button"
          onClick={() => { navigate(-1 as unknown as string) }}
          aria-label="Go back"
          className="p-1 shrink-0 text-text-primary active:opacity-60 transition-opacity"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="m12 5-7 7 7 7" />
          </svg>
        </button>
      </div>

      {/* ── From / Drop Off card ────────────────────────────────────────────── */}
      <div className="mx-4 mb-4 bg-white rounded-2xl shadow-sm border border-border p-4">
        {/* From row */}
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">From</p>
            <p data-testid="from-label" className="text-sm text-text-primary truncate">{fromName}</p>
          </div>
        </div>

        {/* Dotted connector */}
        <div className="ml-[4.5px] h-5 border-l border-dashed border-text-secondary/30" />

        {/* Drop Off row */}
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-success shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Drop Off</p>
            <input
              ref={inputRef}
              data-testid="search-input"
              type="text"
              value={query}
              onChange={(e) => { handleInputChange(e.target.value) }}
              placeholder="Where are you going?"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full text-sm font-medium text-text-primary placeholder:text-text-secondary/60 outline-none bg-transparent"
              aria-label="Search destination"
            />
          </div>

          {/* Clear button */}
          {query && (
            <button
              data-testid="clear-button"
              onClick={() => { setQuery(''); setSelectedDest(null) }}
              aria-label="Clear search"
              className="p-1 text-text-secondary active:opacity-60 transition-opacity shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Scrollable body ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Loading indicator */}
        {isLoading && (
          <div
            data-testid="search-loading"
            className="flex items-center gap-3 px-5 py-4 text-text-secondary text-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 animate-spin text-primary" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Searching…
          </div>
        )}

        {/* Recent destinations — shown when input is empty */}
        {showRecent && (
          <section data-testid="recent-section">
            <p className="px-5 pt-2 pb-2 text-xs font-semibold text-text-secondary uppercase tracking-wider">
              Recent
            </p>
            <ul>
              {recent.map((place) => (
                <li key={place.placeId}>
                  <button
                    data-testid="recent-item"
                    onClick={() => { handleSelect(place) }}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-white active:bg-white transition-colors border-b border-border/50"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span className="text-sm font-medium text-text-primary truncate">
                      {place.mainText}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Search results */}
        {showResults && suggestions.length > 0 && (
          <ul data-testid="search-results">
            {suggestions.map((place) => (
              <li key={place.placeId}>
                <button
                  data-testid="result-item"
                  onClick={() => { handleSelect(place) }}
                  className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-white active:bg-white transition-colors border-b border-border/50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-primary" aria-hidden="true">
                    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {place.mainText}
                    </span>
                    <span className="text-xs text-text-secondary truncate">
                      {place.secondaryText}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Manual destination fallback — shown when API returns no results */}
        {showManualOption && (
          <div data-testid="no-results">
            <button
              data-testid="use-typed-text"
              onClick={handleUseTypedText}
              className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white active:bg-white transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-primary" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium text-text-primary truncate">
                  Use &ldquo;{query}&rdquo;
                </span>
                <span className="text-xs text-text-secondary">Tap to set as destination</span>
              </span>
            </button>
          </div>
        )}
      </div>

      {/* ── Done button — visible when destination selected ───────────────── */}
      <div
        className="px-4 pb-4"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
      >
        <button
          data-testid="done-button"
          onClick={() => { void handleDone() }}
          disabled={!selectedDest || isResolving}
          className={`w-full rounded-2xl py-4 text-base font-semibold text-white transition-all ${
            selectedDest && !isResolving
              ? 'bg-primary active:scale-[0.99]'
              : 'bg-primary/40 cursor-not-allowed'
          }`}
        >
          {isResolving ? 'Getting route...' : 'Done'}
        </button>
      </div>
    </div>
  )
}
