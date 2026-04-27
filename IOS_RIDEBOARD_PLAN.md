# iOS Ride Board — CTO-Level Implementation Plan

> Companion to `rideboardplan.md` (web spec) and `IOS_PROGRESS.md` (current state). This file is the iOS-side plan, not the state — keep it stable; flip checkboxes in `IOS_PROGRESS.md`.

---

## 1. Executive Summary

### What we're porting
The Ride Board feature is the **scheduled-rides surface** on Tago. Drivers and riders post upcoming trips; the other side browses, sends an enriched request, and the poster Accepts / Declines / Counter-offers (transit dropoff). After acceptance, the parties land in MessagingWindow → Pickup → Active → Summary — i.e. the same Phase R loop already shipped on iOS.

### Where iOS stands today
Phase 6 (Schedule & Ride Board) is **entirely unbuilt** on iOS — every checkbox 6.1–6.4 is `[ ]`. Only 6.5 NotificationsPage shipped early (2026-04-24). The board's notification type `board_request` is currently a "coming soon" toast on iOS NotificationsPage — that's the seam where this plan plugs in.

### Vertical-slice posture (per `feedback_complete_features_first.md`)
We will **not** build all 7 web screens before any of them works. Order is end-to-end-first:
slice → ship → verify on device → next slice. Each slice opens and closes a real round-trip with the server.

### Reuse leverage from Phase R
Already shipped and reusable: `MapView` (MapKit), `GlassCard`, `MeshBackground`, `TagoBottomSheet`, `PrimaryButton`, `SecondaryButton`, `InputField`, `Tokens.color.*`, `PollingTimer`, `RealtimeSubscription`, `APIClient` typed-endpoints, `TagoSupabase` wrapper, `ReverseGeocoder`, `Geo.haversineMetres`, `RideSummary.resolveMyRole`, `MessagesViewModel`, `DriverPickupPage`, `RiderPickupPage`, `RideSummaryPage`, `RateRidePage`, `NotificationsPage`, `NotificationsBellStore`. The board essentially feeds into Phase R — the goal is a single new entry-point onto an existing rail.

### Definition of Done (rolls up to project gate)
A slice is `[x]` when:
1. `xcodebuild ... test | xcbeautify` green on iPhone 17 sim
2. `swiftlint --strict ios/` clean
3. Built + installed via `devicectl` on Tarun's paired iPhone (per `feedback_ios_rebuild_protocol.md`)
4. Walked end-to-end in Light **and** Dark on device
5. Diffed against the corresponding web `.tsx` file end-to-end (per `feedback_read_web_end_to_end.md`)
6. User has visually verified — only then flip checkbox in `IOS_PROGRESS.md`

---

## 2. Scope Inventory — Everything That Must Survive The Port

This list is the contract with the user. Anything cut is a deferral that must be flagged via `AskUserQuestion` before Swift gets written. Source: `rideboardplan.md` + the Explore agent's web inventory.

### 2.1 Screens / sheets
| # | Surface | Web file | Actor | iOS target file |
|---|---|---|---|---|
| S1 | Ride Board listing | `RideBoard.tsx` | Both | `RideBoardPage.swift` |
| S2 | Search bar | `RideBoardSearchBar.tsx` | Both | inline in `RideBoardPage` |
| S3 | Filter sheet | `RideBoardFilterSheet.tsx` | Both | `RideBoardFilterSheet.swift` |
| S4 | Card | `RideBoardCard.tsx` | Both | `RideBoardCard.swift` |
| S5 | Detail bottom sheet | inline in `RideBoard.tsx` | Both | `RideBoardDetailSheet.swift` |
| S6 | Confirm/enrichment sheet | `RideBoardConfirmSheet.tsx` | Both | `RideBoardConfirmSheet.swift` |
| S7 | Post-ride form (driver/rider) | `SchedulePage.tsx` | Both | `SchedulePostPage.swift` |
| S8 | Routine editor / list | inside SchedulePage + RideBoard | Driver | `RoutinesSheet.swift` + `RoutineEditorPage.swift` |
| S9 | PostRide FAB | `PostRideFAB.tsx` | Both | inline button in `RideBoardPage` |
| S10 | Driver review of incoming request | `BoardRequestReview.tsx` | Driver | `BoardRequestReviewPage.swift` |
| S11 | Transit dropoff picker | `DropoffSelection.tsx` | Driver | `DropoffSelectionPage.swift` |
| S12 | Board push banner | `RideRequestNotification.tsx` (board variant) | Driver | extend existing `NotificationsBellStore` + add foreground banner |
| S13 | Rider "Withdraw" path | inline detail-sheet button | Rider | menu item on detail sheet |
| S14 | Multi-rider active page | `DriverMultiRidePage.tsx` | Driver | **out of scope** for this plan (defer to Phase 4.8) |
| S15 | Driver group chat | `DriverGroupChatPage.tsx` | Driver | **out of scope** (defer with S14) |
| S16 | Multi-rider summary flow | `DriverMultiSummaryFlow.tsx` | Driver | **out of scope** (defer with S14) |

