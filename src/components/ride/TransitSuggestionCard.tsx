import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { useMap } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { RoutePolyline, MapBoundsFitter, decodePolyline } from '@/components/map/RoutePreview'
import { MAP_ID } from '@/lib/mapConstants'

// ── Types (exported for reuse by DriverDestinationCard) ──────────────────────

export interface TransitOption {
  type: string
  icon: string
  line_name: string
  departure_stop?: string
  arrival_stop?: string
  duration_minutes?: number
  walk_minutes: number
  total_minutes: number
}

export interface TransitDropoffSuggestion {
  station_name: string
  station_lat: number
  station_lng: number
  station_place_id: string
  station_address: string
  transit_options: TransitOption[]
  walk_to_station_minutes: number
  driver_detour_minutes: number
  transit_to_dest_minutes: number
  total_rider_minutes: number
  rider_progress_pct?: number
  transit_polyline?: string | null
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface TransitSuggestionPickerProps {
  rideId: string
  suggestions: TransitDropoffSuggestion[]
  driverRoutePolyline?: string | null
  pickupLat?: number | null
  pickupLng?: number | null
  riderDestLat?: number | null
  riderDestLng?: number | null
  riderDestName?: string | null
  driverDestLat?: number | null
  driverDestLng?: number | null
  driverDestName?: string | null
  'data-testid'?: string
  onPicked?: () => void
}

interface TransitSuggestionCardProps {
  suggestion: TransitDropoffSuggestion
  isRider: boolean
  onAccept?: () => void
  onCounter?: () => void
  transitPolyline?: string | null
  pickupLat?: number | null
  pickupLng?: number | null
  riderDestLat?: number | null
  riderDestLng?: number | null
  riderDestName?: string | null
  driverDestLat?: number | null
  driverDestLng?: number | null
  driverDestName?: string | null
  driverRoutePolyline?: string | null
  'data-testid'?: string
}

// ── Renderless helper: pan map to selected station ───────────────────────────

function SelectedStationFocus({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    map.panTo({ lat, lng })
  }, [map, lat, lng])
  return null
}

// ── Transit Suggestion Picker (driver view: pick from suggestions) ───────────

