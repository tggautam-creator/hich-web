# Tago iOS — Ride Board Feature Manifest

> Single source of truth for what the iOS Ride Board can do today + how to verify each surface on device. Updated per slice. Companion to `IOS_RIDEBOARD_PLAN.md` (the build plan) and `IOS_PROGRESS.md` (the per-slice log).

Last updated: **2026-04-28** — Slices A–H plus deferrals I, J, K, and L1 (multi-rider detection) shipped. Slice L is a partial — sibling-detection + multi-rider page + per-rider chat fan-out are wired; group-chat and step-through multi-summary flows remain stubbed.

---

## What the Ride Board does

A scheduled-rides surface inside the Tago app where:
- Drivers post upcoming trips (driver mode) — origin, destination, date, time, available seats
- Riders post needs (rider mode) — same fields minus seats
- Both browse the board, search by location, filter by time/seats/proximity/sort
- Riders request to join a driver's post (sending pickup, optional destination, note)
- Drivers receive the request and Accept / Decline / Suggest a transit drop-off
- Once accepted, both parties land in MessagingPage to coordinate
- A QR scan starts and ends the actual ride (handled by Phase R, not the board itself)

The board also surfaces driver routines (recurring posts) on the next-7-days projection.

---

## Surface inventory (iOS)

### Tab entry points
- **Home tab → "Browse ride board" pill** on `RiderHomePage` → pushes `RideBoardPage` with default tab `Drivers`
- **Drive tab → "Ride Board" card** on `DriverHomePage` → pushes `RideBoardPage` with default tab `Riders`
- **Notifications bell sheet** → `board_request` row tap → pushes `BoardRequestReviewPage` on the active tab
- **Foreground board-event banner** (top of screen) → tap routes to review / chat depending on event kind

### `RideBoardPage` (Slice A + B + glass pass)
- Header: Back chevron + "Ride Board" title + (placeholder routines button — wires up in Slice J)
- Native search bar with system clear icon, placeholder "Where are you going?", `.dismissKeyboardOnTap()` on the body
- Three tabs: All / Drivers / Riders — each shows a count badge once loaded
- Filters button (top-right of tab row) — primary-blue when ≥1 filter active, glass capsule otherwise
- Card list:
  - Mode badge (Offering Ride / Needs Ride) + "Near you" pill (when origin within ~30 km of GPS)
  - Poster name + ★ rating (when present)
  - Vertical FROM → TO route stack with bullets + dashed connector
  - Date pill + time pill (or "Anytime" when `time_flexible=true`) + "Roundtrip" pill + fare estimate pill
  - "Your posted ride" italic tag for own cards
  - Status badges: "Ride Confirmed" (when ride is coordinating/accepted), "Request Sent" (when pending)
- Empty state: SF Symbol + "No rides posted yet" / "No rides matching '<q>' yet" + Post a Ride button
- Pull-to-refresh
- Glass-surface treatment: cards / search / tab pills / filter button all use `.regularMaterial` + hairline white stroke + layered shadows
- Realtime: subscribed to `board-page:{userID}` for `ride_status_changed` / `ride_cancelled` events → auto-refresh
- Polling fallback: 30s timer
- ScenePhase auto-refresh on app foreground
- **PostRideFAB** (bottom-right, primary-blue circle with plus icon) → pushes `SchedulePostPage` (driver-mode on Drive tab, rider-mode on Home tab)

### `RideBoardFilterSheet` (Slice B)
- Glass-card sections matching the rest of the board:
  - Date — 2×2 grid: All dates / Today / Next 7 days / Pick date (last reveals native graphical `DatePicker`)
  - Seats — 2×1: Any seats / 2+ seats (hidden on Riders tab)
  - Proximity — native iOS toggle "Near me only" with secondary copy ("Within ~30 km" or "Needs location to enable")
  - Sort — Recently posted / Closest to me ("Closest" disabled if no GPS)
- Cancel (top-right) discards draft; Apply commits and shows count badge
- Clear button resets to defaults

