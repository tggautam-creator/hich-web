# Ride Board UX Overhaul — Full Implementation Guide

## How to Use This File

This file is a **self-contained implementation guide** for the Ride Board UX overhaul. It contains all context, feature specs, implementation details, bugs found, and lessons learned — everything needed to continue work in a new session.

**To continue work:**
1. Read this entire file first
2. Check `progress.txt` in the same directory to see what's done
3. Pick the next incomplete item and follow the implementation instructions below
4. After completing a feature, update `progress.txt`
5. Run verification: `npm test -- --run && npm run lint && npm run build`

---

## Product Context

Tago is a carpooling PWA for university students. The **Ride Board** is the scheduling feature where:
- **Drivers** post upcoming trips (origin, destination, date, time, seats)
- **Riders** browse the board and request to join a driver's trip
- **Drivers** receive a push notification and review the request on the `BoardRequestReview` screen
- Driver can **Accept**, **Decline**, or **Suggest Drop-off** (counter-propose a transit station)
- After acceptance, both parties enter the messaging/coordination flow
- A QR code scan starts and ends the ride, triggering fare calculation and payment

### Key Tables
- `ride_schedules` — posted trips on the board (driver or rider posts)
- `rides` — individual ride records created when a request is sent
- `driver_routines` — saved routes with origin/destination geography points
- `messages` — chat messages between rider and driver
- `notifications` — persistent notification records

### Critical Technical Details
- **Geography columns use `GEOMETRY(Point, 4326)`** not `geography(Point, 4326)`. PostgREST only accepts GeoJSON `{ type: 'Point', coordinates: [lng, lat] }` on GEOMETRY columns. This caused a "parse error – invalid geometry" bug during development.
- **GeoJSON coordinate order is [lng, lat]**, not [lat, lng]
- Money is always in **cents** (integers)
- All colors come from `src/lib/tokens.ts`, never raw hex

---

## Phase 1 — Ride Request Enrichment

### 1A. DB Migration: Rider Context Columns

**What:** Add 4 columns to `rides` table so riders can send destination, note, and flexibility with their request. Add `seats_locked` to `ride_schedules`.

**Migration file:** `supabase/migrations/035_ride_request_enrichment.sql`

```sql
ALTER TABLE rides ADD COLUMN IF NOT EXISTS requester_destination GEOMETRY(Point, 4326);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS requester_destination_name text;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS requester_note text;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS destination_flexible boolean DEFAULT false;
ALTER TABLE ride_schedules ADD COLUMN IF NOT EXISTS seats_locked boolean DEFAULT false;
```

**Types file:** `src/types/database.ts`
- Add all 4 columns to `Ride` Row/Insert/Update types
- Add `seats_locked` to `RideSchedule` Row/Insert/Update types
- Add `'expired'` to the ride status union

**IMPORTANT:** Must use `GEOMETRY` not `geography` — see Technical Details above.

---

### 1B. Server: Enrich POST /api/schedule/request

**What:** Accept destination + note fields in the ride request body, store them on the ride record, and include them in push/realtime notifications.

**File:** `server/routes/schedule.ts` — the `/request` endpoint (~line 460-760)

**Implementation:**
- Accept `destination_lat`, `destination_lng`, `destination_name`, `destination_flexible`, `note` in request body
- Build GeoPoint: `{ type: 'Point', coordinates: [destination_lng, destination_lat] }`
- Truncate note to 200 chars
- Store all fields in the ride insert
- Include `requester_destination_name`, `destination_flexible`, `requester_note` in:
  - Realtime broadcast payload
  - FCM push data payload
  - Persistent notification data

---

### 1C. Frontend: RideBoardConfirmSheet Redesign

**What:** Transform the simple confirm dialog into a 2-step enrichment sheet where riders specify their destination and optionally add a note.

**File:** `src/components/schedule/RideBoardConfirmSheet.tsx`

