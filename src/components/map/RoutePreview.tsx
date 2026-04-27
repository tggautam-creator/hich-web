/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

/** Decode a Google encoded polyline string into LatLng pairs.
 *  Pure JS — no google.maps.geometry library needed. */
export function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    shift = 0
    result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}

/** Renders a polyline on the Google Map using the Maps JS API.
 *  Supports dashed rendering via the `dashed` prop. */
export function RoutePolyline({
  encodedPath,
  path: rawPath,
  color = '#4F46E5',
  weight = 4,
  fitBounds = true,
  dashed = false,
}: {
  encodedPath?: string
  path?: Array<{ lat: number; lng: number }>
  color?: string
  weight?: number
  fitBounds?: boolean
  dashed?: boolean
}) {
  const map = useMap()
  const polylineRef = useRef<google.maps.Polyline | null>(null)

  useEffect(() => {
    if (!map) return
    const path = rawPath ?? (encodedPath ? decodePolyline(encodedPath) : [])
    if (path.length === 0) return

    const polyline = new google.maps.Polyline({
      path,
      strokeColor: color,
      strokeOpacity: dashed ? 0 : 0.8,
      strokeWeight: weight,
      ...(dashed ? {
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.6, scale: weight },
          offset: '0',
          repeat: '14px',
        }],
      } : {}),
      map,
    })
    polylineRef.current = polyline

    if (fitBounds) {
      const bounds = new google.maps.LatLngBounds()
      for (const pt of path) bounds.extend(pt)
      map.fitBounds(bounds, { top: 30, right: 30, bottom: 30, left: 30 })
    }

    return () => {
      polyline.setMap(null)
      polylineRef.current = null
    }
  }, [map, encodedPath, rawPath, color, weight, fitBounds, dashed])

  return null
}

/** Fits map bounds to include all given points.
 *
 *  Two modes:
 *  - Uncontrolled (no `fitToken`): refits on every `points` change. Legacy
 *    behavior — kept for callers that still expect "always snap to fit".
 *  - Controlled (`fitToken` provided): refits once when points first become
 *    valid, then only when `fitToken` changes. Lets the user pan/zoom freely
 *    without the map snapping back on every GPS tick. Bump `fitToken` from a
 *    Recenter button to re-frame on demand.
 */
export function MapBoundsFitter({
  points,
  fitToken,
}: {
  points: Array<{ lat: number; lng: number }>
  fitToken?: number
}) {
  const map = useMap()
  const lastFitTokenRef = useRef<number | undefined>(undefined)
  const fittedOnceRef = useRef(false)

  useEffect(() => {
    if (!map || points.length < 2) return

    if (fitToken !== undefined) {
      if (fittedOnceRef.current && fitToken === lastFitTokenRef.current) return
      fittedOnceRef.current = true
      lastFitTokenRef.current = fitToken
    }

    const bounds = new google.maps.LatLngBounds()
    for (const pt of points) bounds.extend(pt)
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
  }, [map, points, fitToken])

  return null
}

/** Floating recenter button — drop inside a `relative` map wrapper.
 *  Default position (top-right) is chosen to match Google/Apple Maps convention
 *  and avoid the bottom area where ride sheets and toasts sit. Pages render
 *  full-width banners with `right-16` so the button stays visible underneath. */
export function RecenterButton({
  onClick,
  className,
  'data-testid': testId,
}: {
  onClick: () => void
  className?: string
  'data-testid'?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId ?? 'recenter-button'}
      aria-label="Recenter map"
      title="Recenter map"
      className={
        className ??
        'absolute top-3 right-3 z-10 h-11 w-11 rounded-full bg-white/95 backdrop-blur-sm shadow-md ring-1 ring-black/5 flex items-center justify-center text-text-primary hover:bg-white hover:shadow-lg active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all'
      }
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="7" />
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
      </svg>
    </button>
  )
}

/** Fetches a real route from Google Directions Service and renders it on the map.
 *  Fires `onResult` with walking and driving durations (minutes) once resolved. */
export function DirectionsRoute({
  from,
  to,
  mode = 'WALKING',
  color = '#6366F1',
  weight = 3,
  onResult,
}: {
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
  mode?: 'WALKING' | 'DRIVING'
  color?: string
  weight?: number
  onResult?: (info: { durationMin: number; distanceM: number }) => void
}) {
  const map = useMap()
  const polylineRef = useRef<google.maps.Polyline | null>(null)
  const fetchedRef = useRef(false)
  const [path, setPath] = useState<google.maps.LatLng[]>([])

  // Fetch directions once
  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    const svc = new google.maps.DirectionsService()
    svc.route(
      {
        origin: from,
        destination: to,
        travelMode: mode === 'DRIVING'
          ? google.maps.TravelMode.DRIVING
          : google.maps.TravelMode.WALKING,
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          const leg = result.routes[0]?.legs[0]
          if (leg) {
            const pts = result.routes[0].overview_path
            setPath(pts)
            if (onResult) {
              onResult({
                durationMin: Math.max(1, Math.round((leg.duration?.value ?? 0) / 60)),
                distanceM: leg.distance?.value ?? 0,
              })
            }
          }
        }
      },
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Draw polyline when path + map are ready
  useEffect(() => {
    if (!map || path.length === 0) return

    const polyline = new google.maps.Polyline({
      path,
      strokeColor: color,
      strokeOpacity: 0.85,
      strokeWeight: weight,
      map,
    })
    polylineRef.current = polyline

    return () => {
      polyline.setMap(null)
      polylineRef.current = null
    }
  }, [map, path, color, weight])

  return null
}
