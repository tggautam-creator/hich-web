/**
 * Corridor clustering for the marketing story generator.
 *
 * "Corridor" = a city-pair (e.g. "Davis ↔ SoCal", "Davis ↔ Bay Area").
 * This module turns the raw ride_schedules table into a ranked list of
 * corridors with their underlying rides, so the story generator can
 * write one Instagram story per high-value corridor instead of one
 * story per individual ride (which would be noise).
 *
 * Pure DB + array logic — no LLM, no side effects. Unit-testable.
 *
 * NOTE: supabaseAdmin is dynamically imported inside
 * `fetchAndClusterCorridors` rather than at top level. That keeps
 * the pure helpers (regionForAddress, dateLabel, clusterCorridors)
 * unit-testable without setting up server env vars — importing
 * supabaseAdmin runs getServerEnv() which throws when SUPABASE_*
 * aren't set, which would tank corridor.test.ts at collection time.
 * (localDate.ts is pure Intl — no env dependency, safe to import.)
 */
import { getLocalDateString, localTodayISO, localDateNDaysFromNow } from '../localDate.ts'

/**
 * Eligible-ride window: how far ahead we'll surface rides in the
 * marketing stories. 7 days matches the Instagram-story-as-flyer
 * mental model (no point posting a story for a ride 3 weeks out).
 */
const WINDOW_DAYS_AHEAD = 7
const TOP_CORRIDORS_PER_BATCH = 6

/**
 * Coarse city → region mapping. Multiple cities in the same metro
 * collapse into one region label so we don't fragment the corridor
 * "Davis ↔ SoCal" into 8 separate "Davis ↔ Long Beach" / "Davis ↔
 * Anaheim" / etc. corridors that each have 1 ride.
 *
 * Order matters: longer/more-specific keys are matched first so
 * "West Sacramento" wins over "Sacramento" via the iteration order
 * preserved in JS objects.
 */
const REGION_MAP: ReadonlyArray<[RegExp, string]> = [
  // Davis core (no aggregation — Davis is the anchor)
  [/\bDavis\b/i, 'Davis'],
  // Sacramento metro
  [/\bWest Sacramento\b|\bElk Grove\b|\bRoseville\b|\bFolsom\b|\bRancho Cordova\b|\bCitrus Heights\b|\bSacramento\b/i, 'Sacramento'],
  // Bay Area
  [/\bSan Francisco\b|\bOakland\b|\bBerkeley\b|\bSan Jose\b|\bPalo Alto\b|\bMountain View\b|\bFremont\b|\bDaly City\b|\bSan Mateo\b|\bMilpitas\b|\bRedwood City\b|\bSunnyvale\b|\bSanta Clara\b|\bHayward\b|\bSan Bruno\b/i, 'Bay Area'],
  // SoCal (LA + OC + IE + SD)
  [/\bLos Angeles\b|\bLong Beach\b|\bAnaheim\b|\bSanta Ana\b|\bIrvine\b|\bRiverside\b|\bSan Bernardino\b|\bSan Diego\b|\bSanta Monica\b|\bPasadena\b|\bGlendale\b|\bBurbank\b|\bTorrance\b|\bHuntington Beach\b|\bGarden Grove\b|\bFullerton\b|\bOrange\b|\bChula Vista\b|\bOceanside\b|\bMission Viejo\b|\bLA\b/i, 'SoCal'],
  // Reno / Tahoe
  [/\bReno\b|\bTahoe\b|\bSouth Lake Tahoe\b|\bTruckee\b/i, 'Reno/Tahoe'],
  // Central Valley
  [/\bFresno\b|\bStockton\b|\bModesto\b/i, 'Central Valley'],
]

/** Falls back to "Other" when no region matches the address. */
const FALLBACK_REGION = 'Other'

interface RideRow {
  id: string
  mode: 'rider' | 'driver'
  origin_address: string | null
  dest_address: string | null
  trip_date: string
  trip_time: string | null
  direction_type: string | null
  available_seats: number | null
}

export interface CorridorRide {
  ride_id: string
  mode: 'rider' | 'driver'
  origin_region: string
  dest_region: string
  trip_date: string
  trip_time: string | null
  direction_type: string | null
  // Full addresses kept so the source-rides drawer in the admin UI
  // can show the real "Axis at Davis, 2555 Research Park Dr" instead
  // of just "Davis". The story prompt also uses these for grounding.
  origin_address: string
  dest_address: string
}