export function TransitSuggestionPicker({
  rideId,
  suggestions,
  driverRoutePolyline,
  pickupLat,
  pickupLng,
  riderDestLat,
  riderDestLng,
  riderDestName,
  driverDestLat,
  driverDestLng,
  driverDestName,
  'data-testid': testId = 'transit-suggestion-picker',
  onPicked,
}: TransitSuggestionPickerProps) {
  const [picking, setPicking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(suggestions.length > 0 ? 0 : null)
  const cardRefs = useRef<globalThis.Map<number, HTMLDivElement>>(new globalThis.Map())

  // Scroll selected card into view (e.g. when tapping a map marker)
  useEffect(() => {
    if (selectedIdx !== null) {
      const el = cardRefs.current.get(selectedIdx)
      if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedIdx])

  // Compute bounds for the map to fit all markers + route endpoints
  const boundsPoints = useMemo(() => {
    const pts: Array<{ lat: number; lng: number }> = suggestions.map(s => ({ lat: s.station_lat, lng: s.station_lng }))
    if (pickupLat != null && pickupLng != null) pts.push({ lat: pickupLat, lng: pickupLng })
    if (riderDestLat != null && riderDestLng != null) pts.push({ lat: riderDestLat, lng: riderDestLng })
    if (driverDestLat != null && driverDestLng != null) pts.push({ lat: driverDestLat, lng: driverDestLng })
    if (driverRoutePolyline) {
      const decoded = decodePolyline(driverRoutePolyline)
      if (decoded.length > 0) {
        pts.push(decoded[0])
        pts.push(decoded[decoded.length - 1])
      }
    }
    return pts
  }, [suggestions, pickupLat, pickupLng, riderDestLat, riderDestLng, driverDestLat, driverDestLng, driverRoutePolyline])

  const handlePick = useCallback(async (suggestion: TransitDropoffSuggestion) => {
    setPicking(suggestion.station_place_id)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`/api/rides/${rideId}/suggest-transit-dropoff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          station_name: suggestion.station_name,
          station_lat: suggestion.station_lat,
          station_lng: suggestion.station_lng,
          station_place_id: suggestion.station_place_id,
          station_address: suggestion.station_address,
          transit_options: suggestion.transit_options,
          walk_to_station_minutes: suggestion.walk_to_station_minutes,
          transit_to_dest_minutes: suggestion.transit_to_dest_minutes,
          total_rider_minutes: suggestion.total_rider_minutes,
          transit_polyline: suggestion.transit_polyline ?? null,
          rider_progress_pct: suggestion.rider_progress_pct ?? null,
        }),
      })

      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { error?: { message?: string } } | null
        setError(body?.error?.message ?? 'Failed to suggest dropoff')
        return
      }

      onPicked?.()
    } catch {
      setError('Network error')
    } finally {
      setPicking(null)
    }
  }, [rideId, onPicked])

  if (suggestions.length === 0) return null

  return (
    <div data-testid={testId} className="mx-3 my-2 flex flex-col max-h-[70dvh] shrink-0">
      <p className="text-xs font-semibold text-primary mb-1.5 shrink-0">
        Transit stations along your route
      </p>
      <p className="text-[10px] text-text-secondary mb-2 shrink-0">
        Pick a station to suggest as the dropoff point. The rider will see transit options to their destination.
      </p>

      {/* ── Route preview map ─────────────────────────────────────────── */}
      {driverRoutePolyline && (
        <div data-testid="route-preview-map" className="shrink-0 rounded-2xl overflow-hidden border border-border mb-2" style={{ height: '180px' }}>
          <Map
            mapId={MAP_ID}
            defaultZoom={12}
            defaultCenter={suggestions[0] ? { lat: suggestions[0].station_lat, lng: suggestions[0].station_lng } : { lat: 38.5, lng: -121.7 }}
            gestureHandling="greedy"
            disableDefaultUI
            className="h-full w-full"
          >
            {/* Driver's route polyline */}
            <RoutePolyline encodedPath={driverRoutePolyline} color="#4F46E5" weight={4} fitBounds={false} />

            {/* Fit bounds to all markers */}
            <MapBoundsFitter points={boundsPoints} />

            {/* Pickup marker */}
            {pickupLat != null && pickupLng != null && (
              <AdvancedMarker position={{ lat: pickupLat, lng: pickupLng }}>
                <div className="flex flex-col items-center">
                  <div className="bg-success text-white rounded-full px-1.5 py-0.5 text-[9px] font-bold shadow mb-0.5">PICKUP</div>
                  <div className="h-3 w-3 rounded-full bg-success border-2 border-white shadow" />
                </div>
              </AdvancedMarker>
            )}

            {/* Station markers */}
            {suggestions.map((s, idx) => (
              <AdvancedMarker
                key={s.station_place_id}
                position={{ lat: s.station_lat, lng: s.station_lng }}
                onClick={() => setSelectedIdx(idx)}
                zIndex={selectedIdx === idx ? 10 : 1}
              >
                <div
                  data-testid={`station-marker-${idx}`}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white shadow-md text-xs font-bold text-white transition-transform ${
                    selectedIdx === idx ? 'bg-primary scale-125' : 'bg-text-secondary scale-100'
                  }`}
                >
                  {idx + 1}
                </div>
              </AdvancedMarker>
            ))}

            {/* Rider destination marker */}
            {riderDestLat != null && riderDestLng != null && (
              <AdvancedMarker position={{ lat: riderDestLat, lng: riderDestLng }} zIndex={2}>
                <div className="flex flex-col items-center">
                  <div className="bg-danger text-white rounded-full px-1.5 py-0.5 text-[9px] font-bold shadow mb-0.5">
                    {riderDestName ? riderDestName.slice(0, 12) : 'RIDER DEST'}
                  </div>
                  <div className="h-3 w-3 rounded-full bg-danger border-2 border-white shadow" />
                </div>
              </AdvancedMarker>
            )}

            {/* Driver destination marker */}
            {driverDestLat != null && driverDestLng != null && (
              <AdvancedMarker position={{ lat: driverDestLat, lng: driverDestLng }} zIndex={0}>
                <div className="flex flex-col items-center">
                  <div className="bg-text-secondary/60 text-white rounded-full px-1.5 py-0.5 text-[9px] font-bold shadow mb-0.5">
                    {driverDestName ? driverDestName.slice(0, 12) : 'DRIVER'}
                  </div>
                  <div className="h-2.5 w-2.5 rounded-full bg-text-secondary/60 border-2 border-white shadow" />
                </div>
              </AdvancedMarker>
            )}

            {/* Transit polyline preview (station → rider dest) when a station is selected */}
            {selectedIdx !== null && suggestions[selectedIdx]?.transit_polyline && (
              <RoutePolyline
                encodedPath={suggestions[selectedIdx].transit_polyline as string}
                color="#10B981"
                weight={3}
                fitBounds={false}
              />
            )}

            {/* Pan to selected station */}
            {selectedIdx !== null && suggestions[selectedIdx] && (
              <SelectedStationFocus
                lat={suggestions[selectedIdx].station_lat}
                lng={suggestions[selectedIdx].station_lng}
              />
            )}
          </Map>
        </div>
      )}

      {/* ── Station list ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {suggestions.map((s, idx) => (
          <div
            key={s.station_place_id}
            ref={(el) => { if (el) cardRefs.current.set(idx, el); else cardRefs.current.delete(idx) }}
            role="button"
            tabIndex={0}
            data-testid="transit-suggestion-option"
            onClick={() => {
              if (picking) return
              if (selectedIdx === idx) {
                void handlePick(s)
              } else {
                setSelectedIdx(idx)
              }
            }}
            className={`w-full rounded-2xl bg-surface border p-3 text-left transition-colors cursor-pointer ${
              picking ? 'opacity-60 pointer-events-none' : ''
            } ${
              selectedIdx === idx ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/40'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {/* Numbered marker matching the map */}
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white mt-0.5 ${
                selectedIdx === idx ? 'bg-primary' : 'bg-text-secondary'
              }`}>
                {idx + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text-primary truncate">
                  {s.station_name}
                </p>
                {s.station_address && (
                  <p className="text-[10px] text-text-secondary truncate mt-0.5">
                    {s.station_address}
                  </p>
                )}
                {s.rider_progress_pct != null && s.rider_progress_pct > 0 && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="flex-1 h-1 rounded-full bg-border max-w-[80px]">
                      <div
                        className="h-1 rounded-full bg-success"
                        style={{ width: `${Math.min(100, s.rider_progress_pct)}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-medium text-success">{s.rider_progress_pct}% of the way</span>
                  </div>
                )}
              </div>
              {picking === s.station_place_id && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0 mt-0.5" />
              )}
            </div>

            {/* Walk to station */}
            {s.walk_to_station_minutes > 0 && (
              <div className="flex items-center gap-2 mt-2 pl-8 text-[10px] text-text-secondary">
                <span>📍</span>
                <span>{s.walk_to_station_minutes} min walk to station</span>
              </div>
            )}

            {/* Step-by-step transit legs */}
            <div className="mt-1.5 space-y-1 pl-8">
              {s.transit_options.slice(0, 4).map((opt, optIdx) => (
                <div key={`${opt.type}-${opt.line_name}-${optIdx}`} data-testid="transit-leg" className="flex items-center gap-1.5 text-[10px]">
                  <span className="shrink-0">{opt.icon}</span>
                  <span className="font-semibold text-text-primary shrink-0">{opt.line_name}</span>
                  {opt.departure_stop && opt.arrival_stop ? (
                    <>
                      <span className="text-text-secondary truncate">
                        {opt.departure_stop} → {opt.arrival_stop}
                      </span>
                      {opt.duration_minutes != null && (
                        <span className="shrink-0 text-text-secondary">· {opt.duration_minutes} min</span>
                      )}
                    </>
                  ) : (
                    <span className="text-text-secondary">{opt.total_minutes} min</span>
                  )}
                </div>
              ))}
            </div>

            {/* Total summary */}
            <div className="mt-1.5 pt-1.5 border-t border-border/50 pl-8">
              <p className="text-[10px] text-text-secondary">
                ~{s.total_rider_minutes} min total to destination
                <span>{' · '}{s.driver_detour_minutes > 0 ? `+${s.driver_detour_minutes} min detour` : 'On your route'}</span>
              </p>
            </div>

            {/* Select button when this card is selected */}
            {selectedIdx === idx && !picking && (
              <div className="mt-2 pt-2 border-t border-border ml-8">
                <button
                  data-testid="suggest-station-button"
                  onClick={(e) => { e.stopPropagation(); void handlePick(s) }}
                  className="w-full rounded-lg bg-primary py-2 text-xs font-semibold text-white"
                >
                  Suggest this station
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-1 text-[10px] text-danger text-center">{error}</p>
      )}
    </div>
  )
}

