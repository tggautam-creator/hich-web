/**
 * Phase C Slice C7 backfill — CLI variant.
 *
 * Same logic as the admin endpoint `POST /api/schedule/admin/backfill-polylines`,
 * but invoked directly so you don't need to grab an admin JWT. Uses the
 * service-role key from `.env` to read/write `ride_schedules` directly.
 *
 * Run:  npx tsx scripts/backfill-polylines.ts
 * Run including past dates:  npx tsx scripts/backfill-polylines.ts --include-past
 *
 * Iterates schedules WHERE route_polyline IS NULL AND mode='driver',
 * calls the Google Routes API for each, persists the polyline +
 * cached coords. Throttles 250ms between calls.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const SUPABASE_URL = process.env['SUPABASE_URL']
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']
const GOOGLE_MAPS_KEY = process.env['GOOGLE_MAPS_KEY']

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}
if (!GOOGLE_MAPS_KEY) {
  console.error('Missing GOOGLE_MAPS_KEY in .env — needed for the Routes API call')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const includePast = process.argv.includes('--include-past')

interface RouteEndpoint {
  placeID: string | null
  lat: number | null
  lng: number | null
}

/**
 * Build a Google Routes API origin/destination waypoint. Prefers
 * placeId (more accurate routing into business entrances) but
 * falls back to lat/lng for "synthetic" routine-projected place
 * IDs (`routine:<uuid>`) that Google can't resolve.
 */
function buildWaypoint(ep: RouteEndpoint): { placeId: string } | { location: { latLng: { latitude: number; longitude: number } } } | null {
  const isSynthetic =
    ep.placeID?.startsWith('routine:') ||
    ep.placeID?.startsWith('edit:') ||
    ep.placeID?.startsWith('apple:')
  if (ep.placeID && !isSynthetic) {
    return { placeId: ep.placeID }
  }
  if (ep.lat != null && ep.lng != null) {
    return { location: { latLng: { latitude: ep.lat, longitude: ep.lng } } }
  }
  return null
}

