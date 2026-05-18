# Smart Geo-Match Search — Phase C

**Started:** 2026-05-17 · **Status:** Planning complete, slices queued

Phase B v1 (`POST /api/schedule/board/search`) does endpoint-distance
matching — rider's origin must be near driver's origin AND rider's
destination near driver's destination. That's not "smart" — it's
spatial filtering on two pairs of dots. Tarun called this out the
same day it shipped: the actual product win is route-aware matching
that finds drivers whose ALREADY-PLANNED route happens to pass near
both the rider's pickup AND drop-off, regardless of where the
driver's own endpoints are. Plus transit handoff for drop-offs that
aren't quite on the route.

## Decisions (locked 2026-05-17 via AskUserQuestion)

| Topic | Decision |
|---|---|
| **Corridor width** | 5 km. Loose, prioritises match volume during early launch. Tighten later. |
| **Polyline source** | Pre-compute + store on `ride_schedules`. Driver posts once → polyline stored once → every search reads it in 0ms. Cost shifts from search to post (acceptable). |
| **Transit scope** | Bay Area only for v1. Hand-curated JSON of ~40 stations (BART, Caltrain, Muni Metro hubs). No external API. |
| **Ranking** | Detour distance + time match. **No** rider/driver ratings in the formula. |

## The 3 match types this enables

1. **Both points along route** — Rider in Vacaville → Berkeley, driver
   Davis → SF. Both rider points sit within 5km of the Davis-SF
   route polyline. **Type 1: direct.**
2. **Pickup on route, drop-off → transit handoff** — Rider in Vacaville
   → Oakland Coliseum, driver Davis → SF. Rider's pickup is on the
   route. Drop-off isn't, but Embarcadero BART is on the route +
   reachable via one BART stop from the Coliseum. Driver drops at
   Embarcadero, rider transits the last leg. **Type 2: handoff.**
3. **Endpoints match driver's** — Rider Davis → SF, driver Davis →
   SF. (What current Phase B already handles.) **Type 3: endpoint.**

## Why pre-compute polylines (and not live-fetch)

- Driver posts a ride ~once per day. Rider searches happen many
  times per session. Pre-computing means **one Directions API call
  per post** vs. potentially dozens per rider's search session.
- Storage cost is trivial — polylines are ~200 chars encoded.
- Search latency stays low (no Directions roundtrip per candidate).
- Trade-off: existing schedule rows have no polyline → search
  ignores them until backfilled. We'll add a one-shot backfill
  endpoint + run it once.

## Architecture

```
                    POST /api/schedule (insert via Supabase RLS)
                                  ↓
                                  └─→ iOS calls
                                       POST /api/schedule/:id/compute-route
                                       (NEW endpoint, Slice C2)
                                                ↓
                                       Server fetches Google Directions
                                       API for origin → dest
                                                ↓
                                       Updates row:
                                         route_polyline = "encoded..."
                                         route_origin_geo = POINT(lng lat)
                                         route_destination_geo = POINT(lng lat)
                                       (no error → fire-and-forget;
                                        row stays valid without polyline,
                                        just not searchable by smart-match)

                    POST /api/schedule/board/search
                                  ↓
                          For each candidate schedule with
                          route_polyline IS NOT NULL:
                            origin_dist  = ST_Distance(line, rider_origin)
                            dest_dist    = ST_Distance(line, rider_dest)
                            pickup_t     = ST_LineLocatePoint(line, rider_origin)
                            dropoff_t    = ST_LineLocatePoint(line, rider_dest)

                          Filter:
                            origin_dist ≤ 5km
                            AND (dest_dist ≤ 5km OR has_transit_handoff)
                            AND pickup_t < dropoff_t  (direction-correct)
                            AND date matches

                          If dest_dist > 5km, look for transit_handoff:
                            For each Bay Area transit station:
                              If station_on_route_dist ≤ 5km
                                 AND station_to_rider_dest_dist ≤ 3km:
                                tag this candidate with that station

                          Score = (1 - detour/maxDetour) * 0.7
                                + (1 - timeDiff/180) * 0.3
```

## Slice plan

### C1 — Migration 078: route polyline + cached coords on ride_schedules
- Add `route_polyline TEXT` (Google-encoded polyline string)
- Add `route_origin_geo geometry(Point, 4326)`, `route_destination_geo geometry(Point, 4326)`
- Index on `(trip_date)` with `WHERE route_polyline IS NOT NULL`
  for fast "today's smart-searchable schedules" reads
- Comment columns explaining backfill semantics

