/**
 * One-shot dev helper: reverse-geocode origin/destination on existing
 * routines (driver_routines + rider_routines) and populate the new
 * origin_address / dest_address columns added by migration 102.
 *
 * Routines created PRE-migration-102 won't have addresses (clients
 * weren't sending them). This script walks every routine where
 * origin_address IS NULL and uses Google Geocoding API to resolve
 * a human-readable address from the stored lat/lng.
 *
 * Safe to re-run: only touches rows where address is still NULL.
 *
 * Usage:
 *   tsx --env-file=.env.dev server/scripts/backfillRoutineAddresses.ts
 *
 * Cost: ~$0.005 per geocode × 2 endpoints per routine = ~$0.01/routine.
 * At our current scale (~10s of routines), under $1.
 */
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

interface RoutineRow {
  id: string
  origin: { coordinates: [number, number] } | null
  destination: { coordinates: [number, number] } | null
  origin_address: string | null
  dest_address: string | null
}

async function reverseGeocode(lat: number, lng: number, apiKey: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`,
    )
    if (!resp.ok) return null
    const data = (await resp.json()) as { results?: Array<{ formatted_address?: string }> }
    return data.results?.[0]?.formatted_address ?? null
  } catch (err) {
    console.error('reverseGeocode error:', err)
    return null
  }
}

async function backfillTable(tableName: 'driver_routines' | 'rider_routines', apiKey: string): Promise<{ scanned: number; updated: number }> {
  // Pull routines missing either address.
  const { data, error } = await supabaseAdmin
    .from(tableName)
    .select('id, origin, destination, origin_address, dest_address')
    .or('origin_address.is.null,dest_address.is.null')
    .limit(500)

  if (error) {
    console.error(`[backfill/${tableName}] fetch failed:`, error.message)
    return { scanned: 0, updated: 0 }
  }

  const rows = (data ?? []) as unknown as RoutineRow[]
  let updated = 0

  for (const row of rows) {
    const updates: Record<string, string> = {}

    if (!row.origin_address && row.origin?.coordinates) {
      const [lng, lat] = row.origin.coordinates
      const addr = await reverseGeocode(lat, lng, apiKey)
      if (addr) updates['origin_address'] = addr
    }
    if (!row.dest_address && row.destination?.coordinates) {
      const [lng, lat] = row.destination.coordinates
      const addr = await reverseGeocode(lat, lng, apiKey)
      if (addr) updates['dest_address'] = addr
    }

    if (Object.keys(updates).length === 0) continue

    const { error: updateErr } = await supabaseAdmin
      .from(tableName)
      .update(updates as never)
      .eq('id', row.id)

    if (updateErr) {
      console.error(`[backfill/${tableName}] update ${row.id.slice(0, 8)} failed:`, updateErr.message)
    } else {
      updated += 1
      console.log(`[backfill/${tableName}] ${row.id.slice(0, 8)} ← ${Object.keys(updates).join(', ')}`)
    }
  }

  return { scanned: rows.length, updated }
}

async function main(): Promise<void> {
  const apiKey = process.env['GOOGLE_MAPS_KEY']
  if (!apiKey) {
    console.error('[backfill] GOOGLE_MAPS_KEY env var missing — required for reverse geocoding')
    process.exit(1)
  }

  const driver = await backfillTable('driver_routines', apiKey)
  const rider = await backfillTable('rider_routines', apiKey)

  console.log(
    `[backfill] Done. driver_routines: scanned=${driver.scanned} updated=${driver.updated} · `
    + `rider_routines: scanned=${rider.scanned} updated=${rider.updated}`,
  )
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