async function computeRoute(origin: RouteEndpoint, dest: RouteEndpoint): Promise<{
  polyline: string
  startLat: number
  startLng: number
  endLat: number
  endLng: number
} | { error: string }> {
  const originWp = buildWaypoint(origin)
  const destWp = buildWaypoint(dest)
  if (!originWp || !destWp) {
    return { error: 'NO_WAYPOINT — no valid place_id or lat/lng for origin/destination' }
  }

  try {
    const resp = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_MAPS_KEY!,
          'X-Goog-FieldMask':
            'routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation',
        },
        body: JSON.stringify({
          origin: originWp,
          destination: destWp,
          travelMode: 'DRIVE',
          computeAlternativeRoutes: false,
          languageCode: 'en-US',
        }),
      },
    )

    if (!resp.ok) {
      const text = await resp.text()
      return { error: `Routes API ${resp.status}: ${text.slice(0, 200)}` }
    }

    type RoutesResp = {
      routes?: Array<{
        polyline?: { encodedPolyline?: string }
        legs?: Array<{
          startLocation?: { latLng?: { latitude?: number; longitude?: number } }
          endLocation?: { latLng?: { latitude?: number; longitude?: number } }
        }>
      }>
    }
    const data = (await resp.json()) as RoutesResp
    const route = data.routes?.[0]
    const polyline = route?.polyline?.encodedPolyline
    const first = route?.legs?.[0]
    const last = route?.legs?.[route.legs.length - 1]
    const start = first?.startLocation?.latLng
    const end = last?.endLocation?.latLng

    if (!polyline || start?.latitude == null || start?.longitude == null
      || end?.latitude == null || end?.longitude == null) {
      return { error: 'NO_ROUTE — Google returned no usable route' }
    }

    return {
      polyline,
      startLat: start.latitude,
      startLng: start.longitude,
      endLat: end.latitude,
      endLng: end.longitude,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown error' }
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10)
  let query = supabase
    .from('ride_schedules')
    .select('id, origin_place_id, dest_place_id, origin_address, dest_address, origin_lat, origin_lng, dest_lat, dest_lng, trip_date, mode, user_id')
    .is('route_polyline', null)
    .eq('mode', 'driver')
    .order('trip_date', { ascending: false })

  // Pull parent driver_routines for any schedules whose place_id is
  // a synthetic `routine:<uuid>` reference — the server's nightly
  // sync-cron projects rows without coords, so the only source of
  // truth for the route's origin/dest geometry is the routine row.
  const fetchRoutine = async (routineID: string): Promise<{
    originLat: number; originLng: number; destLat: number; destLng: number; polyline: string | null
  } | null> => {
    const { data, error: routineErr } = await supabase
      .from('driver_routines')
      .select('origin, destination, route_polyline')
      .eq('id', routineID)
      .maybeSingle()
    if (routineErr || !data) return null
    const o = data.origin as { coordinates?: [number, number] } | null
    const d = data.destination as { coordinates?: [number, number] } | null
    if (!o?.coordinates || !d?.coordinates) return null
    return {
      originLng: o.coordinates[0], originLat: o.coordinates[1],
      destLng: d.coordinates[0], destLat: d.coordinates[1],
      polyline: (data.route_polyline as string | null) ?? null,
    }
  }

  if (!includePast) query = query.gte('trip_date', today)

  const { data: rows, error } = await query
  if (error) {
    console.error('Query failed:', error.message)
    process.exit(1)
  }

  console.log(`Found ${rows?.length ?? 0} driver schedules missing a polyline${includePast ? ' (including past)' : ' (today+future only)'}`)

  if (!rows || rows.length === 0) {
    console.log('Nothing to backfill. Done.')
    return
  }

  let ok = 0
  let fail = 0
  let skip = 0

  for (const row of rows) {
    const tag = `${row.id.slice(0, 8)}… (${row.trip_date}) ${row.origin_address ?? '?'} → ${row.dest_address ?? '?'}`

    let originLat = row.origin_lat as number | null
    let originLng = row.origin_lng as number | null
    let destLat = row.dest_lat as number | null
    let destLng = row.dest_lng as number | null
    let preferRoutinePolyline: string | null = null

    // Routine-projected rows have synthetic `routine:<uuid>` place
    // IDs that Google can't resolve AND the server cron didn't
    // store coords. Fall back to the parent routine's geometry.
    const originPID = row.origin_place_id as string | null
    if (originPID?.startsWith('routine:')) {
      const routineID = originPID.slice('routine:'.length).split(':')[0] ?? ''
      const routine = await fetchRoutine(routineID)
      if (routine) {
        originLat = routine.originLat
        originLng = routine.originLng
        destLat = routine.destLat
        destLng = routine.destLng
        // If the routine already has a polyline (iOS-stored at
        // creation time), prefer that over a fresh Google call.
        preferRoutinePolyline = routine.polyline
      }
    }

    // Use the routine's polyline directly — saves a Routes API
    // call and matches the route the driver actually plans to
    // take (the routine was created with that polyline in mind).
    if (preferRoutinePolyline && originLat != null && originLng != null && destLat != null && destLng != null) {
      const originPoint = `POINT(${originLng} ${originLat})`
      const destPoint = `POINT(${destLng} ${destLat})`
      const { error: updErr } = await supabase
        .from('ride_schedules')
        .update({
          route_polyline: preferRoutinePolyline,
          route_origin_geo: originPoint,
          route_destination_geo: destPoint,
        })
        .eq('id', row.id)
      if (updErr) {
        console.log(`  FAIL ${tag} — DB update (routine polyline): ${updErr.message}`)
        fail++
      } else {
        console.log(`  OK   ${tag} — used routine polyline=${preferRoutinePolyline.length}chars`)
        ok++
      }
      await new Promise((r) => setTimeout(r, 50))
      continue
    }

    const origin: RouteEndpoint = {
      placeID: originPID,
      lat: originLat,
      lng: originLng,
    }
    const dest: RouteEndpoint = {
      placeID: row.dest_place_id,
      lat: destLat,
      lng: destLng,
    }
    const synth = (p: string | null) =>
      !!p && (p.startsWith('routine:') || p.startsWith('edit:') || p.startsWith('apple:'))
    const haveOrigin = (origin.placeID && !synth(origin.placeID)) || (origin.lat != null && origin.lng != null)
    const haveDest = (dest.placeID && !synth(dest.placeID)) || (dest.lat != null && dest.lng != null)
    if (!haveOrigin || !haveDest) {
      console.log(`  SKIP ${tag} — no usable place_id or lat/lng`)
      skip++
      continue
    }

    const result = await computeRoute(origin, dest)
    if ('error' in result) {
      console.log(`  FAIL ${tag} — ${result.error}`)
      fail++
      await new Promise((r) => setTimeout(r, 250))
      continue
    }

    const originPoint = `POINT(${result.startLng} ${result.startLat})`
    const destPoint = `POINT(${result.endLng} ${result.endLat})`

    const { error: updErr } = await supabase
      .from('ride_schedules')
      .update({
        route_polyline: result.polyline,
        route_origin_geo: originPoint,
        route_destination_geo: destPoint,
      })
      .eq('id', row.id)

    if (updErr) {
      console.log(`  FAIL ${tag} — DB update: ${updErr.message}`)
      fail++
    } else {
      console.log(`  OK   ${tag} — polyline=${result.polyline.length}chars`)
      ok++
    }

    await new Promise((r) => setTimeout(r, 250))
  }

  console.log(`\nDone. ok=${ok} fail=${fail} skip=${skip} total=${rows.length}`)
}

void main()