### C2 — Server: `POST /api/schedule/:id/compute-route`
- Validates caller owns the schedule
- Pulls origin_place_id + dest_place_id from the row
- Calls Google Directions API (server has the key) to resolve coords
  + polyline
- Updates the row's three new columns
- Idempotent — re-callable to refresh after a place change
- Returns the polyline/coords for the iOS confirmation

### C3 — iOS: call compute-route after every schedule insert
- After the existing `auth.supabase.from('ride_schedules').insert(...)`
  call in `SchedulePostViewModel+Submit.swift`, fire-and-forget call
  to the new endpoint
- Don't block the success UI — the row is already created; route
  computation enriches it
- On failure, log + move on (post still succeeds, schedule just
  won't appear in smart-search until next compute attempt)

### C4 — Server: Bay Area transit stations dataset ❌ DROPPED (2026-05-17)
- Shipped initially as `server/data/bayAreaTransit.ts` (~160
  hand-curated stations) but **removed** the same day after
  reviewer feedback exposed the fundamental flaw: picking
  stations by haversine distance gives no signal about whether
  transit actually CONNECTS the drop point to the rider's
  destination. SF Caltrain "won" for SFO routes because of raw
  proximity, but Caltrain doesn't serve SFO — BART does. The UI
  was confidently surfacing wrong transit hints.
- Replaced by reusing the existing
  `computeTransitDropoffSuggestions()` engine from
  `server/lib/transitSuggestions.ts` (the same engine driving
  instant-ride dropoff suggestions). That engine uses the
  divergence-point algorithm + Places Nearby Search around the
  divergence zone + Directions API per candidate station — so
  each suggestion comes with REAL transit timing + line name.
- File `server/data/bayAreaTransit.ts` deleted.

### C5 — Server: refactor `/board/search` for polyline + handoff ✅ (2026-05-17)
- ✅ Decode polyline + project rider origin/dest onto it via new
  `projectPointOntoPolyline` helper in `server/lib/polyline.ts`
  (equirectangular projection; sub-metre accurate at commute scale)
- ✅ Direct match: rider pickup AND drop are both reachable —
  either on the polyline within `ROUTE_CORRIDOR_METRES = 2km` OR
  within `PICKUP_RADIUS_METRES`/`DROPOFF_RADIUS_METRES = 10km`
  of the driver's start/end (handles same-city pickups where the
  rider's address isn't directly on the highway)
- ✅ Transit handoff: real transit engine, not static-station
  guess. Pre-filter: rider dest within `HANDOFF_MAX_PRECHECK_METRES
  = 30km` of polyline closest-approach + pickup reachable. Top
  `MAX_HANDOFF_CANDIDATES = 5` plausibility-ranked candidates then
  invoke `computeTransitDropoffSuggestions()` for real Directions
  API timing.
- ✅ Endpoint-fallback path preserved for schedules whose
  compute-route hasn't run yet
