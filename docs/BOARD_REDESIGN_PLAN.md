# Ride Board redesign — payment gate + smart geo-match search

**Owner:** Tarun · **Started:** 2026-05-16 · **Status:** Slice A1 in progress

## Why

Live App Store data: lots of signups, almost no Ride Board requests. Two
diagnosed root causes:

1. **Payment friction.** Riders must add a card before they can post
   "I need a ride" on the board. For a scheduled future ride that may
   or may not match, this is an outsized commitment.
2. **No real search.** The current board is a flat list. Riders have
   to manually scroll to see if any driver's route matches theirs.
   Competitive benchmark (BlaBlaCar): rider enters origin / destination
   / date, gets a **ranked** list of trips, including matches where
   the rider's points lie *along* a driver's route — not just at the
   exact endpoints.

## Strategic decisions (confirmed by Tarun via AskUserQuestion 2026-05-16)

| Topic | Decision |
|---|---|
| Search scope | Smart geo-match — PostGIS query finds rides whose route passes near BOTH origin and destination, even at intermediate points. No Elasticsearch (PostGIS is already in Supabase, free, sufficient up to 10⁴-10⁵ rides). |
| Search ranking | Route fit + time match first. Price + driver rating as tiebreakers. |
| Payment gate — instant rides | UNCHANGED. Card / wallet still required upfront. |
| Payment gate — driver-posted board ("I'm driving this route") | UNCHANGED. Card required upfront when rider books a seat. |
| Payment gate — rider-posted board ("I need a ride") | **NEW** — post freely without card. When a driver offers, rider sees a "Driver offered you a ride" screen with payment gate. Card added → auto-open chat. |
| Multi-offer UX | Rider sees a **list of all offers**, picks one. Accepting one cancels the others. |
| Trust signal | Yes — drivers browsing rider-posts see ✓ Payment ready + ★ rating + # past rides badges. |
| Sequencing | Phase A (payment gate) first. Phase B (smart search) once A is stable. |

## Why not Elasticsearch

Decided against it on 2026-05-16. Reasons:

- Already have PostGIS in Supabase. PostGIS handles `ST_DWithin`,
  `ST_LineLocatePoint`, etc. — exactly the geo-on-route query
  BlaBlaCar uses ES for. PostGIS scales fine to 10⁴-10⁵ rides
  per region; Tago is at 10¹-10² and won't hit those limits for
  months.
- Elasticsearch managed offerings start at ~$25-95/month
  (AWS OpenSearch / Elastic Cloud / Bonsai). Self-hosting means
  operating our own EC2 cluster (updates, scaling, backups). Both
  are operational cost increases we don't need yet.
- BlaBlaCar adopted ES at 100M+ trips/year across 22 countries.
  Different scale problem entirely.

When to revisit: if PostGIS query latency exceeds ~200ms at p95 on
search load, or if we expand beyond ~3 metro markets and need
full-text matching on driver bios / pickup notes / etc.

## Data model

Reuse the existing `ride_offers` table (migration 018) rather than
inventing a new "board_offers" table. Same lifecycle states
(`pending`, `selected`, `released`, `standby`) work for board-offer
flow too.

**Today:** when a driver taps "Take this ride" on a rider-posted
board entry, `POST /api/schedule/request` immediately creates a
`rides` row in status `accepted`. No offer concept.

**After Slice A1+A2:** when a driver taps "Offer to drive", we
create only a `ride_offers` row referencing the rider's schedule.
The `rides` row only materialises when the rider accepts an offer.

Schema check:

- `ride_offers.ride_id` — currently FK to `rides.id`. For the new
  flow there is NO `rides` row yet — needs to be nullable, with a
  new `schedule_id` FK so we can attach offers to a schedule post
  before a ride exists. **Migration 072** handles this.
- `ride_offers.status` — already supports `pending` and `selected`.
- New optional fields on `ride_offers`:
  - `proposed_pickup_point` (GeoPoint) — driver's suggested pickup
  - `proposed_dropoff_point` (GeoPoint) — driver's suggested dropoff
  - `proposed_fare_cents` (int) — computed at offer time
  - `proposed_eta_minutes` (int)

## Phase A — slices

### A1 — Backend: drop the card gate on rider-board POST

**File:** `server/routes/schedule.ts`

When `schedule.mode === 'rider'` AND the requester is the **driver**
(offering on a rider-posted board), do NOT 4xx on the rider's missing
card. Instead, create a `ride_offers` row in status `pending` and
push a notification to the rider.

Keep the gate for the other cases:

