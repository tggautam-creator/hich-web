import { Router, type Request, type Response, type NextFunction } from 'express'
import { validateJwt } from '../middleware/auth.ts'

export const directionsRouter = Router()

// ── In-memory cache (10-min TTL) ──────────────────────────────────────────────
const CACHE_TTL_MS = 10 * 60 * 1000
const directionsCache = new Map<string, { data: Record<string, unknown>; ts: number }>()

function getCacheKey(
  oLat: number, oLng: number,
  dLat: number, dLng: number,
  placeId: string | undefined,
  mode: string,
): string {
  const dest = placeId ?? `${dLat.toFixed(4)},${dLng.toFixed(4)}`
  return `${oLat.toFixed(4)},${oLng.toFixed(4)}->${dest}:${mode}`
}

interface RoutesApiResponse {
  routes?: Array<{
    distanceMeters?: number
    duration?: string  // e.g. "1234s"
    polyline?: { encodedPolyline?: string }
    legs?: Array<{
      endLocation?: { latLng?: { latitude?: number; longitude?: number } }
    }>
  }>
}

/**
 * Calls Google Routes computeRoutes for a single origin→destination
 * leg. Returns the parsed result or `null` on any failure (API key
 * missing, upstream error, route not found). Extracted from the GET
 * handler so the `/validate-polyline` endpoint can reuse it for the
 * MapKit-failure fallback path.
 */
async function fetchGoogleRoutePolyline(args: {
  originLat: number; originLng: number;
  destLat: number; destLng: number;
  mode: 'DRIVE' | 'WALK';
}): Promise<{ polyline: string; distanceKm: number; durationMin: number; destLat: number; destLng: number } | null> {
  const apiKey = process.env['GOOGLE_MAPS_KEY']
  if (!apiKey) {
    console.error('[directions] GOOGLE_MAPS_KEY not configured — cannot fall back to Google')
    return null
  }

  const body = {
    origin: { location: { latLng: { latitude: args.originLat, longitude: args.originLng } } },
    destination: { location: { latLng: { latitude: args.destLat, longitude: args.destLng } } },
    travelMode: args.mode,
    computeAlternativeRoutes: false,
    languageCode: 'en-US',
  }

  try {
    const resp = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.endLocation',
        },
        body: JSON.stringify(body),
      },
    )
    if (!resp.ok) {
      console.error('[directions] Google Routes fallback failed:', resp.status)
      return null
    }
    const data = (await resp.json()) as RoutesApiResponse
    const route = data.routes?.[0]
    if (!route?.distanceMeters || !route.duration || !route.polyline?.encodedPolyline) {
      return null
    }
    const durationSec = parseInt(route.duration.replace('s', ''), 10)
    const endLoc = route.legs?.[0]?.endLocation?.latLng
    return {
      polyline: route.polyline.encodedPolyline,
      distanceKm: route.distanceMeters / 1000,
      durationMin: durationSec / 60,
      destLat: endLoc?.latitude ?? args.destLat,
      destLng: endLoc?.longitude ?? args.destLng,
    }
  } catch (err) {
    console.error('[directions] Google Routes fallback threw:', err)
    return null
  }
}

/// Tiny Google-format polyline decoder (port of
/// https://developers.google.com/maps/documentation/utilities/polylinealgorithm).
/// Mirrors the Swift `PolylineDecoder` in `ios/Tago/Core/Maps/`. Used
/// for the validate-polyline endpoint so we can sanity-check the
/// first/last coords of a client-supplied polyline without trusting
/// the client to also send them as a flat array.
function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const coords: Array<{ lat: number; lng: number }> = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte = 0
    do {
      if (index >= encoded.length) return coords
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1F) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += (result & 1) !== 0 ? ~(result >> 1) : (result >> 1)

    shift = 0
    result = 0
    do {
      if (index >= encoded.length) return coords
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1F) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += (result & 1) !== 0 ? ~(result >> 1) : (result >> 1)

    coords.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return coords
}

function haversineMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000 // earth radius m
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sa = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(sa))
}

/**
 * GET /api/directions?originLat=...&originLng=...&destPlaceId=...
 *
 * Proxies the Google Routes API (computeRoutes) to avoid CORS and
 * the deprecated client-side DirectionsService.
 */
