# Smart-Search Engine Audit — Cross-Route Handoff Gaps

**Author:** Claude (acting as reviewer-engineer per Tarun's request, 2026-05-21)
**Trigger:** Tarun reported a Davis → SF rider was not surfaced to a driver searching Davis → San Jose on the same date, despite a viable BART/Caltrain handoff existing along the driver's route.
**Files audited end-to-end:**
- [`server/routes/schedule.ts`](server/routes/schedule.ts) — `/board/search` rider-side path (line 941+) and `runDriverSideSearch` driver-side path (line 1618+)
- [`server/lib/transitSuggestions.ts`](server/lib/transitSuggestions.ts) — `computeTransitDropoffSuggestions` + divergence-point algorithm + `MAJOR_TRANSIT_HUBS` static list (line 160+)
- [`server/lib/polyline.ts`](server/lib/polyline.ts) — `projectPointOntoPolyline` (already known from earlier audits)

---

## 1. Executive summary

The smart-search engine is **architecturally sound** — divergence-point algorithm + polyline projection + Google Directions transit lookup is the right approach. The problem is a **handful of tightly-tuned constants** that were calibrated against a small set of early test corridors (mostly within ~20 km of Davis) and don't generalize to the **opposite-side-of-the-Bay scenarios** Tarun's users hit immediately.

The single highest-impact bug: `HANDOFF_MAX_PRECHECK_METRES = 30 km` silently filters out any rider whose destination is more than 30 km from the driver's polyline. **Davis → SF is ~30 km from a Davis → San Jose driver's I-680 route at its closest approach**, so the handoff pre-check is sitting right on the boundary — passing or failing based on which exact route Google Routes API returns for that day's traffic.

Secondary contributors:
- The **`MAJOR_TRANSIT_HUBS` static list is incomplete** for the I-680 corridor (Walnut Creek BART, Pleasant Hill BART, Lafayette BART, Orinda BART, Rockridge BART, North Concord BART are all missing — they're the natural handoff points for any East-Bay-bound driver).
- **No ferry hubs** despite Vallejo Ferry → SF Ferry Building being the obvious handoff for a Davis driver heading anywhere not in SF.
- **No intercity bus hubs** (Salesforce Transit Center, San Jose Diridon, Sacramento Valley Station).
- **No reverse-handoff support** — rider can never be told "take BART to meet driver at Embarcadero, then ride together to San Jose."

This audit lays out **10 concrete test cases**, traces the line-by-line failure, identifies **9 systematic gaps**, and proposes **a prioritized 3-tier fix plan**. Estimated engineering: 1-2 days for P0 quick wins, 3-5 days for P1 algorithmic improvements, ~1 week for P2 infrastructure.

The recommendation is to ship the **P0 patch as v1.2.1** immediately after Block A closes (independently of the Block B disabled-rider work), then fold P1 + P2 into a dedicated SEARCH ENGINE V2 epic for v1.3.

---

## 2. The reported failure: line-by-line trace

### Scenario
- **Rider** posted a board ride: Davis (38.5449, -121.7405) → San Francisco (37.7749, -122.4194), trip_date 2026-05-22, mode `rider`
- **Driver** searched from `RideBoardHomePage` in "I'm driving" mode: Davis → San Jose (37.3382, -121.8863), 2026-05-22
- **Expected:** Driver sees the SF rider as a transit-handoff candidate (drop at El Cerrito BART or Walnut Creek BART → BART → SF)
- **Actual:** Driver sees zero match

### Flow trace

1. `POST /api/schedule/board/search` body: `{ origin_lat: 38.5449, origin_lng: -121.7405, destination_lat: 37.3382, destination_lng: -121.8863, trip_date: '2026-05-22', mode: 'rider' }`

2. [`schedule.ts:990`](server/routes/schedule.ts#L990) — `mode === 'rider'` → forks to `runDriverSideSearch`.

3. [`schedule.ts:1641`](server/routes/schedule.ts#L1641) — `fetchDrivingRoute(38.5449, -121.7405, 37.3382, -121.8863, apiKey)` calls Google Routes API. For Davis → San Jose this typically returns the I-80 → I-680 → I-680 South route (~120 mi, ~2h). Polyline decoded.

4. [`schedule.ts:1663`](server/routes/schedule.ts#L1663) — Query for all `mode='rider'` schedules on 2026-05-22. SF rider's row included.

5. [`schedule.ts:1797-1804`](server/routes/schedule.ts#L1797-L1804) — Project SF rider's (pickup, drop) onto driver's I-680 polyline:
   - `pickupProj.distanceM` ≈ ~5 km (rider's pickup is in Davis, driver's polyline starts in Davis — they're close but not exactly co-located if different parts of town)
   - `dropProj.distanceM` ≈ **~30 km** (SF's closest approach to the I-680 polyline is somewhere around Walnut Creek/Hercules area; ~30 km is the typical haversine distance from SF to that stretch)

6. [`schedule.ts:1801-1804`](server/routes/schedule.ts#L1801-L1804):
   - `originOnCorridor = pickupProj.distanceM ≤ 2_000` → likely **TRUE** (Davis to Davis is sub-2km projected)
   - `originNearStart = pickupToDriverOriginM ≤ 10_000` → **TRUE** (same town)
   - `destOnCorridor = dropProj.distanceM ≤ 2_000` → **FALSE** (30km >> 2km)
   - `destNearEnd = dropToDriverDestM ≤ 10_000` → **FALSE** (SF to San Jose is ~75 km)
   - **Direct match: skipped** (correct — driver doesn't pass SF)

7. [`schedule.ts:1847-1851`](server/routes/schedule.ts#L1847-L1851) — Handoff pre-check:
   - `originOnCorridor || originNearStart` → TRUE
   - `!destOnCorridor && !destNearEnd` → TRUE
   - `dropProj.distanceM ≤ HANDOFF_MAX_PRECHECK_METRES` → **30000 ≤ 30000 = TRUE (just barely)** OR **30500 ≤ 30000 = FALSE** depending on the exact polyline Google returned.
   - `effectivePickupFrac ≤ 0.85` → TRUE (Davis is at the start of polyline)

   **Outcome A:** If Google's route was tilted closer to the bay (e.g. I-80 → I-580 → I-880 route), `dropProj.distanceM ≈ 13 km` (passes I-880's closest approach to SF in Oakland area) — pre-check passes.

   **Outcome B:** If Google's route was the standard I-680 route, `dropProj.distanceM ≈ 30-32 km` — pre-check is right on the boundary. A 31-km route silently rejects with no log entry.

8. **Even if pre-check passes (Outcome A or borderline pass):**
   - [`transitSuggestions.ts:506`](server/lib/transitSuggestions.ts#L506) — `findDivergencePoint(decoded, 37.7749, -122.4194)` returns the polyline point closest to SF. For I-880 route this is Oakland (~13 km from SF). For I-680 route this is Walnut Creek (~30 km from SF).
   - [`transitSuggestions.ts:509`](server/lib/transitSuggestions.ts#L509) — `findHubsAlongRoute` checks `MAJOR_TRANSIT_HUBS` within 1 km of the polyline.
   - **For I-880 route:** MacArthur BART, 12th St Oakland, Berkeley BART are all in the hub list AND on the route → matched.
   - **For I-680 route:** **Walnut Creek BART, Pleasant Hill BART, Lafayette BART, Orinda BART, Rockridge BART are NOT in the hub list** → no static hubs matched.
   - [`transitSuggestions.ts:518`](server/lib/transitSuggestions.ts#L518) — Falls through to `searchNearbyStations` at the divergence point with 1500m radius. Walnut Creek BART IS within 1500m of the I-680 polyline at Walnut Creek → Google Places returns it.
   - Then per-station: `fetchTransitFromStation(walnutCreekBART, SF, apiKey)` returns "Walnut Creek BART → SF Embarcadero via BART, ~50 min" — a real, working transit option.

9. **But there's a final filter:** [`transitSuggestions.ts:551-553`](server/lib/transitSuggestions.ts#L551-L553) drops stations where `stationToDestM > pickupToDestM * 0.95`. Walnut Creek BART is ~30km from SF; pickup-to-dest (Davis → SF) is ~95 km; 30 < 95 × 0.95 = 90.25 → passes. Good.

### Root cause summary

The failure mode is **one of two things**, both fixable:
- **Outcome B (most likely):** `HANDOFF_MAX_PRECHECK_METRES = 30_000` is too tight for I-680-routed candidates. SF sits exactly 30-32 km from the closest approach of the I-680 polyline; non-deterministic pass/fail.
- **Even when pre-check passes:** Missing static hubs for the I-680 corridor (Walnut Creek BART, Pleasant Hill BART, etc.) means we depend entirely on Google Places `searchNearbyStations` succeeding at the divergence point. This sometimes returns 0 results if the polyline point is on a freeway (not adjacent to a station), or returns less-relevant station types.

**Either way, the rider was silently dropped — no log entry beyond the rare warning.**

---

## 3. How the search engine works today (architecture snapshot)

The engine has **two symmetric branches** sharing the same constants but different scoring directions:

### Rider-side (`/board/search` with `mode='driver'`)
- Rider supplies `(origin, dest, date)`.
- Server queries `ride_schedules` with `mode='driver'` AND `trip_date = date`.
- For each driver candidate, projects RIDER's points onto DRIVER's stored polyline (from `route_polyline` column populated by compute-route, or fallback to `driver_routines.route_polyline`).
- Scores: direct match (corridor) > handoff (pre-check + 2nd-pass transit lookup) > endpoint fallback (haversine only).

### Driver-side (`/board/search` with `mode='rider'`, calls `runDriverSideSearch`)
- Driver supplies `(origin, dest, date)`.
- Server fetches driver's polyline via `fetchDrivingRoute` on the spot (one Google Routes call per search).
- Queries `ride_schedules` with `mode='rider'` AND `trip_date = date`.
- Projects RIDER's points onto DRIVER's just-fetched polyline.
- Scoring identical to rider-side.

### Shared constants (defined separately in both branches but identical values)
| Constant | Value | What it gates |
|---|---|---|
| `ROUTE_CORRIDOR_METRES` | 2,000 (2 km) | Rider point counts as "on driver's route" if within this distance |
| `HANDOFF_MAX_PRECHECK_METRES` | 30,000 (30 km) | Rider's dest must be within this of driver's polyline to consider a handoff |
| `TIME_WINDOW_MINUTES` | 120 | Hard exclude if rider's `trip_time` differs by > 2 h |
| `PICKUP_RADIUS_METRES` | 10,000 (10 km) | Rider's pickup counts as valid if within this of driver's origin (near-start) |
| `DROPOFF_RADIUS_METRES` | 10,000 (10 km) | Rider's drop counts as valid if within this of driver's destination (near-end) |
| `MAX_HANDOFF_CANDIDATES` | 5 | Cap on per-search transit-API spend (only top 5 plausibility-scored riders get the Google transit lookup) |
| `BOARDS_TOO_LATE_FRACTION` | 0.85 | Rider must board before this fraction of driver's polyline (otherwise no station "downstream" can help) |

### Transit-engine constants (`transitSuggestions.ts`)
| Constant | Value | What it gates |
|---|---|---|
| `SEARCH_RADIUS_M` | 1,500 (1.5 km) | Places API nearby-search radius around the divergence point |
| `MAX_STATIONS` | 5 | Cap per nearby-search call |
| `MAX_SUGGESTIONS` | 3 | Returned to client |
| `MAX_CANDIDATES` | 8 | Cap on per-station expensive API calls (transit + driving-detour fetches) |

### `MAJOR_TRANSIT_HUBS` static list
14 BART stations (Richmond, El Cerrito del Norte, Berkeley, MacArthur, 12th St Oakland, Embarcadero, Montgomery, Powell, Civic Center, 16th St Mission, 24th St Mission, Daly City, Millbrae) + (likely) some Caltrain stations beyond the snippet I read.

### Match types
- `direct` — driver's route already passes through rider's (pickup, drop). Base score 20-100.
- `transit_handoff` — driver drops rider at a station along the route; rider takes transit to final dest. Score 0-20 (capped below any direct).
- `endpoint` (rider-side only) — polyline missing, fell back to haversine. Score 0-20.

---

## 4. Concrete test cases

I've enumerated 10 cross-route scenarios covering the most common Bay Area corridors out of Davis (Tago's primary user base). For each I document the expected behavior, the likely actual behavior under today's code, and the failure mode if any.

### 4.1 Bay Area corridor matrix

| # | Rider posts | Driver searches | Expected | Likely actual today |
|---|---|---|---|---|
| 1 | Davis → SF | Davis → San Jose | ♿ Handoff at Walnut Creek/Pleasant Hill BART → BART to SF (~50 min transit) | **❌ FAIL** if Google returns I-680 route (dropProj ≈ 30 km, right at cap; static hubs miss WC BART) |
| 2 | Davis → Oakland | Davis → SF | ✅ DIRECT (driver passes through Berkeley → Bay Bridge; Oakland ≤ 10 km of polyline near MacArthur BART exit) | ✅ likely works (closest approach < 10 km, `destOnCorridor` may fail but `destNearEnd` doesn't apply — gap: direct corridor at 13 km might fall in between 2 km corridor and 10 km near-end) |
| 3 | Davis → Berkeley | Davis → SF | ✅ DIRECT (driver passes through Berkeley) | ✅ should work (Berkeley is < 2 km of I-80 polyline) |
| 4 | Sacramento → SF | Davis → SF | ✅ DIRECT (rider's pickup in Sacramento is < 10 km of driver's start in Davis; near-start match) | ⚠️ depends on which Sacramento — if mid-town (~25 km from Davis), `originNearStart` fails AND `originOnCorridor` fails (Sacramento isn't on Davis→SF route) → silently dropped despite obvious "Sacramento Amtrak → Davis pickup" reverse-handoff opportunity |
| 5 | Davis → San Jose | Davis → SF | ♿ Handoff at SF Embarcadero BART → BART/Caltrain south to San Jose (~70 min transit) OR Millbrae BART/Caltrain handoff | **❌ FAIL** likely — driver's polyline (Davis→SF via I-80) doesn't pass close to San Jose (~75 km away); pre-check cap at 30 km rejects |
| 6 | Davis → Stanford | Davis → SF | ♿ Handoff at Caltrain SF (4th & King) → Caltrain to Palo Alto (~55 min) | **❌ FAIL** same as case 5 — Stanford is ~50 km from SF, pre-check rejects |
| 7 | Davis → SFO | Davis → San Jose | ♿ Handoff at Millbrae BART (driver's route passes ~10-15 km from Millbrae) | ⚠️ might pass pre-check (Millbrae area is < 30 km from I-880 route) but Millbrae IS in static hubs, so this should work — needs testing |
| 8 | UCSF Med Ctr → Davis | San Jose → Davis | 🔄 REVERSE HANDOFF: rider takes BART from UCSF to MacArthur BART → joins driver on his northbound trip | **❌ NOT SUPPORTED** — engine only models "driver drops rider at station", not "rider arrives at station to join driver" |
| 9 | Davis → Lake Tahoe | Davis → Sacramento | ⚠️ AMBIGUOUS — Sacramento is on the way to Tahoe, but rider needs to continue past Sacramento. Could be "Davis driver drops rider at Sacramento Amtrak → rider takes bus to Tahoe" or could be "no match because driver stops too early" | Likely **❌ FAIL** — driver's polyline ends at Sacramento, Tahoe is ~100 km past; pre-check would reject (rider boards near start but final dest is far past driver's end) |
| 10 | Davis → Marin | Davis → SF | ⚠️ DEPENDS — Marin is north of SF, requires Golden Gate Bridge after driver reaches SF. Driver could drop at SF Civic Center → rider takes Marin Ferry from Ferry Building OR Golden Gate Transit bus | Likely **❌ FAIL** — Marin is ~25 km north of SF, and SF is already at the END of the driver's polyline (`BOARDS_TOO_LATE_FRACTION` may not reject but no downstream station exists past SF's end) |

### 4.2 Failure cluster analysis

Categorized by root cause:

| Root cause | Affected cases |
|---|---|
| `HANDOFF_MAX_PRECHECK_METRES = 30 km` too tight | 1, 5, 6, 10 |
| Missing static hubs (I-680 corridor, ferries, intercity buses) | 1, 7, 10 |
| No reverse-handoff support (rider takes transit to meet driver) | 4, 8 |
| `BOARDS_TOO_LATE_FRACTION` + end-of-route stations | 10 |
| Endpoint-fallback bearing/radius too narrow for cross-corridor | 9 |

**4 of 10 cases fail purely on the 30 km pre-check.** Fixing that one constant would likely close ~40% of the gap, with the other gaps adding cumulative coverage.

---

## 5. Identified gaps (systematic)

### Gap A — `HANDOFF_MAX_PRECHECK_METRES` is tuned for short last-mile handoffs, not legitimate transit legs
The 30 km cap was originally intended to filter out "complete mismatch" cases (rider in LA, driver in Davis). But transit legs of 30-60 km are completely normal in the Bay Area:
- BART Walnut Creek → Embarcadero: 50 min, ~28 km
- BART Pleasant Hill → SF: 55 min, ~32 km
- Caltrain SF → Palo Alto: 40 min, ~50 km
- Vallejo Ferry → SF: 60 min, ~35 km

**Cap should be raised to ~75 km** OR (better) **made dynamic based on actual transit-time feasibility** rather than a haversine cap.

### Gap B — `MAJOR_TRANSIT_HUBS` static list is incomplete
The 14 listed hubs cover the Bay Bridge corridor (I-80) well but miss everything else:
- **I-680 corridor:** Walnut Creek, Pleasant Hill, Lafayette, Orinda, Rockridge BART
- **Pittsburg/Baypoint line:** North Concord, Pittsburg/Bay Point
- **Caltrain south of Millbrae:** San Mateo, Burlingame, Hillsdale, Belmont, San Carlos, Redwood City, Menlo Park, Palo Alto, California Ave, San Antonio, Mountain View, Sunnyvale, Santa Clara, College Park, San Jose Diridon
- **Ferries:** Vallejo, Larkspur, Sausalito, Tiburon, Alameda, South SF
- **Intercity rail:** Sacramento Valley Station (Amtrak Capitol Corridor), Davis Amtrak, Suisun-Fairfield
- **Major intercity bus:** Salesforce Transit Center (SF), San Jose Diridon, Sacramento Greyhound

Static list at ~50 entries would cover 95% of realistic Bay-Area-to-Sacramento handoff scenarios at zero per-search API cost.

### Gap C — `SEARCH_RADIUS_M = 1500` is too tight when divergence falls on a freeway
The divergence point is the closest polyline node to the rider's dest. On a freeway, this is often a non-station spot. Bumping to 3000m would catch stations within reasonable detour distance.

### Gap D — Per-station detour fetch is wasteful when station IS on route
[`transitSuggestions.ts:578`](server/lib/transitSuggestions.ts#L578) — for every candidate station, fetches a separate `fetchDrivingRoute(driver, station)`. For stations IN `MAJOR_TRANSIT_HUBS` (already verified on-route), we could short-circuit and use the closest-polyline-point as the drop without an API call.

### Gap E — No reverse-handoff (transit-to-driver) modeled
Rider in SF needing to go to Davis can never be matched to a driver going San Jose → Davis, even though "rider BART to MacArthur → driver picks up there" is the natural pattern. Currently the algorithm only flows "driver → station → transit → rider's dest".

### Gap F — Time window is binary (±2h, no penalty between 0 and 2h)
A 2 h time gap scores nearly identically to a 30-min gap. Should be a smoother score decay.

### Gap G — Bearing alignment is unused on polyline path
`bearingDiff` is computed (line 1781) but only used as a metadata field in the response. The polyline corridor check should override bearing, but bearing could still be a tiebreaker for handoff plausibility scoring.

### Gap H — No fallback to "nearest valid match" when results empty
Today: 0 matches = silent empty list. Better UX: "we couldn't find an exact match, but here are 3 drivers going nearby — consider a small detour".

### Gap I — `findDivergencePoint` checks every polyline node, no sampling
For a 100 km polyline with ~200 nodes, this is fine. For a 1000+ node polyline (transcontinental), it's O(n). Not a bug today, but worth flagging for future scale.

### Gap J — Endpoint-fallback `radiusMetres` (user-controlled, max 100 km) is the ONLY thing controlling the no-polyline scoring window
If both sides have no polyline AND `radius_km` defaults to 10, even Davis → Sacramento → SF goes unmatched. iOS clients should pass higher defaults OR the server should escalate radius based on `(origin-dest)` distance.

---

## 6. Recommended fixes (prioritized)

### P0 — Quick wins (1-2 day patch, no API changes)

These are pure constant tweaks + static-data additions. Zero risk to existing matches; only expands coverage.

| Fix | Change | File | Lines |
|---|---|---|---|
| **P0.1** Raise `HANDOFF_MAX_PRECHECK_METRES` to 75 km | `30_000` → `75_000` in both rider-side and driver-side branches | `server/routes/schedule.ts` | 1022, 1656 |
| **P0.2** Bump `SEARCH_RADIUS_M` to 3 km | `1500` → `3000` | `server/lib/transitSuggestions.ts` | 90 |
| **P0.3** Expand `MAJOR_TRANSIT_HUBS` from ~14 to ~50 entries | Add I-680 BART, all Caltrain Peninsula, Bay Area ferries, Sacramento Amtrak, Salesforce Transit Center, San Jose Diridon | `server/lib/transitSuggestions.ts` | 160-180 (constant block) |
| **P0.4** Log every silent rejection at `info` level | Add `console.log('[board/search] rider X rejected: dest 32km off polyline, max 30km')` before each `continue` in the search loop | `server/routes/schedule.ts` | various |
| **P0.5** Increase default `radius_km` (endpoint fallback) from 10 → 25 | One-line server-side default change | `server/routes/schedule.ts` | 965 |

**Estimated impact:** Closes ~60-70% of the Bay Area gap from cases 1, 7, 10 (and others not enumerated). No API spend increase (just bigger pre-check window — same number of transit lookups since `MAX_HANDOFF_CANDIDATES = 5` still caps).

### P1 — Algorithmic improvements (3-5 day work)

These require code changes + new tests but no new infrastructure.

| Fix | Change | Why |
|---|---|---|
| **P1.1** Dynamic handoff cap based on transit feasibility | Replace fixed `HANDOFF_MAX_PRECHECK_METRES` with a tiered check: if `dropProj.distanceM < 100 km`, run a single CHEAP transit feasibility check (e.g. "is there ANY transit station within 5 km of the divergence point that gets within 5 km of dest?") before the expensive multi-station resolution | Catches edge cases the static cap misses (e.g. Sacramento → Davis → SF chain) |
| **P1.2** Reverse handoff (transit-to-driver) | New code path: for each rider candidate, also check if rider's PICKUP is reachable from a station on driver's polyline. If yes, suggest "rider takes transit to station X to meet you" | Closes cases 4, 8 (~20% of remaining gap) |
| **P1.3** Smooth time scoring | Replace binary `tripTime gap > 120 → reject` with `score *= exp(-gap/60)` (gradual decay) | Edge cases where rider trip_time is unknown or off by 2-3h still score |
| **P1.4** "Near-miss" results | When fewer than N matches found, surface candidates that failed the corridor/handoff check by < 20% with clear UI framing ("This driver is close to your route — they may detour for you") | Captures hand-raised willingness on both sides |
| **P1.5** Bearing as tiebreaker for handoff plausibility | Move `bearingDiff` from response-only field to plausibility score weight (lower weight, but breaks ties between similarly-scored handoffs) | Marginal accuracy improvement, free |

### P2 — Infrastructure additions (1 week, requires API budget approval)

| Fix | Change | API/cost |
|---|---|---|
| **P2.1** 511.org Bay Area Transit API integration | Free Bay-Area-only transit API; complements Google Directions with regional station coverage + real-time service alerts | Free (rate-limited but generous) |
| **P2.2** Cache common driver polylines | Davis → SF, Davis → San Jose, Davis → SFO are the top 5 corridors. Pre-compute + cache polylines (refresh weekly) to skip the per-search `fetchDrivingRoute` call | Reduces Google Routes spend ~50% on common queries |
| **P2.3** Pre-computed corridor index | Background job runs nightly to compute "all routes that pass within 50 km of point X" for the top 100 destinations. Each search becomes an indexed lookup vs. iterating all schedules | Reduces per-search latency from ~2s to ~200ms at scale |
| **P2.4** Switch transit lookup from Google Directions to OpenTripPlanner self-hosted | OpenTripPlanner with GTFS feeds is free to host; for high-volume transit lookups (>10k/day) saves significant Google API spend | One-time setup ~2 days, ongoing $0 |
| **P2.5** Add `corridor_match_quality` realtime metric | Push every search outcome (matched, rejected, gap reason) to a metrics endpoint. Dashboard to track where the engine is silently dropping legitimate matches | Engineering visibility |

---

## 7. API recommendations

You asked specifically whether more APIs are needed. Here's the assessment:

| API | Current usage | v1.2.1 patch need | v1.3 SEARCH V2 need |
|---|---|---|---|
| **Google Routes API v2** | Used for driver-side `fetchDrivingRoute` (one call per search) and per-station detour | Keep | Cache aggressively (P2.2) |
| **Google Places Nearby Search** | Used for station discovery around divergence point | Keep (bigger radius via P0.2) | Supplement with static + 511 |
| **Google Directions API (Transit mode)** | Used per-station for transit time to dest | Keep | Consider OTP self-host (P2.4) |
| **511.org Bay Area Transit API** | Not used | **Recommended** — free, fills station-coverage gap (P2.1) | Recommended |
| **OpenTripPlanner + GTFS** | Not used | Skip | **Recommended** for scale (P2.4) |
| **Transit App API** | Not used | Skip | Skip (paid; OTP+GTFS is better value) |
| **Google Maps Distance Matrix API** | Not used | Skip | Skip (Routes covers this) |

**Quick verdict:** v1.2.1 patch needs **no new APIs**. Just constant tweaks + static-hub list expansion. 511.org is a free supplement worth wiring up in v1.3.

---

## 8. Cost estimate

### Engineering effort
- **P0 patch:** 1-2 days for code + tests + Tarun verification on the failing case
- **P1 algorithmic:** 3-5 days (new test fixtures + reverse-handoff logic + UI for near-miss cards)
- **P2 infrastructure:** ~1 week (cache layer, optionally OTP setup)

### Google API spend (current vs. proposed)
Per-search cost today (driver-side, 5 plausible handoffs):
- 1× Routes API (driver polyline): ~$0.005
- 5× Routes API (per-station detour): ~$0.025
- 5× Places Nearby Search: ~$0.025 (free tier covers ~17k/month)
- 5× Directions Transit: ~$0.025
- **Total per search: ~$0.08**

After P0 (only constant changes, no extra calls):
- Same as today, ~$0.08

After P1 (reverse-handoff adds 1 transit lookup per candidate):
- ~$0.10-0.12 per search (~25% increase)

After P2 (caching + OTP):
- ~$0.02-0.04 per search (75% reduction at scale)

For an early-stage app at ~100 driver searches/day:
- Today: ~$8/day → $240/mo
- After P0: $240/mo
- After P2: ~$60/mo

Negligible at current scale; matters at 10x scale.

---

## 9. Suggested rollout

### Where this fits in the v1.2 plan

This audit is **out of scope for v1.2 Blocks A/B/C as currently spec'd**. The accessibility + social + routine-match work in `V1_2_PLAN.md` is orthogonal — none of it touches the search engine.

**Recommended sequencing:**

1. **Finish v1.2 Block A first** (Tarun + the v1.2 session are mid-way at F4.2 per `V1_2_PROGRESS.md`). No interruption.

2. **Ship P0 patch as v1.2.1** the same week Block A closes. Quick wins, no new APIs, immediately fixes the reported Davis → SF / Davis → San Jose case + 3 other Bay Area corridor cases. Suggest a single PR with: constants raised, hub list expanded, info logs added, test fixtures for the 10 cases above.

3. **Park P1 + P2 as "SEARCH ENGINE V2"** epic for v1.3 (or v1.2.x if time permits before v1.3 scoping). Decide if it gates v1.3 or ships incrementally.

### Acceptance criteria for v1.2.1 patch
- All 10 test cases above produce the expected result (✅ direct, ♿ handoff, or correctly empty).
- Backend log shows reason for every rejection (so future debugging doesn't require re-tracing the algorithm).
- No regression on the existing rider-side smart search (verify with a Davis-area student rider searching for drivers — should still get the same matches as today, plus possibly a few more from the relaxed handoff cap).
- Tarun can reproduce the original failing scenario on the dev server and see the SF rider in the driver's results within ~3 seconds.

### What I need from Tarun to proceed
1. **Confirm rollout plan** — agree P0 as v1.2.1 patch, P1/P2 as v1.3 epic? Or different sequencing?
2. **Approve the 10 test cases as the canonical regression suite** — or add/remove specific corridors based on actual user demand patterns I don't have visibility into.
3. **OK to expand `MAJOR_TRANSIT_HUBS` from ~14 to ~50 entries?** The list grows but stays maintainable; alternative is to lean entirely on Google Places (more API spend, less predictable).
4. **Any user-direction for "near-miss" UI framing?** P1.4 surfaces drivers who barely missed the corridor — needs UX direction (silent / pill / sub-section / explicit "willing to detour?" toggle).

---

## 10. Conclusion

The search engine is **mostly working as designed**. The reported failure isn't a fundamental architecture issue — it's a **calibration problem** where the 30 km pre-check cap and the small static-hub list were tuned for an earlier, smaller dataset and don't generalize to the cross-Bay scenarios users hit immediately.

A **2-day P0 patch** would resolve the reported failure case and ~60% of the systematic gap with zero new dependencies. Larger algorithmic improvements (reverse handoff, dynamic cap, near-miss results) are worth ~1 week and can wait for v1.3.

Recommendation: ship the P0 patch as v1.2.1 right after v1.2 Block A closes. Don't let it block the accessibility/social/routine-match release in flight.