- `schedule.mode === 'driver'` (rider booking a driver's seat):
  card required (unchanged).
- Instant rides via `/api/rides/request`: card required (unchanged).

Tests:
- Driver offers on rider's board post with rider having no card →
  201 returning `{ offer_id, status: 'pending' }`. No ride row
  created. Push notification queued for rider.
- Rider books a driver's posted seat with rider having no card →
  400 NO_PAYMENT_METHOD (unchanged).
- Instant ride request with no card → 400 NO_PAYMENT_METHOD
  (unchanged).

### A2 — Backend: offer-acceptance endpoints

**New routes:**

```
GET  /api/rides/board/:scheduleId/offers
     → list all pending offers for my board post (rider only)

POST /api/rides/board/offers/:offerId/accept
     → rider accepts a specific offer
     → server: verify rider has payment (card OR wallet ≥ estimated fare)
     → server: create rides row, flip this offer to 'selected',
        mark sibling offers as 'released'
     → server: push 'offer_accepted' to chosen driver,
        'offer_released' to others
     → return { ride_id }

POST /api/rides/board/offers/:offerId/decline
     → rider declines
     → flip offer to 'released'
     → push 'offer_declined' to driver
```

Edge cases:
- Rider tries to accept an already-released offer (race) → 409
  ALREADY_RELEASED.
- Driver who originally offered cancels their own offer before
  rider accepts → existing `DELETE /api/rides/board/offers/:id`
  flips to `released` and notifies rider.

### A3 — iOS: "Driver offered you a ride" screen

**New file:** `ios/Tago/Features/RideBoard/BoardOfferAcceptPage.swift`

Triggered by:
- Push notification tap on `type: 'board_offer'`
- Tapping the offer notification in the in-app inbox

Layout:
- Driver photo + name + rating
- Route summary (pickup → dropoff) with mini map
- Proposed fare
- ETA / arrival time
- **If rider has no card:** show payment gate inline ("Add a card to
  accept"). Tapping it opens `AddCardSheet`. Success → auto-tap Accept.
- **If multiple offers exist:** small horizontal scroller at top
  showing all offers; tapping one switches the page content.
- Accept / Decline buttons at bottom.

On Accept success:
- Brief success toast
- Push to `MessagingPage` for the new `ride_id` (chat opens)

### A4 — iOS: trust badges on driver-side board listings

**File:** `ios/Tago/Features/RideBoard/RideBoardRowView.swift` (or
wherever each board post renders)

Add a horizontal pill row under each rider's name:
- ✓ Payment ready (green) OR ⊘ Payment pending (gray)
- ★ rating · count
- # rides

Server needs to expose these on `GET /api/rides/board` rider posts:
- `rider_has_payment` boolean
- `rider_rating_avg`, `rider_rating_count`, `rider_total_rides`

### A5 — Driver-posted rides keep upfront card requirement

No change needed if the existing path already errors on
`NO_PAYMENT_METHOD` when the requester is the rider. Just verify in
tests.

### A6 — Web parity

Same offer-accept screen + payment gate on web at
`src/components/schedule/BoardOfferAcceptPage.tsx`. Same badges on
the driver-browsing-the-board view.

## Phase B — Smart geo-match search

### B1 — Backend search endpoint

```
POST /api/rides/board/search
Body: { origin: GeoPoint, destination: GeoPoint, date: 'YYYY-MM-DD',
        radius_km?: number  // default 3 }
```

PostGIS query sketch:

```sql
WITH candidate AS (
  SELECT r.*,
         ST_LineFromText(r.route_polyline_wkt) AS route_line
  FROM rides r
  WHERE r.status = 'requested'                 -- still open
    AND r.trip_date = $date
    AND r.schedule_id IS NOT NULL              -- board only
)
SELECT
  c.*,
  ST_Distance(c.route_line::geography, $origin::geography) AS origin_distance,
  ST_Distance(c.route_line::geography, $destination::geography) AS dest_distance,
  ST_LineLocatePoint(c.route_line, $origin) AS origin_t,
  ST_LineLocatePoint(c.route_line, $destination) AS dest_t
FROM candidate c
WHERE
  ST_DWithin(c.route_line::geography, $origin::geography, $radius_km * 1000)
  AND ST_DWithin(c.route_line::geography, $destination::geography, $radius_km * 1000)
  AND ST_LineLocatePoint(c.route_line, $origin) <
      ST_LineLocatePoint(c.route_line, $destination)
ORDER BY (origin_distance + dest_distance) * 1.0
       + ABS(EXTRACT(EPOCH FROM (c.trip_time - $rider_time))) * 0.001
       ASC
LIMIT 20;
```

Ranking score breakdown:
- **70% route fit** = `origin_distance + dest_distance` (lower = better)
- **20% time match** = `|trip_time - rider_time|` (lower = better)
- **5% fare** = `fare_cents` (lower = better tiebreaker)
- **5% driver rating** = `driver.rating_avg` (higher = better tiebreaker)

### B2 — iOS search UI

New view `RideBoardSearchPage.swift`. Search bar at top of Ride
Board with three fields: origin (Places autocomplete), destination
(Places autocomplete), date (date picker default today). Results
below as ranked cards.

Card content:
- Driver photo + name + rating
- Car make/model/color
- Departure → arrival times
- Pickup point (with walking distance from rider's origin)
- Dropoff point (with walking distance from rider's destination)
- Fare

Empty state copy: "No rides match — try a different date, or post
your own request and let a driver come to you."

### B3 — Web parity

`src/components/schedule/RideBoardSearchPage.tsx`.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Fake demand — rider posts, never adds card after driver offers | Show "Payment ready" badge so drivers can filter. Server-side rate limit posts per user per day (e.g. 3/day for users with no payment ever added). |
| Driver gets a "pending offer" forever because rider ghosts | 48-hour expiry — offer auto-flips to `released` if not accepted in time. Push reminder to rider at 24h. |
| Rider accepts but card decline at first charge attempt | Existing safety-net flow handles this (payment dunning + manual top-up). |
| Multiple drivers offer same rider post; rider takes ages | Each driver sees how many other offers are out ("1 of 3 offers"). Drivers can rescind their offer if it gets stale. |
| Geo search returns no results for niche routes | Empty state encourages posting their own request. Surface "Most popular routes today" below empty state to invite engagement. |

## Out of scope (defer until traction)

- Pricing negotiation between rider and driver (only fixed fare for now)
- Multi-passenger rides (driver carries 2+ paying riders on one trip)
- ML-driven ranking (deferred to Phase 4 once we have enough booking
  data to train)
- Ride-cancellation refund policies — keep current behavior
