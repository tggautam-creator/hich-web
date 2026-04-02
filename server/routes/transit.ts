import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { validateJwt } from '../middleware/auth.ts'
import { computeTransitDropoffSuggestions } from '../lib/transitSuggestions.ts'

export const transitRouter = Router()

// ── Types ─────────────────────────────────────────────────────────────────────

interface TransitOption {
  type: string        // e.g. 'BUS', 'SUBWAY', 'RAIL', 'TRAM', 'WALKING'
  icon: string        // emoji icon
  line_name: string   // e.g. 'Route 32', 'Blue Line'
  departure_stop?: string
  arrival_stop?: string
  duration_minutes?: number
  walk_minutes: number
  total_minutes: number
}

interface GoogleStep {
  travel_mode: string
  duration?: { value: number }
  distance?: { value: number }
  transit_details?: {
    departure_stop?: { name?: string }
    arrival_stop?: { name?: string }
    line?: {
      short_name?: string
      name?: string
      vehicle?: { type?: string }
    }
  }
}

interface GoogleLeg {
  duration?: { value: number }
  steps?: GoogleStep[]
}

interface GoogleRoute {
  legs?: GoogleLeg[]
}

interface GoogleDirectionsResponse {
  status: string
  routes?: GoogleRoute[]
}

// ── In-memory cache (10 min TTL) ──────────────────────────────────────────────

