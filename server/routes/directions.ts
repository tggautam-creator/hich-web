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
