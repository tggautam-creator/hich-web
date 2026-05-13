# Web ↔ iOS Parity Report

**Date:** 2026-05-12
**Author:** Engineering audit, 6 parallel reviewers (rider flow, driver flow, ride board + scheduling, wallet/payments/profile, auth/onboarding/notifications, messaging/chat/live-activity/QR/emergency).
**Method:** Each reviewer read the iOS feature folder AND the corresponding web component(s) end-to-end (no skim). Findings cite exact file:line on both sides.

## How to read this

The report is organized by **severity**, not by feature area, because that's how a CTO triages it:

- **Tier 0 — Correctness bugs.** Functionality is broken on one platform OR diverges from a documented contract. These should be fixed before App Store v1 / public launch.
- **Tier 1 — High-impact UX gaps.** Substantial feature or flow missing on one side, not strictly broken but degrades the experience materially.
- **Tier 2 — Polish, copy, and edge cases.** Small ergonomic improvements, reliability hardening, copy alignment.
- **Tier 3 — Intentional divergences.** Native-only capabilities (Live Activity, Apple Pay, MKDirections in-app nav). Document and keep diverged.

Within each tier, items are grouped by **target platform to change** so it's trivial to convert into Jira tickets.

A separate **File index** at the end maps the bug back to the file path that owns the fix.

---

# TL;DR — Top 10 things to fix before public launch

| # | Severity | Platform | Title | Why |
|---|---|---|---|---|
| 1 | 🔴 Bug | Web | `MyRidesPage` hits `/cancel` for board requests; should call `/withdraw-board`. Board-request rows stay in `requested` forever from the rider's perspective. | Data integrity |
| 2 | 🔴 Bug | Web | Driver decline doesn't call `/cancel`. The ride_offer never releases; relies on hourly cron. Other drivers don't get re-fanned-out for ~1h. | Marketplace liquidity |
| 3 | 🔴 Bug | Web | `authStore.refreshProfile` sets `profile=null` on a transient fetch failure → `AuthGuard` bounces user to `/onboarding/profile`. Network blip = forced re-onboard. iOS keeps the last-known profile in Keychain. | Auth reliability |
| 4 | 🔴 Bug | Web | `RideRequestNotification` polling filters `unread_only=true`. Cold-launched driver never sees still-actionable rides_requests within the 150s window — iOS fixed this with `unreadOnly=false` + age window. | Match latency |
| 5 | 🔴 Bug | iOS | `ScheduleRequestEndpoint` omits `estimated_fare_cents`. Wallet-only riders bounce with `NO_PAYMENT_METHOD` even when balance ≥ fare. | Payment UX |
| 6 | 🔴 Bug | Web | `firebase-messaging-sw.js` hardcodes `projectId: 'hich-6f501'` (prod). Dev web builds still register against prod Firebase — cross-project token bug. iOS asserts this at boot with `preconditionFailure`. | Dev/prod isolation |
| 7 | 🔴 Bug | Web | Routine delete silently `UPDATE is_active=false` (soft pause). iOS hard-deletes with cascade. Same button, opposite semantics. | Data integrity |
| 8 | 🟠 UX gap | Web | No tip flow on RideSummary. Riders cannot tip drivers from the web. | Driver earnings |
| 9 | 🟠 UX gap | Web | No `DriverCancelledChoiceOverlay` with countdown + standby count + `find-new-driver` API call. Web modal auto-navigates back to `/waiting` without calling the server endpoint. | Recovery from driver bail |
| 10 | 🟠 UX gap | iOS | No `RiderPickupPage` screen at all. The entire walk-to-pickup phase (walk polyline, walk ETA, "I'm here" signal, JourneyDrawer pulse) is collapsed into MessagingPage. | Pickup coordination |

The rest of the report drills into each area.

---

# Tier 0 — Correctness bugs

## Web bugs

### W-T0-1: `MyRidesPage` cancel endpoint mismatch for board requests
- **File:** [src/components/ride/MyRidesPage.tsx:114](src/components/ride/MyRidesPage.tsx)
- **Issue:** Calls `/api/rides/:id/cancel` regardless of whether the row is an instant ride or a board request. Board requests need `PATCH /api/schedule/withdraw-board`.
- **iOS reference:** [ios/Tago/Features/RiderHome/ActiveRideSheet.swift:384-407](ios/Tago/Features/RiderHome/ActiveRideSheet.swift)
- **Fix:** Branch on `isPendingBoardRequest` (status === 'requested' && schedule_id != null). Use the same logic iOS uses in `ActiveRideSheet.cancel(_:)`.
- **Risk to user flow:** None. Adds correct cleanup; users were already trying to cancel — they'll succeed now.

### W-T0-2: Driver decline doesn't release the ride_offer
- **File:** [src/components/ride/RideSuggestion.tsx:300-302](src/components/ride/RideSuggestion.tsx) (decline button), [src/components/ride/RideRequestNotification.tsx:100-107](src/components/ride/RideRequestNotification.tsx) (banner dismiss).
- **Issue:** Both web decline paths just `navigate('/home/driver')` / drop from queue. They don't call `PATCH /api/rides/:id/cancel` so the ride_offer row stays in `pending` indefinitely. The server's hourly cleanup cron eventually releases it but the rider doesn't get re-fanned-out for up to an hour.
- **iOS reference:** Both auto-decline (150s) and explicit decline call `CancelRideEndpoint` (see [ios/Tago/Features/DriverHome/RideSuggestionPage.swift:1090-1165](ios/Tago/Features/DriverHome/RideSuggestionPage.swift)).
- **Fix:** Wire decline to `PATCH /api/rides/:id/cancel` (with optional `reason` body). Same endpoint the cancel button uses.
- **Risk:** None. Drivers who decline want the offer to clear — this just makes it happen immediately.

### W-T0-3: Web auth recovery drops profile on transient fetch error
- **File:** [src/stores/authStore.ts:293-297](src/stores/authStore.ts)
- **Issue:** `refreshProfile` does `set({ profile: null })` on Supabase error. `AuthGuard.tsx:60-113` then routes to `/onboarding/profile`, sending an already-onboarded user back through CreateProfile on a 1-second network blip.
- **iOS reference:** [ios/Tago/Core/Auth/AuthStore.swift:481-502](ios/Tago/Core/Auth/AuthStore.swift) keeps the last-known profile from Keychain on fetch failure (bug-fix landed 2026-04-30).
- **Fix:** In `refreshProfile`, if the fetch fails AND `get().profile != null`, keep the existing profile. Only null it if the user truly has no row (Supabase returns success with null).
- **Risk:** None. Worst case: a user with a stale profile sees outdated data until next successful refresh — acceptable.

### W-T0-4: Cold-launch driver misses still-actionable ride_requests
- **File:** [src/components/ride/RideRequestNotification.tsx:526-583](src/components/ride/RideRequestNotification.tsx)
- **Issue:** Polling filter `unread_only=true` means a driver who killed the tab and re-opens within the 150s offer window doesn't see the still-pending request — it was marked-read by a prior tick. iOS solved this with `bootstrapResume` reading `unreadOnly: false` + a created-within-150s age filter.
- **iOS reference:** [ios/Tago/Features/DriverHome/RideRequestListener.swift:104-136](ios/Tago/Features/DriverHome/RideRequestListener.swift)
- **Fix:** On mount, do a one-shot `unread_only=false` fetch limited to last 5 notifications, filter to `type='ride_request' && Date.now() - created_at < 150_000`, ingest into the queue. Then continue with `unread_only=true` for regular polling.
- **Risk:** Low. Driver might briefly see an already-actioned offer — the offer-already-released check on the suggestion page handles this gracefully.

### W-T0-5: Web SW hardcodes prod Firebase projectId — cross-project token leakage
- **File:** [public/firebase-messaging-sw.js:8-14](public/firebase-messaging-sw.js)
- **Issue:** `projectId: 'hich-6f501'` is the prod project. Dev web (running on localhost or staging) registers FCM tokens against PROD Firebase, then the prod server tries to push to them via the wrong project → silently dropped. iOS handles this with `AppDelegate.configureFirebaseForBuildFlavor()` which `preconditionFailure`s on mismatch.
- **iOS reference:** [ios/Tago/App/AppDelegate.swift:51-83](ios/Tago/App/AppDelegate.swift)
- **Fix options:** Two viable paths:
  - **Build-time SW variant:** Use Vite's `import.meta.env.MODE` to emit two SW files (`firebase-messaging-sw.dev.js`, `firebase-messaging-sw.prod.js`) and register the right one based on env.
  - **Single SW reading from window**: SW initializes only after the main app calls `serviceWorker.register('/firebase-messaging-sw.js?env=' + import.meta.env.MODE)` and reads the query string — but this is hacky.
