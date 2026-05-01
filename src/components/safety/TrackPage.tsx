import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import { env } from '@/lib/env'

interface TrackData {
  ride_id: string
  expires_at: string
  lat: number | null
  lng: number | null
  recorded_at: string | null
}

type PageState = 'loading' | 'tracking' | 'expired' | 'not_found' | 'error'

const POLL_INTERVAL_MS = 10_000

export default function TrackPage({ 'data-testid': testId = 'track-page' }: { 'data-testid'?: string }) {
  const { token } = useParams<{ token: string }>()
  const [pageState, setPageState] = useState<PageState>('loading')
  const [trackData, setTrackData] = useState<TrackData | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Auto-follow state — true while the map is following the moving
  // location; false the moment the user pans manually. Recenter
  // button below the map flips it back to true (and bumps
  // `recenterNonce` so the helper component picks up the request).
  // Uber/Lyft pattern.
  const [autoFollow, setAutoFollow] = useState(true)
  const [recenterNonce, setRecenterNonce] = useState(0)

  async function fetchLocation() {
    if (!token) return

    try {
      const res = await fetch(`/api/safety/track/${token}`)

      if (res.status === 404) { setPageState('not_found'); return }
      if (res.status === 410) { setPageState('expired'); return }
      if (!res.ok) { setPageState('error'); return }

      const data = (await res.json()) as TrackData
      setTrackData(data)
      setLastUpdated(new Date())
      setPageState('tracking')
    } catch {
      setPageState('error')
    }
  }

  useEffect(() => {
    void fetchLocation()
    intervalRef.current = setInterval(() => { void fetchLocation() }, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const defaultCenter = { lat: 38.5449, lng: -121.7405 } // UC Davis

  return (
    <div data-testid={testId} className="flex min-h-dvh flex-col bg-surface font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-white px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" />
            </svg>
          </div>
          <span className="font-bold text-text-primary text-sm tracking-wide">TAGO · Live Tracking</span>
        </div>
        {pageState === 'tracking' && trackData && (
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs text-success font-medium">Live</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col">
        {pageState === 'loading' && (
          <div data-testid="track-loading" className="flex flex-1 items-center justify-center">
            <div className="text-center space-y-2">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
              <p className="text-sm text-text-secondary">Loading tracking data…</p>
            </div>
          </div>
        )}

        {pageState === 'expired' && (
          <div data-testid="track-expired" className="flex flex-1 items-center justify-center px-6">
            <div className="text-center space-y-3 max-w-xs">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning/10">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h2 className="font-bold text-text-primary">Link expired</h2>
              <p className="text-sm text-text-secondary">This tracking link was valid for 4 hours and has now expired.</p>
            </div>
          </div>
        )}

        {pageState === 'not_found' && (
          <div data-testid="track-not-found" className="flex flex-1 items-center justify-center px-6">
            <div className="text-center space-y-3 max-w-xs">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger/10">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <h2 className="font-bold text-text-primary">Link not found</h2>
              <p className="text-sm text-text-secondary">This tracking link doesn't exist or has been removed.</p>
            </div>
          </div>
        )}

        {pageState === 'error' && (
          <div data-testid="track-error" className="flex flex-1 items-center justify-center px-6">
            <div className="text-center space-y-3 max-w-xs">
              <p className="font-bold text-text-primary">Something went wrong</p>
              <p className="text-sm text-text-secondary">Unable to load tracking data. Please try again.</p>
              <button
                type="button"
                onClick={() => { setPageState('loading'); void fetchLocation() }}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {pageState === 'tracking' && (
          <>
            {/* Map — needs explicit height (NOT just flex-1 + minHeight)
                because @vis.gl/react-google-maps' inner `.gm-style` div
                uses `height: 100%`, and `100%` of a flex-1 parent
                resolves to 0 if no explicit height is set on any
                ancestor. The map mounted + tiles loaded but rendered
                invisibly because of this — caught via DevTools showing
                gm-style {w: 414, h: 0} on 2026-05-01. Fix: set explicit
                viewport-relative height on the wrapper + use absolute
                positioning on Map so its dimensions don't depend on
                the inner library's height-percentage chain. */}
            <div className="flex-1" style={{ position: 'relative', minHeight: '60vh' }}>
              {env.GOOGLE_MAPS_KEY ? (
                <APIProvider apiKey={env.GOOGLE_MAPS_KEY}>
                  <Map
                    data-testid="track-map"
                    mapId={env.GOOGLE_MAP_ID}
                    // Uncontrolled center — `defaultCenter` only runs
                    // on initial mount, so the user can pan freely
                    // without the map snapping back on every poll
                    // tick. The `MapAutoFollow` child below handles
                    // pan-detection + follow-mode toggling.
                    defaultCenter={
                      trackData?.lat != null && trackData.lng != null
                        ? { lat: trackData.lat, lng: trackData.lng }
                        : defaultCenter
                    }
                    defaultZoom={15}
                    gestureHandling="greedy"
                    disableDefaultUI
                    style={{ position: 'absolute', inset: 0 }}
                  >
                    {trackData?.lat != null && trackData.lng != null && (
                      <AdvancedMarker
                        data-testid="track-driver-marker"
                        position={{ lat: trackData.lat, lng: trackData.lng }}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary shadow-lg border-2 border-white">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.08 3.11H5.77L6.85 7zM19 17H5v-5h14v5zm-1.5-3.5a1 1 0 100 2 1 1 0 000-2zm-11 0a1 1 0 100 2 1 1 0 000-2z" />
                          </svg>
                        </div>
                      </AdvancedMarker>
                    )}
                    <MapAutoFollow
                      lat={trackData?.lat ?? null}
                      lng={trackData?.lng ?? null}
                      autoFollow={autoFollow}
                      onUserPan={() => setAutoFollow(false)}
                      recenterNonce={recenterNonce}
                    />
                  </Map>
                  {!autoFollow && trackData?.lat != null && trackData.lng != null && (
                    <button
                      type="button"
                      onClick={() => {
                        setAutoFollow(true)
                        setRecenterNonce((n) => n + 1)
                      }}
                      data-testid="recenter-button"
                      className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-semibold text-text-primary shadow-lg border border-border active:bg-surface"
                      style={{ zIndex: 10 }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <circle cx="12" cy="12" r="3" />
                        <line x1="12" y1="2" x2="12" y2="5" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                        <line x1="2" y1="12" x2="5" y2="12" />
                        <line x1="19" y1="12" x2="22" y2="12" />
                      </svg>
                      Recenter
                    </button>
                  )}
                </APIProvider>
              ) : (
                <div data-testid="track-map" className="flex h-full items-center justify-center bg-surface">
                  <p className="text-sm text-text-secondary">Map unavailable</p>
                </div>
              )}
            </div>

            {/* Status bar */}
            <div data-testid="track-status-bar" className="border-t border-border bg-white px-5 py-4 space-y-1">
              {trackData?.lat != null ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-success animate-pulse shrink-0" />
                    <p className="text-sm font-medium text-text-primary">Driver location is being shared</p>
                  </div>
                  {lastUpdated && (
                    <p className="text-xs text-text-secondary pl-4">
                      Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      {' · '}refreshes every 10s
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-text-secondary">Waiting for location data…</p>
              )}
              <p className="text-xs text-text-secondary pt-1">
                Link expires {new Date(trackData!.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Pan-detection + auto-follow helper for the public TrackPage map.
 * Renders nothing — its only job is to subscribe to the underlying
 * Google Map's events via `useMap()` (only available inside a
 * `<Map>` ancestor) and run the follow-mode behavior:
 *
 *   • While `autoFollow` is true, every (lat, lng) tick pans the
 *     map smoothly to the new location.
 *   • A `dragstart` event from the user fires `onUserPan()` so the
 *     parent can flip `autoFollow=false` and surface the Recenter
 *     button.
 *   • Bumping `recenterNonce` re-pans to current location even if
 *     (lat, lng) hasn't changed since the last pan.
 *
 * Lives inline in TrackPage because it's only used here. If we ever
 * add another map-with-recenter surface, extract.
 */
function MapAutoFollow({
  lat,
  lng,
  autoFollow,
  onUserPan,
  recenterNonce,
}: {
  lat: number | null
  lng: number | null
  autoFollow: boolean
  onUserPan: () => void
  recenterNonce: number
}) {
  const map = useMap()

  // Subscribe to user-drag once per Map instance. Drag-start is the
  // earliest signal the user touched the map — flip auto-follow off
  // immediately so the in-flight tick doesn't snap us back mid-pan.
  useEffect(() => {
    if (!map) return
    const listener = map.addListener('dragstart', () => onUserPan())
    return () => listener.remove()
  }, [map, onUserPan])

  // Pan to current location whenever location changes AND auto-follow
  // is on, OR whenever Recenter button bumps the nonce (always pans
  // even with auto-follow already true so the click feels responsive).
  useEffect(() => {
    if (!map || lat == null || lng == null) return
    if (!autoFollow && recenterNonce === 0) return
    map.panTo({ lat, lng })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, lat, lng, autoFollow, recenterNonce])

  return null
}