- ✅ Polyline source priority: schedule row → driver_routines (so
  iOS-projected routine rows that ship coords without polyline
  still get smart-matched via the parent routine's polyline)
- ✅ Hard filters: `available_seats > 0` (NULL means "unspecified",
  not "0"), time window ±2h when rider supplied a `trip_time`,
  bearing diff ≤ 90° (endpoint path)
- ✅ De-dupe by `user_id`, tiebreaker `created_at ASC`, top 20
- ✅ Warning log when 0 of N candidates have a polyline
- ✅ Response: `match_type`, `corridor_origin_metres`,
  `corridor_dest_metres`, `transit_handoff: { station_name,
  station_place_id, station_address, walk_to_station_minutes,
  transit_to_dest_minutes, total_rider_minutes, transit_option:
  { type, line_name, ... } }`

### C6 — iOS: update `BoardSearchResult` + UI for handoff ✅ (2026-05-17)
- ✅ `BoardSearchResult` decodes `matchType`, `transitHandoff`
  (now `BoardSearchTransitHandoff` carries `stationName`,
  `stationPlaceID`, `stationAddress`, `walkToStationMinutes`,
  `transitToDestMinutes`, `totalRiderMinutes`, `transitOption`)
- ✅ Result card renders summary badges (no raw scores, no
  distance chips — they confused users):
  - Direct → green "On your route" pill
  - Handoff → amber "Drop + transit · ~1h 55m total" pill +
    detail card "Drop at Embarcadero Station · BART Yellow Line
    · 37 min to your destination · Walk 4 min · ride 37 min ·
    ~1h 55m total"
  - Endpoint → blue "Nearby" pill
- ✅ Backwards-compatible decoder: older builds without
  `match_type` field default to `.endpoint`

### C7 — Backfill existing posts ✅ (2026-05-17)
- ✅ `POST /api/schedule/admin/backfill-polylines` — admin-only
  (validateJwt + adminAuth)
- ✅ Selects schedules with `route_polyline IS NULL AND mode='driver'`,
  optionally filters to `trip_date >= today` (default), orders
  trip_date DESC so most-impactful rows go first
- ✅ Throttled 200ms between Routes API calls
- ✅ Returns `{ total, succeeded, failed, skipped, remaining,
  errors[] }` — admin can call repeatedly until `remaining=0`
- ✅ Reuses `computeAndPersistRouteFor` helper extracted from the
  per-schedule compute-route endpoint (no logic duplication)

### C8 — Driver-side smart search (Phase 2) ✅ (2026-05-17)
- ✅ `/board/search` accepts `mode='rider'` (was 400 UNSUPPORTED_MODE)
- ✅ New `runDriverSideSearch()` helper in `server/routes/schedule.ts`:
  - Computes driver's intended polyline once via `fetchDrivingRoute`
    (one Routes API call per search — bounded cost)
  - Pulls rider candidates (`mode='rider' AND trip_date=X`)
  - Projects each rider post's (o, d) onto driver's polyline
  - Direct match: rider pickup AND drop both on driver's route (or
    near driver's endpoints via PICKUP_RADIUS/DROPOFF_RADIUS) +
    ordered
  - Handoff: rider pickup reachable, dest off-route — invokes
    `computeTransitDropoffSuggestions` from driver's POV ("you
    can drop this rider at X, they take transit Y min to dest")
  - Same constants, same scoring math, same response shape as
    rider-side so iOS decoders don't need to branch
- ✅ iOS `RideBoardHomePage` gains mode chips ("I need a ride" /
  "I'm driving") that flip the search payload's `mode` field +
  mode-aware hero copy + button copy + result-clearing on toggle
- ✅ Drive tab's `.rideBoard` routes to `RideBoardHomePage(
  defaultMode: .offerDrive)` instead of the legacy list page
- ✅ **Handoff offer propagation**: when a driver smart-searches and
  picks a handoff result, the offer carries `proposed_dropoff_lat/
  lng/name` from the suggested station. Rider sees the actual
  proposal on `BoardOfferAcceptPage` — not a generic offer they'd
  have to negotiate down in chat. UX: amber "YOUR OFFER" card on
  `RideBoardConfirmSheet` shows what the driver is proposing.
- ✅ Tests: 8 new `projectPointOntoPolyline` cases (1291/1291 pass)

## Out of scope (deferred)

- Multi-stop handoff (rider transits through 2+ stations)
- Drop at one transit station, pickup from another (rider's whole
  trip via transit middle leg)
- Ride-share carpool seat coordination (rider gets matched with
  multiple drivers for legs)
- Live polyline updates if a driver edits their schedule
- Non-Bay-Area transit (LA Metro, NYC subway, etc.) — easy to add
  by extending the dataset file
- ML-driven preference learning ("you usually accept drop-offs at
  the Mission BART") — only useful at scale

## Open questions to revisit after v1 ships

- Should we cache the polyline computation in a CDN/Redis layer so
  the same Davis→SF route is re-used across all drivers posting it
  the same day? (Likely yes once volume picks up.)
- Should handoff drop-offs be allowed only when the transit
  station is one of the rider's "approved" hubs in their settings?
  (Privacy/safety; out of scope for v1.)
- Detour budget — should drivers be able to set "I'll detour up to
  X minutes for a rider"? Could replace the fixed 5km corridor
  with a personalized one.

## File-by-file map

| File | What changes |
|---|---|
| `supabase/migrations/078_smart_search_polylines.sql` | NEW — Phase C1 |
| `server/routes/schedule.ts` | Modify `/board/search` (Phase C5) |
| `server/routes/schedule.ts` or new `server/routes/scheduleCompute.ts` | NEW endpoint `/api/schedule/:id/compute-route` (Phase C2) |
| `server/data/bayAreaTransit.ts` | NEW — Phase C4 |
| `server/lib/polyline.ts` | Likely additions: `polylineDistanceToPoint`, `projectPointOnPolyline` (Phase C5) |
| `ios/Tago/Features/Schedule/SchedulePostViewModel+Submit.swift` | Call compute-route after insert (Phase C3) |
| `ios/Tago/Core/Networking/Endpoints/BoardSearchEndpoint.swift` | Extend `BoardSearchResult` for `match_type` + `transit_handoff` (Phase C6) |
| `ios/Tago/Features/RideBoard/RideBoardSearchPage.swift` | Render handoff chip on result cards (Phase C6) |