- **Risk:** Medium. Test on dev that tokens are now registering against `tago-dev-e3ade`.

### W-T0-6: Routine delete is a soft pause, not a hard delete (semantic mismatch with iOS)
- **File:** [src/components/schedule/RideBoard.tsx:406-411](src/components/schedule/RideBoard.tsx)
- **Issue:** Web's "Delete" button calls `UPDATE ride_schedules SET is_active=false`. iOS's "Delete" calls real `DELETE` which cascades to projected ride rows (per migration 058). Same button, opposite semantics — the data state differs across platforms after a "delete."
- **iOS reference:** [ios/Tago/Features/Schedule/RoutinesViewModel.swift:112-125](ios/Tago/Features/Schedule/RoutinesViewModel.swift)
- **Fix:** Pick one. Recommendation: align both on hard-delete since the migration trigger cascades cleanly. Update web copy to match iOS's "permanently removes the routine and the next 7 days of projected board posts. Pending rider requests on those days will be cancelled. Use Pause if you only want to stop projecting it for a while."
- **Risk:** Medium. Drivers who "deleted" routines on web have soft-paused them in the DB; auditing those rows is recommended before flipping the implementation.

### W-T0-7: Direct-dropoff fare estimate uses outdated formula
- **File:** [src/components/ride/DropoffSelection.tsx:276-287](src/components/ride/DropoffSelection.tsx)
- **Issue:** Hand-rolled `base + gasCents + timeCents` with `min(4000, max(500, ...))` upper cap. The fare formula was updated 2026-05-01 in `CLAUDE.md` to drop the base fare and remove the $40 cap. Web's estimate is stale and may show drivers a wrong number.
- **iOS reference:** [ios/Tago/Features/DriverHome/DropoffSelectionPage+Actions.swift:45-56](ios/Tago/Features/DriverHome/DropoffSelectionPage+Actions.swift) uses canonical `Fare.calculate`.
- **Fix:** Import the canonical fare formula from `src/lib/fare.ts` and use it everywhere; remove the inline arithmetic.
- **Risk:** Low. Estimate becomes slightly different (probably lower without the base fare). User-facing copy stays as "estimate" so no contractual exposure.

### W-T0-8: Phone re-verify is commented out
- **File:** [src/components/ride/ProfilePage.tsx:307-336](src/components/ride/ProfilePage.tsx)
- **Issue:** Saving a changed phone number skips re-verification (the OTP branch is `TODO: Re-enable when Twilio toll-free verification is approved`). User can change their phone to any unverified number and continue using the app.
- **iOS reference:** [ios/Tago/Features/Profile/EditProfileSheet.swift:151-175](ios/Tago/Features/Profile/EditProfileSheet.swift) immediately presents `PhoneVerificationPage` on phone-change.
- **Fix:** Re-enable the branch and route to the existing `PhoneVerificationPage.tsx`. Block save until verified, or persist with `phone_verified=false` and surface an unverified-state banner.
- **Risk:** Low. Once Twilio is approved (or skip-phone is still on), the flow already exists.

### W-T0-9: Email-confirmation link expiry not surfaced
- **File:** [src/components/auth/AuthCallback.tsx](src/components/auth/AuthCallback.tsx)
- **Issue:** Expired/invalid confirmation links land on `AuthCallback` and sit on a spinner indefinitely — `session(from: url)` returns failure but the UI doesn't show a retry path.
- **iOS reference:** [ios/Tago/Features/Auth/AuthCallbackPage.swift:73-90](ios/Tago/Features/Auth/AuthCallbackPage.swift) shows a `DeepLinkErrorCover` with Close.
- **Fix:** Catch the failure in `AuthCallback` and render an error state with "This link expired. Sign in again to receive a new one."
- **Risk:** None. Pure additive.

### W-T0-10: Foreground push for `payment_*` / `schedule_match` types is silent
- **File:** [src/lib/fcm.ts](src/lib/fcm.ts) (foreground dispatch is generic, no per-type toast)
- **Issue:** When a tab is focused, the browser doesn't show the system notification — the app has to render its own toast. `RideRequestNotification.tsx` handles `ride_request` foreground delivery but `payment_received` / `payment_failed` / `schedule_match` types fall through silently.
- **iOS reference:** [ios/Tago/Features/Payment/PaymentEventStore.swift](ios/Tago/Features/Payment/PaymentEventStore.swift), [ios/Tago/Features/Schedule/ScheduleMatchEventStore.swift](ios/Tago/Features/Schedule/ScheduleMatchEventStore.swift) show typed banners.
- **Fix:** Add a typed dispatcher in `fcm.ts onForegroundMessage` that fires a toast for each type.
- **Risk:** Low. Additive UI.

### W-T0-11: Stale `ride_request` filter window is 1 hour (should be 5 minutes)
- **File:** [src/components/ride/NotificationsPage.tsx:240-244](src/components/ride/NotificationsPage.tsx)
- **Issue:** Server-side ride_offer expires at 150s. Web shows ride_request notifications up to 1h old — user can tap into a long-dead offer.
- **iOS reference:** [ios/Tago/Features/Notifications/NotificationsPage.swift:186](ios/Tago/Features/Notifications/NotificationsPage.swift) uses 5 minutes (tightened 2026-05-01).
- **Fix:** Change the filter to 5 minutes (300_000 ms).
- **Risk:** None. Drivers wanted dead offers cleared anyway.

### W-T0-12: Stripe Connect — no `needsReverification` branch
- **File:** [src/components/driver/DriverPayoutsPage.tsx:148](src/components/driver/DriverPayoutsPage.tsx)
- **Issue:** When Stripe re-flags an account, iOS shows an orange banner with "Open the dashboard to continue." Web shows nothing — driver in re-verification limbo gets no signal.
- **iOS reference:** [ios/Tago/Features/Payment/PayoutsPage.swift:380-404](ios/Tago/Features/Payment/PayoutsPage.swift)
- **Fix:** Read `needsReverification` from the same `/api/connect/status` response and render a warning banner above the payout method.
- **Risk:** None. Pure additive.

## iOS bugs

### I-T0-1: `ScheduleRequestEndpoint` omits `estimated_fare_cents`
- **File:** [ios/Tago/Core/Networking/Endpoints/ScheduleRequestEndpoint.swift:38-69](ios/Tago/Core/Networking/Endpoints/ScheduleRequestEndpoint.swift)
- **Issue:** Wallet-only riders need to send `estimated_fare_cents` so the server can verify wallet covers the fare and skip the `NO_PAYMENT_METHOD` gate. iOS sends the request without it; server rejects.
- **Web reference:** [src/components/schedule/RideBoard.tsx:209-220](src/components/schedule/RideBoard.tsx) computes `estimateScheduleFare(confirmRide).high_cents` and includes it.
- **Fix:** Thread the value through `RequestEnrichment` → endpoint body. Use `RideBoardHelpers.estimateScheduleFare(ride)?.highCents`.
- **Risk:** Low — matches existing web contract.

### I-T0-2: No `is_driver` gate on driver-offers-on-rider-post
- **File:** [ios/Tago/Features/RideBoard/RideBoardConfirmViewModel.swift:116](ios/Tago/Features/RideBoard/RideBoardConfirmViewModel.swift)
- **Issue:** Non-driver users can tap a rider's post and trigger the offer-to-drive flow. Server rejects with a generic error; UX is bad.
- **Web reference:** [src/components/schedule/RideBoard.tsx:177-181](src/components/schedule/RideBoard.tsx) redirects non-drivers to `/become-driver`.
- **Fix:** Gate the confirm sheet on `auth.profile?.isDriver == true` for rider-post tabs. Show "Become a driver" CTA otherwise.
- **Risk:** None. Closes a confusing dead-end.

### I-T0-3: No driver-side `/gps-ping` loop during active ride
- **File:** [ios/Tago/Features/DriverHome/DriverActiveRidePage.swift](ios/Tago/Features/DriverHome/DriverActiveRidePage.swift)
- **Issue:** Server uses driver GPS pings to compute the fare-determining distance more accurately than haversine. Web does this; iOS doesn't. Fares may be slightly off on iOS-driven rides.
- **Web reference:** [src/components/ride/DriverActiveRidePage.tsx:129-155](src/components/ride/DriverActiveRidePage.tsx)
- **Fix:** Add a 10s `PollingTimer` while in `.active` phase that POSTs `/api/rides/:id/gps-ping {lat, lng}`.
- **Risk:** Low. Server endpoint already exists.

