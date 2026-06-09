/**
 * One-shot backfill: compute route_polyline for every legacy schedule
 * and routine that's missing one.
 *
 * Context (2026-05-25): Phase B.7 added iOS-side MapKit polyline
 * computation, but every row created BEFORE that ship has
 * route_polyline = NULL. The suggestion engine degrades these to
 * weak-direct matches and never enters the transit_dropoff branch.
 * This script fixes that for the deployed prod data.
 *
 * Strategy:
 *   1. SELECT eligible rows (future-dated, no polyline, has lat/lng)
 *   2. For each, call Google Routes (server has no MapKit) with the
 *      stored lat/lng — this works for ALL rows because we use coords
 *      directly, not the apple:NNN place IDs that caused the
 *      iOS-fired compute-route to fail.
 *   3. UPDATE row with polyline + route_origin_geo + route_destination_geo
 *      + polyline_source = 'google_routes'
 *   4. Throttle to 100/min to stay under Google's per-second cap
 *   5. After all rows done, fire runSuggestionBackstopScan so users
 *      see suggestions within minutes instead of waiting for the cron.
 *
 * Cost: ~$0.005 per row (Google Routes). 5000 legacy rows → ~$25 one-time.
 *
 * Usage:
 *   tsx --env-file=.env.dev server/scripts/backfillPolylines.ts
 *   tsx --env-file=.env.prod server/scripts/backfillPolylines.ts --confirm-prod
 *
 * Prod safety: requires explicit --confirm-prod flag when SUPABASE_URL
 * points at the prod project.
 */
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'
import { runSuggestionBackstopScan } from '../lib/suggestionEngine.ts'
import { localTodayISO } from '../lib/localDate.ts'

const BATCH_SIZE = 10               // parallel calls per second
const BATCH_INTERVAL_MS = 1_000     // pause between batches
const MAX_ROWS_PER_RUN = 10_000     // safety cap

interface RoutesApiResponse {
  routes?: Array<{
    distanceMeters?: number
    duration?: string
    polyline?: { encodedPolyline?: string }
    legs?: Array<{
      startLocation?: { latLng?: { latitude?: number; longitude?: number } }
      endLocation?: { latLng?: { latitude?: number; longitude?: number } }
    }>
  }>
}

async function fetchGoogleRoutePolyline(args: {
  originLat: number; originLng: number;
  destLat: number; destLng: number;
}): Promise<{ polyline: string; originLat: number; originLng: number; destLat: number; destLng: number } | null> {
  const apiKey = process.env['GOOGLE_MAPS_KEY']
  if (!apiKey) return null
  const body = {
    origin: { location: { latLng: { latitude: args.originLat, longitude: args.originLng } } },
    destination: { location: { latLng: { latitude: args.destLat, longitude: args.destLng } } },
    travelMode: 'DRIVE',
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
          'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation',
        },
        body: JSON.stringify(body),
      },
    )
    if (!resp.ok) return null
    const data = (await resp.json()) as RoutesApiResponse
    const route = data.routes?.[0]
    const polyline = route?.polyline?.encodedPolyline
    const firstLeg = route?.legs?.[0]
    const lastLeg = route?.legs?.[route.legs.length - 1]
    if (!polyline || !firstLeg?.startLocation?.latLng || !lastLeg?.endLocation?.latLng) return null
    return {
      polyline,
      originLat: firstLeg.startLocation.latLng.latitude!,
      originLng: firstLeg.startLocation.latLng.longitude!,
      destLat: lastLeg.endLocation.latLng.latitude!,
      destLng: lastLeg.endLocation.latLng.longitude!,
    }
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms))