S14–S16 are the multi-rider carpooling track. Web shipped them but they are independent of single-request Ride Board flow — list them as deferrals on the project board. The plan below is single-rider-per-schedule first; multi-rider is a follow-up plan after seat-locking + per-rider QR is verified.

### 2.2 User actions per surface
- **Browse:** tab (All / Drivers / Riders), search, filter (date / seats / near-me / sort), open card detail
- **Detail:** see poster, route, seats, note, fare estimate; Request / Offer / Withdraw / Open Messages / Edit Seats / Delete (own) / view rider posts side
- **Confirm sheet (driver post → rider requesting):** pickup search, destination radio (driver-dest vs custom), inline transit suggestions, optional note, send
- **Confirm sheet (rider post → driver offering):** route summary, optional note, send offer
- **Post:** mode (one-time / routine), origin + dest autocomplete, date, time-type (departure / arrival / anytime), seats (driver), note, days-of-week (routine), end-date (routine)
- **Driver review:** see rider context (pickup, destination or "Flexible", note, distance from route), Accept / Suggest Drop-off / Decline
- **Dropoff selection:** map with route, transit station cards, direct dropoff option, cancel
- **Notifications:** board_request push → review screen; board_accepted → open chat; board_declined → toast back to board

### 2.3 Domain rules to preserve verbatim
- Money in cents; never floats
- GeoJSON `[lng, lat]` order; `GEOMETRY(Point, 4326)` not `geography`
- Haversine for proximity; <= 30 km = "Near you"
- Note truncated to 200 chars
- Seats decremented on accept; auto-cancel remaining `requested` rows when seats hit 0
- `seats_locked = true` after first QR scan → block new accepts (409)
- Request expires when `trip_date + trip_time < NOW()` (cron-driven server-side; iOS just respects the `expired` status)
- Role-on-ride from IDs (`rider_id` / `driver_id`), not from "which tab" (per `feedback_role_per_ride.md`)

---

## 3. Architecture

### 3.1 Module layout (mirrors existing iOS conventions)
```
ios/Tago/
├─ Features/
│  ├─ RideBoard/
│  │  ├─ RideBoardPage.swift
│  │  ├─ RideBoardCard.swift
│  │  ├─ RideBoardDetailSheet.swift
│  │  ├─ RideBoardFilterSheet.swift
│  │  ├─ RideBoardConfirmSheet.swift
│  │  ├─ RideBoardViewModel.swift
│  │  ├─ RideBoardFilters.swift            // pure model + countActive()
│  │  ├─ TransitPreviewView.swift
│  │  └─ RideBoard+Live.swift              // realtime + polling extension
│  ├─ Schedule/
│  │  ├─ SchedulePostPage.swift            // mode-flagged: driver | rider
│  │  ├─ ScheduleDetailsSection.swift
│  │  ├─ ScheduleOneTimeSection.swift
│  │  ├─ ScheduleRoutineSection.swift
│  │  ├─ RoutinesSheet.swift
│  │  ├─ RoutineEditorPage.swift
│  │  └─ ScheduleViewModel.swift
│  └─ BoardReview/
│     ├─ BoardRequestReviewPage.swift
│     ├─ BoardRequestReviewViewModel.swift
│     ├─ DropoffSelectionPage.swift
│     ├─ DropoffSelectionViewModel.swift
│     └─ BoardReview+Live.swift
├─ Models/
│  ├─ ScheduledRide.swift                  // mirrors web ScheduledRide
│  ├─ DriverRoutine.swift
│  ├─ RequestEnrichment.swift
│  ├─ TransitSuggestion.swift
│  └─ TransitOption.swift
└─ Core/Networking/Endpoints/
   ├─ ScheduleBoardEndpoint.swift          // GET /api/schedule/board
   ├─ ScheduleRequestEndpoint.swift        // POST /api/schedule/request
   ├─ ScheduleAcceptBoardEndpoint.swift    // PATCH /api/schedule/accept-board
   ├─ ScheduleDeclineBoardEndpoint.swift   // PATCH /api/schedule/decline-board
   ├─ ScheduleWithdrawBoardEndpoint.swift  // PATCH /api/schedule/withdraw-board
   ├─ ScheduleSyncRoutinesEndpoint.swift   // POST /api/schedule/sync-routines
   ├─ ScheduleUpdateSeatsEndpoint.swift    // PATCH /api/schedule/{id}/seats
   ├─ ScheduleDeleteEndpoint.swift         // DELETE /api/schedule/{id}
   ├─ TransitPreviewEndpoint.swift         // POST /api/transit/preview
   ├─ DriverDestinationEndpoint.swift      // PATCH /api/rides/{id}/driver-destination (already partly in place — verify)
   ├─ SuggestTransitDropoffEndpoint.swift  // POST /api/rides/{id}/suggest-transit-dropoff
   └─ ConfirmDirectDropoffEndpoint.swift   // POST /api/rides/{id}/confirm-direct-dropoff
```