export interface Corridor {
  /** Sorted-alphabetically label so directions collapse into one. */
  corridor: string
  /** Direction-specific region names captured for the story copy. */
  primary_origin: string
  primary_dest: string
  rides: CorridorRide[]
  rider_count: number
  driver_count: number
  /** 'driver' = corridor is rider-heavy, story asks DRIVERS.
   *  'rider'  = corridor is driver-heavy, story asks RIDERS.
   *  null     = balanced, skip (matches will form organically). */
  asking_for: 'driver' | 'rider' | null
  /** Sort key: weighted score combining volume + date proximity. */
  score: number
  /** Friendly date label for the story headline. */
  date_label: string
}

/**
 * Map any address string to its coarse region. Public so unit tests
 * can drive the map without going through the DB layer.
 */
export function regionForAddress(address: string | null | undefined): string {
  if (!address) return FALLBACK_REGION
  for (const [pattern, region] of REGION_MAP) {
    if (pattern.test(address)) return region
  }
  return FALLBACK_REGION
}

/**
 * Friendly date label for the story headline. Today / Tomorrow /
 * weekday-month-day for everything else.
 */
export function dateLabel(tripDate: string, today: Date = new Date()): string {
  // 2026-06-09 TZ fix — interpret `today` as a PACIFIC calendar date
  // before diffing. The old `today.getUTC*` anchoring meant that from
  // 4-5 PM PT onward, "Today" labeled tomorrow's trips (UTC had
  // already rolled over). trip_date is the poster's PT wall-clock
  // date, so the comparison must happen in the same calendar.
  // Both anchors then go through midnight-UTC so the diff is an
  // integer day count.
  const trip = new Date(tripDate + 'T00:00:00Z')
  const todayPT = new Date(getLocalDateString(today) + 'T00:00:00Z')
  const diffDays = Math.round((trip.getTime() - todayPT.getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${days[trip.getUTCDay()]} ${months[trip.getUTCMonth()]} ${trip.getUTCDate()}`
}

// Pacific, not UTC (2026-06-09 TZ fix) — these gate the trip_date
// window for story generation; UTC versions skipped same-day rides
// every PT evening.
function todayISO(): string {
  return localTodayISO()
}

function dateNDaysFromNow(n: number): string {
  return localDateNDaysFromNow(n)
}

/**
 * `askingFor` filter (Phase 1.1):
 *   - 'driver' → only return corridors that need DRIVERS (rider-heavy)
 *   - 'rider'  → only return corridors that need RIDERS (driver-heavy)
 *   - 'both' or undefined → both directions (default behavior)
 *
 * Lets the admin manually steer story generation toward one audience
 * ("I have a backlog of driver demand today — push riders only").
 * The daily cron passes 'both' for full coverage.
 */
export type AskingForFilter = 'driver' | 'rider' | 'both'

/**
 * Pure clustering — given an arbitrary rides array, returns ranked
 * corridors. Exported for testability; the production path calls
 * fetchAndClusterCorridors() which wraps DB-fetch + this.
 */
export function clusterCorridors(
  rides: RideRow[],
  today: Date = new Date(),
  askingFor: AskingForFilter = 'both',
): Corridor[] {
  // Map each ride to its (origin_region, dest_region) pair.
  const enriched: CorridorRide[] = rides
    .filter((r) => r.origin_address && r.dest_address)
    .map((r) => ({
      ride_id: r.id,
      mode: r.mode,
      origin_region: regionForAddress(r.origin_address),
      dest_region: regionForAddress(r.dest_address),
      trip_date: r.trip_date,
      trip_time: r.trip_time,
      direction_type: r.direction_type,
      origin_address: r.origin_address!,
      dest_address: r.dest_address!,
    }))
    // Drop intra-region rides (Davis → Davis) — those don't make for
    // compelling stories ("come carpool 2 miles!" doesn't convert).
    .filter((r) => r.origin_region !== r.dest_region)
    // Drop "Other ↔ Other" — we have no name for either side, can't
    // write a good headline.
    .filter((r) => r.origin_region !== FALLBACK_REGION || r.dest_region !== FALLBACK_REGION)

  // Group by sorted city-pair so both directions roll up.
  const groups = new Map<string, CorridorRide[]>()
  for (const r of enriched) {
    const pair = [r.origin_region, r.dest_region].sort()
    const key = `${pair[0]}|${pair[1]}`
    const arr = groups.get(key) ?? []
    arr.push(r)
    groups.set(key, arr)
  }

  const corridors: Corridor[] = []
  for (const [key, ridesInCorridor] of groups) {
    const [a, b] = key.split('|') as [string, string]
    const riderCount = ridesInCorridor.filter((r) => r.mode === 'rider').length
    const driverCount = ridesInCorridor.filter((r) => r.mode === 'driver').length

    // Bias decision: a corridor with ≥2 of one side and ≤1 of the
    // other is imbalanced enough to push a "we need X" story.
    // Perfectly balanced corridors are skipped (asking_for=null) since
    // matches form naturally without our push.
    let askingFor: 'driver' | 'rider' | null = null
    if (riderCount >= 2 && driverCount <= 1) askingFor = 'driver'
    else if (driverCount >= 2 && riderCount <= 1) askingFor = 'rider'

    // Earliest trip date drives the date label so "Rides Needed
    // Today" beats "Rides Needed in 4 days" in the headline.
    const earliestDate = ridesInCorridor
      .map((r) => r.trip_date)
      .sort()[0]!

    // Score: volume × recency. Closer dates score higher.
    const daysOut = Math.max(0, Math.round(
      (new Date(earliestDate + 'T00:00:00Z').getTime() - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
      / (24 * 60 * 60 * 1000),
    ))
    const recencyMultiplier = Math.max(0.5, 1 - daysOut * 0.1)
    const score = ridesInCorridor.length * recencyMultiplier

    // Pick the most-common direction within the corridor so the
    // headline uses real city names ("Davis ⇌ SoCal") not the
    // alphabetised pair.
    const dirCount = new Map<string, number>()
    for (const r of ridesInCorridor) {
      const k = `${r.origin_region}→${r.dest_region}`
      dirCount.set(k, (dirCount.get(k) ?? 0) + 1)
    }
    const [primaryOrigin, primaryDest] = Array.from(dirCount.entries())
      .sort((x, y) => y[1] - x[1])[0]![0]
      .split('→') as [string, string]

    corridors.push({
      corridor: `${a} ⇌ ${b}`,
      primary_origin: primaryOrigin,
      primary_dest: primaryDest,
      rides: ridesInCorridor,
      rider_count: riderCount,
      driver_count: driverCount,
      asking_for: askingFor,
      score,
      date_label: dateLabel(earliestDate, today),
    })
  }

  // Drop balanced corridors before ranking — they don't make stories.
  // Then optionally narrow by askingFor so the admin can target a
  // single audience on demand.
  return corridors
    .filter((c) => c.asking_for !== null)
    .filter((c) => askingFor === 'both' || c.asking_for === askingFor)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_CORRIDORS_PER_BATCH)
}

/**
 * Production path: pull eligible rides from ride_schedules and
 * cluster them. Returns the top N corridors ready for the story
 * generator to consume.
 */
export async function fetchAndClusterCorridors(
  askingFor: AskingForFilter = 'both',
): Promise<{
  corridors: Corridor[]
  error: string | null
}> {
  const { supabaseAdmin } = await import('../supabaseAdmin.ts')
  // Notes on the filter:
  //  - ride_schedules has no `status` column. Posts are deleted on
  //    cancellation, so "exists in table" == "active".
  //  - No payment_status filter either — that column lives on `rides`,
  //    not `ride_schedules` (the rider posts the request before paying).
  //  - seats_locked=true means the schedule was already paired and the
  //    QR scan locked the seat; no value in promoting it.
  //  - origin_place_id LIKE 'routine:%' are projection rows from
  //    routines — skip so we don't double-count alongside the routine
  //    itself.
  const { data, error } = await supabaseAdmin
    .from('ride_schedules')
    .select('id, mode, origin_address, dest_address, trip_date, trip_time, direction_type, available_seats')
    .gte('trip_date', todayISO())
    .lte('trip_date', dateNDaysFromNow(WINDOW_DAYS_AHEAD))
    .not('origin_place_id', 'like', 'routine:%')
    .neq('seats_locked', true)
    .limit(500)

  if (error) {
    console.error('[marketing/corridors] fetch failed:', error.message)
    return { corridors: [], error: error.message }
  }
  return {
    corridors: clusterCorridors((data ?? []) as RideRow[], new Date(), askingFor),
    error: null,
  }
}