async function backfillSchedules(): Promise<{ found: number; updated: number; failed: number }> {
  const today = localTodayISO()
  const { data, error } = await supabaseAdmin
    .from('ride_schedules')
    .select('id, origin_lat, origin_lng, dest_lat, dest_lng')
    .is('route_polyline', null)
    .gte('trip_date', today)
    .not('origin_lat', 'is', null)
    .not('dest_lat', 'is', null)
    .limit(MAX_ROWS_PER_RUN)
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; origin_lat: number; origin_lng: number; dest_lat: number; dest_lng: number }>
  console.log(`[backfill/schedules] found ${rows.length} eligible rows`)

  let updated = 0
  let failed = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (row) => {
      const route = await fetchGoogleRoutePolyline({
        originLat: row.origin_lat, originLng: row.origin_lng,
        destLat: row.dest_lat, destLng: row.dest_lng,
      })
      if (!route) { failed += 1; return }
      const originGeo = `POINT(${route.originLng} ${route.originLat})`
      const destGeo = `POINT(${route.destLng} ${route.destLat})`
      const { error: upErr } = await supabaseAdmin
        .from('ride_schedules')
        .update({
          route_polyline: route.polyline,
          route_origin_geo: originGeo,
          route_destination_geo: destGeo,
          polyline_source: 'google_routes',
        } as never)
        .eq('id', row.id)
      if (upErr) { failed += 1; console.error(`  ${row.id.slice(0,8)} update failed: ${upErr.message}`) }
      else { updated += 1 }
    }))
    if (i + BATCH_SIZE < rows.length) {
      console.log(`[backfill/schedules] progress ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`)
      await sleep(BATCH_INTERVAL_MS)
    }
  }
  return { found: rows.length, updated, failed }
}

async function backfillRoutines(): Promise<{ found: number; updated: number; failed: number }> {
  const today = localTodayISO()
  const { data, error } = await supabaseAdmin
    .from('driver_routines')
    .select('id, origin, destination')
    .is('route_polyline', null)
    .eq('is_active', true)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .limit(MAX_ROWS_PER_RUN)
  if (error) throw error
  type RoutineRow = {
    id: string
    origin: { coordinates?: [number, number] } | null
    destination: { coordinates?: [number, number] } | null
  }
  const rows = (data ?? []) as RoutineRow[]
  console.log(`[backfill/routines] found ${rows.length} eligible rows`)

  let updated = 0
  let failed = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (row) => {
      const oCoords = row.origin?.coordinates
      const dCoords = row.destination?.coordinates
      if (!oCoords || !dCoords) { failed += 1; return }
      const [originLng, originLat] = oCoords
      const [destLng, destLat] = dCoords
      const route = await fetchGoogleRoutePolyline({ originLat, originLng, destLat, destLng })
      if (!route) { failed += 1; return }
      const { error: upErr } = await supabaseAdmin
        .from('driver_routines')
        .update({
          route_polyline: route.polyline,
          polyline_source: 'google_routes',
        } as never)
        .eq('id', row.id)
      if (upErr) { failed += 1; console.error(`  ${row.id.slice(0,8)} update failed: ${upErr.message}`) }
      else { updated += 1 }
    }))
    if (i + BATCH_SIZE < rows.length) {
      console.log(`[backfill/routines] progress ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`)
      await sleep(BATCH_INTERVAL_MS)
    }
  }
  return { found: rows.length, updated, failed }
}

async function main() {
  const isProd = (process.env['SUPABASE_URL'] ?? '').includes('pdxtswlaxqbqkrfwailf')
  const confirmedProd = process.argv.includes('--confirm-prod')
  if (isProd && !confirmedProd) {
    console.error('Refusing to run against PROD without --confirm-prod flag.')
    process.exit(1)
  }
  console.log(`Backfilling against ${process.env['SUPABASE_URL']}`)

  const sched = await backfillSchedules()
  console.log(`Schedules: found=${sched.found} updated=${sched.updated} failed=${sched.failed}`)
  const rout = await backfillRoutines()
  console.log(`Routines:  found=${rout.found} updated=${rout.updated} failed=${rout.failed}`)

  if (sched.updated + rout.updated > 0) {
    console.log('\nTriggering runSuggestionBackstopScan so suggestions populate immediately…')
    const scan = await runSuggestionBackstopScan()
    console.log(`Backstop scan: scanned=${scan.scanned} inserted=${scan.inserted}`)
  } else {
    console.log('\nNo rows updated; skipping suggestion backstop scan.')
  }
}

main().catch((err: unknown) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