### I-T0-4: Cancel modal hard-codes "rider" in copy
- **File:** [ios/Tago/Features/Messaging/MessagingPage.swift:636-647](ios/Tago/Features/Messaging/MessagingPage.swift)
- **Issue:** Confirmation copy says "This cancels the ride and notifies the rider." On rider-initiated cancels, it should say "notifies the driver."
- **Web reference:** [src/components/ride/MessagingWindow.tsx:2147-2174](src/components/ride/MessagingWindow.tsx) branches by role.
- **Fix:** Branch on `effectiveViewerRole` to swap "rider" / "driver" in the copy.
- **Risk:** None. Trivial one-liner.

### I-T0-5: No `chat-badge:{rideID}` subscription on active-ride drawer
- **File:** [ios/Tago/Features/RiderHome/RiderActiveRideDrawer.swift](ios/Tago/Features/RiderHome/RiderActiveRideDrawer.swift) and [ios/Tago/Features/DriverHome/DriverPickupPage.swift](ios/Tago/Features/DriverHome/DriverPickupPage.swift)
- **Issue:** Active-ride drawer has a Chat button but no unread badge. Web subscribes to a dedicated `chat-badge:{rideId}` channel for this purpose.
- **Web reference:** [src/components/ride/RiderActiveRidePage.tsx:285-292](src/components/ride/RiderActiveRidePage.tsx)
- **Fix:** Subscribe to `chat-badge:{rideID}` in `*Drawer.swift`, increment unread counter on new_message broadcast, clear on chat-open.
- **Risk:** Low.

### I-T0-6: Missing vehicle color/year/make/model/plate in chat header
- **File:** [ios/Tago/Features/Messaging/MessagingSubviews.swift](ios/Tago/Features/Messaging/MessagingSubviews.swift) (or `MessagingHeader`)
- **Issue:** Rider needs car details to identify the right vehicle at pickup. Web shows them inline; iOS shows only driver name + rating.
- **Web reference:** [src/components/ride/MessagingWindow.tsx:1558-1572](src/components/ride/MessagingWindow.tsx)
- **Fix:** Fetch `vehicles` row in `MessagesViewModel` and render a thin banner under the partner header for rider role.
- **Risk:** Low.

### I-T0-7: `/api/rides/find-new-driver` flow has a residual rider WaitingRoom stale-state tail
- **File:** Documented in memory `project_find_new_driver_known_issue.md`
- **Issue:** After driver-cancel + rider tap "Find another driver", the rider's WaitingRoom occasionally still shows the cancelled driver as "DRIVER ACCEPTED." Deferred to v2 bug-fix release.
- **Already partial fixes shipped** (server: requester_destination, OFFER_RELEASED guard, find-new-driver rewrite; iOS: envelope unwrap, defensive offer-clear). Residual cause unresolved.
- **Fix:** See memory file for detailed debugging trail.

---

# Tier 1 — High-impact UX gaps

## Rider experience

### W-T1-R1: No tip flow on Web RideSummary
- **File:** [src/components/ride/RideSummaryPage.tsx](src/components/ride/RideSummaryPage.tsx)
- **iOS reference:** [ios/Tago/Features/RiderHome/RideSummaryPage.swift:507-846](ios/Tago/Features/RiderHome/RideSummaryPage.swift)
- **What's missing:** Fare-scaled percentage chips (15/20/25%), custom-tip field with live-formatted total, tip-payment row ("Tip charged to Visa •••• 4242 / Add card"). iOS calls `TipRideEndpoint`; web's `RateRidePage` has a flat-dollar tip but only after rating submission.
- **Fix:** Either inline tip on `RideSummaryPage.tsx` (matches iOS), or surface the existing `RateRidePage` tip picker upfront with percentage chips.
- **Risk:** Medium. Touches the payment path and `chargeTip` server contract — but the endpoint already exists.

### W-T1-R2: Inline rate-on-summary (no separate page)
- **File:** [src/components/ride/RideSummaryPage.tsx:526-533](src/components/ride/RideSummaryPage.tsx)
- **iOS reference:** [ios/Tago/Features/RiderHome/RideSummaryPage.swift:484-527](ios/Tago/Features/RiderHome/RideSummaryPage.swift)
- **What's missing:** Web pushes to `/ride/rate/:id` (`RateRidePage.tsx`); iOS does stars + tags + comment + tip all inline.
- **Fix:** Inline the RateRidePage UX directly on RideSummary. Web's two-step is an extra navigation.
- **Risk:** Low — pure consolidation.

### W-T1-R3: `DriverCancelledChoiceOverlay` is missing on web (chat-side)
- **File:** [src/components/ride/MessagingWindow.tsx:2176-2229](src/components/ride/MessagingWindow.tsx)
- **iOS reference:** [ios/Tago/Features/RiderHome/DriverCancelledChoiceOverlay.swift](ios/Tago/Features/RiderHome/DriverCancelledChoiceOverlay.swift)
- **What's missing:** iOS has a full-screen overlay with warning haptic, dynamic subtitle (`N other drivers are ready`), a 2-minute idle countdown that auto-fires Cancel, and the Find-Another-Driver button calls `POST /api/rides/:id/find-new-driver` (not just nav back).
- **Fix:** Replace the bare modal with the same structure. Server endpoint exists.
- **Risk:** Medium. Need to verify `find-new-driver` flow works on web (rider-side WaitingRoom should accept incoming offers post-find).

### W-T1-R4: No "Find Another Driver" auto-dismiss + standby count on RiderPickup
- **File:** [src/components/ride/RiderPickupPage.tsx:196-200](src/components/ride/RiderPickupPage.tsx)
- **Issue:** Web auto-redirects to `/rides` after 3s with a banner ("Auto-dismissed banner" — anti-pattern per CLAUDE.md). User has no agency.
- **iOS reference:** Same `DriverCancelledChoiceOverlay` is reused across surfaces.
- **Fix:** Replace auto-dismiss with the choice overlay.
- **Risk:** Low.

### I-T1-R1: No `RiderPickupPage` screen on iOS (entire walk-to-pickup phase missing)
- **Files needed:** A new `ios/Tago/Features/RiderHome/RiderPickupPage.swift` + `+Live.swift`
- **Web reference:** [src/components/ride/RiderPickupPage.tsx](src/components/ride/RiderPickupPage.tsx) — full screen with walk polyline, walk-ETA pill ("X min · Y ft"), nearby-alert pulse, signal-driver button, start-ride QR modal, `JourneyDrawer`.
- **What's missing on iOS:** Everything above. The walk phase is collapsed into `MessagingPage` flow, which provides no walk polyline, no walk timer, no "I'm at the pickup" button, no nearby pulse, no QR start-ride modal at the walk surface.
- **Fix:** Build the screen as a new SwiftUI page following the web's design: walk polyline via `MKDirections(transportType: .walking)`, nearby-threshold (100m) pulse animation, signal-driver POST `/api/rides/:id/signal`, QR scan modal.
- **Risk:** **High** — this is the biggest single missing rider-side screen on iOS. Affects pickup coordination quality.

### I-T1-R2: No `progress_pct` persistence to ride row on iOS active-ride
- **File:** [ios/Tago/Features/RiderHome/RiderActiveRidePage.swift](ios/Tago/Features/RiderHome/RiderActiveRidePage.swift)
- **Web reference:** [src/components/ride/RiderActiveRidePage.tsx:381-390](src/components/ride/RiderActiveRidePage.tsx) writes back every 5% throttled.
- **Fix:** UPDATE `rides.progress_pct` at 5% intervals so other consumer surfaces (driver-side, multi-summary) see the rider's progress.
- **Risk:** Low.

### I-T1-R3: No live `rider_location` broadcast to driver channel during pickup
- **File:** [ios/Tago/Features/RiderHome/RiderActiveRidePage+Live.swift:282-296](ios/Tago/Features/RiderHome/RiderActiveRidePage+Live.swift)
- **Web reference:** [src/components/ride/RiderPickupPage.tsx:249-273](src/components/ride/RiderPickupPage.tsx) broadcasts every 15s on `ride-location:{rideId}`.
- **Fix:** `channel.send({event: 'rider_location', payload})` on a 10-15s cadence during coordinating/active.
- **Risk:** Medium. Driver-side live "rider approaching" indicator may be missing data on iOS-driven pairs.

## Driver experience