### `RideBoardDetailSheet` (Slice B)
- Full-screen `.sheet(.large)` with drag indicator
- Mini-map (180pt) at top showing pickup + destination markers when coords available
- Poster row: avatar (image or initial fallback), name, mode pill (Driver/Rider), ★ rating, "Near you" pill on right
- Route card: vertical FROM → TO with dashed connector
- Meta pills: calendar + date / clock + time / "Roundtrip" pill (accent)
- Seats + note section (only when present): seats count + note in subtle card
- Branched action buttons (real, not stubs):
  - **Open Messages** → `MessagingPage` for that ride (when ride.status is coordinating/accepted)
  - **Request Sent** badge + **Withdraw Request** → `WithdrawBoardRequestEndpoint`
  - **Request This Ride** / **Offer to Drive** → opens `RideBoardConfirmSheet`
  - **Full — No Seats Available** badge (when `available_seats <= 0`)
  - **Edit Seats** (own driver post only) → inline `Stepper` row → PATCH `/api/schedule/{id}/seats`
  - **Delete This Ride** (own post) → confirmation alert → `DeleteScheduleEndpoint`

### `RideBoardConfirmSheet` (Slice C + glass pass)
- Two paths driven by `ride.mode`:
  - **Driver post → rider requesting** (`isDriverPost=true`): full enrichment form
  - **Rider post → driver offering** (`isDriverPost=false`): minimal form (note only)
- Common: poster card + route summary + fare-estimate row
- Rider flow:
  - "📍 Use my current location" pill above pickup search (native upgrade — one-tap GPS prefill, fills with literal "Current location" text per user spec)
  - Pickup `MKLocalSearchCompleter` autocomplete with debounce + selected-confirmation row
  - Destination radio: "Drop me at driver's destination" (default checked) vs custom search
  - Custom destination autocomplete with debounce
  - Inline transit suggestions (from `POST /api/transit/preview`) when rider's destination is selected and driver coords are present — tap a station to switch
- Note `TextField` with 200-char counter + Done keyboard toolbar button
- Send button (Send Request / Send Offer) with progress spinner state
- Inline error banner with **Open Notifications** button when server returns `NO_PAYMENT_METHOD` (or RIDER_NO_PAYMENT_METHOD / FULL / SEATS_LOCKED)
- Recent server fix `0d2033c` honored — when rider keeps "Drop me at driver's destination" checked, body sends `dropoff_at_driver_destination: true`
- Tap-target fix: `.contentShape(Rectangle())` on every suggestion row so the entire padded row is hit-testable