// ── Transit Suggestion Card (rider view: shown in chat) ──────────────────────

export default function TransitSuggestionCard({
  suggestion,
  isRider,
  onAccept,
  onCounter,
  transitPolyline,
  pickupLat,
  pickupLng,
  riderDestLat,
  riderDestLng,
  driverDestLat,
  driverDestLng,
  driverRoutePolyline,
  'data-testid': testId = 'transit-suggestion-card',
}: TransitSuggestionCardProps) {
  // Determine if we have enough data for the mini-map
  const hasMapData = (driverRoutePolyline || transitPolyline) &&
    suggestion.station_lat !== 0 && suggestion.station_lng !== 0

  // Compute bounds for the mini-map
  const miniMapBounds = useMemo(() => {
    if (!hasMapData) return []
    const pts: Array<{ lat: number; lng: number }> = [
      { lat: suggestion.station_lat, lng: suggestion.station_lng },
    ]
    if (pickupLat != null && pickupLng != null) pts.push({ lat: pickupLat, lng: pickupLng })
    if (riderDestLat != null && riderDestLng != null) pts.push({ lat: riderDestLat, lng: riderDestLng })
    if (driverDestLat != null && driverDestLng != null) pts.push({ lat: driverDestLat, lng: driverDestLng })
    return pts
  }, [hasMapData, suggestion.station_lat, suggestion.station_lng, pickupLat, pickupLng, riderDestLat, riderDestLng, driverDestLat, driverDestLng])

  return (
    <div data-testid={testId} className="rounded-2xl bg-primary/5 border border-primary/20 p-3">
      <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">
        Transit Dropoff Suggestion
      </p>

      {/* ── Mini-map showing color-coded journey ──────────────────── */}
      {hasMapData && (
        <div data-testid="transit-mini-map" className="rounded-lg overflow-hidden border border-border/50 mb-2" style={{ height: '150px' }}>
          <Map
            mapId={MAP_ID}
            defaultZoom={11}
            defaultCenter={{ lat: suggestion.station_lat, lng: suggestion.station_lng }}
            gestureHandling="greedy"
            disableDefaultUI
            className="h-full w-full"
          >
            {/* Driver route — indigo solid line */}
            {driverRoutePolyline && (
              <RoutePolyline encodedPath={driverRoutePolyline} color="#4F46E5" weight={4} fitBounds={false} />
            )}

            {/* Transit route — green line (station → rider dest) */}
            {transitPolyline && (
              <RoutePolyline encodedPath={transitPolyline} color="#10B981" weight={3} fitBounds={false} />
            )}

            {/* Fit bounds */}
            <MapBoundsFitter points={miniMapBounds} />

            {/* Pickup marker */}
            {pickupLat != null && pickupLng != null && (
              <AdvancedMarker position={{ lat: pickupLat, lng: pickupLng }} zIndex={3}>
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-success border-2 border-white shadow text-[8px] font-bold text-white">
                  P
                </div>
              </AdvancedMarker>
            )}

            {/* Station dropoff marker */}
            <AdvancedMarker position={{ lat: suggestion.station_lat, lng: suggestion.station_lng }} zIndex={5}>
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-warning border-2 border-white shadow">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="h-3.5 w-3.5">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                </svg>
              </div>
            </AdvancedMarker>

            {/* Rider destination marker */}
            {riderDestLat != null && riderDestLng != null && (
              <AdvancedMarker position={{ lat: riderDestLat, lng: riderDestLng }} zIndex={3}>
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-danger border-2 border-white shadow text-[8px] font-bold text-white">
                  D
                </div>
              </AdvancedMarker>
            )}

            {/* Driver destination marker (subtle) */}
            {driverDestLat != null && driverDestLng != null && (
              <AdvancedMarker position={{ lat: driverDestLat, lng: driverDestLng }} zIndex={0}>
                <div className="h-3 w-3 rounded-full bg-text-secondary/50 border border-white shadow" />
              </AdvancedMarker>
            )}
          </Map>

          {/* Legend overlay */}
          <div className="relative">
            <div className="absolute bottom-1 left-1 flex gap-2 bg-white/80 backdrop-blur-sm rounded px-1.5 py-0.5 text-[8px] text-text-secondary">
              <span className="flex items-center gap-0.5"><span className="inline-block w-3 h-0.5 bg-[#4F46E5] rounded" /> Ride</span>
              <span className="flex items-center gap-0.5"><span className="inline-block w-3 h-0.5 bg-[#10B981] rounded" /> Transit</span>
            </div>
          </div>
        </div>
      )}

      <p className="text-sm font-semibold text-text-primary">
        {suggestion.station_name}
      </p>

      {suggestion.station_address && (
        <p className="text-[10px] text-text-secondary mt-0.5">
          {suggestion.station_address}
        </p>
      )}

      {/* Progress badge */}
      {suggestion.rider_progress_pct != null && suggestion.rider_progress_pct > 0 && (
        <div className="flex items-center gap-1.5 mt-1">
          <div className="flex-1 h-1 rounded-full bg-border max-w-[80px]">
            <div
              className="h-1 rounded-full bg-success"
              style={{ width: `${Math.min(100, suggestion.rider_progress_pct)}%` }}
            />
          </div>
          <span className="text-[9px] font-medium text-success">{suggestion.rider_progress_pct}% of the way</span>
        </div>
      )}

      {/* Step-by-step transit journey */}
      <div className="mt-2 space-y-1.5">
        {suggestion.transit_options.map((opt, idx) => (
          <div
            key={`${opt.type}-${opt.line_name}-${idx}`}
            data-testid="transit-leg"
            className="flex items-center gap-1.5 text-xs"
          >
            <span className="shrink-0 text-sm">{opt.icon}</span>
            <span className="font-semibold text-text-primary shrink-0">{opt.line_name}</span>
            {opt.departure_stop && opt.arrival_stop ? (
              <>
                <span className="text-text-secondary truncate">
                  {opt.departure_stop} → {opt.arrival_stop}
                </span>
                {opt.duration_minutes != null && (
                  <span className="shrink-0 text-text-secondary">· {opt.duration_minutes} min</span>
                )}
              </>
            ) : (
              <span className="text-text-secondary">
                {opt.walk_minutes > 0 ? `${opt.walk_minutes} min walk · ` : ''}{opt.total_minutes} min
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="flex gap-3 mt-2 text-[10px] text-text-secondary">
        <span>{suggestion.total_rider_minutes} min total to destination</span>
        {suggestion.walk_to_station_minutes > 0 && (
          <span>{suggestion.walk_to_station_minutes} min walk to station</span>
        )}
      </div>

      {/* Accept / Counter buttons for rider */}
      {isRider && (onAccept ?? onCounter) && (
        <div className="flex gap-2 mt-3">
          {onAccept && (
            <button
              data-testid="accept-transit-dropoff"
              onClick={onAccept}
              className="flex-1 rounded-lg bg-primary py-2 text-xs font-semibold text-white"
            >
              Accept dropoff
            </button>
          )}
          {onCounter && (
            <button
              data-testid="counter-transit-dropoff"
              onClick={onCounter}
              className="flex-1 rounded-lg bg-surface border border-border py-2 text-xs font-semibold text-text-primary"
            >
              Counter
            </button>
          )}
        </div>
      )}
    </div>
  )
}