### W-T1-D1: Decline reason sheet + snooze (15min / 1h / 2h / 4h / 8h / Until tomorrow) is missing on web
- **Files:** [src/components/ride/RideRequestNotification.tsx:1142-1149](src/components/ride/RideRequestNotification.tsx) (banner Decline), [src/components/ride/RideSuggestion.tsx:297-302](src/components/ride/RideSuggestion.tsx) (suggestion Decline)
- **iOS reference:** [ios/Tago/Features/DriverHome/DeclineReasonSheet.swift](ios/Tago/Features/DriverHome/DeclineReasonSheet.swift)
- **What's missing:** A modal with reason pills (Too far / Wrong direction / Busy / Taking a break / Other) + snooze duration picker (4 pills). Submit calls `POST /api/rides/snooze` independently of `PATCH /cancel`.
- **Fix:** Build a sheet modal component; reuse for both decline entry points. Server already accepts the contract.
- **Risk:** Medium. Banner is in a portal — modal must z-index above.

### W-T1-D2: Snooze state on Driver Home (top pill + bottom toggle + live countdown)
- **Files:** [src/components/ride/DriverHomePage.tsx:288-305](src/components/ride/DriverHomePage.tsx) (top status pill), [src/components/ride/DriverHomePage.tsx:414-446](src/components/ride/DriverHomePage.tsx) (online toggle)
- **iOS reference:** [ios/Tago/Features/DriverHome/DriverTopBar.swift:99-141](ios/Tago/Features/DriverHome/DriverTopBar.swift)
- **What's missing:** Orange "Snoozed · Xm left" pill, RESUME affordance replacing the online toggle, live countdown.
- **Fix:** Read `snoozed_until` alongside `is_online` on mount, render third pill state, drive countdown with `setInterval`.
- **Risk:** Low.

### W-T1-D3: Two-step accept flow (quick-accept → destination)
- **File:** [src/components/ride/RideSuggestion.tsx:323-397](src/components/ride/RideSuggestion.tsx)
- **iOS reference:** [ios/Tago/Features/DriverHome/RideSuggestionPage.swift:1020-1064](ios/Tago/Features/DriverHome/RideSuggestionPage.swift) + [DriverDestinationEntryPage.swift](ios/Tago/Features/DriverHome/DriverDestinationEntryPage.swift)
- **What's missing:** Web blocks Accept until destination is typed; iOS accepts first (empty body), then asks for destination on a second screen. Cuts match latency drastically.
- **Fix:** Split Accept into two stages. The server supports empty-destination accept.
- **Risk:** Medium. Disable the back-button on stage 2 to prevent half-accepted state; iOS solves this with a hard cancel pill.

### W-T1-D4: No `driver_selected` realtime listener (rider auto-selected this driver)
- **File:** [src/components/ride/RideRequestNotification.tsx:421-431](src/components/ride/RideRequestNotification.tsx) HAS it. iOS does NOT.
- **iOS file needing change:** [ios/Tago/Features/DriverHome/RideRequestListener.swift:212-264](ios/Tago/Features/DriverHome/RideRequestListener.swift)
- **What's missing:** Subscription to `driver_selected` on the `driver:{userID}` channel. Today a standby driver who closes the suggestion page never gets re-routed back when they win.
- **Fix:** Add the listener; on receipt, re-present the suggestion cover or auto-route to `/ride/dropoff/:id`.
- **Risk:** Low.

### I-T1-D1: No driver-side pickup-pin dropper / "Set Pickup Point" flow
- **File:** [ios/Tago/Features/DriverHome/DriverPickupPage.swift](ios/Tago/Features/DriverHome/DriverPickupPage.swift)
- **Web reference:** [src/components/ride/DriverPickupPage.tsx:674-845](src/components/ride/DriverPickupPage.tsx)
- **What's missing:** Web lets the DRIVER propose a pickup adjustment via pin-drop (420m max walk constraint, rider walking-ETA). iOS only lets the rider propose; driver only accepts/rejects via chat.
- **Fix:** Add a pin-drop affordance to `DriverJourneyDrawer` for the driver path. Or document the divergence as intentional.
- **Risk:** Medium.

### I-T1-D2: Stack-aware queue badge on suggestion page header (1 of N)
- **File:** [ios/Tago/Features/DriverHome/RideSuggestionPage.swift:438-449](ios/Tago/Features/DriverHome/RideSuggestionPage.swift) — already has it. Web does NOT.
- **Web file needing change:** [src/components/ride/RideSuggestion.tsx](src/components/ride/RideSuggestion.tsx)
- **Fix:** Pass queue count via nav state and render header badge when count > 1.
- **Risk:** Low.

### I-T1-D3: Pending-earnings pill on driver home
- **File:** [ios/Tago/Features/DriverHome/DriverHomePage.swift:333-350](ios/Tago/Features/DriverHome/DriverHomePage.swift) — does NOT render the pill. Web does.
- **Web reference:** [src/components/ride/DriverHomePage.tsx:447-477](src/components/ride/DriverHomePage.tsx) shows yellow pill "$X.XX pending · N rides awaiting rider payment."
- **Fix:** iOS already has `WalletPendingEarningsEndpoint` and `PendingEarningsPage.swift`. Surface the pill on the home screen too.
- **Risk:** Low.

### I-T1-D4: Mid-ride new-message slide-in banner
- **Files:** [ios/Tago/Features/DriverHome/DriverPickupPage.swift:947-1023](ios/Tago/Features/DriverHome/DriverPickupPage.swift) has it. **Web does NOT** (only bumps `unreadChat`).
- **Web files needing change:** [src/components/ride/DriverPickupPage.tsx](src/components/ride/DriverPickupPage.tsx) + [src/components/ride/DriverActiveRidePage.tsx](src/components/ride/DriverActiveRidePage.tsx)
- **Fix:** Slide-in toast with sender + preview, tap to open chat, auto-dismiss 5s.
- **Risk:** Low.

## Ride Board / Scheduling

### W-T1-B1: No tip flow + no edit existing one-time schedule
- **File:** [src/components/schedule/SchedulePage.tsx](src/components/schedule/SchedulePage.tsx)
- **iOS reference:** [ios/Tago/Features/Schedule/SchedulePostViewModel+Submit.swift:71-82](ios/Tago/Features/Schedule/SchedulePostViewModel+Submit.swift) (`updateExistingSchedule`).
- **What's missing:** Web only inserts; can't UPDATE an existing `ride_schedules` row. Drivers/riders who want to fix a typo must delete + re-post (losing any requests on the original row).
- **Fix:** Add a `prefillScheduleId` mode that loads an existing row, locks mode + tripType, and submits via UPDATE.
- **Risk:** Medium.

### W-T1-B2: Pause / Resume routine missing on Routines sheet
- **File:** [src/components/schedule/RideBoard.tsx:933-1083](src/components/schedule/RideBoard.tsx)
- **iOS reference:** [ios/Tago/Features/Schedule/RoutinesSheet.swift:230-285](ios/Tago/Features/Schedule/RoutinesSheet.swift)
- **What's missing:** Only Edit + Delete. iOS has Pause/Resume + Active/Paused badge.
- **Fix:** Add Pause/Resume toggle that flips `is_active`. Server filters paused routines correctly.
- **Risk:** Low.

### W-T1-B3: City preset chip strip (Davis / Sacramento / SF / San Jose / Berkeley / Woodland / Elk Grove / Stockton)
- **Files:** [src/components/schedule/RideBoard.tsx](src/components/schedule/RideBoard.tsx) (header), [src/components/schedule/RideBoardFilterSheet.tsx](src/components/schedule/RideBoardFilterSheet.tsx), [src/components/schedule/boardFilters.ts](src/components/schedule/boardFilters.ts) (add `cityID`)
- **iOS reference:** [ios/Tago/Features/RideBoard/RideBoardCityChipStrip.swift](ios/Tago/Features/RideBoard/RideBoardCityChipStrip.swift) + `RideBoardCityPresets.swift`
- **What's missing:** A horizontally scrollable chip strip + smart resolver that auto-applies city when search query matches a preset name.
- **Fix:** Port `CityPreset.all` to TS, add `cityID` to `RideBoardFilters`, render chip strip.
- **Risk:** Low — pure client filter.

### W-T1-B4: Default sort = soonest trip (iOS) vs recently posted (web)
- **File:** [src/components/schedule/boardFilters.ts:19](src/components/schedule/boardFilters.ts)
- **iOS reference:** [ios/Tago/Features/RideBoard/RideBoardFilters.swift:38-44](ios/Tago/Features/RideBoard/RideBoardFilters.swift)
- **Fix:** Default to soonest trip; recency becomes a secondary tiebreaker.
- **Risk:** None.

