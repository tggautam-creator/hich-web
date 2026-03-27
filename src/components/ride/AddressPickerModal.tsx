/**
 * AddressPickerModal — BottomSheet for adding/editing a saved address.
 *
 * Uses Google Places autocomplete (searchPlaces) to find an address,
 * then saves it via the /api/addresses endpoint.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import { searchPlaces, getPlaceCoordinates } from '@/lib/places'
import { supabase } from '@/lib/supabase'
import type { PlaceSuggestion } from '@/lib/places'

interface AddressPickerModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
  presetLabel?: 'home' | 'work' | null
  'data-testid'?: string
}

export default function AddressPickerModal({
  isOpen,
  onClose,
  onSaved,
  presetLabel = null,
  'data-testid': testId,
}: AddressPickerModalProps) {
  const [label, setLabel] = useState(presetLabel ?? '')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceSuggestion[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setLabel(presetLabel ?? '')
      setQuery('')
      setResults([])
      setError(null)
      setSaving(false)
    }
  }, [isOpen, presetLabel])

  const handleSearch = useCallback((input: string) => {
    setQuery(input)
    setError(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!input.trim()) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      const places = await searchPlaces(input)
      setResults(places)
    }, 300)
  }, [])

  const handleSelect = useCallback(async (place: PlaceSuggestion) => {
    const currentLabel = label.trim()
    if (!currentLabel) {
      setError('Please enter a label for this address')
      return
    }

    setSaving(true)
    setError(null)

    try {
      // Resolve coordinates
      let lat = place.lat
      let lng = place.lng
      if (lat == null || lng == null) {
        const coords = await getPlaceCoordinates(place.placeId)
        if (!coords) {
          setError('Could not resolve address coordinates')
          setSaving(false)
          return
        }
        lat = coords.lat
        lng = coords.lng
      }

      // Save via API
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setError('Not authenticated')
        setSaving(false)
        return
      }

      const resp = await fetch('/api/addresses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          label: currentLabel,
          place_id: place.placeId,
          main_text: place.mainText,
          secondary_text: place.secondaryText,
          full_address: place.fullAddress,
          lat,
          lng,
        }),
      })

      if (!resp.ok) {
        const body = await resp.json().catch(() => null) as { error?: { message?: string } } | null
        setError(body?.error?.message ?? 'Failed to save address')
        setSaving(false)
        return
      }

      onSaved()
      onClose()
    } catch {
      setError('Something went wrong')
    } finally {
      setSaving(false)
    }
  }, [label, onSaved, onClose])

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={presetLabel ? `Set ${presetLabel} address` : 'Add address'}
      data-testid={testId ?? 'address-picker-modal'}
    >
      <div className="px-4 pb-6 space-y-4">
        {/* Label input */}
        {!presetLabel && (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Gym, Library"
              maxLength={30}
              className="w-full rounded-xl border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-primary focus:outline-none"
              data-testid="address-label-input"
            />
          </div>
        )}

        {/* Search input */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Address</label>
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search for an address..."
            className="w-full rounded-xl border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-primary focus:outline-none"
            autoFocus
            data-testid="address-search-input"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-danger" data-testid="address-picker-error">{error}</p>
        )}

        {/* Results */}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {results.map((place) => (
            <button
              key={place.placeId}
              onClick={() => handleSelect(place)}
              disabled={saving}
              className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-surface transition-colors disabled:opacity-50"
              data-testid="address-result-item"
            >
              <p className="text-sm font-medium text-text-primary truncate">{place.mainText}</p>
              <p className="text-xs text-text-secondary truncate">{place.secondaryText}</p>
            </button>
          ))}
          {query.trim() && results.length === 0 && !saving && (
            <p className="text-xs text-text-secondary text-center py-4">No results found</p>
          )}
        </div>

        {saving && (
          <div className="flex justify-center py-2">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
