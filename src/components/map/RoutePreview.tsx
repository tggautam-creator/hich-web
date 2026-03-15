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

/** Renders a polyline on the Google Map using the Maps JS API. */
export function RoutePolyline({
  encodedPath,
  color = '#4F46E5',
  weight = 4,
  fitBounds = true,
}: {
  encodedPath: string
  color?: string
  weight?: number
  fitBounds?: boolean
}) {
  const map = useMap()
  const polylineRef = useRef<google.maps.Polyline | null>(null)

  useEffect(() => {
    if (!map || !encodedPath) return

    const path = decodePolyline(encodedPath)
    const polyline = new google.maps.Polyline({
      path,
      strokeColor: color,
      strokeOpacity: 0.8,
      strokeWeight: weight,
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
  }, [map, encodedPath, color, weight, fitBounds])

  return null
}

/** Fits map bounds to include all given points. */
export function MapBoundsFitter({ points }: { points: Array<{ lat: number; lng: number }> }) {
  const map = useMap()

  useEffect(() => {
    if (!map || points.length < 2) return
    const bounds = new google.maps.LatLngBounds()
    for (const pt of points) bounds.extend(pt)
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
  }, [map, points])

  return null
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