### W-T1-B5: Decline reason picker on board request review
- **File:** [src/components/ride/BoardRequestReview.tsx:135-154](src/components/ride/BoardRequestReview.tsx) fires `decline-board` with no reason.
- **iOS reference:** [ios/Tago/Features/BoardReview/BoardDeclineReasonSheet.swift](ios/Tago/Features/BoardReview/BoardDeclineReasonSheet.swift)
- **Fix:** Add a modal with 7 reason pills + "Just decline" with confirmation. Server already accepts `reason`.
- **Risk:** Low.

### W-T1-B6: Status-aware "already actioned" bar on board request review
- **File:** [src/components/ride/BoardRequestReview.tsx](src/components/ride/BoardRequestReview.tsx)
- **iOS reference:** [ios/Tago/Features/BoardReview/BoardRequestReviewPage+Actions.swift:104-167](ios/Tago/Features/BoardReview/BoardRequestReviewPage+Actions.swift)
- **What's missing:** Realtime listener that reloads when the ride row is mutated, swaps action bar to "Already accepted — coordinate in chat" / "Rider withdrew this request" / "Ride completed" etc.
- **Fix:** Subscribe to `board:{userID}` on the review page + add status-aware UI.
- **Risk:** Low.

### W-T1-B7: Asymmetric "Offer Sent" vs "Request Sent" badges
- **Files:** [src/components/schedule/RideBoardCard.tsx:141-157](src/components/schedule/RideBoardCard.tsx), [src/components/schedule/RideBoard.tsx:843-860](src/components/schedule/RideBoard.tsx)
- **Issue:** Always says "Request Sent" regardless of viewer side.
- **iOS reference:** [ios/Tago/Features/RideBoard/RideBoardCard.swift:384-401](ios/Tago/Features/RideBoard/RideBoardCard.swift) flips based on post type.
- **Fix:** Branch on `isDriverPost`.
- **Risk:** Trivial.

### W-T1-B8: Filter sheet "Near me only" copy is wrong
- **File:** [src/components/schedule/RideBoardFilterSheet.tsx:125-128](src/components/schedule/RideBoardFilterSheet.tsx) — `"within ~5-min walk of route"`
- **Issue:** Actual radius is 30 km, not a 5-minute walk. Copy is misleading.
- **iOS reference:** [ios/Tago/Features/RideBoard/RideBoardFilterSheet.swift:188](ios/Tago/Features/RideBoard/RideBoardFilterSheet.swift) — `"Within ~30 km of your location"`
- **Fix:** Port iOS copy.
- **Risk:** Trivial.

## Wallet / Payments / Profile

### W-T1-P1: No Apple Pay / Payment Request Button for top-up
- **File:** [src/components/ride/AddFundsPage.tsx:267-301](src/components/ride/AddFundsPage.tsx)
- **iOS reference:** [ios/Tago/Features/Payment/AddFundsSheet.swift:329-340](ios/Tago/Features/Payment/AddFundsSheet.swift) + `ApplePayCoordinator.swift`
- **What's missing:** iOS has Apple Pay as primary CTA. Web could use Stripe's Payment Request Button (Apple Pay on Safari iOS, Google Pay on Chrome Android).
- **Fix:** Add `paymentRequest.canMakePayment()` detection + render `PaymentRequestButton` above the CardElement.
- **Risk:** Medium. Apple Pay on web requires `.well-known/apple-developer-merchantid-domain-association` file.

### W-T1-P2: No saved-card top-up path
- **File:** [src/components/ride/AddFundsPage.tsx](src/components/ride/AddFundsPage.tsx)
- **iOS reference:** [ios/Tago/Features/Payment/AddFundsSheet.swift:373-419](ios/Tago/Features/Payment/AddFundsSheet.swift)
- **What's missing:** Forces user to retype card every time. iOS has a "Use saved card · Visa •••• 4242" button.
- **Fix:** Load rider's default `PaymentCard` on mount, render saved-card button above CardElement, charge via `confirmCardPayment(clientSecret, { payment_method: pmId })`.
- **Risk:** Low.

### W-T1-P3: Withdraw is full-balance only (no amount picker)
- **File:** [src/components/ride/WithdrawSheet.tsx:43](src/components/ride/WithdrawSheet.tsx)
- **iOS reference:** [ios/Tago/Features/Payment/WithdrawSheet.swift:148-175](ios/Tago/Features/Payment/WithdrawSheet.swift)
- **What's missing:** Editable amount + Half/All quick pills + $1 min. Server supports partial withdraws.
- **Fix:** Add the input + chips.
- **Risk:** Low.

### W-T1-P4: Withdraw confirmation alert
- **File:** [src/components/ride/WithdrawSheet.tsx:106-113](src/components/ride/WithdrawSheet.tsx)
- **Issue:** Single button click initiates irreversible Stripe transfer. iOS has a confirm step.
- **Fix:** Add confirmation modal with "Withdraw $X? Funds go to <bank>. This action is irreversible from Tago."
- **Risk:** None. Pure safety gate.

### W-T1-P5: Live nudge cooldown countdown
- **File:** [src/components/ride/WalletPage.tsx:325-368](src/components/ride/WalletPage.tsx)
- **iOS reference:** [ios/Tago/Features/Payment/PendingEarningsPage.swift:172-244](ios/Tago/Features/Payment/PendingEarningsPage.swift)
- **What's missing:** Server returns 429 with `retry_after_seconds` on nudge. Web just disables button. iOS drives a per-second clock so a returning driver sees the actual remaining cooldown.
- **Fix:** Honor the 429 retry-after + drive a setInterval countdown.
- **Risk:** Low.

### W-T1-P6: Transaction detail page
- **File:** No equivalent on web. iOS has [ios/Tago/Features/Payment/TransactionDetailPage.swift](ios/Tago/Features/Payment/TransactionDetailPage.swift)
- **What's missing:** Tappable rows → detail view with signed amount hero, status pill, withdrawal-failure banner with parsed Stripe reason, copyable Stripe IDs, "View ride details" deep link, settle date, wallet-balance-after.
- **Fix:** Build a `/wallet/transaction/:id` route.
- **Risk:** Medium — needs server fields exposed.

### W-T1-P7: Bank-onboard "post-ride nudge" modal (web has, iOS missing)
- **Web file:** [src/components/ride/BankOnboardPrompt.tsx](src/components/ride/BankOnboardPrompt.tsx)
- **iOS file needing change:** No equivalent — only has the inline `bankPromptIfNeeded` row on `WalletHubPage`.
- **What's missing:** Full post-ride modal that re-arms when balance grows past last-dismissed amount, fires analytics.
- **Fix:** Port as a post-ride sheet.
- **Risk:** Low.

### W-T1-P8: Wallet/card split row on Web RideSummary (iOS missing)
- **Web file:** [src/components/ride/RideSummaryPage.tsx:190-208](src/components/ride/RideSummaryPage.tsx)
- **iOS file needing change:** [ios/Tago/Features/RiderHome/RideSummaryPage.swift:923-967](ios/Tago/Features/RiderHome/RideSummaryPage.swift)
- **What's missing:** "Paid · $5.00 wallet + $4.50 card" line so rider understands the two transactions.
- **Fix:** Query transactions table for fare_debit/wallet_refund pairs.
- **Risk:** Low.

### W-T1-P9: Driver "Settling with the rider" reassurance (drivers see scary "Payment failed" copy)
- **File:** [src/components/ride/RideSummaryPage.tsx:340-378](src/components/ride/RideSummaryPage.tsx)
- **Issue:** Both rider AND driver see "PAYMENT FAILED" pill. Drivers didn't fail anything.
- **iOS reference:** [ios/Tago/Features/RiderHome/RideSummaryPage.swift:324-374](ios/Tago/Features/RiderHome/RideSummaryPage.swift) shows neutral "Payment pending" + reassurance: "You earned this fare. We're working with the rider's card to settle. You'll see this credited to your wallet within 48 hours."
- **Fix:** Branch by role; never show "failed" to drivers.
- **Risk:** None. Pure copy improvement.

## Auth / Onboarding

### W-T1-A1: Web doesn't keep profile in any cache → network blip drops user to onboarding
- **File:** Covered as W-T0-3 above.