### `BoardRequestReviewPage` (Slice D + bug fixes)
- Pushed from `NotificationsPage` `board_request` row tap (also from foreground banner tap in Slice G)
- Header: back chevron + "Ride Request" / "Ride Offer" title + "X wants to join your ride" / "X offered to drive you" subtitle
- Requester card (glass): avatar + name + ★ rating + ride count + role pill (Rider/Driver)
- **Rider Details card** (only when posterIsDriver):
  - Pickup row (reverse-geocoded via `CLGeocoder` from `ride.origin` if `origin_name` is missing)
  - Destination row (or "Flexible — will discuss in chat" badge when `destination_flexible=true`)
  - Distance pill ("X.X mi from your route" or "on your route", computed via haversine between rider's destination and driver_destination)
  - Optional rider note in styled card
- Posted-route card: route name (when present) + origin → dest dashed connector + date/time
- Sticky bottom action bar:
  - **Active state** (ride status = `requested`):
    - Accept Rider / Accept Ride (green)
    - Suggest Drop-off (primary outline) — only shown when `posterIsDriver` AND `dropoff_confirmed != true` (Bug #1 fix — pre-confirmed dropoff hides the button)
    - Decline (red outline)
  - **Already-actioned state** (ride status moved past `requested`, Bug #3 fix):
    - Status copy: "Already accepted — coordinate in chat" / "Ride in progress" / "Ride completed" / "Request was declined" / "Rider withdrew" / "Cancelled" / "Expired"
    - For live states (coordinating/accepted/active): **Open Chat** button → `MessagingPage`
    - For terminal states: **Back to Home** button → pop
- Role resolution: from `ride.rider_id` / `ride.driver_id` IDs, never from tab (per `feedback_role_per_ride.md`)
- Server-confirmed accept replaces the page in the stack with the chat — no jarring back-to-review

### `DropoffSelectionPage` (Slice F integration with Phase R existing screen)
- Pushed from `BoardRequestReviewPage`'s **Suggest Drop-off** action
- Full-screen MapKit map + stationary 55%-height bottom panel (no detents, panel scrolls internally)
- Driver's route + rider's walk polylines on the map
- Numbered transit station markers + selected-pin highlight
- "Take rider all the way" / "100%" direct-dropoff card at top of panel (per web's `0728704`)
- Transit station cards with walk-to / transit-to / total minutes + driver detour
- Tap-once = highlight, tap-again = submit (web pattern, intentionally preserved)
- Cancel ride button (floating top-right)
- Server endpoints used: `PATCH /api/rides/:id/driver-destination`, `POST /api/rides/:id/suggest-transit-dropoff`, `POST /api/rides/:id/confirm-direct-dropoff`

### `SchedulePostPage` (Slice E)
- Header: back chevron + "Post a Ride" / "Request a Ride" title (changes based on selected mode)
- Mode segmented control (Driving / Need a ride) — only visible if user `is_driver=true`
- From + To autocomplete pair (`MKLocalSearchCompleter`, free, no API key)
- Trip type segmented control (One-time / Recurring)
- One-time path:
  - Native `DatePicker` for date (`.date`, future dates only)
  - Time-kind segmented (Departing / Arriving / Anytime)
  - Native `DatePicker` for time (`.hourAndMinute`, hidden when "Anytime")
- Routine path:
  - Sun-first day pills (S M T W T F S) — tap to toggle
  - "Different time per day" toggle (perDayMode)
  - Per-day or shared time picker(s)
  - Optional end-date toggle + native `DatePicker`
- Driver-only seats `Stepper` (1-8)
- Optional route name field
- Optional note field with 200-char counter + Done keyboard toolbar
- Send button (Post Ride / Save Routine)
- Inline error banner with **Open Notifications** button when migration-051 trigger fires (no card)
- `.dismissKeyboardOnTap()` on the body
- Submit logic:
  - One-time → direct insert into `ride_schedules` + fire-and-forget `POST /api/schedule/notify`
  - Routine → insert into `driver_routines` (deduped by time config) + project each day-of-week into `ride_schedules` for the next upcoming occurrence
  - "Anytime" stores `time_flexible=true` + a `12:00:00` placeholder for `trip_time` (NOT NULL constraint)
- All date-sensitive fields use the device's wall-clock; server side uses America/Los_Angeles per the `78d6a44` UTC fix

### `BoardEventBanner` + `BoardEventListener` (Slice G)
- `BoardEventListener` subscribes to `board:{userID.lowercased()}` realtime channel for three events:
  - `board_request` (incoming request to your post — full payload from realtime, abbreviated from FCM)
  - `board_accepted` (your offer/request was accepted)
  - `board_declined` (your offer/request was declined)
- FCM via `PushManager.onBoardEvent` — same payload routes through the listener
- Dedup by `(kind, rideID)` composite — same ride from realtime + FCM only enqueues once
- Auto-expire: 30s timer drops `board_request` items whose `trip_date + trip_time` has passed
- `BoardEventBanner` is a glass-floating top banner with three flavours:
  - `.boardRequest` — header "INCOMING RIDE BOARD REQUEST" + requester name + route + inline **Accept** / **Decline** buttons; tap body → `BoardRequestReviewPage` on Drive tab
  - `.boardAccepted` — green header "RIDE ACCEPTED" + "Tap to open chat" — auto-dismiss after 6s; tap → bell inbox
  - `.boardDeclined` — red header "REQUEST DECLINED" + "Tap to find another ride" — auto-dismiss after 6s; tap → bell inbox
- Banner sits in the `SignedInTabs` ZStack with z-index above the tabs but below the coming-soon toast
- Inline Accept/Decline fire `AcceptBoardRequestEndpoint` / `DeclineBoardRequestEndpoint` and refresh the bell store on success

### `NotificationsPage` (Slice D + a11y wiring)
- Bell-icon presented sheet across all tabs
- Per-row icon tile (SF Symbol with semantic tint by type)
- `board_request` rows have inline Accept / Decline as quick actions PLUS a "Tap row to review details →" hint — tap body opens `BoardRequestReviewPage`
- `board_accepted` rows tap → `MessagingPage`
- `board_declined` rows tap → board list (currently shows a coming-soon toast)
- `ride_request` rows older than 1h auto-hidden client-side
- Mark-all-read on appear; pull-to-refresh

---

## Server endpoints used (board)

| Method | Path | Used by | Notes |
|---|---|---|---|
| GET | `/api/schedule/board?mode&lat&lng&client_date&client_now` | `RideBoardPage` | Always sends `client_date` + `client_now` per UTC fix `78d6a44` |
| POST | `/api/schedule/request` | `RideBoardConfirmSheet` | Body includes `dropoff_at_driver_destination` per `0d2033c` |
| PATCH | `/api/schedule/accept-board` | `BoardRequestReviewPage`, foreground banner inline | |
| PATCH | `/api/schedule/decline-board` | `BoardRequestReviewPage`, foreground banner inline | |
| PATCH | `/api/schedule/withdraw-board` | Detail sheet Withdraw button | |
| DELETE | `/api/schedule/{id}` | Detail sheet Delete button | |
| PATCH | `/api/schedule/{id}/seats` | Detail sheet Edit Seats | |
| POST | `/api/schedule/notify` | `SchedulePostPage` | Fire-and-forget driver-matching after a new schedule lands |
| POST | `/api/transit/preview` | `RideBoardConfirmSheet` (rider flow) | Returns top-3 transit stations along driver route |
| PATCH | `/api/rides/:id/driver-destination` | `DropoffSelectionPage` | |
| POST | `/api/rides/:id/suggest-transit-dropoff` | `DropoffSelectionPage` | |
| POST | `/api/rides/:id/confirm-direct-dropoff` | `DropoffSelectionPage` (and "Take rider all the way") | |

Direct Supabase reads/writes:
- `ride_schedules` insert (one-time + routine projection)
- `driver_routines` insert (routine — one row per unique time config)
- `rides` row read (BoardRequestReviewPage)
- `users` profile read (other party in BoardRequestReviewPage)

---

## Realtime channels

| Channel | Subscriber | Events |
|---|---|---|
| `board-page:{userID}` | `RideBoardPage` while open | `ride_status_changed`, `ride_cancelled` → refetch board |
| `board:{userID}` | `BoardEventListener` (always-on while signed in) | `board_request`, `board_accepted`, `board_declined` → enqueue + show banner |

---

## Native iOS upgrades over the web

- `MKLocalSearchCompleter` autocomplete on every search (free, no API key, no quota)
- Native `DatePicker(.graphical)` / `DatePicker(.compact)` instead of HTML `<input type="date">`
- Native `Stepper` for seats
- `.regularMaterial` glass surfaces for cards / pills / banners (matches RiderHome / DriverHome aesthetic)
- "📍 Use my current location" one-tap pickup prefill
- `.dismissKeyboardOnTap()` on every page with a TextField (mandatory iOS rule)
- `.toolbar(.keyboard)` Done button on multi-line note fields
- Haptic feedback on every CTA + segmented-control switch + day-pill toggle
- Foreground board-event banner (request + accepted + declined toasts) — web has only persistent inbox rows
- Light + Dark mode parity: every color from `Tokens.color.*` adaptive tokens or system materials, no hardcoded fills

---

## Device verification checklist

Walk these on a paired iPhone after a fresh install. The app should be foregrounded for the realtime + banner tests.

### As a driver (test on the Drive tab)

1. **Browse**: open Drive tab → tap Ride Board card → board should load with "Riders" tab default
2. **Search**: type "Davis" or another partial address → list narrows
3. **Filters**: tap Filters → set Date to "Today" + Sort to "Closest to me" → Apply → list filters; badge shows "2"
4. **Detail sheet**: tap any rider card → detail sheet slides up with mini-map, route, fare, action buttons
5. **Post a ride**: tap the + FAB → `SchedulePostPage` opens in Driving mode → fill From/To, set date + time, set seats → Post Ride
6. **Receive a request**: have your test rider account post on your ride from another device → foreground banner should appear within ~1s with their name + route + Accept/Decline buttons
7. **Accept on banner**: tap Accept → banner clears, app pushes Drive tab → MessagingPage
8. **Or tap banner body**: lands on `BoardRequestReviewPage` with full rider context (pickup reverse-geocoded, distance pill, note)
9. **Suggest Drop-off**: tap the Suggest Drop-off button (only shown when rider didn't pick driver's destination) → DropoffSelectionPage opens
10. **Edit seats** on your own posted card: detail sheet → Edit Seats → adjust → Save → toast + card updates
11. **Delete own post**: detail sheet → Delete This Ride → confirmation alert → Delete → card disappears

### As a rider (test on the Home tab)

1. **Browse**: Home tab → tap "Browse ride board" pill → board loads with "Drivers" default
2. **Send a request**: tap a driver's card → Detail → Request This Ride → Confirm sheet opens
3. **Pickup**: tap "📍 Use my current location" → field shows literal "Current location" (no coords leaked)
4. **Destination**: leave radio on "Drop me at driver's destination" → Send Request
5. **Or custom destination**: tap the destination search field → type → tap a suggestion (anywhere on the row, including padding) → green checkmark appears
6. **Transit preview**: when custom destination is set and driver coords are present → list of nearby transit stations appears below the search → tap one to switch
7. **Note**: type a note → counter ticks down from 200 → tap Done in keyboard toolbar
8. **Send**: tap Send Request → confirm sheet closes, board card flips to "Request Sent" / "Ride Confirmed"
9. **Withdraw**: detail sheet on the requested card → Withdraw Request → toast + status clears
10. **Receive acceptance**: when the driver accepts → green "RIDE ACCEPTED" toast banner appears → auto-dismisses after 6s

### Light + Dark walk

1. Open Control Center → toggle Dark Mode → walk every screen above (board / detail / confirm / review / dropoff / schedule post / banner)
2. Every glass card / pill / search bar should read clearly in both modes
3. No white blobs in Light or invisible text in Dark
4. Brand colors (primary blue / success green / danger red) stay fixed across modes

### Known limitations (documented separately, not bugs)

- Multi-rider chat is per-rider only; a unified group-chat surface (Slice L3) is not shipped yet — driver opens individual chats from the multi-rider page
- Multi-summary step-through (Slice L4) is stubbed — when all sibling rides complete the driver lands back on the Drive home, and per-rider `RideSummaryPage` flows still fire from each ride's QR-end path

---

## Slice I — chat-agreement message on auto-confirmed dropoff (server)

When a rider taps **Send Request** with "Drop me at driver's destination" still selected, the server now also inserts a `messages` row of `type=location_accepted` with `meta = { direct_dropoff: true, pre_confirmed_at_request: true }` and broadcasts to `chat:{rideID}` + `chat-badge:{rideID}`. The iOS chat surface already renders this via `LocationAcceptedCard.swift` — no client change required.

**Verify on device:**
1. Rider account: open `RideBoardConfirmSheet` for a driver post, leave the dropoff radio on "Drop me at driver's destination", send.
2. Driver account: open the chat for that ride. The "Drop-off agreed" card should be the first message after the system opener — no need for the rider to send a separate proposal.

## Slice J — Routines management sheet (`RoutinesSheet`)

A bottom sheet wired to the calendar-clock button in the `RideBoardPage` header. Reads the user's active `driver_routines` directly from Supabase and supports edit-in-place + soft-delete (mirrors the web's `is_active=false`).

- List rows: route name + Sun-first day chips (S M T W T F S in order, only the saved days highlighted) + departure/arrival time + Edit / Delete.
- Edit panel (inline): route name `TextField`, Sun-first day pills, Departure / Arrival segmented control, native `DatePicker(.hourAndMinute)`. Save calls `update("driver_routines")` with the new fields and re-fetches the list.
- Delete: confirmation prompt → `update is_active=false` → server's existing trigger removes any orphaned `ride_schedules` rows for the same user/route.
- Open syncs once: fires `POST /api/schedule/sync-routines` so the routines re-project into the next 7 days of the board, matching what the web does on routines-sheet open.

**Verify on device:** open the Ride Board, tap the calendar-clock icon top-right of the header → sheet slides up. Tap Edit on a routine, change the time + days, Save — the row reflects the new values. Tap Delete on another routine, confirm — row disappears and the underlying schedule rows for that routine drop off the next-7-day board projection.

## Slice K — PaymentMethods + SaveCard wiring

Replaced the migration-051 stub banner CTA with a real route to `PaymentMethodsPage` so the user can save a card via Stripe `PaymentSheet` and come back to the form.

- `DriveRoute.addPaymentMethod` route added; `addPaymentMethodDestination` view wires `PaymentMethodsPage` with `onCardAdded → drivePath.popLast()` (700ms delay so the success toast renders).
- Both `RideBoardPage.onOpenNotifications` and `SchedulePostPage.onOpenNotifications` now `drivePath.append(.addPaymentMethod)` instead of opening the bell.
- Same wiring on the rider side via `RiderFlow`.

**Verify on device:**
1. Sign in to a fresh account with no card on file.
2. Driver mode: post any rider-mode ride from the Ride Board FAB → trigger fires "No saved payment method" inline error → tap **Open Payment Methods** → `PaymentMethodsPage` opens with **+ Add card** entry.
3. Tap **+ Add card** → Stripe PaymentSheet sheet → enter test card 4242 4242 4242 4242 + any future date + any CVC + ZIP → Pay/Save → success toast appears, page pops back to the form, retry the post → succeeds.

## Slice L1 — Multi-rider sibling detection + redirect

`DriverActiveRidePage` now reads the ride row's `schedule_id` and queries for sibling rides on the same schedule that this driver is also assigned to (statuses `requested | accepted | coordinating | active`). If at least one sibling exists, fires `onMultiRiderDetected(scheduleID)` → `MessagingPage` dismisses the active cover, and `SignedInTabs+DriveRoutes.messagingDestination` replaces the path with `.driverMultiRide(scheduleID:)`.

`DriverMultiRidePage` shows:
- Header bar with back chevron + "Your run" title + sibling count.
- One card per sibling rider (avatar / name / rating / status pill / destination preview / fare estimate / **Open Chat** button).
- Status pill colors: warning (waiting / requested / accepted / coordinating), success (active), primary (completed).
- Pull-to-refresh + 10s polling fallback + realtime listener on `driver-active:{userID.lowercased()}` for `rider_ride_ended` and `ride_started` events to flip pills live.
- When all siblings reach completed, fires `onAllCompleted` → drops back to Drive home (Slice L4 multi-summary stub).

**Verify on device** — needs two rider accounts (or two phones) and a driver post that both riders request on the same `ride_schedule`:
1. Driver: post a `ride_schedules` row.
2. Rider A + Rider B: both request that ride from the board (each becomes its own `rides` row sharing `schedule_id`).
3. Driver: accept both → both ride into MessagingPage chats → tap **Start Ride** for the first one (QR scan flow).
4. As the first ride flips to active, the driver's active-ride screen detects siblings and auto-routes to `DriverMultiRidePage` — both rider rows visible with status pills.
5. Tap **Open Chat** on Rider B's row → `MessagingPage` for that ride. Pop back → multi-rider page persists.
6. Riders end their rides via QR scan. Each pill flips to "Completed". When the last completes, the driver lands on Drive home.

---

## Pending — Slice L follow-ups (multi-rider polish)

| Sub-slice | Surface | Status |
|---|---|---|
| L3 | Unified group-chat surface (single chat with both riders) | Pending — current build opens per-rider chats |
| L4 | Multi-rider step-through summary (one summary per rider, swipe through) | Pending — current build pops to home and per-rider summaries fire on QR-end |

This document is updated per slice as each one ships.