**UI structure:**
1. **Poster info card** — avatar, name, rating
2. **Route summary** — origin → destination with date/time
3. **Step 1: "Where are you headed?"**
   - Two pill toggles: "I know my destination" | "Let's figure it out"
   - Destination mode: address search using `searchPlaces` + `getPlaceCoordinates` from `src/lib/places.ts`
   - Flexible mode: sets `destination_flexible = true`, shows info badge
   - After destination selected, calls `POST /api/transit/preview` to show transit station suggestions
4. **Step 2: "Add a note" (optional)**
   - Textarea, max 200 chars with counter
5. **Send Request / Send Offer button**
   - Disabled until destination selected or flexible mode chosen

**Props:** `onConfirm(enrichment: RequestEnrichment)` — passes `{ destination_lat, destination_lng, destination_name, destination_flexible, note }`

**Wiring:** `handleConfirmRequest` in `RideBoard.tsx` spreads the enrichment into the POST body

---

### 1D. Frontend: BoardRequestReview Redesign

**What:** Show the driver full rider context (pickup, destination, note, distance) and add a "Suggest Drop-off" counter button.

**File:** `src/components/ride/BoardRequestReview.tsx`

**Sections (in order):**
1. **Header** — "Ride Request" title + subtitle ("X wants to join your ride")
2. **Requester card** — avatar, name, rating, ride count, role badge
3. **Rider Details card** (only for driver posts):
   - **Pickup** — reverse-geocoded from `ride.origin` using `reverseGeocode()` from `src/lib/geocode.ts`
   - **Destination** — `ride.requester_destination_name` OR "Flexible" badge if `destination_flexible`
   - **Note** — `ride.requester_note` in a styled card
   - **Distance from route** — haversine distance between `ride.requester_destination` and `ride.driver_destination`
4. **Your Posted Route card** — origin → destination with date/time from linked `ride_schedules`
5. **Action buttons:**
   - Accept Rider (green) — calls `accept-board`, navigates to messaging
   - Suggest Drop-off (primary outline) — calls `accept-board`, navigates to `/ride/dropoff/${rideId}`
   - Decline (red outline) — calls `decline-board`, navigates back

**Data fetching:**
- Ride: `supabase.from('rides').select('*').eq('id', rideId)`
- Schedule: `supabase.from('ride_schedules').select('origin_address, dest_address, ...')`
- Other user: `supabase.from('users').select('id, full_name, avatar_url, rating_avg, rating_count')`
- Pickup address: `reverseGeocode(origin.coordinates[1], origin.coordinates[0])`

**Bug fix applied:** "Suggest Drop-off" must navigate to `/ride/dropoff/${rideId}` (not `/ride/dropoff-selection/`). The route in `main.tsx` is `/ride/dropoff/:rideId`.

---

### 1E. Request Expiry at Trip Time

**What:** Auto-expire ride requests when the scheduled trip time passes.

**Server — `server/lib/scheduledReminders.ts`:**
- `expireStaleRequests()` function
- Query: rides WHERE `status = 'requested'` AND linked schedule's `trip_date + trip_time < NOW()`
- Update: `status → 'expired'`
- Send FCM push + persistent notification: "Your ride request expired"
- Broadcast via Realtime

**Server — `server/cron/reminders.ts`:**
- Call both `checkUpcomingRides()` and `expireStaleRequests()` in parallel

**Frontend — `src/components/ride/RideRequestNotification.tsx`:**
- Board requests (`isBoardRequest`) do NOT show the 90-second countdown timer
- Instead show trip date/time: "Ride at Apr 9, 2:00 PM"
- Auto-dismiss if trip time has passed (check every 60s)

---

### 1F. Seat Display + Enforcement

**What:** Show seat counts, disable requests when full, decrement on accept.

**Frontend — `src/components/schedule/RideBoard.tsx`:**
- Detail view shows "X seats available" with icon
- When `available_seats <= 0`: show "Full — No Seats Available" badge, hide request button