### W-T1-A2: Mandatory photo gate (iOS) vs optional (web)
- **File:** [src/components/auth/CreateProfilePage.tsx:342-344](src/components/auth/CreateProfilePage.tsx) labels photo `(optional)`.
- **iOS reference:** [ios/Tago/Features/Auth/CreateProfilePage.swift:64-85](ios/Tago/Features/Auth/CreateProfilePage.swift) — photo required.
- **Issue:** Platforms disagree on whether photo is required. iOS made it mandatory 2026-04-30.
- **Fix:** Decide policy. If keeping mandatory, drop "(optional)" and gate web submit; otherwise relax iOS.
- **Risk:** Low product decision.

### I-T1-A1: No password field at CreateProfile (iOS OTP-only signup leaves users unable to use web login password path)
- **File:** [ios/Tago/Features/Auth/CreateProfilePage.swift](ios/Tago/Features/Auth/CreateProfilePage.swift)
- **Web reference:** [src/components/auth/CreateProfilePage.tsx:295-308](src/components/auth/CreateProfilePage.tsx)
- **Issue:** User signs up on iOS via 8-digit OTP, never sets a password. iOS LoginPage requires a password (line 50-52); "Send login code" works but the password path is dead.
- **Fix:** Either (a) add a password field to iOS CreateProfile to match web; OR (b) document that "Send login code" is the primary path.
- **Risk:** Low.

### I-T1-A2: "Wrong number? Change it" inline-edit on PhoneVerificationPage
- **File:** [ios/Tago/Features/Auth/PhoneVerificationPage.swift](ios/Tago/Features/Auth/PhoneVerificationPage.swift)
- **Web reference:** [src/components/auth/PhoneVerificationPage.tsx:367-417](src/components/auth/PhoneVerificationPage.tsx)
- **Issue:** Re-verify path on iOS only allows OTP entry; no inline phone-change for users with stale numbers.
- **Fix:** Add inline tel input + Send button when `isExistingUser` (has full_name + landing here).
- **Risk:** Medium.

### I-T1-A3: Phone-verify send-failure recovery UI
- **File:** [ios/Tago/Features/Auth/PhoneVerificationPage.swift](ios/Tago/Features/Auth/PhoneVerificationPage.swift)
- **Web reference:** [src/components/auth/PhoneVerificationPage.tsx:237-271](src/components/auth/PhoneVerificationPage.tsx)
- **Issue:** Initial SMS send failure on iOS shows a small error text but no Sign-Out / change-number escape. User is stranded.
- **Fix:** Add explicit retry / use-different-number / sign-out CTAs in a dedicated error state.
- **Risk:** Medium.

### I-T1-A4: PostHog analytics events on auth funnel
- **Files:** All iOS auth pages.
- **Web reference:** [src/components/Signup.tsx:67](src/components/Signup.tsx) (signup_started), etc.
- **Issue:** Without these events, conversion-funnel comparisons between platforms break.
- **Fix:** Wire to existing iOS analytics helper.
- **Risk:** Low.

### I-T1-A5: Intro carousel after sign-in (web has, iOS missing)
- **File:** A new `ios/Tago/Features/Onboarding/IntroCarouselPage.swift`
- **Web reference:** [src/components/onboarding/IntroCarousel.tsx](src/components/onboarding/IntroCarousel.tsx) — 5-slide pitch shown once.
- **Fix:** Build SwiftUI `TabView(.page)` equivalent OR drop intentionally.
- **Risk:** Medium — new screen + assets.

## Messaging / Chat

### W-T1-M1: No optimistic outgoing message bubbles (iOS feels Uber-class, web slow)
- **File:** [src/components/ride/MessagingWindow.tsx:678-727](src/components/ride/MessagingWindow.tsx)
- **iOS reference:** [ios/Tago/Features/Messaging/MessagesViewModel.swift:274-326](ios/Tago/Features/Messaging/MessagesViewModel.swift)
- **What's missing:** Optimistic bubble with temp UUID at 55% opacity; swap to authoritative on HTTP return; mark `.failed` on error.
- **Fix:** Add optimistic `setMessages` before fetch, replace by id on response. Use the same `hasRecentLocalMatch` dedup against realtime echo.
- **Risk:** Low. Realtime dedup already handles the echo race on web.

### W-T1-M2: Phase machine (pickup/dropoff banners gated by negotiation phase)
- **File:** [src/components/ride/MessagingWindow.tsx](src/components/ride/MessagingWindow.tsx)
- **iOS reference:** [ios/Tago/Features/Messaging/MessagesViewModel+Phase.swift](ios/Tago/Features/Messaging/MessagesViewModel+Phase.swift)
- **Issue:** Web renders both pickup and dropoff banners simultaneously when proposals exist. A stale pickup_suggestion can get an Accept button during dropoff phase.
- **Fix:** Adopt the `.dropoff → .pickup → .complete` phase machine.
- **Risk:** Medium. Touches the messy banner logic.

### W-T1-M3: Day-divider + sender-run grouping in chat
- **File:** [src/components/ride/MessagingWindow.tsx](src/components/ride/MessagingWindow.tsx)
- **iOS reference:** [ios/Tago/Features/Messaging/MessagingPage.swift:1136-1188](ios/Tago/Features/Messaging/MessagingPage.swift)
- **What's missing:** Calendar-day dividers + only-last-of-run timestamps/avatars (Messages.app pattern).
- **Fix:** Same grouping logic.
- **Risk:** Low.

### W-T1-M4: Pull-to-dismiss-keyboard + tap-outside-to-dismiss
- **File:** [src/components/ride/MessagingWindow.tsx](src/components/ride/MessagingWindow.tsx)
- **Issue:** Mobile web keyboard traps the user.
- **Fix:** `onClick` on scroll container → `blur()` input.
- **Risk:** Low.

### W-T1-M5: Missed scheduled ride empty state
- **File:** [src/components/ride/MessagingWindow.tsx:330-337](src/components/ride/MessagingWindow.tsx) HAS it. **iOS does NOT.**
- **iOS file needing change:** [ios/Tago/Features/Messaging/MessagingPage.swift](ios/Tago/Features/Messaging/MessagingPage.swift) `cancelledView`
- **Fix:** Detect `status === 'cancelled' && schedule_id && minutesUntilRide < 0 && !started_at` and render dedicated empty state.
- **Risk:** Low.

### I-T1-M1: Pin-dropper lacks address-search autocomplete
- **File:** [ios/Tago/Features/Messaging/MapPickerPage.swift](ios/Tago/Features/Messaging/MapPickerPage.swift)
- **Web reference:** [src/components/ride/MessagingWindow.tsx:1310-1357](src/components/ride/MessagingWindow.tsx) — full-screen pin dropper with Google Places autocomplete.
- **Issue:** iOS only allows drag/tap to place pin; web has typeahead search.
- **Fix:** Add `searchPlaces`-style autocomplete via existing GooglePlaces SDK on iOS.
- **Risk:** Medium.

### I-T1-M2: TransitInfo chips inside non-transit dropoff cards (rider side)
- **Files:** [ios/Tago/Features/Messaging/DropoffProposalCard.swift](ios/Tago/Features/Messaging/DropoffProposalCard.swift), [LocationAcceptedCard.swift](ios/Tago/Features/Messaging/LocationAcceptedCard.swift)
- **Web reference:** [src/components/ride/MessagingWindow.tsx:1774-1784](src/components/ride/MessagingWindow.tsx) renders `<TransitInfo />` inline.
- **What's missing:** When a non-transit dropoff is proposed, rider sees a "Transit from dropoff" mini-section walking from the proposed pin to their original destination.
- **Fix:** Add a TransitInfo-style view that calls `GET /api/transit/options`.
- **Risk:** Medium.

## Emergency / QR

### W-T1-E1: Emergency sheet missing "Stop sharing location" + "Text trusted contacts"
- **File:** [src/components/ui/EmergencySheet.tsx](src/components/ui/EmergencySheet.tsx)
- **iOS reference:** [ios/Tago/Features/Safety/EmergencySheet+TrustedContacts.swift](ios/Tago/Features/Safety/EmergencySheet+TrustedContacts.swift)
- **What's missing:** iOS has text-trusted-contacts via SMS composer + stop-sharing-location row + revoke flow. Web has 3 buttons (Call 911, Share location, Report unsafe).
- **Fix:** Add Trusted Contacts row + Stop Sharing affordance + revoke flow.
- **Risk:** Medium — needs profile-trusted-contacts UI + Twilio SMS template.