interface CacheEntry {
  data: TransitOption[]
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 10 * 60 * 1000

function cacheKey(
  dropoffLat: number,
  dropoffLng: number,
  destLat: number,
  destLng: number,
): string {
  // Round to 4 decimal places (~11m accuracy) for cache key
  return `${dropoffLat.toFixed(4)},${dropoffLng.toFixed(4)}->${destLat.toFixed(4)},${destLng.toFixed(4)}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VEHICLE_ICONS: Record<string, string> = {
  BUS: 'Bus',
  SUBWAY: 'Metro',
  RAIL: 'Rail',
  TRAM: 'Tram',
  FERRY: 'Ferry',
  CABLE_CAR: 'Cable',
  COMMUTER_TRAIN: 'Rail',
  HEAVY_RAIL: 'Rail',
  HIGH_SPEED_TRAIN: 'Rail',
  INTERCITY_BUS: 'Bus',
  METRO_RAIL: 'Metro',
  MONORAIL: 'Rail',
  SHARE_TAXI: 'Van',
  TROLLEYBUS: 'Bus',
}

function parseTransitOptions(data: GoogleDirectionsResponse): TransitOption[] {
  if (data.status !== 'OK' || !data.routes?.length) return []

  const options: TransitOption[] = []
  const route = data.routes[0]
  const leg = route.legs?.[0]
  if (!leg?.steps) return []

  const totalMinutes = Math.round((leg.duration?.value ?? 0) / 60)
  let walkSeconds = 0

  for (const step of leg.steps) {
    if (step.travel_mode === 'WALKING') {
      walkSeconds += step.duration?.value ?? 0
    } else if (step.travel_mode === 'TRANSIT' && step.transit_details) {
      const td = step.transit_details
      const vehicleType = td.line?.vehicle?.type ?? 'BUS'
      const lineName = td.line?.short_name ?? td.line?.name ?? 'Transit'
      const stepDurationMin = Math.round((step.duration?.value ?? 0) / 60)

      options.push({
        type: vehicleType,
        icon: VEHICLE_ICONS[vehicleType] ?? 'Bus',
        line_name: lineName,
        departure_stop: td.departure_stop?.name ?? undefined,
        arrival_stop: td.arrival_stop?.name ?? undefined,
        duration_minutes: stepDurationMin > 0 ? stepDurationMin : undefined,
        walk_minutes: Math.round(walkSeconds / 60),
        total_minutes: totalMinutes,
      })
    }
  }

  // If no transit steps found, return a single walking option
  if (options.length === 0 && totalMinutes > 0) {
    options.push({
      type: 'WALKING',
      icon: 'Walk',
      line_name: 'Walk',
      walk_minutes: totalMinutes,
      total_minutes: totalMinutes,
    })
  }

  return options
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/transit/options?dropoff_lat=…&dropoff_lng=…&dest_lat=…&dest_lng=…
 *
 * Returns transit options from the drop-off point to the rider's final destination.
 * Cached for 10 minutes per coordinate pair.
 */
transitRouter.get(
  '/options',
  validateJwt,
  async (req: Request, res: Response) => {
    const dropoffLat = parseFloat(req.query['dropoff_lat'] as string)
    const dropoffLng = parseFloat(req.query['dropoff_lng'] as string)
    const destLat = parseFloat(req.query['dest_lat'] as string)
    const destLng = parseFloat(req.query['dest_lng'] as string)

    if ([dropoffLat, dropoffLng, destLat, destLng].some(isNaN)) {
      res.status(400).json({
        error: {
          code: 'INVALID_PARAMS',
          message: 'dropoff_lat, dropoff_lng, dest_lat, dest_lng are required numeric query params',
        },
      })
      return
    }

    // Check cache
    const key = cacheKey(dropoffLat, dropoffLng, destLat, destLng)
    const cached = cache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      res.status(200).json({ options: cached.data })
      return
    }

    const apiKey = process.env['GOOGLE_DIRECTIONS_KEY'] ?? process.env['GOOGLE_MAPS_KEY']
    if (!apiKey) {
      res.status(500).json({
        error: { code: 'CONFIG_ERROR', message: 'Google API key not configured on server' },
      })
      return
    }

    const url = new URL('https://maps.googleapis.com/maps/api/directions/json')
    url.searchParams.set('origin', `${dropoffLat},${dropoffLng}`)
    url.searchParams.set('destination', `${destLat},${destLng}`)
    url.searchParams.set('mode', 'transit')
    url.searchParams.set('key', apiKey)

    try {
      const response = await fetch(url.toString())
      const data = (await response.json()) as GoogleDirectionsResponse

      const options = parseTransitOptions(data)

      // Cache result
      cache.set(key, { data: options, expiresAt: Date.now() + CACHE_TTL_MS })

      res.status(200).json({ options })
    } catch {
      res.status(502).json({
        error: { code: 'UPSTREAM_ERROR', message: 'Failed to fetch transit directions' },
      })
    }
  },
)

// ── POST /api/transit/preview ─────────────────────────────────────────────────
/**
 * Rider proactive transit suggestion.
 * Given the driver's route (polyline or origin+dest) and the rider's destination,
 * returns top 3 transit dropoff suggestions along the driver's route.
 *
 * Body: {
 *   driver_origin_lat, driver_origin_lng,
 *   driver_dest_lat, driver_dest_lng,
 *   rider_dest_lat, rider_dest_lng,
 *   driver_route_polyline? (optional, saves an API call)
 * }
 */
transitRouter.post(
  '/preview',
  validateJwt,
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as Record<string, unknown>
    const driverOriginLat = Number(body['driver_origin_lat'])
    const driverOriginLng = Number(body['driver_origin_lng'])
    const driverDestLat = Number(body['driver_dest_lat'])
    const driverDestLng = Number(body['driver_dest_lng'])
    const riderDestLat = Number(body['rider_dest_lat'])
    const riderDestLng = Number(body['rider_dest_lng'])
    const existingPolyline = typeof body['driver_route_polyline'] === 'string'
      ? body['driver_route_polyline']
      : undefined

    if (
      [driverOriginLat, driverOriginLng, driverDestLat, driverDestLng, riderDestLat, riderDestLng].some(isNaN)
    ) {
      res.status(400).json({
        error: {
          code: 'INVALID_BODY',
          message: 'driver_origin_lat/lng, driver_dest_lat/lng, rider_dest_lat/lng are required',
        },
      })
      return
    }

    const apiKey = process.env['GOOGLE_DIRECTIONS_KEY'] ?? process.env['GOOGLE_MAPS_KEY']
    if (!apiKey) {
      res.status(500).json({
        error: { code: 'CONFIG_ERROR', message: 'Google API key not configured on server' },
      })
      return
    }

    try {
      const { suggestions } = await computeTransitDropoffSuggestions(
        driverOriginLat, driverOriginLng,
        driverDestLat, driverDestLng,
        riderDestLat, riderDestLng,
        apiKey,
        existingPolyline,
      )

      // Return top 3 suggestions
      res.status(200).json({ suggestions: suggestions.slice(0, 3) })
    } catch (err) {
      next(err)
    }
  },
)