**Server — `server/routes/schedule.ts` — `accept-board`:**
- Before accepting: reject 409 if `available_seats <= 0`
- After accepting: `UPDATE ride_schedules SET available_seats = available_seats - 1`
- Only auto-cancel remaining requests when `seatsAfter <= 0`

---

## Phase 2 — Transit Counter-Propose + Chat Enhancements

### 2A. Counter Button → Transit Station Picker

**What:** Driver taps "Suggest Drop-off" on accept screen → accepts ride → navigates to DropoffSelection page showing transit stations along driver's route.

**Flow:**
1. `handleCounter()` in `BoardRequestReview.tsx` calls `accept-board` (status → `coordinating`)
2. Navigates to `/ride/dropoff/${rideId}` with location state:
   ```
   { driverDestLat, driverDestLng, driverDestName, riderDestLat, riderDestLng, riderDestName, riderName, pickupLat, pickupLng }
   ```
3. `DropoffSelection.tsx` calls `/api/rides/${rideId}/driver-destination` which computes transit suggestions
4. Driver picks a station → sends `transit_dropoff_suggestion` message

**Bug fix applied:** The `driver-destination` endpoint now prefers `ride.requester_destination` over `ride.destination` when computing transit suggestions. For board rides, `ride.destination` is the driver's schedule endpoint (e.g. SFO), not the rider's actual destination.

**File:** `server/routes/rides.ts` — `PATCH /:id/driver-destination` (line ~3114)
- Must select `requester_destination` in the ride query
- Use `reqDest ?? ride.destination` as the rider's destination for transit computation

---

### 2B. Chat Suggest Buttons for 'coordinating' Status

**What:** Ensure "Suggest Pickup" and "Suggest Dropoff" buttons render in messaging when ride status is `coordinating` (not just `accepted`).

**File:** `src/components/ride/MessagingWindow.tsx`
- Check all conditional renders for button visibility
- Widen status gates to include `'coordinating'`

---

### 2C. Rider Proactive Transit Suggestion (Pre-Request)

**What:** When rider enters their destination in the confirm sheet, show nearby transit stations along the driver's route *before* submitting the request.

**Server — `server/routes/transit.ts` — `POST /api/transit/preview`:**
- Accepts: `driver_origin_lat/lng`, `driver_dest_lat/lng`, `rider_dest_lat/lng`
- Calls `computeTransitDropoffSuggestions()` from `server/lib/transitSuggestions.ts`
- Returns top 3 suggestions

**Frontend — `RideBoardConfirmSheet.tsx`:**
- After rider selects destination, call `/api/transit/preview` with driver's route coords (from `ScheduledRide.driver_origin_lat/lng` and `driver_dest_lat/lng`)
- Show inline transit suggestions below selected destination
- Rider can tap a station to switch their destination to the transit stop

**Data flow:** Board endpoint includes `driver_origin_lat/lng`, `driver_dest_lat/lng` from `driver_routines` for each schedule poster.

---

## Phase 3 — Multi-Rider Carpooling

### 3A. DB: Seat Lock Column

**What:** `seats_locked` boolean on `ride_schedules` prevents new riders from joining after the first QR scan starts the ride.

**Migration:** Part of `035_ride_request_enrichment.sql`
**Types:** `src/types/database.ts` — `RideSchedule` types

---

### 3B. Seat Lock on QR Scan

**What:** When first QR scan starts a ride, lock seats so no more riders can be accepted.

**Server — `server/routes/rides.ts` — `scan-driver` endpoint:**
- After setting ride to `'active'`: `UPDATE ride_schedules SET seats_locked = true WHERE id = ride.schedule_id`

**Server — `server/routes/schedule.ts` — `accept-board`:**
- Before accepting: check `seats_locked`. If true → 409: "This ride has already started"

---

### 3C. Multi-Accept Logic