### I-T1-E1: Verify iOS Emergency sheet survives drawer dismissal
- **File:** [ios/Tago/Features/RiderHome/RiderActiveRidePage.swift:93-100](ios/Tago/Features/RiderHome/RiderActiveRidePage.swift)
- **Issue:** Sheet is presented from a drawer instance, not a portal. CLAUDE.md hard rule says "always in a React portal" — iOS satisfies the intent via the top-bar SOS pill but the sheet itself is hosted on the drawer (`.constant(true)`). Fragile to changes.
- **Fix:** Audit that drawer is genuinely always presented mid-ride. Long-term: present sheet from the page root.
- **Risk:** Low (currently working; risk is regression-prone).

---

# Tier 2 — Polish, copy, edge cases

This section consolidates smaller items. Each row is a 1-2 line fix.

## Web copy improvements (port from iOS)
- [src/components/ride/MessagingWindow.tsx:2185-2188](src/components/ride/MessagingWindow.tsx) — driver-cancelled modal copy. Use iOS: "Driver cancelled · {N} other drivers are ready to take this ride right now."
- [src/components/ride/WaitingRoom.tsx:670](src/components/ride/WaitingRoom.tsx) — "No drivers available right now" → vary based on whether drivers were notified ([WaitingRoomPage.swift:649](ios/Tago/Features/RiderHome/WaitingRoomPage.swift) fanoutHeadline).
- [src/components/ride/WaitingRoom.tsx:494](src/components/ride/WaitingRoom.tsx) — Add the "X accepted — confirming route…" interstitial when driverDestinationName==nil.
- [src/components/ride/RideSummaryPage.tsx:332](src/components/ride/RideSummaryPage.tsx) — "Ride Complete!" → "Trip complete" + amount as hero (more Uber-feel).
- [src/components/ride/RideSummaryPage.tsx:534](src/components/ride/RideSummaryPage.tsx) — "Rate Your Driver" → "How was your trip?" + inline stars.
- [src/components/payment/PaymentMethodsPage.tsx](src/components/payment/PaymentMethodsPage.tsx) — Add trust footer: "Cards are charged after a ride completes — never before. No charge if a ride is cancelled or never confirmed."
- [src/components/payment/SaveCardPage.tsx:215-217](src/components/payment/SaveCardPage.tsx) — Replace "Your card will be charged automatically after each ride" with iOS's calmer "Saving a card doesn't charge you…"
- [src/components/ride/WithdrawSheet.tsx](src/components/ride/WithdrawSheet.tsx) — Add irreversibility warning copy.

## Web functionality improvements
- [src/components/payment/PaymentMethodsPage.tsx:50-70](src/components/payment/PaymentMethodsPage.tsx) — Set-default rollback on failure (web swallows error silently; iOS rolls back local state).
- [src/components/payment/PaymentMethodsPage.tsx:177](src/components/payment/PaymentMethodsPage.tsx) — Delete card confirmation dialog (web deletes immediately).
- [src/components/ride/NotificationsPage.tsx:113-124](src/components/ride/NotificationsPage.tsx) — Restore the row on optimistic-remove failure.
- [src/components/ride/RideRequestNotification.tsx:87](src/components/ride/RideRequestNotification.tsx) — Banner countdown is 90s but server offer expires at 150s. Align to 150s or remove the banner-level timer.
- [src/components/ride/MyRidesPage.tsx](src/components/ride/MyRidesPage.tsx) — Reverse-geocoded pickup label per active-ride row (cosmetic).
- [src/components/ride/WaitingRoom.tsx:728-735](src/components/ride/WaitingRoom.tsx) — Add cancel confirmation dialog (currently fires `handleCancel` without confirm).
- [src/components/ride/RiderActiveRidePage.tsx](src/components/ride/RiderActiveRidePage.tsx) — Move emergency button from drawer to a fixed top-bar pill (always reachable per CLAUDE.md rule).
- [src/components/ride/WalletPage.tsx](src/components/ride/WalletPage.tsx) — Add `document.visibilitychange` → invalidateQueries(['wallet-*']) so webhook-landed top-ups appear on tab refocus.
- [src/components/ride/DriverPickupPage.tsx:455-459](src/components/ride/DriverPickupPage.tsx) — Add maps chooser (Google / Apple Maps web / Waze) instead of hardcoded Google.
- [src/lib/notification-actions](src/lib) — Add Accept/Decline action buttons to `firebase-messaging-sw.js showNotification` for `board_request` and `ride_request` (Chrome only; Safari ignores). Wire action handlers in `notificationclick`.
- [public/firebase-messaging-sw.js:84-97](public/firebase-messaging-sw.js) — Notification routing for `dropoff_reminder` falls through to `/notifications`; add explicit route.

## iOS functionality improvements
- [ios/Tago/Features/RiderHome/RideConfirmPage.swift:371-377](ios/Tago/Features/RiderHome/RideConfirmPage.swift) — Disable Request Ride when `directions == nil` (iOS already does this; verify).
- [ios/Tago/Features/RideBoard/RideBoardConfirmSheet.swift](ios/Tago/Features/RideBoard/RideBoardConfirmSheet.swift) — Wire `estimated_fare_cents` (covered in I-T0-1).
- [ios/Tago/Features/Profile/AvatarPicker.swift:184-186](ios/Tago/Features/Profile/AvatarPicker.swift) — Already appends cache-buster `?t=...`. Web counterpart [ProfilePage.tsx:290-291](src/components/ride/ProfilePage.tsx) does NOT. Sync.
- [ios/Tago/Features/Auth/ForgotPasswordPage.swift](ios/Tago/Features/Auth/ForgotPasswordPage.swift) — Add "Check your email" success panel for parity with web (currently jumps straight to CheckInbox).
- [ios/Tago/Features/Auth/SignupPage.swift](ios/Tago/Features/Auth/SignupPage.swift) — Add Terms / Privacy links + ".edu only" trust line.
- [ios/Tago/Features/Auth/CheckInboxPage.swift](ios/Tago/Features/Auth/CheckInboxPage.swift) — Already has "Wrong email? Go back"; **port to web** instead.

---

# Tier 3 — Intentional native-only divergences

Document these so they aren't mistaken for bugs:

1. **Live Activity / Dynamic Island** — iOS lock-screen ride card. ([RideActivityController.swift](ios/Tago/Features/LiveActivity/RideActivityController.swift), [server/routes/liveActivity.ts](server/routes/liveActivity.ts)). No web equivalent — PWAs can't render Live Activities. Action: ensure messaging-time state transitions (driver_cancelled, dropoff_confirmed) also call `RideActivityController.update` so the lock-screen card doesn't go stale.
2. **Wake-up silent push** — iOS PushManager fetches GPS within 4s and upserts driver_locations. PWAs can't reliably background-execute. Keep diverged.
3. **MKDirections in-app turn-by-turn nav** — iOS DriverNavController + PickupTurnByTurnBanner. Web hands off to Google Maps via `window.open`. Keep diverged.
4. **Apple Pay / Google Pay top-up** — iOS uses PKPaymentButton; web could add Stripe Payment Request Button (see W-T1-P1). Currently diverged; web could partially close the gap.
5. **Embedded Stripe Connect onboarding** — iOS uses `AccountOnboardingController` inline; web does a full-page redirect. Web's pattern is more reliable; keep diverged unless conversion data argues otherwise.
6. **Lock-screen action buttons** — iOS UNNotificationCategory with Accept/Decline/Snooze. Chrome web push supports `actions` array; Safari doesn't. Partial parity possible on Chrome.
7. **Trusted-contacts SMS via system composer** — iOS uses `MFMessageComposeViewController`; web could use `navigator.share` with pre-filled message or Twilio API. See W-T1-E1.
8. **Native QR scanner (DataScannerViewController)** — iOS 16+ system component with corner brackets, pinch-zoom; web uses `html5-qrcode` library. Both work; iOS feels native.
9. **Photo crop sheet** — iOS has it on CreateProfile + AvatarPicker; web uploads raw. Could add a web cropper (e.g. `react-image-crop`).
10. **`progress_pct` write-back** — Web writes, iOS doesn't. Covered I-T1-R2.

---

# Cross-cutting observations

1. **iOS is consistently more defensive against transient failures.** Optimistic operations are paired with rollback paths; envelope unwrapping handles both broadcast shapes; cancellation gates are idempotent. Web is more "happy-path" coded. Aligning web on iOS's reliability patterns would reduce the support-ticket tail meaningfully.

2. **iOS makes destructive actions explicit and confirmable; web often fires them silently.** Cancel ride, delete card, delete routine, withdraw funds — iOS always confirms first; web fires on first tap. Add confirmation modals on the web wherever the action is irreversible from Tago's side.

3. **iOS uses lowercase UUIDs in channel names defensively.** Per CLAUDE.md memory rule. Web doesn't need to but should document it for new contributors.