directionsRouter.get(
  '/',
  validateJwt,
  async (req: Request, res: Response, _next: NextFunction) => {
    const originLat = parseFloat(req.query['originLat'] as string)
    const originLng = parseFloat(req.query['originLng'] as string)
    const destPlaceId = req.query['destPlaceId'] as string | undefined
    const destLat = parseFloat(req.query['destLat'] as string)
    const destLng = parseFloat(req.query['destLng'] as string)
    const modeParam = (req.query['mode'] as string | undefined)?.toUpperCase()
    const travelMode = modeParam === 'WALK' ? 'WALK' : 'DRIVE'

    const hasLatLng = !isNaN(destLat) && !isNaN(destLng)

    if (isNaN(originLat) || isNaN(originLng) || (!destPlaceId && !hasLatLng)) {
      res.status(400).json({
        error: { code: 'INVALID_PARAMS', message: 'originLat, originLng, and either destPlaceId or destLat+destLng are required' },
      })
      return
    }

    const apiKey = process.env['GOOGLE_MAPS_KEY']
    if (!apiKey) {
      res.status(500).json({
        error: { code: 'CONFIG_ERROR', message: 'Google Maps API key not configured' },
      })
      return
    }

    // Check cache
    const cacheKey = getCacheKey(originLat, originLng, destLat, destLng, destPlaceId, travelMode)
    const cached = directionsCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      res.json(cached.data)
      return
    }

    try {
      const destination = destPlaceId
        ? { placeId: destPlaceId }
        : { location: { latLng: { latitude: destLat, longitude: destLng } } }

      const body = {
        origin: {
          location: {
            latLng: { latitude: originLat, longitude: originLng },
          },
        },
        destination,
        travelMode,
        computeAlternativeRoutes: false,
        languageCode: 'en-US',
      }

      const resp = await fetch(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.endLocation',
          },
          body: JSON.stringify(body),
        },
      )

      if (!resp.ok) {
        const errText = await resp.text()
        console.error('[directions] Routes API error:', resp.status, errText)
        res.status(502).json({
          error: { code: 'ROUTES_API_ERROR', message: 'Failed to fetch directions' },
        })
        return
      }

      const data = (await resp.json()) as RoutesApiResponse
      const route = data.routes?.[0]

      if (!route?.distanceMeters || !route.duration) {
        res.status(404).json({
          error: { code: 'NO_ROUTE', message: 'No route found' },
        })
        return
      }

      // duration comes as "1234s" string — parse to seconds
      const durationSec = parseInt(route.duration.replace('s', ''), 10)
      const endLoc = route.legs?.[0]?.endLocation?.latLng

      const result = {
        distance_km: route.distanceMeters / 1000,
        distance_miles: (route.distanceMeters / 1000) * 0.621371,
        duration_min: durationSec / 60,
        polyline: route.polyline?.encodedPolyline ?? '',
        destLat: endLoc?.latitude ?? 0,
        destLng: endLoc?.longitude ?? 0,
      }

      directionsCache.set(cacheKey, { data: result, ts: Date.now() })
      res.json(result)
    } catch (err) {
      console.error('[directions] Error:', err)
      res.status(500).json({
        error: { code: 'INTERNAL', message: 'Failed to compute route' },
      })
    }
  },
)

/**
 * POST /api/directions/validate-polyline
 *
 * v1.3 Phase B.7 (2026-05-25) — cost-reduction path. iOS computes the
 * driving polyline locally via MKDirections (free Apple MapKit) and
 * POSTs the encoded string here. Server sanity-checks that the
 * polyline's endpoints are reasonably close to the requested origin/
 * destination; on success returns the same polyline back (the round-
 * trip exists so the server, not the client, is the gatekeeper of
 * what lands in `driver_routines.route_polyline`).
 *
 * If the client didn't compute a polyline (MKDirections unavailable,
 * no route in region, etc.) OR validation fails, the server falls
 * back to Google Routes — same call the GET handler makes. This
 * preserves the existing behavior for clients that can't compute a
 * polyline locally, while letting MapKit-capable clients short-circuit
 * the Google charge.
 *
 * Body: { origin: {lat,lng}, destination: {lat,lng}, polyline?: string,
 *         mode?: 'DRIVE' | 'WALK' }
 * Response: { polyline: string, source: 'client' | 'google' }
 *           OR { error: { code, message } }
 */
directionsRouter.post(
  '/validate-polyline',
  validateJwt,
  async (req: Request, res: Response, _next: NextFunction) => {
    const body = (req.body ?? {}) as {
      origin?: { lat?: number; lng?: number }
      destination?: { lat?: number; lng?: number }
      polyline?: string
      mode?: string
    }
    const oLat = Number(body.origin?.lat)
    const oLng = Number(body.origin?.lng)
    const dLat = Number(body.destination?.lat)
    const dLng = Number(body.destination?.lng)
    if (![oLat, oLng, dLat, dLng].every((n) => Number.isFinite(n))) {
      res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'origin {lat,lng} and destination {lat,lng} are required' },
      })
      return
    }
    const mode: 'DRIVE' | 'WALK' = body.mode?.toUpperCase() === 'WALK' ? 'WALK' : 'DRIVE'

    // ── Try the client-supplied polyline first ─────────────────────
    // Validation rules: must decode to ≥2 points; first point ≤2km
    // from requested origin AND last point ≤2km from requested
    // destination (MapKit snaps to road, so some drift is expected;
    // 2km is a generous upper bound that still catches a wholly
    // wrong polyline).
    const VALIDATION_RADIUS_M = 2_000
    if (typeof body.polyline === 'string' && body.polyline.length > 0) {
      const decoded = decodePolyline(body.polyline)
      if (decoded.length >= 2) {
        const first = decoded[0]!
        const last = decoded[decoded.length - 1]!
        const dOrigin = haversineMetres(first, { lat: oLat, lng: oLng })
        const dDest = haversineMetres(last, { lat: dLat, lng: dLng })
        if (dOrigin <= VALIDATION_RADIUS_M && dDest <= VALIDATION_RADIUS_M) {
          res.status(200).json({ polyline: body.polyline, source: 'client' })
          return
        }
        console.warn('[directions/validate] client polyline rejected — origin drift:', Math.round(dOrigin), 'm, dest drift:', Math.round(dDest), 'm')
      } else {
        console.warn('[directions/validate] client polyline rejected — decoded to', decoded.length, 'points')
      }
    }

    // ── Fallback: ask Google ───────────────────────────────────────
    const google = await fetchGoogleRoutePolyline({
      originLat: oLat, originLng: oLng,
      destLat: dLat, destLng: dLng,
      mode,
    })
    if (!google) {
      res.status(502).json({
        error: { code: 'ROUTE_UNAVAILABLE', message: 'No polyline available from client or Google' },
      })
      return
    }
    res.status(200).json({ polyline: google.polyline, source: 'google' })
  },
)