**What:** Don't auto-cancel all other requests when driver accepts one rider. Only cancel when all seats are filled.

**Server — `server/routes/schedule.ts` — `accept-board`:**
```
accepted_count = COUNT rides WHERE schedule_id = X AND status IN ('coordinating','accepted','active')
IF accepted_count >= schedule.available_seats (original):
    cancel all remaining 'requested' rides for this schedule
    SET available_seats = 0
ELSE:
    SET available_seats = available_seats - 1
```

---

### 3D. Per-Rider QR Scan Broadcast

**What:** When one rider's ride ends but others remain active, only notify that rider — don't trigger driver navigation to summary.

**Server — `server/routes/rides.ts` — `scan-driver` (ride end):**
- Check: are there other `'active'` rides for this driver with the same `schedule_id`?
- If yes: broadcast `rider_ride_ended` to `driver-active:${driverId}`, only send `ride_ended` to rider channels
- If no more active rides: broadcast normally, driver navigates to multi-summary

---

### 3E. Driver Multi-Rider Active Page

**What:** When driver has 2+ riders for the same schedule, show a multi-rider management UI.

**File:** `src/components/ride/DriverMultiRidePage.tsx` (NEW)
**Route:** `/ride/driver-multi/:scheduleId`

**Features:**
- Rider cards with status badges (Waiting / In car / Dropped off + fare)
- Color-coded pickup markers on map
- Pickup order sorted by haversine distance from driver GPS
- Per-rider action buttons (Chat, Navigate)
- Realtime subscriptions for `rider_ride_ended` and `ride_started` events
- Auto-navigate to multi-summary when all rides done
- Bottom: Group Chat button + Show QR Code button

**Detection:** `DriverActiveRidePage.tsx` checks for sibling rides on mount — if found, redirects to multi-rider page.

---

### 3F. Driver Group Chat View

**What:** Tabbed chat view for drivers with multiple riders.

**File:** `src/components/ride/DriverGroupChatPage.tsx` (NEW)
**Route:** `/ride/group-chat/:scheduleId`

**Features:**
- Tab bar: "All" + per-rider tabs
- "All" tab merges messages chronologically with rider name labels
- Per-rider tab filters by `ride_id`
- Send button disabled in "All" tab when multiple riders (must select specific rider)
- Realtime subscriptions on each ride's chat channel

---

### 3G. Multi-Summary + Ratings Flow

**What:** Step-through flow for rating multiple riders after all rides complete.

**File:** `src/components/ride/DriverMultiSummaryFlow.tsx` (NEW)
**Route:** `/ride/multi-summary/:scheduleId`

**Features:**
- Step through: Summary 1 → Rate 1 → Summary 2 → Rate 2 → Done
- Per-rider fare breakdown with platform fee deduction
- Star rating UI (1-5) per rider
- Final "Trip Complete" screen with total earnings
- Skips already-rated rides

---

## Bugs Found & Fixed During Development