4. **Realtime broadcast envelope unwrap** — iOS handles both shapes (web-broadcast nested, iOS-broadcast flat). Documented in CLAUDE.md but worth a one-line comment in `MessagesViewModel`, `BoardEventListener`, and `DriverGroupChatViewModel`.

5. **Stripe Live Mode coordination** — confirmed working today. EC2 has `sk_live_51T9AU7...` matching iOS Release `pk_live_51T9AU79...`. Maintain this in the future by checking the iOS xcconfig comment block ([ios/Tago.Release.xcconfig:11-31](ios/Tago.Release.xcconfig)) on every Stripe-key change.

6. **Notifications routing — iOS has 4 input layers** (realtime / FCM foreground / push tap / cold-launch inbox bootstrap). Web has 2 (realtime / SW click). Web's resilience to missed FCM deliveries is therefore lower.

---

# File index (one-line summary)

| File | Tier | Issue |
|---|---|---|
| src/components/ride/MyRidesPage.tsx:114 | T0 | Board-request cancel hits wrong endpoint |
| src/components/ride/RideSuggestion.tsx:300 | T0 | Driver decline doesn't release offer |
| src/components/ride/RideRequestNotification.tsx:100 | T0 | Same as above for banner dismiss |
| src/stores/authStore.ts:293 | T0 | Profile drops on transient fetch error |
| src/components/ride/RideRequestNotification.tsx:526 | T0 | Cold-launch driver misses still-actionable requests |
| public/firebase-messaging-sw.js:8 | T0 | Hardcoded prod Firebase projectId |
| src/components/schedule/RideBoard.tsx:406 | T0 | Routine "delete" is soft-pause, not hard-delete |
| src/components/ride/DropoffSelection.tsx:276 | T0 | Outdated fare formula |
| src/components/ride/ProfilePage.tsx:307 | T0 | Phone re-verify commented out |
| src/components/auth/AuthCallback.tsx | T0 | Email-link expiry not surfaced |
| src/lib/fcm.ts | T0 | Foreground payment/schedule_match push is silent |
| src/components/ride/NotificationsPage.tsx:240 | T0 | Stale ride_request window 1h (should be 5min) |
| src/components/driver/DriverPayoutsPage.tsx:148 | T0 | Missing needsReverification branch |
| ios/Tago/Core/Networking/Endpoints/ScheduleRequestEndpoint.swift:38 | T0 | Missing estimated_fare_cents |
| ios/Tago/Features/RideBoard/RideBoardConfirmViewModel.swift:116 | T0 | No is_driver gate on offer-to-drive |
| ios/Tago/Features/DriverHome/DriverActiveRidePage.swift | T0 | No driver-side /gps-ping loop |
| ios/Tago/Features/Messaging/MessagingPage.swift:636 | T0 | Cancel modal hard-codes "rider" |
| ios/Tago/Features/RiderHome/RiderActiveRideDrawer.swift | T0 | No chat-badge:{rideID} subscription |
| ios/Tago/Features/Messaging/MessagingSubviews.swift | T0 | Missing vehicle row in chat header (rider side) |
| (multiple) | T0 | find-new-driver residual stale-state tail (deferred to v2) |
| src/components/ride/RideSummaryPage.tsx | T1 | No tip flow + driver sees "PAYMENT FAILED" copy |
| src/components/ride/MessagingWindow.tsx:2176 | T1 | No DriverCancelledChoiceOverlay |
| src/components/ride/RiderPickupPage.tsx:196 | T1 | Auto-dismiss banner anti-pattern |
| ios/Tago/Features/RiderHome/ (new file) | T1 | No RiderPickupPage screen at all |
| ios/Tago/Features/RiderHome/RiderActiveRidePage+Live.swift:282 | T1 | No live rider_location broadcast |
| src/components/ride/RideRequestNotification.tsx:1142 | T1 | No decline reason / snooze sheet |
| src/components/ride/DriverHomePage.tsx:288 | T1 | No snooze pill on driver home |
| src/components/ride/RideSuggestion.tsx:323 | T1 | Single-step accept (forces destination upfront) |
| ios/Tago/Features/DriverHome/RideRequestListener.swift:212 | T1 | No driver_selected listener |
| ios/Tago/Features/DriverHome/DriverPickupPage.swift | T1 | No driver-side pickup pin-drop |
| ios/Tago/Features/DriverHome/RideSuggestionPage.swift:438 (web side change) | T1 | Web suggestion missing "1 of N" badge |
| ios/Tago/Features/DriverHome/DriverHomePage.swift:333 | T1 | No pending-earnings pill on iOS home |
| ios/Tago/Features/DriverHome/DriverPickupPage.swift:947 (web side change) | T1 | Web missing in-app new-message banner |
| src/components/schedule/SchedulePage.tsx | T1 | No edit-existing-schedule path |
| src/components/schedule/RideBoard.tsx:933 | T1 | No Pause/Resume on routines |
| src/components/schedule/RideBoard.tsx | T1 | No city chip strip |
| src/components/schedule/boardFilters.ts:19 | T1 | Default sort wrong |
| src/components/ride/BoardRequestReview.tsx:135 | T1 | No decline reason picker |
| src/components/ride/BoardRequestReview.tsx | T1 | No status-aware action bar |
| src/components/schedule/RideBoardCard.tsx:141 | T1 | "Offer Sent" vs "Request Sent" asymmetric badges |
| src/components/schedule/RideBoardFilterSheet.tsx:125 | T1 | Wrong "Near me only" copy |
| src/components/ride/AddFundsPage.tsx | T1 | No Apple Pay / saved-card top-up |
| src/components/ride/WithdrawSheet.tsx | T1 | Full-balance only + no confirm |
| src/components/ride/WalletPage.tsx:325 | T1 | No live nudge cooldown |
| (new file) | T1 | No transaction detail page on web |
| ios/Tago/Features/Wallet/ | T1 | No post-ride bank-onboard modal |
| ios/Tago/Features/RiderHome/RideSummaryPage.swift:923 | T1 | No wallet/card split row |
| ios/Tago/Features/Auth/CreateProfilePage.swift | T1 | No password field at signup |
| ios/Tago/Features/Auth/PhoneVerificationPage.swift | T1 | No "wrong number? change it" |
| ios/Tago/Features/Auth/PhoneVerificationPage.swift | T1 | No send-failure recovery UI |
| ios/Tago/Features/Auth/ (multiple) | T1 | Missing PostHog analytics events |
| ios/Tago/Features/Onboarding/ (new file) | T1 | No intro carousel |
| src/components/ride/MessagingWindow.tsx:678 | T1 | No optimistic send |
| src/components/ride/MessagingWindow.tsx | T1 | No phase machine / day dividers / kbd dismiss |
| src/components/ride/MessagingWindow.tsx:330 | T1 | (iOS side change) Missed-scheduled-ride empty state |
| ios/Tago/Features/Messaging/MapPickerPage.swift | T1 | No address-search autocomplete on pin-drop |
| ios/Tago/Features/Messaging/DropoffProposalCard.swift | T1 | No TransitInfo chips inline |
| src/components/ui/EmergencySheet.tsx | T1 | Missing trusted-contacts + stop-sharing |

---

# Recommended sequencing

**Sprint 1 (correctness — 2-3 days for one engineer):**
- W-T0-1 (MyRides cancel endpoint mismatch)
- W-T0-2 (driver decline doesn't release offer)
- W-T0-3 (auth profile drops on failure)
- W-T0-4 (cold-launch driver misses requests)
- W-T0-7 (outdated fare formula)
- W-T0-11 (stale ride_request window)
- I-T0-1 (iOS estimated_fare_cents)
- I-T0-4 (cancel modal "rider" hardcode)
- I-T0-5 (chat-badge subscription)

**Sprint 2 (highest-impact UX gaps — 1 week):**
- W-T1-R1 (web tip flow)
- W-T1-R3 (DriverCancelledChoiceOverlay)
- W-T1-D1 (decline reason + snooze sheet)
- W-T1-D3 (two-step accept)
- I-T1-R1 (iOS RiderPickupPage) — biggest single iOS gap

**Sprint 3 (parity polish):**
- All remaining T1 items (board polish, payment polish, auth polish, messaging polish)
- T2 copy/edge-case improvements

**Backlog / v2:**
- T3 intentional divergences — keep as architectural notes
- find-new-driver residual stale-state tail (deferred per memory file)
- Intro carousel (iOS) — UX gain is real but not blocking

---

End of report. Generated 2026-05-12 by 6-agent parallel parity audit.
