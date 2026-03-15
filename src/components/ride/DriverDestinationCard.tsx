import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { searchPlaces, getPlaceCoordinates } from '@/lib/places'
import type { PlaceSuggestion } from '@/lib/places'
import type { TransitDropoffSuggestion } from './TransitSuggestionCard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverDestinationCardProps {
  rideId: string
  driverId: string
  'data-testid'?: string
  onSuggestionsReceived?: (suggestions: TransitDropoffSuggestion[]) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriverDestinationCard({
  rideId,
  driverId,
  'data-testid': testId = 'driver-destination-card',
  onSuggestionsReceived,
}: DriverDestinationCardProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPlace, setSelectedPlace] = useState<PlaceSuggestion | null>(null)
  const [suggestions, setSuggestions] = useState<TransitDropoffSuggestion[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-fill from driver routines on mount
  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: routines } = await supabase
        .from('driver_routines')
        .select('dest_address, destination')
        .eq('user_id', driverId)
        .eq('is_active', true)
        .limit(1)

      if (routines && routines.length > 0 && routines[0].dest_address) {
        setQuery(routines[0].dest_address)
      }
    })()
  }, [driverId])

  // Debounced place search
  const handleQueryChange = useCallback((val: string) => {
    setQuery(val)
    setSelectedPlace(null)
    setError(null)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (val.trim().length < 3) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(() => {
      setSearching(true)
      void searchPlaces(val).then((r) => {
        setResults(r)
        setSearching(false)
      })
    }, 350)
  }, [])

  const handleSelect = useCallback((place: PlaceSuggestion) => {
    setSelectedPlace(place)
    setQuery(place.fullAddress)
    setResults([])
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!selectedPlace) return
    setSubmitting(true)
    setError(null)

    try {
      const coords = await getPlaceCoordinates(selectedPlace.placeId)
      if (!coords) {
        setError('Could not resolve place coordinates')
        setSubmitting(false)
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Not authenticated')
        setSubmitting(false)
        return
      }

      const resp = await fetch(`/api/rides/${rideId}/driver-destination`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          destination_lat: coords.lat,
          destination_lng: coords.lng,
          destination_name: selectedPlace.fullAddress,
        }),
      })

      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { error?: { message?: string } } | null
        setError(body?.error?.message ?? 'Failed to set destination')
        setSubmitting(false)
        return
      }

      const data = (await resp.json()) as { suggestions?: TransitDropoffSuggestion[] }
      const received = data.suggestions ?? []
      setSuggestions(received)
      setSubmitted(true)
      onSuggestionsReceived?.(received)
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }, [selectedPlace, rideId, onSuggestionsReceived])

  // After submission with suggestions, let parent handle rendering them
  if (submitted && suggestions.length > 0) {
    return null
  }

  // After submission with no suggestions
  if (submitted && suggestions.length === 0) {
    return (
      <div data-testid={testId} className="mx-3 my-2 rounded-2xl bg-surface border border-border p-3">
        <p className="text-xs text-text-secondary text-center">
          No transit stations found along your route. You can suggest a dropoff manually.
        </p>
      </div>
    )
  }

  return (
    <div data-testid={testId} className="mx-3 my-2 rounded-2xl bg-primary/5 border border-primary/20 p-3">
      <p className="text-xs font-semibold text-primary mb-2">Where are you headed?</p>
      <p className="text-[10px] text-text-secondary mb-2">
        We&apos;ll find transit stations along your route where you can drop off the rider.
      </p>

      {/* Search input */}
      <div className="relative">
        <input
          data-testid="driver-dest-input"
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Enter your destination..."
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {searching && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}
      </div>

      {/* Place suggestions dropdown */}
      {results.length > 0 && (
        <div className="mt-1 rounded-lg border border-border bg-white shadow-sm overflow-hidden">
          {results.map((place) => (
            <button
              key={place.placeId}
              data-testid="driver-dest-result"
              onClick={() => handleSelect(place)}
              className="w-full px-3 py-2 text-left hover:bg-surface transition-colors"
            >
              <p className="text-xs font-medium text-text-primary truncate">{place.mainText}</p>
              <p className="text-[10px] text-text-secondary truncate">{place.secondaryText}</p>
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="mt-1 text-[10px] text-danger">{error}</p>
      )}

      {/* Submit */}
      <button
        data-testid="driver-dest-submit"
        onClick={handleSubmit}
        disabled={!selectedPlace || submitting}
        className="mt-2 w-full rounded-lg bg-primary py-2 text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
      >
        {submitting ? 'Finding transit stations...' : 'Find transit dropoffs'}
      </button>
    </div>
  )
}