| # | Bug | Cause | Fix |
|---|-----|-------|-----|
| 1 | "Could not find destination_flexible column" error | Migration not run in Supabase | Created `035_ride_request_enrichment.sql`, user runs in SQL editor |
| 2 | "parse error – invalid geometry" on ride request | Used `geography(Point, 4326)` instead of `GEOMETRY(Point, 4326)` | Changed migration to GEOMETRY to match `rides.origin`/`destination` |
| 3 | "Suggest Drop-off" → 404 page | Navigated to `/ride/dropoff-selection/` but route is `/ride/dropoff/:rideId` | Fixed path in `BoardRequestReview.tsx` |
| 4 | Transit suggestions based on driver's destination | `driver-destination` endpoint used `ride.destination` (driver's schedule dest) not `ride.requester_destination` (rider's actual dest) | Updated endpoint to prefer `requester_destination` over `destination` |
| 5 | Pickup showing raw coordinates "38.5456, -121.7228" | No reverse geocoding on pickup point | Added `reverseGeocode()` call in `BoardRequestReview.tsx` |
| 6 | Destination "Not specified" despite rider sending one | Ride was created before code update — no data in DB | Data issue, not code bug. New requests populate correctly |
| 7 | Tests failing after confirm sheet redesign | Tests clicked "Send Request" without selecting destination mode | Added `click('mode-flexible')` before send in tests |
| 8 | "Suggest Drop-off" shows "Where are you headed?" | For board rides, `ride.driver_destination` is null — DropoffSelection falls back to RideSuggestion form | Fall back to `ride.destination` (driver's schedule dest) in BoardRequestReview nav state; also write `driver_destination` from routine on accept-board |
| 9 | Fare under-calculating by ~30% | `computeRideFare()` used haversine (straight-line) distance instead of road distance | Replaced with Google Routes API `computeRoutes` call; falls back to haversine * 1.3 if API fails |
| 10 | Status bar overlapping back buttons on iOS PWA | No universal safe-area top padding | Added `.safe-top` CSS class in `index.css`; applied to pages missing `safe-area-inset-top` |

---

## Lessons Learned

1. **Always check existing column types** before adding new geography columns. The `rides` table uses `GEOMETRY`, not `geography`.
2. **Supabase migrations must be run manually** in the SQL editor for the hosted project. The migration files in `supabase/migrations/` are for documentation/version control.
3. **DropoffSelection was built for on-demand flow** — when reusing for board flow, ensure the transit suggestion API receives the correct rider destination (not the driver's schedule destination).
4. **Route names must match exactly** between `main.tsx` route definitions and `navigate()` calls.

---

## Verification Checklist

After any change, run:
```bash
npm test -- --run    # All tests pass
npm run lint         # Zero errors
npm run build        # No build errors
```

Manual test on phone:
- [ ] Rider enters destination + note in confirm sheet → driver sees it on accept screen
- [ ] "Suggest Drop-off" → DropoffSelection loads with transit stations
- [ ] Transit stations are based on rider's destination, not driver's
- [ ] Seats decrement on accept, "Full" badge shows at 0
- [ ] Stale requests auto-expire after trip time
- [ ] Multi-rider: 2 riders accepted, individual QR scans, individual fares
- [ ] Group chat shows tabs for each rider
- [ ] Multi-summary steps through each rider's summary + rating

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/components/schedule/RideBoard.tsx` | Board listing page |
| `src/components/schedule/RideBoardConfirmSheet.tsx` | Request enrichment bottom sheet |
| `src/components/schedule/boardTypes.ts` | Shared types for board components |
| `src/components/ride/BoardRequestReview.tsx` | Driver accept/decline/counter screen |
| `src/components/ride/DropoffSelection.tsx` | Transit station picker |
| `src/components/ride/DriverMultiRidePage.tsx` | Multi-rider active page |
| `src/components/ride/DriverGroupChatPage.tsx` | Tabbed group chat |
| `src/components/ride/DriverMultiSummaryFlow.tsx` | Multi-rider summary + rating flow |
| `src/components/ride/RideRequestNotification.tsx` | Push notification handler |
| `src/components/ride/MessagingWindow.tsx` | Chat/coordination window |
| `src/components/ride/DriverActiveRidePage.tsx` | Single-rider active page (detects multi) |
| `server/routes/schedule.ts` | Board CRUD + request/accept/decline endpoints |
| `server/routes/rides.ts` | Ride lifecycle + QR scan + driver-destination |
| `server/routes/transit.ts` | Transit preview + options endpoints |
| `server/lib/scheduledReminders.ts` | Expiry cron logic |
| `server/lib/transitSuggestions.ts` | Transit dropoff suggestion algorithm |
| `supabase/migrations/035_ride_request_enrichment.sql` | DB migration |
| `src/types/database.ts` | TypeScript types for all Supabase tables |