### 3.2 Navigation
- Add `RideBoardRoute` enum: `.list`, `.post(mode:)`, `.routines`, `.routineEditor(routineID?)`, `.review(rideID:)`, `.dropoff(rideID:Params)`. Hangs off both `RiderRoute` and `DriveRoute` so the same NavigationStack can host the board on either tab.
- Entry points:
  - `RiderHomePage` already has a "Ride Board" card — wire its action to push `.list`
  - `DriverHomePage` already has a "Ride Board" card — wire its action to push `.list`
  - `NotificationsPage` `board_request` → push `.review(rideID:)` on the active tab's stack
- Sheet vs push:
  - Detail / filter / confirm → `.sheet(detents: [.large])` with drag indicator (matches `TagoBottomSheet`)
  - Post / RoutineEditor / Review / Dropoff → push (`NavigationStack` destinations)
  - Routines list → `.sheet(.large)` (matches the web's full-screen-ish surface)

### 3.3 State strategy
- **Server state:** `RideBoardViewModel` is `@MainActor @Observable`, owns `rides: [ScheduledRide]`, `loading`, `error`. Refetch on tab change, on filter apply, and on every realtime tick (debounced to 250ms).
- **Client UI state:** filters, search query, selected detail ride live in the page (or in a tiny `@Observable` if we need to share with the filter sheet).
- **Realtime:** one `board-page:{userID}` subscription owned by the page; `RealtimeSubscription` cleans up on disappear. Polling fallback every 30s (mirrors the web's pattern + our existing `PollingTimer`).
- **Bootstrap-from-table:** on `BoardRequestReviewPage` mount, query `rides` row directly even if nav state is fresh (per `feedback` from R.6 — realtime broadcasts aren't replayed for late subscribers; same pattern bit us with the driver pickup map).
- **Role-from-IDs:** `BoardRequestReviewViewModel` decides "am I the driver or rider on this ride" by comparing `auth.profile.id` with `rides.rider_id` / `rides.driver_id`. Never from "which tab pushed this screen." Per the `feedback_role_per_ride.md` rule. Server's `my_role` field on `/api/rides/active` is preferred when available.

### 3.4 Realtime channel naming (lowercase mandate)
Server channels embed user IDs lowercased. `UUID().uuidString` in Swift returns uppercase. Every channel construction must `.lowercased()` the UUID. Channels we touch on Ride Board:
- `board-page:{userID.lowercased}` — page-level: `ride_status_changed`, `ride_cancelled` (refresh)
- `board:{userID.lowercased}` — driver inbox: `board_request`, `board_accepted` (foreground notification)
- `rider:{userID.lowercased}` — already wired by `WaitingRoomPage` / `RiderPickupPage` — leave alone
- `ride-chat:{rideID.lowercased}` — already wired by `MessagingPage` — leave alone

### 3.5 Realtime envelope unwrap (the bug from R.6)
Per `ios/CLAUDE.md` "Swift Realtime SDK yields the FULL envelope for web-sent broadcasts" — copy the existing helper, do not re-implement:
```swift
let body: JSONObject
if case let .object(inner) = envelope["payload"] ?? .null {
    body = inner       // web-sent
} else {
    body = envelope    // iOS-sent
}
```
Both `board-page` and `board` events are server-published (web client) → expect the nested-payload shape on every event from these channels. Test fixture should cover both shapes.

---

## 4. Phased Slice Plan

Each slice ends in a working device demo. No slice depends on the next; if we run out of time mid-plan, the previous slice is still useful.

### Slice A — Read-only board (1 session, ~4–5h)
**Goal:** rider can browse the board. No request flow yet. Proves the data plumb works end-to-end.

- Build `ScheduledRide` model + `Endpoint`
- `RideBoardPage`: header, search input (no debounce yet), tabs (All/Drivers/Riders), list of `RideBoardCard`s
- `RideBoardCard`: poster + name + rating + route + date/time + mode badge + "Near you" pill
- Tab counts based on `rides.filter { $0.mode == .driver }`.count etc.
- "Near me" filter wired to `LocationManager` (already exists)
- Empty / loading / error states (skeleton card shimmer = native upgrade)
- **No** confirm sheet, no detail sheet yet

**Tests:**
- VM unit: filter mode, search by origin/dest, near-me proximity (haversine fixture)
- UI test: open board from RiderHome → see N cards → tap tab → list reshuffles

**Deferrals to flag in plan summary BEFORE writing Swift:** post-ride FAB (Slice E), filter sheet (Slice B), detail sheet (Slice B), confirm sheet (Slice C), withdraw / edit / delete (Slice E). All visible-on-web — user must veto deferrals.

### Slice B — Filter + detail sheet (~3h)
- `RideBoardFilterSheet`: date (4 buttons + native `DatePicker`), seats (any / 2+, hidden on rider tab), near-me toggle (disabled if no location), sort (recent / nearest, "nearest" disabled if no location)
- Apply / Clear actions; counted-active badge on filter button
- `RideBoardDetailSheet`: poster card, route, seats, note, fare estimate (use existing `FareBreakdownCard` pattern with road distance via `MKDirections` — same as Phase R drove-route)
- Map mini-preview at top of detail sheet (reuse `MapView` with markers + polyline) — native upgrade over web's address-only view
- Buttons in detail: contextual ("Request This Ride" / "Offer to Drive" / "Already Requested" pill) — but wired to a **stubbed `print(...)`** for now. Actual networking lands in Slice C.

**Tests:**
- Filter sheet: each filter narrows result correctly, count badge updates
- Detail sheet: shows correct buttons per (mode, isOwn, already_requested, ride_status) matrix — table-driven test

### Slice C — Confirm sheet + Send Request happy path (~5–6h, biggest slice)
- `RideBoardConfirmSheet`: full enrichment flow, two paths (driver-post vs rider-post)
- Pickup search uses existing `GooglePlaces` autocomplete wrapper
- Destination radio: "Driver's destination" (default) vs "I have a different destination" → custom search
- Inline `TransitPreviewView`: cards w/ station + walk + transit + total minutes + progress bar; tap to switch destination to that station
- Note `TextField` (multi-line) + 200-char counter
- `.dismissKeyboardOnTap()` on outer body (mandatory per `feedback_keyboard_dismiss.md`); `.toolbar(.keyboard)` Done button on the multi-line note field
- `ScheduleRequestEndpoint` POST → on 200, dismiss sheet, mark card `already_requested = true` optimistically, refetch in background
- Error handling:
  - `NO_PAYMENT_METHOD` → push `/payment/add` (Phase 5.3 isn't shipped, so for now route to a stub or — preferable — surface a `PaymentMethodsSection`-style inline error pointing to NotificationsPage. Flag as deferral.)
  - `RIDER_NO_PAYMENT_METHOD` → inline error on confirm sheet
  - `FULL` → inline error + dismiss + refetch
  - `SEATS_LOCKED` → same handling as `FULL`
- Haptics: success on send, warning on error

**Tests:**
- VM unit: enrichment payload shape matches server contract (lat/lng/name/flexible/note)
- UI test: open card → enrichment sheet → search dest → see transit → tap station → send → return to board with "Request Sent" pill
- Error cases via injected mock endpoint

### Slice D — Driver review + Accept / Decline (~4h)
- `BoardRequestReviewPage`: card components per the per-component inventory — requester card, rider details card (pickup reverse-geocoded via `CLGeocoder`, destination or "Flexible" badge, note card, distance from route), driver's route card, three buttons
- Wire into `NotificationsPage` `board_request` row tap (currently a stub) → push `.review(rideID:)`
- `ScheduleAcceptBoardEndpoint` + `ScheduleDeclineBoardEndpoint`
- On Accept → dismiss + push to existing `MessagingPage(rideID:)`
- On Decline → pop + toast on board

**Bootstrap-from-table:** on mount, query `rides` row directly (don't depend on push payload alone — per the realtime-buffering rule).

**Tests:**
- VM unit: role decided from `rider_id`/`driver_id` not from constructor hint
- UI test: tap board_request notification → review → accept → land on chat
- Edge: "Suggest Drop-off" routes to `.dropoff(rideID:)` (Slice F), not 404 (this is the bug #3 from rideboardplan)

### Slice E — Routines + Posting + own-card actions (~5–6h)
- `SchedulePostPage`: native `Form` with mode pickup, From/To `GooglePlaces` autocomplete, native `DatePicker` for date, time-type segmented control, native `DatePicker` (`.hourAndMinute`) for time, seats `Stepper`
- Routine variant: `DayPill` (already shipped) row, optional end date, share-time toggle vs per-day times
- Direct Supabase insert (matches web pattern; no server endpoint needed for `ride_schedules` insert)
- "My Routines" sheet: list with edit / delete + sync-to-board button
- `RoutineEditorPage`: same form with prefill + update path
- Detail sheet own-card actions: Edit Seats (`Stepper` + Save), Delete (with confirm dialog, per Uber-class UX rule for irreversible actions)
- Withdraw pending request: menu item on detail sheet → `ScheduleWithdrawBoardEndpoint`
- Wire `PostRideFAB` (floating button) on `RideBoardPage`

**Tests:**
- VM unit: post payload shape (one-time + routine variants), withdraw, delete, seats-update
- UI test: post a routine → it appears on board → delete it → it's gone
- UI test: send request → withdraw → "Request Sent" pill clears

### Slice F — Dropoff Selection / Counter Offer (~5h)
This slice depends on map + polyline patterns we've already shipped on `DriverPickupPage`. **Re-read** `MapView+Polyline.swift` and the polyline-cache trap in `ios/CLAUDE.md` before writing it; do not re-derive.

- `DropoffSelectionPage`: top-half map with multi-color polylines (driver route solid → station, dashed station → end, rider walk green, transit colored), markers for pickup / stations (numbered, selected = enlarged) / rider dest
- Use the additive-polyline pattern (`polylines: [MapView.Polyline]`); set styles **before** `addOverlay` (the cache-default-forever bug)
- Scrollable card list: direct dropoff card + transit cards (numbered)
- Tap-once = highlight, tap-again = submit (web pattern, intentionally preserved)
- `DriverDestinationEndpoint` PATCH on mount to fetch suggestions
- `SuggestTransitDropoffEndpoint` on transit-card double-tap
- `ConfirmDirectDropoffEndpoint` on direct card double-tap
- After server 200 → push `MessagingPage`
- Native confirmation dialog ("Suggest [Station] as dropoff?" with explicit "your rider will need to accept" copy — irreversibility framing per Uber-UX rule)

**Tests:**
- UI: open from review → tap station → confirm → message inserted → land on chat
- Polyline-style assertion: renderer style mapped before overlay added (catches bug regression)
- Bootstrap-from-table: nav state missing driverDest → recover from `rides` row

### Slice G — Realtime + foreground push polish (~2–3h)
- Subscribe to `board-page:{userID}` on `RideBoardPage` mount; on `ride_status_changed` / `ride_cancelled` → debounced refetch + animated card update (`.transition(.move)`)
- Subscribe to `board:{userID}` on `RideBoardPage` mount AND on `RootView` (low priority listener) so a `board_request` arriving while app is foregrounded fires:
  - haptic notification
  - banner overlay reusing the existing `NotificationsBellStore` semantics (or a new `BoardRequestBanner` modeled after the rider's `RideRequestNotification.tsx`)
  - dedup against `seenRideIDs: Set<UUID>` to suppress double-fires from FCM + realtime
- Polling fallback (`PollingTimer` 30s) for board listing; web does the same
- Auto-dismiss expired requests in any banner (web checks every 60s — port that)

**Tests:**
- Envelope-shape: nested-payload (web-sent) AND flat-payload (iOS-sent) both decode
- Dedup: same ride_id from realtime + FCM + polling = one banner

### Slice H — Dark/Light + accessibility + post-build web diff (~1.5h, mandatory final gate)
Per `ios/CLAUDE.md` "post-build web diff" rule:
- Walk every state in Light then Dark on real device
- Audit for hardcoded `Color.white` / `.black` / hex on surfaces; should all come from `Tokens.color.*`
- Re-open every web `.tsx` file end-to-end against finished iOS screen — flag drift in summary before declaring done
- VoiceOver pass: every card has accessibility label "Driver post by Jamie, San Jose to SFO, March 15, 2:30 PM, three seats, near you" (composed string)
- Dynamic Type: cards reflow at AccessibilityXXXL — wrap, don't truncate the action button
- Add `accessibilityIdentifier` to every interactive element so `RideBoardUITests` can target them

---

## 5. Server Contract Map (no server changes anticipated)

The web has shipped every endpoint we need. iOS just consumes them. **Do not change `server/`** without flagging — that's an explicit off-limit per `ios/CLAUDE.md`. Endpoints + key validation rules:

| Endpoint | Slice | Method | Notes |
|---|---|---|---|
| `/api/schedule/board?mode&lat&lng&dest_lat&dest_lng&trip_time` | A | GET | Returns `{ rides: [...] }`; relevance-scored if all params present |
| `/api/schedule/request` | C | POST | Idempotency key required; error codes: `NO_PAYMENT_METHOD`, `RIDER_NO_PAYMENT_METHOD`, `FULL`, `SEATS_LOCKED` |
| `/api/schedule/accept-board` | D | PATCH | Decrements seats; auto-cancels remaining at 0; 409 if `seats_locked` |
| `/api/schedule/decline-board` | D | PATCH | Sets `declined`; broadcasts |
| `/api/schedule/withdraw-board` | E | PATCH | Rider-side withdraw |
| `/api/schedule/sync-routines` | E | POST | Driver routine → board sync |
| `/api/schedule/{id}` | E | DELETE | Own schedule |
| `/api/schedule/{id}/seats` | E | PATCH | Update seats |
| `/api/transit/preview` | C | POST | Pre-request transit suggestions |
| `/api/rides/{id}/driver-destination` | F | PATCH | Already used by Phase R DropoffSelection — verify endpoint exists in iOS already; reuse |
| `/api/rides/{id}/suggest-transit-dropoff` | F | POST | Adds chat message + advances ride |
| `/api/rides/{id}/confirm-direct-dropoff` | F | POST | Direct dropoff path |

**Side-effect awareness:** every accept/decline broadcasts on multiple channels and writes a persistent `notifications` row + FCM push. iOS doesn't need to fan out — server does that. iOS **only consumes** these.

---

## 6. Data Models (Swift, exact)

```swift
struct ScheduledRide: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let userID: UUID
    let mode: Mode
    let routeName: String
    let originAddress: String
    let destAddress: String
    let directionType: DirectionType
    let tripDate: String          // YYYY-MM-DD — keep as String to match server, format on display
    let timeType: TimeType
    let tripTime: String          // HH:MM:SS
    let timeFlexible: Bool?
    let availableSeats: Int?
    let note: String?
    let createdAt: Date
    let poster: Poster?
    let relevanceScore: Double?
    let alreadyRequested: Bool?
    let rideStatus: RideStatus?   // requested | coordinating | accepted | nil
    let rideID: UUID?
    let originLat: Double?
    let originLng: Double?
    let destLat: Double?
    let destLng: Double?
    let driverOriginLat: Double?
    let driverOriginLng: Double?
    let driverDestLat: Double?
    let driverDestLng: Double?

    enum Mode: String, Codable, Sendable { case driver, rider }
    enum DirectionType: String, Codable, Sendable { case oneWay = "one_way", roundtrip }
    enum TimeType: String, Codable, Sendable { case departure, arrival }
    enum RideStatus: String, Codable, Sendable { case requested, coordinating, accepted, expired, declined, cancelled }

    enum CodingKeys: String, CodingKey {
        case id
        case userID = "user_id"
        case mode
        case routeName = "route_name"
        case originAddress = "origin_address"
        case destAddress = "dest_address"
        case directionType = "direction_type"
        case tripDate = "trip_date"
        case timeType = "time_type"
        case tripTime = "trip_time"
        case timeFlexible = "time_flexible"
        case availableSeats = "available_seats"
        case note
        case createdAt = "created_at"
        case poster
        case relevanceScore = "relevance_score"
        case alreadyRequested = "already_requested"
        case rideStatus = "ride_status"
        case rideID = "ride_id"
        case originLat = "origin_lat"
        case originLng = "origin_lng"
        case destLat = "dest_lat"
        case destLng = "dest_lng"
        case driverOriginLat = "driver_origin_lat"
        case driverOriginLng = "driver_origin_lng"
        case driverDestLat = "driver_dest_lat"
        case driverDestLng = "driver_dest_lng"
    }
}

struct Poster: Codable, Hashable, Sendable {
    let id: UUID
    let fullName: String?
    let avatarURL: String?
    let ratingAvg: Double?
    let isDriver: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case fullName = "full_name"
        case avatarURL = "avatar_url"
        case ratingAvg = "rating_avg"
        case isDriver = "is_driver"
    }
}

struct RequestEnrichment: Codable, Sendable {
    let pickupLat: Double?
    let pickupLng: Double?
    let pickupName: String?
    let destinationLat: Double?
    let destinationLng: Double?
    let destinationName: String?
    let destinationFlexible: Bool
    let note: String?    // truncated to 200 client-side, also enforced server-side

    // Manual encode to snake_case server keys via APIClient encoder (which converts via CodingKeys).
}

struct RideBoardFilters: Equatable, Sendable {
    var time: Time = .all
    var customDate: String?
    var seats: Seats = .any
    var nearMeOnly: Bool = false
    var sort: Sort = .recent

    enum Time: String, Sendable { case all, today, week, custom }
    enum Seats: String, Sendable { case any, twoPlus = "2plus" }
    enum Sort: String, Sendable { case recent, nearest }

    var activeCount: Int {
        var n = 0
        if time != .all { n += 1 }
        if seats != .any { n += 1 }
        if nearMeOnly { n += 1 }
        if sort != .recent { n += 1 }
        return n
    }
}
```

(`TransitSuggestion` / `TransitOption` follow the same pattern — explicit `CodingKeys`, no `convertFromSnakeCase` strategy on the decoder per the existing rule in IOS_PROGRESS.md decision 2026-04-22.)

---

## 7. Risk Register — Known Bugs + iOS-Specific Traps

Every row here has an explicit mitigation baked into the slice plan.

### 7.1 Bugs from `rideboardplan.md` — most fixed server-side, but iOS must respect them
| # | Bug | iOS-side mitigation |
|---|---|---|
| 1 | "destination_flexible column not found" | iOS doesn't need to apply migration; user already ran 035. Verify by GETing a ride and decoding the field. **Plan note:** flag at session start that migrations 035 + 048 + 051 + 052 are assumed applied; if any test 400s with a missing-column error, stop and tell user. |
| 2 | "Invalid geometry" parse error | iOS sends GeoJSON `{type:"Point",coordinates:[lng,lat]}` everywhere. `Coordinate.geoJSONPair` already exists — use it; do not roll a fresh encoder. |
| 3 | "Suggest Drop-off" → 404 | `RideBoardRoute.dropoff(rideID:)` is the canonical case; nav state passes a typed `DropoffParams` struct (per the `RiderRoute` associated-values cap pattern). |
| 4 | Transit based on driver's dest, not rider's | Server-side fix already shipped. iOS just calls the endpoint and trusts the response. **Test fixture** should still cover both branches so a future regression on the server is caught by iOS contract tests. |
| 5 | Pickup shows raw coords | iOS reverse-geocodes via `CLGeocoder` (already used elsewhere). Plan `BoardRequestReviewViewModel.loadPickupAddress()` runs the geocode on mount. |
| 6 | Destination "Not specified" — data issue | Inert. Iff a rider with a legacy ride opens the review page, fall back to "Destination not provided" with the "Flexible" framing. |
| 7 | Tests broke after confirm-sheet redesign | Our XCTest matrix already covers the both-modes (default driverDest + custom dest) — see Slice C tests. |
| 8 | Driver-destination null on board → DropoffSelection redirects to RideSuggestion | Already addressed server-side by writing `driver_destination` from routine on `accept-board`. iOS implementation: on DropoffSelection mount, do a fresh `rides` read; if `driver_destination` still null, push to `/ride/suggestion/{rideID}` (to be wired into existing `DriverHomePage` suggestion flow). Until that flow is on iOS, surface a polite error: "Set your destination first" with a back button. |
| 9 | Fare under-calculated 30% | iOS uses `MKDirections` for road distance (already in `DriverPickupPage+Live.swift`). Fall back to `Geo.haversineMetres * 1.3` if `MKDirections` errors — matches the web's bonus multiplier. |
| 10 | Status bar overlapping back buttons | SwiftUI `.toolbar` + `NavigationStack` give safe-area for free. No web-style `.safe-top` hack needed. |

### 7.2 iOS-specific traps (from `ios/CLAUDE.md` + memory)
| Risk | Mitigation |
|---|---|
| Realtime envelope shape varies (nested vs flat) | Use the existing payload-unwrap helper; add a unit test fixture for each shape |
| Realtime broadcasts NOT replayed on subscribe | On `BoardRequestReviewPage` mount, always re-read `rides` row from DB regardless of nav-state freshness |
| Channel UUIDs case-mismatch | Lowercase every channel UUID at construction site (helper extension on UUID — already exists; if not, add and test) |
| MapKit polyline style cached default | On `DropoffSelectionPage`, populate `polylineStyles` BEFORE `addOverlay` (re-read `MapView+Polyline.swift` first; do not improvise) |
| Stationary-driver heading spin | N/A on this feature (no live driver dot) |
| XcodeGen regen after new files | After every new `.swift`, run `xcodegen generate`; verify with grep against `project.pbxproj` |
| Empty `.app` bundle on silent build failure | Verify `Tago.app/` has Info.plist + binary after `xcodebuild`; don't trust exit 0 alone |
| OSLog `<private>` redaction on device | All diagnostic logs use `privacy: .public` for non-PII values (e.g. `ride_id`, `status`) |
| Strong-reference cycle in viewmodel closures | `[weak self]` in every escaping closure; subscription Tasks captured on the VM and `cancel()` on disappear |
| Role decided by tab not by IDs | `BoardRequestReviewViewModel` resolves role via `RideSummary.resolveMyRole(myUserID:)` — never from constructor hint alone |
| Keyboard trap on confirm sheet | `.dismissKeyboardOnTap()` mandatory on outer body; `.toolbar(.keyboard)` Done on multi-line note field |

### 7.3 Open questions (queue for `AskUserQuestion` at session start, batched)
1. **Multi-rider scope (S14–S16):** in-scope-now or follow-up? Recommendation: follow-up — we can ship single-rider-per-schedule first and seat-lock works the same way.
2. **`NO_PAYMENT_METHOD` behaviour:** Phase 5.3 (PaymentMethods + SaveCard) hasn't shipped. Three options: (a) inline error pointing to web app, (b) a stripped-down SaveCard sheet just for board flow, (c) push the user to NotificationsPage with a banner — what does Tarun want?
3. **Driver-side schedule entry:** does posting a routine on iOS push to `driver_routines` table directly (web behaviour) or only to `ride_schedules`? Need confirmation that direct insert is safe under RLS.
4. **Filter sheet visual:** native `Form` (matches Settings ergonomic) vs custom glass cards (matches RiderHome / RideBoard surface aesthetic). Recommendation: glass cards for visual continuity.
5. **Empty-state copy + illustration:** Tarun has been opinionated about copy in the past. Prefer SF Symbol + tagline OR custom asset?

These get one batched `AskUserQuestion` call at the start of the implementation session.

---

## 8. Test Strategy

### 8.1 Unit tests (Swift Testing or XCTest, follow existing convention in `TagoTests/`)
- `RideBoardFiltersTests` — `activeCount`, time predicates, seats predicate (rider-tab skip), proximity predicate
- `RideBoardViewModelTests` — pagination, dedup (same ride id), filter → list change, near-me-with-no-location yields empty
- `ScheduledRideDecodingTests` — decodes both server response shapes (with and without coords)
- `RequestEnrichmentEncodingTests` — snake_case payload matches `POST /api/schedule/request` server expectation
- `BoardRequestReviewRoleResolutionTests` — role from IDs, ignores constructor hint
- `BoardEnvelopeShapeTests` — nested-payload AND flat-payload realtime decode
- `DropoffSelectionTests` — bootstrap-from-table when nav state missing
- `TransitSuggestionDecodingTests` — covers minimal + full payload shapes

### 8.2 UI tests (`HichUITests/RideBoardUITests.swift`)
- Happy path: open → search → tap card → confirm → request sent
- Sad path: send request with no payment method → see inline error
- Impatient: double-tap "Send Request" → only one POST fires (idempotency-key cache)
- Filter: apply 2+ filters → count badge shows "2" → clear → list resets
- Routine: post routine → routines sheet shows new row → delete → row gone
- Driver review: tap board_request notification → review page → accept → land on chat
- Counter: tap Suggest Drop-off → DropoffSelection → tap station → confirm → land on chat

### 8.3 Manual device passes (per `feedback_ios_rebuild_protocol.md`)
- Light + Dark walk for every screen
- VoiceOver swipe through every card
- Dynamic Type at AX5 on every screen
- Slow network (Network Link Conditioner: 3G) — every loading state visible, no dead spinners
- Background app mid-request → return → state recovers via realtime / polling

---

## 9. Sequencing & Effort Estimate

Across ~6–7 sessions of focused iOS work, with the user testing on device between each:

| Slice | Effort | Sessions | Cumulative result |
|---|---|---|---|
| A | 4–5h | 1 | Browse-only board on rider home |
| B | 3h | 0.5 | Filter + detail sheet (still browse-only) |
| C | 5–6h | 1.5 | Send request end-to-end (rider → driver) |
| D | 4h | 1 | Driver Accept / Decline working |
| E | 5–6h | 1.5 | Posting + routines + own-card actions |
| F | 5h | 1 | Counter Offer / Dropoff Selection |
| G | 2–3h | 0.5 | Realtime polish + dedup |
| H | 1.5h | 0.5 | Final web diff + Light/Dark + a11y |
| **Total** | **~30h** | **~7 sessions** | Full Ride Board parity, single-rider-per-schedule |

Multi-rider (S14–S16) is a separate plan, ~10–14h on top, after this lands.

Slices A → D are the unblocking spine — at end of slice D the feature is functionally complete (board → request → accept → chat → existing ride loop). E + F are quality / parity. G + H are the polish and gate.

---

## 10. What This Plan Deliberately Does Not Cover
- **Multi-rider carpooling (S14–S16)** — separate plan, separate sprint.
- **Server changes** — none expected; if a server gap surfaces, stop and flag (per `ios/CLAUDE.md` "STOP and flag" rule).
- **Apple Pay express-checkout for the board flow** — Phase 8.3, deferred; Stripe Connect onboarding + PaymentMethods (Phase 5.3) is the gate for the `NO_PAYMENT_METHOD` happy path.
- **Live Activities for in-flight board requests** — Phase 8.1; future.
- **Widget surfacing the next scheduled ride** — Phase 8.8.
- **Driver-destination missing → RideSuggestion redirect** — a polite error stop is the iOS-side fallback until the web's RideSuggestion flow is also ported.

---

## 11. Pre-flight Checklist (before first slice writes Swift)
1. Read this file end-to-end
2. Read `rideboardplan.md` end-to-end (web spec)
3. Read `IOS_PROGRESS.md` Decisions Log + Phase 6 row (current state)
4. Re-read every web `.tsx` listed in §2.1 end-to-end (per `feedback_read_web_end_to_end.md`)
5. Confirm migrations 035 / 048 / 051 / 052 are applied on the Supabase project (a quick `select column_name from information_schema.columns where table_name = 'ride_schedules'` in the SQL editor)
6. `npm run dev:server` running on the LAN IP that's in `Tago.local.xcconfig` (per `project_dev_server_ip.md`)
7. Open a single `AskUserQuestion` call with the §7.3 batched questions; do not write Swift until answers land
8. State role at start of session (UX + Senior iOS engineer for this work)
9. Update `IOS_PROGRESS.md` Phase 6 row to `[~]` with today's date the moment slice A starts

---

*Last updated: 2026-04-26 — iOS-side companion to `rideboardplan.md`. Update only when the plan itself changes; live state belongs in `IOS_PROGRESS.md`.*
